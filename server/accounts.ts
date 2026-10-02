import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Database } from './db.ts';
import { hashPassword } from './password.ts';
import { sendMail } from './mailer.ts';
import { resetCodeEmail, verifyCodeEmail } from './mail-templates.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VERIFY_MINUTES = 15, VERIFY_MAX_ATTEMPTS = 5;
const RESET_MINUTES = 15, RESET_MAX_ATTEMPTS = 5;
const verifyHash = (userId: number, code: string) => sha(`signup:${userId}:${code}`);
const codeHash = (userId: number, code: string) => sha(`${userId}:${code}`);

export async function limited(db: Database, key: string, max: number): Promise<boolean> {
  const windowStart = new Date().toISOString().slice(0, 13);
  await db.prepare(`INSERT INTO rate_limits (key, window_start, hits) VALUES (?, ?, 1)
    ON CONFLICT(key, window_start) DO UPDATE SET hits = rate_limits.hits + 1`).run(key, windowStart);
  const row = await db.prepare('SELECT hits FROM rate_limits WHERE key = ? AND window_start = ?').get(key, windowStart);
  return Number(row?.hits ?? 0) > max;
}

async function sendVerifyCode(db: Database, userId: number, email: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.transaction(async (tx) => {
    await tx.prepare("UPDATE email_verifications SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND used_at IS NULL").run(userId);
    await tx.prepare(`INSERT INTO email_verifications (user_id, token_hash, expires_at)
      VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','+${VERIFY_MINUTES} minutes'))`).run(userId, verifyHash(userId, code));
  });
  const message = verifyCodeEmail(code, VERIFY_MINUTES);
  await sendMail(email, message.subject, message.text, message.html);
}

/** Normalize Gmail aliases to a single mailbox key. */
export function mailboxKey(email: string): string {
  const [local, domain] = email.toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return email.toLowerCase();
}

async function findExisting(db: Database, email: string): Promise<{ id: number; status: string } | undefined> {
  const exact = await db.prepare('SELECT id, status FROM users WHERE email = ?').get(email);
  if (exact) return { id: Number(exact.id), status: exact.status };
  const key = mailboxKey(email);
  if (!key.endsWith('@gmail.com')) return undefined;
  const rows = await db.prepare(`SELECT id, status, email FROM users
    WHERE (email LIKE '%@gmail.com' OR email LIKE '%@googlemail.com')
      AND lower(substr(email, 1, 1)) = ?`).all(email[0].toLowerCase()) as any[];
  const hit = rows.find((row) => mailboxKey(String(row.email)) === key);
  return hit ? { id: Number(hit.id), status: hit.status } : undefined;
}

export type RegisterResult =
  | { ok: true; resumed?: boolean }
  | { ok: false; code: 'bad_request' | 'weak_password' | 'rate_limited' | 'closed' | 'email_exists' };

export async function register(db: Database, o: { name: string; email: string; password: string; terms: boolean; ip?: string; origin: string }): Promise<RegisterResult> {
  const name = String(o.name ?? '').trim().slice(0, 80);
  const email = String(o.email ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(o.password ?? '');
  if (!name || !EMAIL.test(email) || !o.terms) return { ok: false, code: 'bad_request' };
  if (password.length < 8 || password.length > 1024) return { ok: false, code: 'weak_password' };

  const setting = async (key: string) => (await db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key))?.value;
  if (await setting('auth.registration_open') !== 'true' || await setting('security.single_owner') === 'true') {
    return { ok: false, code: 'closed' };
  }
  if (await limited(db, `register:${o.ip ?? '-'}`, 10)) return { ok: false, code: 'rate_limited' };
  const existing = await findExisting(db, email);
  if (existing) {
    if (existing.status !== 'pending') return { ok: false, code: 'email_exists' };
    if (await limited(db, `signup-code:${email}`, 5)) return { ok: false, code: 'rate_limited' };
    await sendVerifyCode(db, existing.id, email);
    return { ok: true, resumed: true };
  }

  try {
    const inserted = await db.prepare(`INSERT INTO users
      (email, display_name, password_hash, status, terms_accepted_at, password_changed_at)
      VALUES (?, ?, ?, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      RETURNING id`).get(email, name, hashPassword(password));
    const id = Number(inserted.id);
    await db.prepare(`INSERT INTO user_roles (user_id, role_id)
      SELECT ?, id FROM roles WHERE name = 'user' ON CONFLICT DO NOTHING`).run(id);
    await sendVerifyCode(db, id, email);
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, code: 'email_exists' };
    throw error;
  }
}

