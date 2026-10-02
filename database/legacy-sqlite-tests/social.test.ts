import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { openDb } from './db.ts';
import { getSession, type SessionUser } from './auth.ts';
import { startOAuth, finishOAuth, configured } from './oauth.ts';
import { registerOptions, registerVerify, loginOptions, loginVerify } from './passkeys.ts';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${name}`); };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();

// ============ OAuth مع مزوّد وهمي ============
console.log('— OAuth (Google / GitHub)');
let identity: any = { sub: 'g-1', email: 'grykj249@gmail.com', email_verified: true };
let ghEmails: any[] = [{ email: 'grykj249@gmail.com', primary: true, verified: true }];
let lastChallenge = '', verifierSeen = '';
const mock = createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const send = (o: unknown, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/token') {
      const f = new URLSearchParams(body);
      if (f.get('code') !== 'GOOD' || f.get('client_secret') !== 'sec') return send({ error: 'bad' }, 400);
      verifierSeen = f.get('code_verifier') ?? '';
      return send({ access_token: 'AT' });
    }
    if (req.headers.authorization !== 'Bearer AT') return send({}, 401);
    if (req.url === '/user') return send(identity);
    if (req.url === '/emails') return send(ghEmails);
    send({}, 404);
  });
});
await new Promise<void>(r => mock.listen(0, r));
const base = `http://127.0.0.1:${(mock.address() as any).port}`;
Object.assign(process.env, {
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'sec', OPERA_OAUTH_GOOGLE_TOKEN_URL: base + '/token', OPERA_OAUTH_GOOGLE_USER_URL: base + '/user',
  GITHUB_CLIENT_ID: 'hid', GITHUB_CLIENT_SECRET: 'sec', OPERA_OAUTH_GITHUB_TOKEN_URL: base + '/token', OPERA_OAUTH_GITHUB_USER_URL: base + '/user', OPERA_OAUTH_GITHUB_EMAILS_URL: base + '/emails',
});
const RU = 'http://localhost:3000/api/auth/oauth/google/callback';
let db = openDb(':memory:');

const st = startOAuth('google', RU)!;
const u = new URL(st.url), state = u.searchParams.get('state')!;
ok(u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('redirect_uri') === RU && !!state, 'رابط Google فيه state وPKCE وعنوان الرجوع');
const r1 = await finishOAuth(db, 'google', { code: 'GOOD', state, cookie: st.cookie, redirectUri: RU });
ok(r1.ok && getSession(db, r1.ok ? r1.token : '')?.email === 'grykj249@gmail.com', 'Google: يدخل المالك ويُنشأ له جلسة صالحة');
ok(sha(verifierSeen).toString('base64url') === u.searchParams.get('code_challenge'), 'PKCE: المُتحقِّق المرسَل يطابق التحدّي');
ok(Number((db.prepare("SELECT COUNT(*) c FROM oauth_accounts WHERE provider='google'").get() as any).c) === 1, 'ربط الحساب سُجّل في oauth_accounts');

identity = { sub: 'g-case', email: 'GRYKJ249@GMAIL.COM', email_verified: true };
const caseSt = startOAuth('google', RU)!;
const caseLogin = await finishOAuth(db, 'google', { code: 'GOOD', state: new URL(caseSt.url).searchParams.get('state')!, cookie: caseSt.cookie, redirectUri: RU });
const ownerId = Number((db.prepare("SELECT id FROM users WHERE email='grykj249@gmail.com'").get() as any).id);
const linkedId = Number((db.prepare("SELECT user_id FROM oauth_accounts WHERE provider='google' AND provider_user_id='g-case'").get() as any)?.user_id);
ok(caseLogin.ok && linkedId === ownerId, 'Google: ربط الحساب الموجود يعمل حتى مع اختلاف حالة أحرف البريد');

identity = { sub: 'g-1', email: 'changed@example.com', email_verified: true };
const st2 = startOAuth('google', RU)!;
const r2 = await finishOAuth(db, 'google', { code: 'GOOD', state: new URL(st2.url).searchParams.get('state')!, cookie: st2.cookie, redirectUri: RU });
ok(r2.ok, 'الدخول التالي يعتمد على المعرّف المربوط لا على البريد');

