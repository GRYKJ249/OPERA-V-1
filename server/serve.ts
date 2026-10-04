import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, purgeExpired } from './db.ts';
import { login, getSession, logout } from './auth.ts';
import { register, verifyEmail, verifySignupCode, resendVerifyCode, requestReset, resetPassword, limited } from './accounts.ts';
import { startOAuth, finishOAuth, isProvider, configured, oauthDiagnostics } from './oauth.ts';
import { registerOptions, registerVerify, loginOptions, loginVerify } from './passkeys.ts';
import { createGiteaRepository, GiteaError, giteaStatus, isGiteaConfigured } from './gitea.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 5000);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SECURE = process.env.NODE_ENV === 'production';
const GITEA_TARGET = new URL('http://127.0.0.1:3000');
const db = openDb();
await db.query('SELECT 1');
await purgeExpired(db);
setInterval(() => { void purgeExpired(db).catch((error) => console.error('[database] cleanup failed', error)); }, 3600_000).unref();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};
const BLOCKED = ['/server', '/db', '/database', '/scripts', '/docs', '/src', '/config', '/node_modules', '/.git', '/attached_assets'];

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
};
const cookieOf = (req: IncomingMessage, name: string) => req.headers.cookie?.split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];
const clientIp = (req: IncomingMessage) => (TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || undefined;
/** أصل الموقع (للروابط وعناوين الرجوع والبصمة): PUBLIC_URL إن وُجد، وإلا يُستنتج من الطلب. أي دومين حقيقي = https، وlocalhost/IP = http */
const originOf = (req: IncomingMessage) => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.trim().replace(/\/+$/, '');
  const host = String(req.headers.host ?? '');
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() : '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/.test(host);
  return `${fwd || (SECURE || !local ? 'https' : 'http')}://${host}`;
};
/** مسار رجوع Google هو المسجَّل عند Google (/auth/google/callback)، وGitHub يبقى على /api/auth/oauth/github/callback */
const callbackPath = (prov: string) => prov === 'google' ? '/auth/google/callback' : `/api/auth/oauth/${prov}/callback`;
const tmpCookie = (name: string, v: string, maxAge: number) => `${name}=${v}; HttpOnly; SameSite=${name === 'op_oauth' ? 'Lax' : 'Strict'}; Path=${name === 'op_oauth' ? '/' : '/api/auth'}; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;
const redirect = (res: ServerResponse, to: string, cookies: string[] = []) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }); res.end(); };
const sessionCookie = (v: string, maxAge: number) => `op_session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

