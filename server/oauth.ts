import type { Database } from './db.ts';
import { createHash, randomBytes } from 'node:crypto';
import { loginAs, type LoginResult } from './auth.ts';
import { limited } from './accounts.ts';

/**
 * الدخول عبر Google وGitHub (OAuth 2.0 بمسار الكود + state، وPKCE مع Google).
 * يربط الحساب الموجود بالبريد المؤكد نفسه؛ وينشئ حساباً جديداً فقط إذا كان التسجيل مفتوحاً.
 * المفاتيح من البيئة: GOOGLE_CLIENT_ID/SECRET و GITHUB_CLIENT_ID/SECRET.
 * عنوانا الرجوع: Google /auth/google/callback، وGitHub /api/auth/oauth/github/callback.
 */
export type Provider = 'google' | 'github';
interface Cfg { id: string; secret: string; authUrl: string; tokenUrl: string; userUrl: string; emailsUrl?: string; scope: string }
export type OAuthError = 'not_configured' | 'bad_state' | 'provider_error' | 'unverified_email' | 'not_owner' | 'invalid' | 'locked' | 'blocked';

const env = (k: string) => (process.env[k] ?? '').trim();
export const isProvider = (p: string): p is Provider => p === 'google' || p === 'github';

export function providerCfg(p: Provider): Cfg | null {
  const P = p.toUpperCase(), id = env(`${P}_CLIENT_ID`), secret = env(`${P}_CLIENT_SECRET`);
  if (!id || !secret) return null;
  const o = (k: string, d: string) => env(`OPERA_OAUTH_${P}_${k}`) || d; // التجاوز للاختبار فقط
  return p === 'google'
    ? { id, secret, scope: 'openid email profile', authUrl: o('AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
        tokenUrl: o('TOKEN_URL', 'https://oauth2.googleapis.com/token'), userUrl: o('USER_URL', 'https://openidconnect.googleapis.com/v1/userinfo') }
    : { id, secret, scope: 'read:user user:email', authUrl: o('AUTH_URL', 'https://github.com/login/oauth/authorize'),
        tokenUrl: o('TOKEN_URL', 'https://github.com/login/oauth/access_token'), userUrl: o('USER_URL', 'https://api.github.com/user'),
        emailsUrl: o('EMAILS_URL', 'https://api.github.com/user/emails') };
}
export const configured = () => ({ google: !!providerCfg('google'), github: !!providerCfg('github') });

/** يبدأ المسار: يرجع رابط المزوّد وقيمة كوكي مؤقتة تحمل state والمُتحقِّق (verifier). */
export function startOAuth(p: Provider, redirectUri: string): { url: string; cookie: string } | null {
  const c = providerCfg(p); if (!c) return null;
  const state = randomBytes(24).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri, response_type: 'code', scope: c.scope, state });
  if (p === 'google') { q.set('code_challenge', createHash('sha256').update(verifier).digest('base64url')); q.set('code_challenge_method', 'S256'); q.set('prompt', 'select_account'); }
  return { url: `${c.authUrl}?${q}`, cookie: `${p}.${state}.${verifier}` };
}

const j = async (r: Response) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<any>; };
const sig = () => AbortSignal.timeout(10_000);

async function fetchIdentity(p: Provider, c: Cfg, code: string, redirectUri: string, verifier: string): Promise<{ id: string; email: string; name?: string } | 'unverified_email'> {
  const body = new URLSearchParams({ client_id: c.id, client_secret: c.secret, code, redirect_uri: redirectUri });
  if (p === 'google') { body.set('grant_type', 'authorization_code'); body.set('code_verifier', verifier); }
  const tok = await j(await fetch(c.tokenUrl, { method: 'POST', signal: sig(), headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body }));
  const at = String(tok.access_token ?? ''); if (!at) throw new Error('no access_token');
  const h = { Authorization: `Bearer ${at}`, Accept: 'application/json', 'User-Agent': 'opera-portfolio' };
  const u = await j(await fetch(c.userUrl, { headers: h, signal: sig() }));
  if (p === 'google') return u.sub && u.email && u.email_verified === true ? { id: String(u.sub), email: String(u.email).trim().toLowerCase(), name: u.name ? String(u.name) : undefined } : 'unverified_email';
  const emails = (await j(await fetch(c.emailsUrl!, { headers: h, signal: sig() }))) as { email: string; primary: boolean; verified: boolean }[];
  const e = emails.find(x => x.primary && x.verified) ?? emails.find(x => x.verified);
  return u.id && e ? { id: String(u.id), email: e.email.trim().toLowerCase(), name: u.name || u.login ? String(u.name || u.login) : undefined } : 'unverified_email';
}

