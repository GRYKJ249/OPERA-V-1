import type { Database } from './db.ts';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { loginAs, type LoginResult, type SessionUser } from './auth.ts';

/**
 * الدخول ببصمة الهاتف (WebAuthn / مفاتيح المرور) بدون مكتبات خارجية.
 * التسجيل يتطلب جلسة فعّالة (المالك)، والدخول يتحقق من التوقيع والتحدّي والأصل وعدّاد التوقيع.
 * يعمل على https أو على localhost فقط (شرط المتصفح).
 */
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();

// ---- CBOR مصغّر (يكفي لـ attestationObject ومفتاح COSE) ----
function cbor(buf: Buffer, o = { p: 0 }, depth = 0): any {
  if (depth > 8 || o.p >= buf.length) throw new Error('cbor');
  const b = buf[o.p++], mt = b >> 5, ai = b & 31;
  const need = (n: number) => { if (o.p + n > buf.length) throw new Error('cbor'); };
  const len = (): number => {
    if (ai < 24) return ai;
    if (ai === 24) { need(1); return buf[o.p++]; }
    if (ai === 25) { need(2); const v = buf.readUInt16BE(o.p); o.p += 2; return v; }
    if (ai === 26) { need(4); const v = buf.readUInt32BE(o.p); o.p += 4; return v; }
    throw new Error('cbor');
  };
  switch (mt) {
    case 0: return len();
    case 1: return -1 - len();
    case 2: case 3: { const n = len(); need(n); const r = buf.subarray(o.p, o.p + n); o.p += n; return mt === 2 ? Buffer.from(r) : r.toString('utf8'); }
    case 4: { const n = len(); if (n > 64) throw new Error('cbor'); return Array.from({ length: n }, () => cbor(buf, o, depth + 1)); }
    case 5: { const n = len(); if (n > 64) throw new Error('cbor'); const m = new Map(); for (let i = 0; i < n; i++) { const k = cbor(buf, o, depth + 1); m.set(k, cbor(buf, o, depth + 1)); } return m; }
    case 7: if (ai === 20) return false; if (ai === 21) return true; if (ai === 22) return null; throw new Error('cbor');
  }
  throw new Error('cbor');
}

// ---- التحدّيات المؤقتة (في الذاكرة، تنتهي بعد 5 دقائق) ----
interface Ch { challenge: string; kind: 'reg' | 'auth'; userId?: number; exp: number }
const CH = new Map<string, Ch>();
function putChallenge(kind: Ch['kind'], userId?: number): { id: string; challenge: string } {
  const now = Date.now(); for (const [k, v] of CH) if (v.exp < now) CH.delete(k);
  if (CH.size > 500) CH.clear();
  const id = randomBytes(18).toString('base64url'), challenge = b64u(randomBytes(32));
  CH.set(id, { challenge, kind, userId, exp: now + 300_000 });
  return { id, challenge };
}
const takeChallenge = (id: string | undefined, kind: Ch['kind']): Ch | null => {
  const c = id ? CH.get(id) : undefined; if (id) CH.delete(id); // يُستعمل مرة واحدة
  return c && c.kind === kind && c.exp > Date.now() ? c : null;
};

const rpOf = (origin: string) => new URL(origin).hostname;

export async function registerOptions(db: Database, user: SessionUser, origin: string) {
  const { id, challenge } = putChallenge('reg', user.id);
  const pub = (await db.prepare('SELECT public_id FROM users WHERE id = ?').get(user.id)).public_id as string;
  const have = await db.prepare('SELECT credential_id FROM passkeys WHERE user_id = ?').all(user.id) as { credential_id: string }[];
  return { cookie: id, options: {
    challenge, rp: { name: 'Opera', id: rpOf(origin) },
    user: { id: b64u(Buffer.from(pub)), name: user.email, displayName: user.displayName ?? user.email },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    attestation: 'none', timeout: 60000,
    excludeCredentials: have.map(c => ({ type: 'public-key', id: c.credential_id })),
  } };
}

