// اختبار إنشاء الحساب: رفض البريد المكرر + تأكيد الحساب بالرمز (6 أرقام)
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './db.ts';
import { register, verifySignupCode, resendVerifyCode, mailboxKey } from './accounts.ts';
import { login } from './auth.ts';

process.env.RESEND_API_KEY = 're_test';
const sent: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_u: any, init: any) => { sent.push(JSON.parse(init.body).text); return new Response('{}', { status: 200 }); }) as any;

const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); migrate(db);
db.prepare("INSERT OR REPLACE INTO site_settings (key,value,type,is_public) VALUES ('auth.registration_open','true','boolean',1),('security.single_owner','false','boolean',0)").run();
const lastCode = () => (sent.at(-1)!.match(/\n(\d{6})\n/) ?? [])[1];
const reg = (email: string, extra: object = {}, ip = '9.9.9.9') => register(db, { name: 'Go', email, password: 'Passw0rd!x', terms: true, ip, origin: 'http://x', ...extra });
const users = (e: string) => Number((db.prepare('SELECT COUNT(*) c FROM users WHERE email = ?').get(e) as any).c);
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); console.log('  ✓', n); pass++; } catch (e: any) { console.log('  ✗', n, e.message); fail++; } };

await t('تسجيل جديد: ينجح ويرسل رمزاً من 6 أرقام', async () => { assert.deepEqual(await reg('go@gmail.com'), { ok: true }); assert.match(lastCode() ?? '', /^\d{6}$/); });
await t('الحساب غير المؤكد لا يدخل', () => assert.deepEqual(login(db, { email: 'go@gmail.com', password: 'Passw0rd!x' }), { ok: false, code: 'pending' }));
await t('رمز خاطئ = مرفوض', () => assert.equal(verifySignupCode(db, { email: 'go@gmail.com', code: lastCode() === '000000' ? '111111' : '000000' }), 'invalid'));
await t('الرمز الصحيح يفعّل الحساب', () => assert.equal(verifySignupCode(db, { email: 'go@gmail.com', code: lastCode()! }), 'ok'));
await t('الرمز لا يُستخدم مرتين', () => assert.equal(verifySignupCode(db, { email: 'go@gmail.com', code: lastCode()! }), 'invalid'));
await t('بعد التفعيل يدخل بكلمة سره', () => assert.equal(login(db, { email: 'go@gmail.com', password: 'Passw0rd!x' }).ok, true));
await t('نفس البريد مرة ثانية = مرفوض email_exists ولا ينشأ صف جديد', async () => { assert.deepEqual(await reg('go@gmail.com'), { ok: false, code: 'email_exists' }); assert.equal(users('go@gmail.com'), 1); });
await t('اختلاف حالة الأحرف GO@Gmail.com = مرفوض', async () => assert.deepEqual(await reg('GO@Gmail.com'), { ok: false, code: 'email_exists' }));
await t('مسافات حول البريد = مرفوض', async () => assert.deepEqual(await reg('  go@gmail.com  '), { ok: false, code: 'email_exists' }));
await t('Gmail: g.o@gmail.com و go+x@gmail.com و googlemail = نفس الصندوق = مرفوض', async () => {
  for (const e of ['g.o@gmail.com', 'go+shop@gmail.com', 'go@googlemail.com']) assert.deepEqual(await reg(e), { ok: false, code: 'email_exists' }, e);
});
await t('mailboxKey لا يمسّ نطاقات غير Gmail', () => { assert.equal(mailboxKey('a.b+c@outlook.com'), 'a.b+c@outlook.com'); assert.equal(mailboxKey('A.B+c@gmail.com'), 'ab@gmail.com'); });
await t('بريد مختلف = مقبول', async () => assert.deepEqual(await reg('other@gmail.com'), { ok: true }));
await t('بريد قيد التأكيد: يعاد إرسال رمز جديد (resumed) بلا حساب مكرر ولا تغيير لكلمة السر', async () => {
  const before = (db.prepare("SELECT password_hash h FROM users WHERE email='other@gmail.com'").get() as any).h;
  const r = await reg('other@gmail.com', { password: 'Attacker1234!' }); assert.deepEqual(r, { ok: true, resumed: true });
  assert.equal(users('other@gmail.com'), 1);
  assert.equal((db.prepare("SELECT password_hash h FROM users WHERE email='other@gmail.com'").get() as any).h, before);
});
await t('الرمز القديم يبطل عند إرسال رمز جديد', async () => {
  const older = lastCode()!; db.exec('DELETE FROM rate_limits'); await resendVerifyCode(db, { email: 'other@gmail.com', ip: '1.1.1.1' });
  const newer = lastCode()!; if (older !== newer) assert.equal(verifySignupCode(db, { email: 'other@gmail.com', code: older }), 'invalid');
  assert.equal(verifySignupCode(db, { email: 'other@gmail.com', code: newer }), 'ok');
});
await t('5 محاولات خاطئة تقفل الرمز حتى لو جاء الصحيح بعدها', async () => {
  await reg('lock@example.com'); const good = lastCode()!, bad = good === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal(verifySignupCode(db, { email: 'lock@example.com', code: bad }), 'invalid');
  assert.equal(verifySignupCode(db, { email: 'lock@example.com', code: good }), 'invalid');
});
await t('رمز منتهي = مرفوض', async () => {
  await reg('exp@example.com'); db.exec("UPDATE email_verifications SET expires_at='2000-01-01T00:00:00.000Z' WHERE used_at IS NULL");
  assert.equal(verifySignupCode(db, { email: 'exp@example.com', code: lastCode()! }), 'invalid');
});
await t('قيد UNIQUE في القاعدة نفسها يمنع التكرار حتى لو تجاوزنا الكود', () => {
  assert.throws(() => db.prepare("INSERT INTO users (email, display_name, status) VALUES ('GO@GMAIL.COM','x','active')").run(), /UNIQUE/i);
});
await t('بيانات ناقصة/ضعيفة تُرفض', async () => {
  assert.deepEqual(await reg('x@example.com', { terms: false }), { ok: false, code: 'bad_request' });
  assert.deepEqual(await reg('x@example.com', { password: 'short' }), { ok: false, code: 'weak_password' });
  assert.deepEqual(await reg('not-an-email'), { ok: false, code: 'bad_request' });
});
globalThis.fetch = realFetch;
console.log(fail ? `\n❌ فشل ${fail}` : `\n✅ نجحت كل اختبارات إنشاء الحساب (${pass}/${pass})`);
process.exit(fail ? 1 : 0);