const setOpt = (k: string, v: string) => db.prepare('UPDATE site_settings SET value = ? WHERE key = ?').run(v, k);
setOpt('security.single_owner', 'true'); setOpt('auth.registration_open', 'false');   // وضع المالك: لا حسابات جديدة
identity = { sub: 'g-2', email: 'stranger@example.com', email_verified: true };
const st3 = startOAuth('google', RU)!;
const r3 = await finishOAuth(db, 'google', { code: 'GOOD', state: new URL(st3.url).searchParams.get('state')!, cookie: st3.cookie, redirectUri: RU });
ok(!r3.ok && r3.code === 'not_owner', 'غريب ببريد غير مسجّل = مرفوض ولا يُنشأ له حساب');
ok(Number((db.prepare('SELECT COUNT(*) c FROM users').get() as any).c) === 1, 'عدد المستخدمين بقي 1');

{
// ---- التسجيل المفتوح: Google/GitHub ينشئان حساباً جديداً ----
console.log('— التسجيل عبر المزوّد (الوضع المفتوح)');
const go = async (prov: 'google' | 'github' = 'google') => { const st = startOAuth(prov, RU)!; return finishOAuth(db, prov, { code: 'GOOD', state: new URL(st.url).searchParams.get('state')!, cookie: st.cookie, redirectUri: RU, ip: '9.9.9.9' }); };
const U = (email: string) => db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
setOpt('security.single_owner', 'false'); setOpt('auth.registration_open', 'false');
identity = { sub: 'g-n1', email: 'newbie@example.com', email_verified: true, name: 'Newbie Nora' };
const rc = await go(); ok(!rc.ok && rc.code === 'not_owner', 'التسجيل مغلق (registration_open=false) = مرفوض');
setOpt('auth.registration_open', 'true');
const rn = await go(); ok(rn.ok, 'التسجيل مفتوح: غريب ببريد مؤكَّد ينشئ حساباً ويدخل');
const nu = U('newbie@example.com');
ok(nu?.status === 'active' && !!nu.email_verified_at && nu.password_hash === null, 'الحساب الجديد مفعّل والبريد مؤكَّد وبلا كلمة سر');
ok(nu?.display_name === 'Newbie Nora', 'الاسم من حساب Google');
ok(Number((db.prepare("SELECT COUNT(*) c FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'user'").get(nu.id) as any).c) === 1, 'دور user الافتراضي');
ok(Number((db.prepare('SELECT COUNT(*) c FROM oauth_accounts WHERE user_id = ?').get(nu.id) as any).c) === 1, 'ربط المزوّد انحفظ');
const rn2 = await go(); ok(rn2.ok && Number((db.prepare('SELECT COUNT(*) c FROM users WHERE email = ?').get('newbie@example.com') as any).c) === 1, 'الدخول التالي لا ينشئ حساباً ثانياً');
identity = { sub: 'g-n2', email: 'newbie@example.com', email_verified: false };
const ru = await go(); ok(!ru.ok && ru.code === 'unverified_email', 'بريد غير مؤكَّد عند المزوّد = مرفوض حتى مع التسجيل المفتوح');
// GitHub: الاسم من login عند غياب name
ghEmails = [{ email: 'octo@example.com', primary: true, verified: true }]; identity = { id: 777, login: 'octocat' };
const rg = await go('github'); ok(rg.ok && U('octo@example.com')?.display_name === 'octocat', 'GitHub: ينشئ حساباً والاسم من login');
// حساب سُجّل بالبريد ولم يؤكد: المزوّد يثبت الملكية فيُفعَّل وتُمسح كلمة السر (منع سطو الحساب)
db.prepare("INSERT INTO users (email, display_name, password_hash, status) VALUES ('pend@example.com','Pend','h_"+'x'.repeat(30)+"','pending')").run();
identity = { sub: 'g-p1', email: 'pend@example.com', email_verified: true, name: 'Pend' };
const rp = await go(); const pu = U('pend@example.com');
ok(rp.ok && pu.status === 'active' && pu.password_hash === null, 'حساب معلّق يُفعَّل عبر المزوّد وتُمسح كلمة سره');
// حساب موقوف لا يدخل ولا يُنشأ بديل عنه
db.prepare("INSERT INTO users (email, display_name, status) VALUES ('sus@example.com','Sus','suspended')").run();
identity = { sub: 'g-s1', email: 'sus@example.com', email_verified: true };
const rs = await go(); ok(!rs.ok && rs.code === 'locked', 'حساب موقوف = مرفوض');
// تنظيف: نرجع لمستخدم واحد (المالك) ولوضع المالك كما كان في بقية الاختبارات
db.prepare("DELETE FROM users WHERE email <> 'grykj249@gmail.com'").run();
setOpt('security.single_owner', 'true'); setOpt('auth.registration_open', 'false');
ok(Number((db.prepare('SELECT COUNT(*) c FROM users').get() as any).c) === 1, 'رجعنا لمستخدم واحد بعد التنظيف');
ghEmails = [{ email: 'grykj249@gmail.com', primary: true, verified: true }]; identity = { sub: 'g-1', email: 'grykj249@gmail.com', email_verified: true };   // نرجع لحالة المزوّد الوهمي الأصلية
}