function readBody(req: IncomingMessage, limit = 8192): Promise<any> {
  return new Promise((ok, no) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', c => { size += c.length; if (size > limit) { no(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { no(new Error('bad json')); } });
    req.on('error', no);
  });
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  // حماية CSRF: الطلبات المغيّرة يجب أن تأتي من نفس الأصل
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'forbidden' });
  }
  const token = cookieOf(req, 'op_session');
  if (path === '/api/auth/login' && req.method === 'POST') {
    let b: any; try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    const r = await login(db, { email: b.email, password: b.password, remember: !!b.remember, ip: clientIp(req), ua: req.headers['user-agent'] });
    if (!r.ok) return json(res, r.code === 'blocked' ? 429 : r.code === 'locked' ? 423 : r.code === 'pending' ? 403 : 401, { error: r.code });
    return json(res, 200, { user: r.user, restored: r.restored ?? null }, { 'Set-Cookie': sessionCookie(r.token, r.maxAgeSec) });
  }
  if (path === '/api/auth/register' && req.method === 'POST') {
    let b: any; try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    const r = await register(db, { name: b.name, email: b.email, password: b.password, terms: !!b.terms, ip: clientIp(req), origin: originOf(req) });
    return r.ok ? json(res, 200, { ok: true, resumed: !!r.resumed }) : json(res, r.code === 'rate_limited' ? 429 : r.code === 'closed' ? 403 : r.code === 'email_exists' ? 409 : 400, { error: r.code });
  }
  if (path === '/api/auth/verify-code' && req.method === 'POST') {
    let b: any; try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    if (await limited(db, `verifycode:${clientIp(req) ?? '-'}`, 20)) return json(res, 429, { error: 'rate_limited' });
    const r = await verifySignupCode(db, { email: String(b.email ?? ''), code: String(b.code ?? '') });
    return r === 'ok' ? json(res, 200, { ok: true }) : json(res, 400, { error: r });
  }
  if (path === '/api/auth/resend-code' && req.method === 'POST') {
    let b: any; try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    const r = await resendVerifyCode(db, { email: b.email, ip: clientIp(req) });
    return r.ok ? json(res, 200, { ok: true }) : json(res, 429, { error: r.code });
  }
  if (path === '/api/auth/verify' && req.method === 'GET') {
    const ok = await verifyEmail(db, new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? '');
    res.writeHead(302, { Location: `/pages/login.html?verified=${ok ? 1 : 0}` }); return res.end();
  }
  if (path === '/api/auth/forgot' && req.method === 'POST') {
    let b: any; try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    const r = await requestReset(db, { email: b.email, ip: clientIp(req), origin: originOf(req) });
    return r.ok ? json(res, 200, { ok: true }) : json(res, 429, { error: r.code });
  }
  if (path === '/api/auth/reset' && req.method === 'POST') {
    let b: any; try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    if (await limited(db, `resetcode:${clientIp(req)}`, 20)) return json(res, 429, { error: 'rate_limited' });
    const r = await resetPassword(db, { email: String(b.email ?? ''), code: String(b.code ?? ''), password: String(b.password ?? '') });
    return r === 'ok' ? json(res, 200, { ok: true }) : json(res, 400, { error: r });
  }
  if (path === '/api/auth/providers' && req.method === 'GET') return json(res, 200, { ...configured(), passkey: true });

  if (path === '/api/admin/gitea/status' && req.method === 'GET') {
    const me = await getSession(db, token);
    if (!me) return json(res, 401, { error: 'unauthenticated' });
    if (!me.roles.includes('admin')) return json(res, 403, { error: 'forbidden' });
    return json(res, 200, await giteaStatus());
  }
  const repositoryPath = path.match(/^\/api\/admin\/projects\/(\d+)\/repository$/);
  if (repositoryPath && req.method === 'POST') {
    const me = await getSession(db, token);
    if (!me) return json(res, 401, { error: 'unauthenticated' });
    if (!me.roles.includes('admin')) return json(res, 403, { error: 'forbidden' });
    const projectId = Number(repositoryPath[1]);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return json(res, 400, { error: 'bad_request' });
    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    const project = await db.prepare('SELECT id, slug FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId);
    if (!project) return json(res, 404, { error: 'project_not_found' });
    const name = String(body.name ?? project.slug).trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name)) return json(res, 400, { error: 'invalid_repository_name' });
    if (!isGiteaConfigured()) return json(res, 503, { error: 'gitea_not_configured' });

    const existing = await db.prepare('SELECT state FROM project_repositories WHERE project_id = ?').get(projectId);
    if (existing?.state === 'active') return json(res, 409, { error: 'repository_already_linked' });
    if (existing?.state === 'pending') return json(res, 409, { error: 'repository_creation_in_progress' });
    if (existing?.state === 'failed') await db.prepare('DELETE FROM project_repositories WHERE project_id = ?').run(projectId);
    try {
      await db.prepare(`INSERT INTO project_repositories (project_id, repository_name, is_private, state)
        VALUES (?, ?, 1, 'pending')`).run(projectId, name);
    } catch {
      return json(res, 409, { error: 'repository_link_conflict' });
    }

    try {
      const repository = await createGiteaRepository(name, `Opera project: ${project.slug}`);
      await db.prepare(`UPDATE project_repositories SET gitea_repository_id = ?, owner = ?, repository_name = ?,
        clone_url = ?, html_url = ?, is_private = 1, state = 'active', last_error_code = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id = ?`)
        .run(repository.id, repository.owner, repository.name, repository.cloneUrl, repository.htmlUrl, projectId);
      return json(res, 201, { projectId, repository: { owner: repository.owner, name: repository.name, cloneUrl: repository.cloneUrl, htmlUrl: repository.htmlUrl, private: true } });
    } catch (error) {
      const code = error instanceof GiteaError ? error.code : 'repository_link_failed';
      await db.prepare(`UPDATE project_repositories SET state = 'failed', last_error_code = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id = ?`).run(code, projectId).catch(() => undefined);
      const status = error instanceof GiteaError ? (error.status === 409 ? 409 : error.code === 'gitea_unreachable' ? 503 : 502) : 500;
      return json(res, status, { error: code });
    }
  }

  // ---- Google / GitHub ----
  const oa = path.match(/^\/api\/auth\/oauth\/([a-z]+)(\/callback)?$/);
  if (oa && req.method === 'GET') {
    const prov = oa[1]; if (!isProvider(prov)) return json(res, 404, { error: 'not_found' });
    const redirectUri = `${originOf(req)}${callbackPath(prov)}`;
    if (!oa[2]) console.log(`[oauth] ${prov} redirect_uri = ${redirectUri}`);
    if (!oa[2]) {
      if (await limited(db, `oauth:${clientIp(req) ?? '-'}`, 60)) return redirect(res, '/pages/login.html?oauth=blocked');
      const st = startOAuth(prov, redirectUri);
      return st ? redirect(res, st.url, [tmpCookie('op_oauth', st.cookie, 600)]) : redirect(res, '/pages/login.html?oauth=not_configured');
    }
    const q = new URL(req.url ?? '', 'http://x').searchParams;
    if (q.get('error')) return redirect(res, '/pages/login.html?oauth=denied', [tmpCookie('op_oauth', '', 0)]);
    const r = await finishOAuth(db, prov, { code: q.get('code') ?? '', state: q.get('state') ?? '', cookie: cookieOf(req, 'op_oauth'), redirectUri, ip: clientIp(req), ua: req.headers['user-agent'] });
    if (!r.ok) return redirect(res, `/pages/login.html?oauth=${r.code}`, [tmpCookie('op_oauth', '', 0)]);
    return redirect(res, '/git/', [sessionCookie(r.token, r.maxAgeSec), tmpCookie('op_oauth', '', 0)]);
  }

  // ---- البصمة (WebAuthn) ----
  if (path.startsWith('/api/auth/passkey/') && req.method === 'POST') {
    let b: any; try { b = await readBody(req, 32768); } catch { return json(res, 400, { error: 'bad_request' }); }
    const origin = originOf(req), wa = cookieOf(req, 'op_wa');
    if (path === '/api/auth/passkey/register/options' || path === '/api/auth/passkey/register/verify') {
       const me = await getSession(db, token); if (!me) return json(res, 401, { error: 'unauthenticated' });
       if (path.endsWith('options')) { const o = await registerOptions(db, me, origin); return json(res, 200, o.options, { 'Set-Cookie': tmpCookie('op_wa', o.cookie, 300) }); }
       const r = await registerVerify(db, me, origin, wa, b);
      return r.ok ? json(res, 200, { ok: true }, { 'Set-Cookie': tmpCookie('op_wa', '', 0) }) : json(res, 400, { error: r.code });
    }
    if (path === '/api/auth/passkey/login/options') {
      if (await limited(db, `pk:${clientIp(req) ?? '-'}`, 60)) return json(res, 429, { error: 'blocked' });
      const o = await loginOptions(db, origin);
      return o ? json(res, 200, o.options, { 'Set-Cookie': tmpCookie('op_wa', o.cookie, 300) }) : json(res, 404, { error: 'no_passkey' });
    }
    if (path === '/api/auth/passkey/login/verify') {
      const r = await loginVerify(db, origin, wa, { ip: clientIp(req), ua: req.headers['user-agent'] }, b);
      if (!r.ok) return json(res, r.code === 'blocked' ? 429 : r.code === 'locked' ? 423 : 401, { error: r.code }, { 'Set-Cookie': tmpCookie('op_wa', '', 0) });
      return json(res, 200, { user: r.user }, { 'Set-Cookie': [sessionCookie(r.token, r.maxAgeSec), tmpCookie('op_wa', '', 0)] });
    }
  }
  if (path === '/api/auth/me' && req.method === 'GET') {
    const u = await getSession(db, token);
    return u ? json(res, 200, { user: u }) : json(res, 401, { error: 'unauthenticated' });
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    await logout(db, token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  return json(res, 404, { error: 'not_found' });
}

async function staticFile(res: ServerResponse, urlPath: string) {
  let p = normalize(decodeURIComponent(urlPath)).replace(/\\/g, '/');
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, p));
  if (!file.startsWith(root + sep) || BLOCKED.some(b => p === b || p.startsWith(b + '/')) || /(^|\/)\./.test(p) || /^\/(package|vercel)\.json$/.test(p)) {
    res.writeHead(404); return res.end('Not found');
  }
  try {
    if (!(await stat(file)).isFile()) throw 0;
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ...(p === '/assets/sw.js' ? { 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' } : {}),
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(root, 'pages/404.html')).catch(() => 'Not found'));
  }
}