export async function resendVerifyCode(db: Database, o: { email: string; ip?: string }): Promise<{ ok: boolean; code?: 'rate_limited' }> {
  const email = String(o.email ?? '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL.test(email)) return { ok: true };
  if (await limited(db, `signup-code-ip:${o.ip ?? '-'}`, 10) || await limited(db, `signup-code:${email}`, 5)) {
    return { ok: false, code: 'rate_limited' };
  }
  const user = await db.prepare("SELECT id FROM users WHERE email = ? AND status = 'pending'").get(email);
  if (user) await sendVerifyCode(db, Number(user.id), email);
  return { ok: true };
}

export async function verifySignupCode(db: Database, o: { email: string; code: string }): Promise<'ok' | 'invalid'> {
  const email = String(o.email ?? '').trim().toLowerCase().slice(0, 254);
  const code = String(o.code ?? '').trim();
  if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) return 'invalid';
  const user = await db.prepare("SELECT id FROM users WHERE email = ? AND status = 'pending'").get(email);
  if (!user) return 'invalid';
  const verification = await db.prepare(`SELECT id, token_hash FROM email_verifications
    WHERE user_id = ? AND used_at IS NULL AND attempts < ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ORDER BY id DESC LIMIT 1`).get(user.id, VERIFY_MAX_ATTEMPTS);
  if (!verification) return 'invalid';
  const actual = Buffer.from(verification.token_hash, 'hex');
  const expected = Buffer.from(verifyHash(Number(user.id), code), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    await db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?').run(verification.id);
    return 'invalid';
  }
  await db.transaction(async (tx) => {
    await tx.prepare("UPDATE email_verifications SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(verification.id);
    await tx.prepare(`UPDATE users SET status = 'active',
      email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'`).run(user.id);
  });
  return 'ok';
}

export async function verifyEmail(db: Database, token: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const verification = await db.prepare(`SELECT id, user_id FROM email_verifications
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`).get(sha(token));
  if (!verification) return false;
  await db.transaction(async (tx) => {
    await tx.prepare("UPDATE email_verifications SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(verification.id);
    await tx.prepare(`UPDATE users SET status = 'active',
      email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'`).run(verification.user_id);
  });
  return true;
}

export async function requestReset(db: Database, o: { email: string; ip?: string; origin?: string }): Promise<{ ok: boolean; code?: 'rate_limited' }> {
  const email = String(o.email ?? '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL.test(email)) return { ok: true };
  if (await limited(db, `reset:${o.ip ?? '-'}`, 5) || await limited(db, `reset:${email}`, 3)) {
    return { ok: false, code: 'rate_limited' };
  }
  const user = await db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").get(email);
  if (!user) return { ok: true };
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.transaction(async (tx) => {
    await tx.prepare("UPDATE password_resets SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND used_at IS NULL").run(user.id);
    await tx.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at, ip)
      VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','+${RESET_MINUTES} minutes'), ?)`)
      .run(user.id, codeHash(Number(user.id), code), o.ip ?? null);
  });
  const message = resetCodeEmail(code, RESET_MINUTES);
  await sendMail(email, message.subject, message.text, message.html);
  return { ok: true };
}

export async function resetPassword(db: Database, o: { email: string; code: string; password: string }): Promise<'ok' | 'invalid' | 'weak_password'> {
  const email = String(o.email ?? '').trim().toLowerCase().slice(0, 254);
  const code = String(o.code ?? '').trim();
  const password = String(o.password ?? '');
  if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) return 'invalid';
  if (password.length < 8 || password.length > 1024) return 'weak_password';
  const user = await db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").get(email);
  if (!user) return 'invalid';
  const reset = await db.prepare(`SELECT id, token_hash FROM password_resets
    WHERE user_id = ? AND used_at IS NULL AND attempts < ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ORDER BY id DESC LIMIT 1`).get(user.id, RESET_MAX_ATTEMPTS);
  if (!reset) return 'invalid';
  const actual = Buffer.from(reset.token_hash, 'hex');
  const expected = Buffer.from(codeHash(Number(user.id), code), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    await db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);
    return 'invalid';
  }
  await db.transaction(async (tx) => {
    await tx.prepare("UPDATE password_resets SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(reset.id);
    await tx.prepare(`UPDATE users SET password_hash = ?, password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      must_change_password = 0, failed_login_count = 0, locked_until = NULL WHERE id = ?`).run(hashPassword(password), user.id);
    await tx.prepare("UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND revoked_at IS NULL").run(user.id);
  });
  return 'ok';
}