import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// صيغة التخزين: scrypt$N$r$p$salt(base64)$hash(base64)  — لا تُخزَّن كلمة السر نفسها أبداً.
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = scryptSync(plain.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