function isGitTransportRequest(path: string, method: string): boolean {
  const match = path.match(/^\/git\/[^/]+\/[^/]+(?:\.git)?\/(.+)$/);
  if (!match) return false;
  const endpoint = match[1];
  if (endpoint === 'info/refs') return method === 'GET';
  if (endpoint === 'git-upload-pack' || endpoint === 'git-receive-pack') return method === 'POST';
  if (endpoint === 'info/lfs' || endpoint.startsWith('info/lfs/')) return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  return false;
}

function proxyGitea(req: IncomingMessage, res: ServerResponse, me: { id: number; email: string; displayName: string | null } | null, gitTransport: boolean): Promise<void> {
  return new Promise((resolve) => {
    const incoming = new URL(req.url ?? '/', 'http://x');
    // Gitea is configured with ROOT_URL=/git/, so the reverse proxy strips that public prefix.
    const backendPath = incoming.pathname.slice('/git'.length) || '/';
    const publicHost = req.headers.host ?? 'localhost';
    const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
    for (const name of ['x-webauth-user', 'x-webauth-email', 'x-webauth-fullname', 'remote-user', 'x-remote-user']) delete headers[name];
    for (const name of ['x-forwarded-host', 'x-forwarded-prefix', 'x-forwarded-proto']) delete headers[name];
    const cookies = String(headers.cookie ?? '').split(/;\s*/).filter((part) => part && !/^op_session=/i.test(part));
    if (cookies.length) headers.cookie = cookies.join('; '); else delete headers.cookie;
    if (me && !gitTransport) {
      headers['x-webauth-user'] = `opera-${me.id}`;
      headers['x-webauth-email'] = me.email;
      headers['x-webauth-fullname'] = me.displayName || `opera-${me.id}`;
      // Browser UI actions use the Opera identity, not a stale or client-supplied Gitea token.
      delete headers.authorization;
    }
    headers.host = publicHost;
    headers['x-forwarded-host'] = publicHost;
    headers['x-forwarded-prefix'] = '/git';
    headers['x-forwarded-proto'] = TRUST_PROXY ? String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim() : 'https';
    headers['accept-encoding'] = 'identity';
    const upstream = httpRequest({ hostname: GITEA_TARGET.hostname, port: GITEA_TARGET.port || 3000, method: req.method, path: backendPath + incoming.search, headers }, (upstreamRes) => {
      const outHeaders = { ...upstreamRes.headers };
      const location = outHeaders.location;
      if (typeof location === 'string') {
        try {
          const url = new URL(location, `http://${publicHost}`);
          if (url.hostname === GITEA_TARGET.hostname || url.port === String(GITEA_TARGET.port)) outHeaders.location = `https://${publicHost}/git${url.pathname}${url.search}${url.hash}`;
          else if (location.startsWith('/')) outHeaders.location = location.startsWith('/git') ? location : `/git${location}`;
        } catch { /* leave malformed upstream location untouched */ }
      }
      if (String(outHeaders['content-type'] ?? '').includes('text/html')) {
        delete outHeaders['content-length'];
        delete outHeaders['content-encoding'];
        outHeaders['cache-control'] = 'no-store';
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8').replace(/(\/git\/assets\/(?:css|js)\/[^"'?]+)(?=["'])/g, '$1?opera_cache=3');
          res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
          res.end(html);
          resolve();
        });
      } else {
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        upstreamRes.pipe(res).on('finish', resolve);
      }
    });
    upstream.on('error', (error) => { console.error('[gitea] proxy failed', error.message); if (!res.headersSent) { res.writeHead(502); res.end('Git-Opera service unavailable'); } else res.end(); resolve(); });
    req.pipe(upstream);
  });
}