/** يكمل المسار بعد رجوع المزوّد. cookie = قيمة كوكي op_oauth التي وُضعت في startOAuth. */
export async function finishOAuth(db: Database, p: Provider, o: { code: string; state: string; cookie: string | undefined; redirectUri: string; ip?: string; ua?: string }):
  Promise<Extract<LoginResult, { ok: true }> | { ok: false; code: OAuthError }> {
  const c = providerCfg(p); if (!c) return { ok: false, code: 'not_configured' };
  const [cp, state, verifier] = String(o.cookie ?? '').split('.');
  if (cp !== p || !state || !verifier || !o.code || o.state.length !== state.length || o.state !== state) return { ok: false, code: 'bad_state' };
  let who: Awaited<ReturnType<typeof fetchIdentity>>;
  try { who = await fetchIdentity(p, c, o.code, o.redirectUri, verifier); } catch { return { ok: false, code: 'provider_error' }; }
  if (who === 'unverified_email') return { ok: false, code: 'unverified_email' };

  let row = await db.prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?').get(p, who.id) as { user_id: number } | undefined;
  if (!row) { // أول مرة بهذا المزوّد
    const setting = async (k: string) => (await db.prepare('SELECT value FROM site_settings WHERE key = ?').get(k))?.value;
    const u = await db.prepare('SELECT id, status FROM users WHERE email = ?').get(who.email) as { id: number; status: string } | undefined;
    if (u && u.status === 'active') { // مستخدم موجود بنفس البريد المؤكَّد عند المزوّد: نربطه
      await db.prepare('INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email) VALUES (?,?,?,?)').run(u.id, p, who.id, who.email);
      row = { user_id: u.id };
    } else if (u && u.status === 'pending') { // سجّل بالبريد ولم يؤكد: المزوّد أثبت ملكية البريد، فنفعّله ونمسح كلمة السر (منع سطو الحساب قبل التفعيل)
      try {
        await db.transaction(async (tx) => {
          await tx.prepare(`UPDATE users SET status = 'active',
            email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), password_hash = NULL WHERE id = ?`).run(u.id);
          await tx.prepare('INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email) VALUES (?,?,?,?)').run(u.id, p, who.id, who.email);
        });
      } catch { return { ok: false, code: 'invalid' }; }
      row = { user_id: u.id };
    } else if (u) { // موقوف أو محذوف
      return { ok: false, code: 'locked' };
    } else { // لا حساب: ننشئ واحداً إن كان التسجيل مفتوحاً
      if (await setting('auth.registration_open') !== 'true' || await setting('security.single_owner') === 'true') return { ok: false, code: 'not_owner' };
      if (await limited(db, `oauth-signup:${o.ip ?? '-'}`, 10)) return { ok: false, code: 'blocked' };
      const name = (who.name ?? who.email.split('@')[0]).trim().slice(0, 80) || 'User';
      try {
        row = await db.transaction(async (tx) => {
          const inserted = await tx.prepare(`INSERT INTO users
            (email, display_name, status, email_verified_at, password_changed_at)
            VALUES (?, ?, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            RETURNING id`).get(who.email, name);
          const id = Number(inserted.id);
          await tx.prepare(`INSERT INTO user_roles (user_id, role_id)
            SELECT ?, id FROM roles WHERE name = 'user' ON CONFLICT DO NOTHING`).run(id);
          await tx.prepare('INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email) VALUES (?,?,?,?)').run(id, p, who.id, who.email);
          return { user_id: id };
        });
      } catch { return { ok: false, code: 'invalid' }; }
    }
  }
  const r = await loginAs(db, Number(row.user_id), { method: `oauth:${p}`, ip: o.ip, ua: o.ua });
  return r.ok ? r : { ok: false, code: r.code as OAuthError };
}

/** تشخيص للمفاتيح وعناوين الرجوع (يُطبع عند تشغيل السيرفر وبأمر npm run oauth:check) */
export function oauthDiagnostics(publicUrl?: string): string[] {
  const out: string[] = [];
  for (const p of ['google', 'github'] as const) {
    const P = p.toUpperCase(), id = env(`${P}_CLIENT_ID`), secret = env(`${P}_CLIENT_SECRET`);
    if (!id || !secret) { out.push(`[oauth] ${p}: غير مفعّل (لا توجد مفاتيح)`); continue; }
    const fake = /mock|your[-_]|xxx|changeme|example/i.test(id + secret);
    const badGoogle = p === 'google' && !id.endsWith('.apps.googleusercontent.com');
    out.push(fake || badGoogle ? `[oauth] ${p}: ⚠ المفاتيح تبدو وهمية أو بصيغة خاطئة، وسيرفضها المزوّد (invalid_client)` : `[oauth] ${p}: المفاتيح مضبوطة`);
    out.push(`[oauth]   سجّل هذا العنوان عند ${p}: ${publicUrl ?? '<PUBLIC_URL>'}${p === 'google' ? '/auth/google/callback' : `/api/auth/oauth/${p}/callback`}`);
  }
  return out;
}
