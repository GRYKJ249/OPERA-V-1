// اختبار استعادة كلمة السر بالرمز (6 أرقام): نجاح، رمز خاطئ، حد المحاولات، انتهاء، إلغاء الجلسات
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './db.ts';
import { requestReset, resetPassword } from './accounts.ts';

process.env.RESEND_API_KEY = 're_test';
const sent: string[] = [];
process.env.RESEND_API_URL = 'http://127.0.0.1:1/never';   // لا إرسال حقيقي
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_u: any, init: any) => { sent.push(JSON.parse(init.body).text); return new Response('{}', { status: 200 }); }) as any;

const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); migrate(db);
const email = (db.prepare('SELECT email FROM users LIMIT 1').get() as any).email;
const lastCode = () => (sent.at(-1)!.match(/\n(\d{6})\n/) ?? [])[1];
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); console.log('  ✓', n); pass++; } catch (e: any) { console.log('  ✗', n, e.message); fail++; } };

await t('الطلب يرسل رمزاً من 6 أرقام', async () => { await requestReset(db, { email, ip: '1.1.1.1' }); assert.match(lastCode() ?? '', /^\d{6}$/); });
await t('رمز خاطئ = مرفوض', () => assert.equal(resetPassword(db, { email, code: lastCode() === '000000' ? '111111' : '000000', password: 'NewPassw0rd!' }), 'invalid'));
await t('كلمة سر ضعيفة = مرفوضة', () => assert.equal(resetPassword(db, { email, code: lastCode()!, password: 'short' }), 'weak_password'));
await t('بريد آخر بنفس الرمز = مرفوض', () => assert.equal(resetPassword(db, { email: 'other@example.com', code: lastCode()!, password: 'NewPassw0rd!' }), 'invalid'));
await t('الرمز الصحيح ينجح', () => assert.equal(resetPassword(db, { email, code: lastCode()!, password: 'NewPassw0rd!' }), 'ok'));
await t('الرمز لا يُستخدم مرتين', () => assert.equal(resetPassword(db, { email, code: lastCode()!, password: 'AnotherPass1!' }), 'invalid'));
await t('5 محاولات خاطئة تقفل الرمز حتى لو جاء الصحيح بعدها', async () => {
  await requestReset(db, { email, ip: '2.2.2.2' }); const good = lastCode()!;
  const bad = good === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal(resetPassword(db, { email, code: bad, password: 'NewPassw0rd!' }), 'invalid');
  assert.equal(resetPassword(db, { email, code: good, password: 'NewPassw0rd!' }), 'invalid');
});
await t('طلب جديد يلغي الرمز القديم', async () => {
  await requestReset(db, { email, ip: '3.3.3.3' }); const first = lastCode()!;
  db.exec("DELETE FROM rate_limits"); await requestReset(db, { email, ip: '4.4.4.4' }); const second = lastCode()!;
  if (first !== second) assert.equal(resetPassword(db, { email, code: first, password: 'NewPassw0rd!' }), 'invalid');
  assert.equal(resetPassword(db, { email, code: second, password: 'NewPassw0rd!' }), 'ok');
});
await t('رمز منتهي = مرفوض', async () => {
  db.exec("DELETE FROM rate_limits"); await requestReset(db, { email, ip: '5.5.5.5' });
  db.exec("UPDATE password_resets SET expires_at='2000-01-01T00:00:00.000Z' WHERE used_at IS NULL");
  assert.equal(resetPassword(db, { email, code: lastCode()!, password: 'NewPassw0rd!' }), 'invalid');
});
await t('الاستعادة تلغي الجلسات القديمة', async () => {
  const uid = (db.prepare('SELECT id FROM users WHERE email=?').get(email) as any).id;
  db.exec("DELETE FROM rate_limits"); await requestReset(db, { email, ip: '6.6.6.6' });
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('zz', ?, '2999-01-01T00:00:00.000Z')").run(uid);
  assert.equal(resetPassword(db, { email, code: lastCode()!, password: 'NewPassw0rd!' }), 'ok');
  assert.equal((db.prepare("SELECT revoked_at r FROM sessions WHERE id='zz'").get() as any).r !== null, true);
});
globalThis.fetch = realFetch;
console.log(fail ? `\n❌ فشل ${fail}` : `\n✅ نجحت كل اختبارات رمز الاستعادة (${pass}/${pass})`);
process.exit(fail ? 1 : 0);