const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/git') { res.writeHead(302, { Location: '/git/', 'Cache-Control': 'no-store' }); return res.end(); }
    if (path.startsWith('/git/')) {
      const me = await getSession(db, cookieOf(req, 'op_session'));
      const gitTransport = isGitTransportRequest(path, req.method ?? 'GET');
      if (!me && !gitTransport) return redirect(res, `/pages/login.html?next=${encodeURIComponent(req.url ?? '/git/')}`);
      if (me && !gitTransport && !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) {
        let originHost = '';
        try { originHost = req.headers.origin ? new URL(req.headers.origin).host : ''; } catch { /* invalid origin */ }
        if (!originHost || originHost !== req.headers.host) return json(res, 403, { error: 'forbidden' });
      }
      if (path === '/git/user/logout') {
        await logout(db, cookieOf(req, 'op_session'));
        return redirect(res, '/', [sessionCookie('', 0)]);
      }
      return await proxyGitea(req, res, gitTransport ? null : me, gitTransport);
    }
    if (path === '/auth/google/callback') return await api(req, res, '/api/auth/oauth/google/callback');
    if (path.startsWith('/api/')) return await api(req, res, path);
    return await staticFile(res, path);
  } catch (e) {
    console.error(e); if (!res.headersSent) json(res, 500, { error: 'server_error' }); else res.end();
  }
};

createServer(handleRequest).listen(PORT, '127.0.0.1', () => {
  console.log(`Opera: http://localhost:${PORT}`);
  if (!process.env.PUBLIC_URL) console.log('[oauth] PUBLIC_URL غير مضبوط: سيُستنتج العنوان من الطلب. ضبطه أضمن (مثل https://xxxx.replit.dev)');
  for (const l of oauthDiagnostics(process.env.PUBLIC_URL?.trim().replace(/\/+$/, ''))) console.log(l);
});