identity = { sub: 'g-3', email: 'grykj249@gmail.com', email_verified: false };
const st4 = startOAuth('google', RU)!;
const r4 = await finishOAuth(db, 'google', { code: 'GOOD', state: new URL(st4.url).searchParams.get('state')!, cookie: st4.cookie, redirectUri: RU });
ok(!r4.ok && r4.code === 'unverified_email', 'بريد غير مؤكَّد من المزوّد = مرفوض');

const st5 = startOAuth('google', RU)!;
const r5 = await finishOAuth(db, 'google', { code: 'GOOD', state: 'forged', cookie: st5.cookie, redirectUri: RU });
ok(!r5.ok && r5.code === 'bad_state', 'state مزوَّر = مرفوض');
const r6 = await finishOAuth(db, 'google', { code: 'GOOD', state: new URL(st5.url).searchParams.get('state')!, cookie: undefined, redirectUri: RU });
ok(!r6.ok && r6.code === 'bad_state', 'بدون كوكي state = مرفوض');
const r7 = await finishOAuth(db, 'google', { code: 'BAD', state: new URL(st5.url).searchParams.get('state')!, cookie: st5.cookie, redirectUri: RU });
ok(!r7.ok && r7.code === 'provider_error', 'كود خاطئ من المزوّد = provider_error');

const GU = 'http://localhost:3000/api/auth/oauth/github/callback';
identity = { id: 777, login: 'owner' }; // شكل رد GitHub: المعرّف في id والبريد من /user/emails
const sg = startOAuth('github', GU)!;
const rg = await finishOAuth(db, 'github', { code: 'GOOD', state: new URL(sg.url).searchParams.get('state')!, cookie: sg.cookie, redirectUri: GU });
ok(rg.ok, 'GitHub: يدخل بالبريد الأساسي المؤكَّد');
const sg2 = startOAuth('github', GU)!;
ok(!(await finishOAuth(db, 'google', { code: 'GOOD', state: new URL(sg2.url).searchParams.get('state')!, cookie: sg2.cookie, redirectUri: GU })).ok, 'كوكي GitHub لا يصلح لمسار Google');
delete process.env.GITHUB_CLIENT_ID;
ok(startOAuth('github', GU) === null && configured().github === false && configured().google === true, 'بدون مفاتيح: المزوّد يُعتبر غير مفعّل');
mock.close();