function checkClient(clientDataJSON: string, type: string, challenge: string, origin: string): Buffer {
  const raw = Buffer.from(String(clientDataJSON ?? ''), 'base64url');
  const cd = JSON.parse(raw.toString('utf8'));
  if (cd.type !== type || cd.challenge !== challenge || cd.origin !== origin) throw new Error('client data mismatch');
  return raw;
}
function checkAuthData(ad: Buffer, origin: string, needAttested: boolean) {
  if (ad.length < 37) throw new Error('short authData');
  if (!ad.subarray(0, 32).equals(sha(rpOf(origin)))) throw new Error('rpId mismatch');
  const flags = ad[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error('user not present/verified'); // UP + UV
  if (needAttested && !(flags & 0x40)) throw new Error('no credential data');
  return { signCount: ad.readUInt32BE(33) };
}

/** يحوّل مفتاح COSE (ES256 أو RS256) إلى SPKI DER للتخزين. */
function coseToSpki(m: Map<number, any>): Buffer {
  const kty = m.get(1);
  const jwk = kty === 2 && m.get(-1) === 1 && m.get(3) === -7
    ? { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) }
    : kty === 3 && m.get(3) === -257 ? { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)) } : null;
  if (!jwk) throw new Error('unsupported key');
  return createPublicKey({ key: jwk as any, format: 'jwk' }).export({ type: 'spki', format: 'der' }) as Buffer;
}

export type PkResult = { ok: true } | { ok: false; code: 'invalid' | 'expired' };
export async function registerVerify(db: Database, user: SessionUser, origin: string, cookie: string | undefined,
  b: { id: string; response: { clientDataJSON: string; attestationObject: string }; transports?: string[]; name?: string }): Promise<PkResult> {
  const ch = takeChallenge(cookie, 'reg');
  if (!ch || ch.userId !== user.id) return { ok: false, code: 'expired' };
  try {
    checkClient(b.response.clientDataJSON, 'webauthn.create', ch.challenge, origin);
    const att = cbor(Buffer.from(String(b.response.attestationObject), 'base64url')) as Map<string, any>;
    const ad = att.get('authData') as Buffer;
    checkAuthData(ad, origin, true);
    const idLen = ad.readUInt16BE(53), credId = ad.subarray(55, 55 + idLen);
    if (!idLen || idLen > 1023 || credId.length !== idLen || b64u(credId) !== b.id) throw new Error('credential id mismatch');
    const key = cbor(ad, { p: 55 + idLen }) as Map<number, any>;
    const signCount = ad.readUInt32BE(33);
    await db.prepare('INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, transports, name) VALUES (?,?,?,?,?,?)')
      .run(user.id, b.id, coseToSpki(key), signCount, JSON.stringify((b.transports ?? []).filter(x => typeof x === 'string').slice(0, 6)), String(b.name ?? 'جهازي').slice(0, 60));
    return { ok: true };
  } catch { return { ok: false, code: 'invalid' }; }
}

export async function loginOptions(db: Database, origin: string): Promise<{ cookie: string; options: object } | null> {
  const have = await db.prepare("SELECT p.credential_id FROM passkeys p JOIN users u ON u.id = p.user_id WHERE u.status = 'active' LIMIT 20").all() as { credential_id: string }[];
  if (!have.length) return null;
  const { id, challenge } = putChallenge('auth');
  return { cookie: id, options: { challenge, rpId: rpOf(origin), userVerification: 'required', timeout: 60000, allowCredentials: have.map(c => ({ type: 'public-key', id: c.credential_id })) } };
}

export async function loginVerify(db: Database, origin: string, cookie: string | undefined, o: { ip?: string; ua?: string },
  b: { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string } }): Promise<Extract<LoginResult, { ok: true }> | { ok: false; code: 'invalid' | 'expired' | 'locked' | 'blocked' }> {
  const ch = takeChallenge(cookie, 'auth');
  if (!ch) return { ok: false, code: 'expired' };
  try {
    const row = await db.prepare('SELECT id, user_id, public_key, sign_count FROM passkeys WHERE credential_id = ?').get(String(b.id ?? '')) as any;
    if (!row) return { ok: false, code: 'invalid' };
    const cdRaw = checkClient(b.response.clientDataJSON, 'webauthn.get', ch.challenge, origin);
    const ad = Buffer.from(String(b.response.authenticatorData), 'base64url');
    const { signCount } = checkAuthData(ad, origin, false);
    const key = createPublicKey({ key: Buffer.from(row.public_key), format: 'der', type: 'spki' });
    if (!verify('sha256', Buffer.concat([ad, sha(cdRaw)]), key, Buffer.from(String(b.response.signature), 'base64url'))) return { ok: false, code: 'invalid' };
    const prev = Number(row.sign_count);
    if ((signCount || prev) && signCount <= prev) return { ok: false, code: 'invalid' }; // عدّاد لم يتقدّم: احتمال نسخة مستنسخة
    await db.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(signCount, row.id);
    const r = await loginAs(db, Number(row.user_id), { method: 'passkey', ip: o.ip, ua: o.ua });
    return r.ok ? r : { ok: false, code: r.code as 'invalid' | 'locked' | 'blocked' };
  } catch { return { ok: false, code: 'invalid' }; }
}