// ============ مفاتيح المرور مع «جهاز» وهمي ============
console.log('— البصمة (WebAuthn)');
const enc = (v: any): Buffer => {
  const head = (mt: number, n: number) => n < 24 ? Buffer.from([mt << 5 | n]) : n < 256 ? Buffer.from([mt << 5 | 24, n]) : Buffer.from([mt << 5 | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  const e = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, e.length), ...e.flatMap(([k, x]: any) => [enc(k), enc(x)])]);
};
const ORIGIN = 'http://localhost:3000', rpHash = sha('localhost');
db = openDb(':memory:');
const owner = (db.prepare("SELECT id, email, display_name FROM users").get() as any);
const user: SessionUser = { id: Number(owner.id), email: owner.email, displayName: owner.display_name, roles: [], mustChangePassword: false };
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' }) as any;
const credId = randomBytes(32);
const cose = enc(new Map<number, any>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
const cd = (type: string, challenge: string, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
const reg = (flags: number, challenge: string, origin = ORIGIN) => {
  const sc = Buffer.alloc(4), idl = Buffer.alloc(2); idl.writeUInt16BE(credId.length);
  const ad = Buffer.concat([rpHash, Buffer.from([flags]), sc, Buffer.alloc(16), idl, credId, cose]);
  return { id: credId.toString('base64url'), response: { clientDataJSON: cd('webauthn.create', challenge, origin).toString('base64url'), attestationObject: enc({ fmt: 'none', attStmt: new Map(), authData: ad }).toString('base64url') }, transports: ['internal'] };
};
ok(loginOptions(db, ORIGIN) === null, 'بدون أي بصمة مسجّلة: لا خيارات دخول');

let ro = registerOptions(db, user, ORIGIN);
ok((ro.options as any).rp.id === 'localhost' && (ro.options as any).authenticatorSelection.userVerification === 'required', 'خيارات التسجيل: rpId صحيح والتحقق (UV) مطلوب');
ok(!registerVerify(db, user, ORIGIN, ro.cookie, reg(0x45, 'wrong-challenge')).ok, 'تسجيل بتحدٍّ خاطئ = مرفوض');
ro = registerOptions(db, user, ORIGIN);
ok(!registerVerify(db, user, ORIGIN, ro.cookie, reg(0x45, (ro.options as any).challenge, 'https://evil.com')).ok, 'تسجيل من أصل (origin) آخر = مرفوض');
ro = registerOptions(db, user, ORIGIN);
ok(!registerVerify(db, user, ORIGIN, ro.cookie, reg(0x41, (ro.options as any).challenge)).ok, 'تسجيل بدون تحقق المستخدم (بصمة/PIN) = مرفوض');
ro = registerOptions(db, user, ORIGIN);
const good = reg(0x45, (ro.options as any).challenge);
ok(registerVerify(db, user, ORIGIN, ro.cookie, good).ok, 'تسجيل صحيح = ينجح');
ok(!registerVerify(db, user, ORIGIN, ro.cookie, good).ok, 'إعادة استخدام نفس التحدّي = مرفوضة');
ok(Number((db.prepare('SELECT COUNT(*) c FROM passkeys').get() as any).c) === 1, 'المفتاح العام محفوظ في جدول passkeys');

const assertion = (challenge: string, count: number, flags = 0x05, key = privateKey, origin = ORIGIN) => {
  const sc = Buffer.alloc(4); sc.writeUInt32BE(count);
  const ad = Buffer.concat([rpHash, Buffer.from([flags]), sc]), raw = cd('webauthn.get', challenge, origin);
  return { id: credId.toString('base64url'), response: { clientDataJSON: raw.toString('base64url'), authenticatorData: ad.toString('base64url'), signature: sign('sha256', Buffer.concat([ad, sha(raw)]), key).toString('base64url') } };
};
const lo = () => loginOptions(db, ORIGIN)!;
let o = lo();
ok((o.options as any).allowCredentials.length === 1, 'خيارات الدخول تعرض المفتاح المسجّل');
const lv = loginVerify(db, ORIGIN, o.cookie, {}, assertion((o.options as any).challenge, 1));
ok(lv.ok && getSession(db, lv.ok ? lv.token : '')?.email === owner.email, 'الدخول بالبصمة ينجح ويفتح جلسة');
ok(Number((db.prepare('SELECT sign_count FROM passkeys').get() as any).sign_count) === 1, 'عدّاد التوقيع تحدّث');
o = lo(); ok(!loginVerify(db, ORIGIN, o.cookie, {}, assertion((o.options as any).challenge, 1)).ok, 'عدّاد لم يتقدّم (نسخة مستنسخة) = مرفوض');
o = lo(); ok(!loginVerify(db, ORIGIN, o.cookie, {}, assertion((o.options as any).challenge, 2, 0x05, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey)).ok, 'توقيع بمفتاح آخر = مرفوض');
o = lo(); ok(!loginVerify(db, ORIGIN, o.cookie, {}, assertion('another-challenge', 2)).ok, 'تحدٍّ خاطئ = مرفوض');
o = lo(); ok(!loginVerify(db, ORIGIN, o.cookie, {}, assertion((o.options as any).challenge, 2, 0x05, privateKey, 'https://evil.com')).ok, 'أصل مختلف = مرفوض');
o = lo(); ok(!loginVerify(db, ORIGIN, o.cookie, {}, assertion((o.options as any).challenge, 2, 0x01)).ok, 'بدون تحقق المستخدم (UV) = مرفوض');
o = lo(); ok(loginVerify(db, ORIGIN, o.cookie, {}, assertion((o.options as any).challenge, 2)).ok, 'بعد المحاولات الفاشلة الدخول الصحيح ما زال ينجح');
ok(!loginVerify(db, ORIGIN, undefined, {}, assertion('x', 3)).ok, 'بدون كوكي التحدّي = مرفوض');

console.log(fail ? `\n❌ فشل ${fail} من ${pass + fail}` : `\n✅ نجحت كل اختبارات الدخول الاجتماعي والبصمة (${pass}/${pass})`);
process.exit(fail ? 1 : 0);
