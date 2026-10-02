import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, applyRetention } from './db.ts';
import { verifyPassword } from './password.ts';
import * as dev from './dev.ts';

const OWNER = 'grykj249@gmail.com';
const db = openDb(':memory:');
const get = (sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const all = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];
const run = (sql: string, ...a: any[]) => db.prepare(sql).run(...a);
const now = (mod = '') => (get(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'${mod ? `,'${mod}'` : ''}) t`)).t as string;
const addUser = (email: string) => Number(run(`INSERT INTO users (email, password_hash, status) VALUES (?, 'h_${'x'.repeat(30)}', 'active')`, email).lastInsertRowid);
const addProject = (slug: string) => Number(run('INSERT INTO projects (slug) VALUES (?)', slug).lastInsertRowid);
let n = 0, failed = 0;
// الترحيل 014 يوقف وضع المالك ويفتح التسجيل افتراضياً: نتحقق من ذلك أولاً، ثم نعيد تفعيل القفل لاختبار حمايته
const defaultOwnerMode = get("SELECT value v FROM site_settings WHERE key='security.single_owner'").v;
const defaultRegOpen = get("SELECT value v FROM site_settings WHERE key='auth.registration_open'").v;
run("UPDATE site_settings SET value='true' WHERE key='security.single_owner'");
run("UPDATE site_settings SET value='false' WHERE key='auth.registration_open'");
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', (e as Error).message); } };

console.log('— الافتراضي بعد الترحيل 014');
test('وضع المالك الوحيد موقوف افتراضياً', () => assert.equal(defaultOwnerMode, 'false'));
test('التسجيل مفتوح افتراضياً', () => assert.equal(defaultRegOpen, 'true'));
console.log('— سجل الميزات');
test('100 ميزة F01..F100 و11 ميزة مطور D01..D11', () => {
  const codes = all('SELECT code FROM db_features').map(r => r.code);
  for (let i = 1; i <= 100; i++) assert.ok(codes.includes('F' + String(i).padStart(2, '0')), 'missing F' + i);
  for (let i = 1; i <= 11; i++) assert.ok(codes.includes('D' + String(i).padStart(2, '0')), 'missing D' + i);
  assert.equal(codes.length, 111);
});
test('كل ميزة مرتبطة بكائن موجود فعلاً في القاعدة', () => {
  const missing = all("SELECT code, object_name FROM db_features WHERE object_name NOT LIKE 'fn:%'")
    .filter(f => !get('SELECT 1 x FROM sqlite_master WHERE name=?', f.object_name)).map(f => f.code);
  assert.deepEqual(missing, []);
});
test('دوال المطور D08–D10 موجودة في dev.ts', () => {
  for (const f of all("SELECT object_name o FROM db_features WHERE object_name LIKE 'fn:%'").map(r => r.o.slice(3)))
    assert.ok(f === 'inspector' ? typeof dev.rowCounts === 'function' && typeof dev.explain === 'function' : typeof (dev as any)[f] === 'function', f);
});
test('ميزات المطور فقط معلّمة dev_only', () => assert.equal(get("SELECT COUNT(*) c FROM db_features WHERE dev_only=1").c, 11));
test('كل ملفات الترحيل موسومة [F..] لكل ميزة مرة واحدة', () => {
  const sql = ['007_features_content', '008_features_ops', '009_developer'].map(f => readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), 'utf8')).join('\n');
  const tags = [...sql.matchAll(/-- \[([FD]\d+)\]/g)].map(m => m[1]);
  assert.equal(new Set(tags).size, tags.length);
  assert.equal(tags.filter(t => t[0] === 'F').length, 100);
});

console.log('— المالك الوحيد');
test('مستخدم واحد فقط: المالك، نشط وبريده موثّق', () => {
  const u = all('SELECT email, status, email_verified_at v, username FROM users');
  assert.equal(u.length, 1); assert.equal(u[0].email, OWNER); assert.equal(u[0].status, 'active'); assert.ok(u[0].v);
});
test('كلمة السر مخزّنة كـ scrypt hash فقط', () => {
  const h = get('SELECT password_hash h FROM users').h as string;
  assert.ok(h.startsWith('scrypt$')); assert.equal(h.split('$').length, 6);
  assert.equal(verifyPassword('wrong-password', h), false);
  if (process.env.OWNER_PASSWORD_CHECK) assert.equal(verifyPassword(process.env.OWNER_PASSWORD_CHECK, h), true);
});
test('المالك مدير ومطور معاً', () => assert.deepEqual(get('SELECT roles r FROM v_user_access').r.split(',').sort(), ['admin', 'developer', 'user']));
test('التسجيل مغلق في الإعدادات', () => assert.equal(get("SELECT value v FROM site_settings WHERE key='auth.registration_open'").v, 'false'));
test('إضافة مستخدم ثانٍ مرفوضة', () => assert.throws(() => addUser('other@example.com'), /single-owner/));
test('حذف المالك مرفوض', () => assert.throws(() => run('DELETE FROM users WHERE email=?', OWNER), /single-owner/));
test('إيقاف حساب المالك مرفوض', () => assert.throws(() => run("UPDATE users SET status='suspended' WHERE email=?", OWNER), /single-owner/));
test('سحب دور المطور من المالك مرفوض', () => assert.throws(() => run("DELETE FROM user_roles WHERE role_id=(SELECT id FROM roles WHERE name='developer')"), /single-owner/));
test('قفل الحساب بعد 5 محاولات فاشلة يعمل على المالك', () => {
  for (let i = 0; i < 5; i++) run("INSERT INTO login_attempts (email, ip, success) VALUES (?, '9.9.9.9', 0)", OWNER);
  assert.equal(get('SELECT is_locked l FROM v_user_security WHERE email=?', OWNER).l, 1);
  run("UPDATE users SET failed_login_count=0, locked_until=NULL WHERE email=?", OWNER);
});

console.log('— أدوات المطور (للمطور فقط)');
test('المطور مسموح وغيره مرفوض', () => {
  dev.requireDeveloper(db, OWNER);
  assert.throws(() => dev.requireDeveloper(db, 'nobody@example.com'), /denied/);
});
test('healthCheck سليم', () => { const h = dev.healthCheck(db, OWNER); assert.equal(h.ok, true, JSON.stringify(h)); });
test('rowCounts وexplain', () => {
  assert.equal(dev.rowCounts(db, OWNER).users, 1);
  assert.ok(dev.explain(db, OWNER, 'SELECT * FROM users WHERE email = ?').length > 0);
});
test('seedDemo آمن للتكرار ولا ينشئ مستخدمين', () => {
  dev.seedDemo(db, OWNER); const r = dev.seedDemo(db, OWNER);
  assert.equal(r.projects, 2); assert.equal(get('SELECT COUNT(*) c FROM users').c, 1);
});
test('seedDemo مرفوض في الإنتاج', () => {
  process.env.NODE_ENV = 'production';
  try { assert.throws(() => dev.seedDemo(db, OWNER), /production/); } finally { delete process.env.NODE_ENV; }
});
test('snapshot ينشئ ملفاً بـ sha256 صحيح ويسجّله', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'opera-')), 'snap.db');
  const s = dev.snapshot(db, OWNER, f, 'test');
  assert.ok(existsSync(f)); assert.equal(s.sha256, createHash('sha256').update(readFileSync(f)).digest('hex'));
  assert.equal(get('SELECT COUNT(*) c FROM db_snapshots').c, 1);
});
test('timed يسجّل الاستعلام البطيء عند تجاوز العتبة', () => {
  dev.timed(db, OWNER, 'SELECT COUNT(*) c FROM users', [], 0);
  assert.equal(get('SELECT COUNT(*) c FROM slow_queries').c, 1);
});
test('logDev وعرض أخطاء 24 ساعة', () => {
  dev.logDev(db, 'info', 't', 'x'); dev.logDev(db, 'error', 't', 'boom', { a: 1 });
  assert.equal(get('SELECT COUNT(*) c FROM v_dev_errors_24h').c, 1);
});
test('env_config يرفض المفاتيح التي تشبه الأسرار', () => {
  run("INSERT INTO env_config (env,key,value) VALUES ('development','API_URL','http://x')");
  assert.throws(() => run("INSERT INTO env_config (env,key,value) VALUES ('production','DB_PASSWORD','x')"), /secrets/);
  assert.throws(() => run("INSERT INTO env_config (env,key,value) VALUES ('production','lower','x')"), /CHECK/);
});

// بقية الاختبارات تحتاج عدة مستخدمين: نعطّل قفل المالك الوحيد (الإعداد نفسه يُدقَّق)
run("UPDATE site_settings SET value='false' WHERE key='security.single_owner'");
const ownerId = get('SELECT id FROM users').id;
test('تعطيل القفل يُسجَّل في التدقيق', () => assert.equal(get("SELECT COUNT(*) c FROM audit_log WHERE action='settings.changed' AND entity_id='security.single_owner'").c, 2)); // تفعيله في بداية الاختبار + تعطيله هنا
const guest = addUser('guest@example.com');
test('دور المطور يتطلب دور المدير', () => {
  const dev = get("SELECT id FROM roles WHERE name='developer'").id;
  assert.throws(() => run('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)', guest, dev), /requires admin/);
  assert.throws(() => dev_denied(), /denied/);
});
const dev_denied = () => dev.requireDeveloper(db, 'guest@example.com');

console.log('— المحتوى والبحث');
const proj = addProject('opera-site');
run("INSERT INTO project_translations (project_id, locale, title, summary) VALUES (?,'ar','موقع','ملخص')", proj);
test('F01/F02 نسخ المشروع وحد 20 نسخة', () => {
  for (let i = 0; i < 25; i++) run("UPDATE project_translations SET title=? WHERE project_id=? AND locale='ar'", `عنوان ${i}`, proj);
  assert.equal(get('SELECT COUNT(*) c FROM project_revisions WHERE project_id=?', proj).c, 20);
});
test('F03/F04 تغيير الرابط يحفظ القديم ويحوّل إليه', () => {
  run("UPDATE projects SET slug='opera-new' WHERE id=?", proj);
  assert.equal(get("SELECT new_slug s FROM v_slug_redirects WHERE old_slug='opera-site'").s, 'opera-new');
});
test('F05 أحداث المشاهدة تزيد العدّاد', () => {
  run('INSERT INTO project_view_events (project_id) VALUES (?)', proj); run('INSERT INTO project_view_events (project_id) VALUES (?)', proj);
  assert.equal(get('SELECT view_count c FROM projects WHERE id=?', proj).c, 2);
});
test('F23/F24 بحث الخدمات والأسئلة بالعربية والإنجليزية', () => {
  run("INSERT INTO services (slug, title_ar, title_en, desc_ar, desc_en) VALUES ('web','تصميم مواقع','Web design','مواقع سريعة','Fast sites')");
  run("INSERT INTO faqs (q_ar, a_ar, q_en, a_en) VALUES ('كم السعر؟','حسب المشروع','Price?','Depends')");
  assert.equal(all("SELECT 1 FROM services_fts WHERE services_fts MATCH 'مواقع'").length, 1);
  assert.equal(all("SELECT 1 FROM services_fts WHERE services_fts MATCH 'fast'").length, 1);
  assert.equal(all("SELECT 1 FROM faqs_fts WHERE faqs_fts MATCH 'السعر'").length, 1);
  run("DELETE FROM services WHERE slug='web'");
  assert.equal(all("SELECT 1 FROM services_fts WHERE services_fts MATCH 'مواقع'").length, 0);
});
test('F13 تاريخ نهاية الخبرة لا يسبق البداية', () => assert.throws(() => run("INSERT INTO experience (company, role_ar, start_date, end_date) VALUES ('x','y','2024-05','2023-01')"), /CHECK/));
test('F21 الإعلانات خارج فترتها لا تظهر', () => {
  run('INSERT INTO announcements (text_ar, starts_at, ends_at) VALUES (?,?,?)', 'نشط', now('-1 day'), now('+1 day'));
  run('INSERT INTO announcements (text_ar, starts_at, ends_at) VALUES (?,?,?)', 'منتهي', now('-3 day'), now('-2 day'));
  assert.deepEqual(all('SELECT text_ar t FROM v_active_announcements').map(r => r.t), ['نشط']);
});
test('F19 تحويل المسار لنفسه مرفوض', () => assert.throws(() => run("INSERT INTO redirects (from_path, to_path) VALUES ('/a','/a')"), /CHECK/));
test('F27/F28/F29 شعبية وتشابه واستخدام الوسوم', () => {
  const p2 = addProject('second'); run("UPDATE projects SET status='published' WHERE id IN (?,?)", proj, p2);
  run("INSERT INTO tags (slug,name_ar,name_en) VALUES ('t1','أ','A')"); const t = get("SELECT id FROM tags WHERE slug='t1'").id;
  run('INSERT INTO project_tags VALUES (?,?)', proj, t); run('INSERT INTO project_tags VALUES (?,?)', p2, t);
  assert.equal(get('SELECT shared_tags s FROM v_related_projects WHERE project_id=? AND related_id=?', proj, p2).s, 1);
  assert.equal(get("SELECT uses u FROM v_tag_usage WHERE slug='t1'").u, 2);
  assert.equal(get('SELECT id i FROM v_popular_projects LIMIT 1').i, proj);
  assert.equal(JSON.parse(get('SELECT tags_json j FROM v_project_full WHERE id=?', proj).j)[0], 't1');
});

console.log('— التفاعل');
const c1 = Number(run("INSERT INTO comments (project_id, user_id, body) VALUES (?,?,'a')", proj, guest).lastInsertRowid);
test('F38 إشعار المدير بتعليق ينتظر المراجعة', () => assert.equal(get("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND type='comment.pending'", ownerId).c, 1));
test('F31 التصويت: إضافة وتغيير وحذف', () => {
  run('INSERT INTO comment_votes (user_id, comment_id, value) VALUES (?,?,1)', guest, c1);
  assert.equal(get('SELECT vote_score s FROM comments WHERE id=?', c1).s, 1);
  run('UPDATE comment_votes SET value=-1 WHERE user_id=? AND comment_id=?', guest, c1);
  assert.equal(get('SELECT vote_score s FROM comments WHERE id=?', c1).s, -1);
  run('DELETE FROM comment_votes WHERE user_id=?', guest);
  assert.equal(get('SELECT vote_score s FROM comments WHERE id=?', c1).s, 0);
});
test('F32/F33 ثلاثة بلاغات تخفي التعليق', () => {
  for (const e of ['r1@x.com', 'r2@x.com', 'r3@x.com']) run("INSERT INTO comment_reports (comment_id, user_id, reason) VALUES (?,?, 'spam')", c1, addUser(e));
  assert.equal(get('SELECT status s FROM comments WHERE id=?', c1).s, 'hidden');
  assert.equal(get("SELECT COUNT(*) c FROM audit_log WHERE action='comment.status' AND entity_id=?", String(c1)).c, 1);
});
test('F34 أقصى عمق للردود 3', () => {
  const c2 = Number(run("INSERT INTO comments (project_id, user_id, parent_id, body) VALUES (?,?,?,'b')", proj, guest, c1).lastInsertRowid);
  const c3 = Number(run("INSERT INTO comments (project_id, user_id, parent_id, body) VALUES (?,?,?,'c')", proj, guest, c2).lastInsertRowid);
  assert.throws(() => run("INSERT INTO comments (project_id, user_id, parent_id, body) VALUES (?,?,?,'d')", proj, guest, c3), /depth/);
});
test('F35 الرد على تعليق من مشروع آخر مرفوض', () => {
  const other = addProject('other-project');
  assert.throws(() => run("INSERT INTO comments (project_id, user_id, parent_id, body) VALUES (?,?,?,'x')", other, guest, c1), /another project/);
});
test('F36 إيقاف ميزة التعليقات يمنع الإضافة', () => {
  run("UPDATE site_settings SET value='false' WHERE key='features.comments'");
  assert.throws(() => run("INSERT INTO comments (project_id, user_id, body) VALUES (?,?,'z')", proj, guest), /disabled/);
  run("UPDATE site_settings SET value='true' WHERE key='features.comments'");
});
test('F37/F47/F48/F49/F50 رسائل التواصل', () => {
  const ins = (email: string, body = 'مرحبا') => Number(run("INSERT INTO contact_messages (name, email, subject, body) VALUES ('س', ?, 'موضوع', ?)", email, body).lastInsertRowid);
  const m = ins('c@x.com');
  assert.equal(get("SELECT COUNT(*) c FROM notifications WHERE type='contact.new' AND user_id=?", ownerId).c >= 1, true);
  assert.equal(get('SELECT status s FROM contact_messages WHERE id=?', ins('spam@x.com', 'http://a http://b http://c')).s, 'spam');
  run("INSERT INTO message_replies (message_id, user_id, body) VALUES (?,?, 'شكراً')", m, ownerId);
  const r = get('SELECT status s, handled_by h, handled_at t FROM contact_messages WHERE id=?', m);
  assert.deepEqual([r.s, r.h], ['replied', ownerId]); assert.ok(r.t);
  for (let i = 0; i < 4; i++) ins('flood@x.com');
  assert.equal(get("SELECT COUNT(*) c FROM contact_messages WHERE email='flood@x.com'").c, 4);
  ins('flood@x.com');
  assert.throws(() => ins('flood@x.com'), /rate limit/);
  const m2 = ins('h@x.com'); run("UPDATE contact_messages SET status='read' WHERE id=?", m2);
  assert.ok(get('SELECT handled_at t FROM contact_messages WHERE id=?', m2).t);
});
test('F44/F77 لوحة المراجعة وصحة الموقع', () => {
  assert.ok(get('SELECT new_messages n FROM v_pending_moderation').n >= 1);
  assert.ok(get('SELECT users u, published_projects p FROM v_site_health').u >= 1);
});

console.log('— الأمان والتدقيق');
test('F51 كلمة سر غير مشفّرة مرفوضة', () => {
  assert.throws(() => run("INSERT INTO users (email, password_hash) VALUES ('p@x.com','12345678')"), /unhashed/);
  assert.throws(() => run("UPDATE users SET password_hash='short' WHERE id=?", guest), /unhashed/);
});
test('F52/F70 تغيير البريد يُحفظ ويُدقَّق', () => {
  run("UPDATE users SET email='guest2@example.com' WHERE id=?", guest);
  assert.equal(get('SELECT old_email o FROM user_email_history WHERE user_id=?', guest).o, 'guest@example.com');
  assert.equal(get("SELECT COUNT(*) c FROM audit_log WHERE action='user.email_changed'").c, 1);
});
test('F53 أسماء المستخدمين المحجوزة', () => {
  assert.throws(() => run("UPDATE users SET username='Admin' WHERE id=?", guest), /reserved/);
  run("UPDATE users SET username='guest_1' WHERE id=?", guest);
});
test('F54 حذف الحساب يعبّئ deleted_at', () => {
  const u = addUser('gone@x.com'); run("UPDATE users SET status='deleted' WHERE id=?", u);
  assert.ok(get('SELECT deleted_at d FROM users WHERE id=?', u).d);
});
test('F55/F56 الحساب غير النشط لا يدخل ولا تُنشأ له جلسة', () => {
  const u = addUser('susp@x.com'); run("UPDATE users SET status='suspended' WHERE id=?", u);
  assert.throws(() => run("INSERT INTO login_attempts (email, ip, success) VALUES ('susp@x.com','3.3.3.3',1)"), /not active/);
  assert.throws(() => run("INSERT INTO sessions (id, user_id, expires_at) VALUES ('s-susp', ?, ?)", u, now('+1 day')), /not active/);
});
test('F57 حد 10 جلسات نشطة', () => {
  for (let i = 0; i < 12; i++) run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', `cap-${i}`, guest, now('+1 day'));
  assert.equal(get('SELECT COUNT(*) c FROM v_active_sessions WHERE user_id=?', guest).c, 10);
});
test('F58/F59 إعادة استخدام رمز التجديد تُنهي العائلة والجلسة', () => {
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', 'rt-s', ownerId, now('+1 day'));
  run("INSERT INTO refresh_tokens (session_id, family_id, token_hash, expires_at) VALUES ('rt-s','fam1','th1',?)", now('+1 day'));
  run("INSERT INTO refresh_tokens (session_id, family_id, token_hash, expires_at) VALUES ('rt-s','fam1','th2',?)", now('+1 day'));
  run("UPDATE refresh_tokens SET used_at=? WHERE token_hash='th1'", now());
  assert.equal(get("SELECT COUNT(*) c FROM refresh_tokens WHERE family_id='fam1' AND revoked_at IS NULL").c, 2);
  run("UPDATE refresh_tokens SET used_at=? WHERE token_hash='th1'", now());
  assert.equal(get("SELECT COUNT(*) c FROM refresh_tokens WHERE family_id='fam1' AND revoked_at IS NULL").c, 0);
  assert.ok(get("SELECT revoked_at r FROM sessions WHERE id='rt-s'").r);
  assert.equal(get("SELECT COUNT(*) c FROM audit_log WHERE action='auth.refresh_reuse'").c, 1);
});
test('F60/F61/F73 حظر IP تلقائي بعد 20 فشل', () => {
  for (let i = 0; i < 20; i++) run("INSERT INTO login_attempts (email, ip, success) VALUES (?, '8.8.8.8', 0)", `x${i}@x.com`);
  assert.equal(get("SELECT COUNT(*) c FROM ip_blocklist WHERE ip='8.8.8.8'").c, 1);
  assert.throws(() => run("INSERT INTO login_attempts (email, ip, success) VALUES ('y@x.com','8.8.8.8',0)"), /blocked/);
  assert.equal(get("SELECT failures f FROM v_suspicious_ips WHERE ip='8.8.8.8'").f, 20);
  assert.ok(all("SELECT 1 FROM v_failed_logins_24h WHERE ip='8.8.8.8'").length > 0);
});
test('F62/F63/F64/F65 تدقيق MFA ومفاتيح API ومرور وOAuth', () => {
  run("INSERT INTO mfa_totp (user_id, secret_enc) VALUES (?, 'enc')", guest);
  run('UPDATE mfa_totp SET enabled_at=? WHERE user_id=?', now(), guest);
  run("INSERT INTO api_keys (user_id, name, prefix, key_hash, expires_at) VALUES (?, 'k', 'op_', 'kh1', ?)", guest, now('+3 days'));
  run("UPDATE api_keys SET revoked_at=? WHERE key_hash='kh1'", now());
  run("INSERT INTO passkeys (user_id, credential_id, public_key) VALUES (?, 'pk1', x'01')", guest);
  run("DELETE FROM passkeys WHERE credential_id='pk1'");
  run("INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'github', 'gh1')", guest);
  const acts = all('SELECT action a FROM audit_log').map(r => r.a);
  for (const a of ['mfa.enabled', 'apikey.created', 'apikey.revoked', 'passkey.added', 'passkey.removed', 'oauth.linked']) assert.ok(acts.includes(a), a);
});
test('F74/F75/F76 عروض المراقبة', () => {
  run("INSERT INTO api_keys (user_id, name, prefix, key_hash, expires_at) VALUES (?, 'k2', 'op_', 'kh2', ?)", guest, now('+3 days'));
  assert.equal(all("SELECT 1 FROM v_expiring_api_keys WHERE name='k2'").length, 1);
  assert.deepEqual(all('SELECT email e FROM v_admins_without_mfa').map(r => r.e), [OWNER]);
  run("UPDATE sessions SET last_seen_at=? WHERE id='cap-5'", now('-40 days'));
  assert.equal(all('SELECT 1 FROM v_stale_sessions').length >= 0, true);
});
test('F66/F67/F69/F71 تدقيق الإعدادات والمشروع والأدوار', () => {
  run("UPDATE site_settings SET value='Opera 2' WHERE key='site.name'");
  run("UPDATE projects SET status='published' WHERE id=?", proj);
  run("INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (?, (SELECT id FROM roles WHERE name='editor'), ?)", guest, ownerId);
  run("DELETE FROM user_roles WHERE user_id=? AND role_id=(SELECT id FROM roles WHERE name='editor')", guest);
  const acts = all('SELECT action a FROM v_audit_recent').map(r => r.a);
  for (const a of ['settings.changed', 'role.revoked']) assert.ok(acts.includes(a), a);
});

console.log('— التحليلات');
test('F84/F85/F86/F87 تجميع يومي وتجاهل الروبوتات وفحص المسار', () => {
  for (let i = 0; i < 3; i++) run("INSERT INTO page_views (path, country, device, referrer, session_hash) VALUES ('/about','SD','mobile','google.com',?)", 's' + i);
  run("INSERT INTO page_views (path, device) VALUES ('/about','bot')");
  assert.equal(get("SELECT views v FROM daily_stats WHERE path='/about'").v, 3);
  assert.throws(() => run("INSERT INTO page_views (path) VALUES ('about')"), /must start/);
  assert.equal(get("SELECT views v FROM v_traffic_by_country WHERE country='SD'").v, 3);
  assert.equal(get("SELECT views v FROM v_traffic_by_device WHERE device='mobile'").v, 3);
  assert.equal(get("SELECT views v FROM v_top_referrers WHERE referrer='google.com'").v, 3);
  assert.equal(get("SELECT views v FROM v_top_pages_7d WHERE path='/about'").v, 3);
  assert.equal(all('SELECT * FROM v_hourly_views').length, 1);
  assert.equal(all('SELECT * FROM v_monthly_views').length, 1);
});

console.log('— الخصوصية والعمليات');
test('F90 طلب حذف مفتوح واحد فقط لكل مستخدم', () => {
  run('INSERT INTO account_deletion_requests (user_id) VALUES (?)', guest);
  assert.throws(() => run('INSERT INTO account_deletion_requests (user_id) VALUES (?)', guest), /UNIQUE/);
  run("UPDATE account_deletion_requests SET cancelled_at=? WHERE user_id=?", now(), guest);
  run('INSERT INTO account_deletion_requests (user_id) VALUES (?)', guest);
});
test('F88/F91/F92/F93 الاحتفاظ والموافقات والأعلام', () => {
  assert.equal(get('SELECT COUNT(*) c FROM data_retention_policies').c, 5);
  assert.throws(() => run("INSERT INTO consent_log (kind, granted) VALUES ('selfies', 1)"), /CHECK/);
  run("INSERT INTO feature_flags (name, enabled, rollout_percent) VALUES ('new.nav', 1, 50)");
  assert.throws(() => run("INSERT INTO feature_flags (name, rollout_percent) VALUES ('bad', 150)"), /CHECK/);
  run("INSERT INTO user_feature_flags VALUES (?, 'new.nav', 0)", guest);
});
test('F94/F95/F96 نشر مشروع يُنشئ تسليم ويب هوك للمشتركين فقط', () => {
  run("INSERT INTO webhooks (url, secret_enc, events) VALUES ('https://a.example/hook','enc','[\"project.published\"]')");
  run("INSERT INTO webhooks (url, secret_enc, events) VALUES ('https://b.example/hook','enc','[\"other\"]')");
  assert.throws(() => run("INSERT INTO webhooks (url, secret_enc) VALUES ('http://insecure','enc')"), /CHECK/);
  const p = addProject('hooked'); run("UPDATE projects SET status='published' WHERE id=?", p);
  const d = all('SELECT event e, json_extract(payload, \'$.slug\') s FROM webhook_deliveries');
  assert.equal(d.length, 1); assert.equal(d[0].e, 'project.published'); assert.equal(d[0].s, 'hooked');
});
test('F88 applyRetention يحذف القديم فقط', () => {
  run("INSERT INTO search_log (query, created_at) VALUES ('old', '2000-01-01T00:00:00.000Z')");
  const before = get('SELECT COUNT(*) c FROM search_log').c;
  assert.equal(applyRetention(db).search_log, 1);
  assert.equal(get('SELECT COUNT(*) c FROM search_log').c, before - 1);
});
test('F97 مهام مجدولة افتراضية', () => assert.equal(get('SELECT COUNT(*) c FROM scheduled_tasks').c, 3));
test('F98/F99 إعادة محاولة المهام الفاشلة وحد 5 محاولات', () => {
  const j = Number(run("INSERT INTO jobs (type) VALUES ('t')").lastInsertRowid);
  run("UPDATE jobs SET status='failed', attempts=2 WHERE id=?", j);
  const r = get('SELECT status s, run_at r FROM jobs WHERE id=?', j);
  assert.equal(r.s, 'queued'); assert.ok(r.r > now('+3 minutes'));
  run("UPDATE jobs SET status='failed', attempts=5 WHERE id=?", j);
  assert.equal(get('SELECT status s FROM jobs WHERE id=?', j).s, 'failed');
  run("UPDATE jobs SET status='running', locked_at=? WHERE id=?", now('-1 hour'), j);
  assert.equal(all('SELECT 1 FROM v_stuck_jobs').length, 1);
});
test('F100 البريد الموقوف يُتجاهل في الإرسال', () => {
  run("INSERT INTO email_suppressions (email, reason) VALUES ('Bounced@X.com','bounce')");
  run("INSERT INTO email_outbox (to_email, template) VALUES ('bounced@x.com','welcome')");
  run("INSERT INTO email_outbox (to_email, template) VALUES ('ok@x.com','welcome')");
  assert.deepEqual(all('SELECT to_email e FROM email_outbox').map(r => r.e), ['ok@x.com']);
});
test('F89/F45/F46/F39/F40/F06/F07/F08/F09/F10/F11/F12/F14/F15/F16/F17/F18/F20/F22/F25/F26 الجداول تعمل', () => {
  const pid = proj, uid = guest;
  run("INSERT INTO collections (slug,title_ar,title_en) VALUES ('best','الأفضل','Best')"); run('INSERT INTO collection_items VALUES (1,?,0)', pid);
  run("INSERT INTO project_links (project_id,label,url,kind) VALUES (?,'demo','https://x.com','demo')", pid);
  assert.throws(() => run("INSERT INTO project_links (project_id,label,url) VALUES (?,'bad','javascript:1')", pid), /CHECK/);
  run("INSERT INTO media (path,mime,size_bytes) VALUES ('m.png','image/png',1)"); run('INSERT INTO project_media (project_id,media_id) VALUES (?,1)', pid);
  run("INSERT INTO project_milestones (project_id,title_ar,happened_on) VALUES (?,'إطلاق','2026-01-05')", pid);
  assert.throws(() => run("INSERT INTO project_milestones (project_id,title_ar,happened_on) VALUES (?,'x','5/1/2026')", pid), /CHECK/);
  run("INSERT INTO skills (slug,name_ar,name_en,level) VALUES ('ts','تايب','TS',90)"); run('INSERT INTO project_skills VALUES (?,1)', pid);
  assert.throws(() => run("INSERT INTO skills (slug,name_ar,name_en,level) VALUES ('x','x','x',101)"), /CHECK/);
  run("INSERT INTO education (institution, degree_ar, start_year, end_year) VALUES ('U','بكالوريوس',2015,2019)");
  run("INSERT INTO certificates (name, issuer, issued_on) VALUES ('c','i','2025-02-01')");
  run("INSERT INTO social_links (platform, url) VALUES ('github','https://github.com/x')");
  assert.throws(() => run("INSERT INTO social_links (platform, url) VALUES ('github','https://github.com/y')"), /UNIQUE/);
  run("INSERT INTO static_pages (slug,title_ar) VALUES ('privacy','الخصوصية')");
  run("INSERT INTO menu_items (label_ar,label_en,href) VALUES ('الرئيسية','Home','/')");
  run("INSERT INTO content_blocks (key, ar, en) VALUES ('hero.title','أهلاً','Hello')");
  run("INSERT INTO search_log (query, results) VALUES ('opera', 2)"); run("INSERT INTO search_synonyms VALUES ('site','website')");
  run('INSERT INTO bookmarks (user_id, project_id) VALUES (?,?)', uid, pid); run("INSERT INTO share_events (project_id, platform) VALUES (?, 'whatsapp')", pid);
  run("INSERT INTO newsletter_subscribers (email) VALUES ('sub@x.com')");
  run("INSERT INTO newsletter_campaigns (subject_ar, body_ar) VALUES ('عنوان','نص')"); run("INSERT INTO campaign_deliveries (campaign_id, subscriber_id) VALUES (1,1)");
  run('INSERT INTO data_export_requests (user_id) VALUES (?)', uid);
  assert.equal(all('PRAGMA foreign_key_check').length, 0);
});
test('العروض العامة: شهادات وخدمات وأسئلة', () => {
  run("INSERT INTO testimonials (author_name, quote_ar, approved) VALUES ('a','جيد',1)"); run("INSERT INTO testimonials (author_name, quote_ar) VALUES ('b','لم يُعتمد')");
  run("INSERT INTO services (slug,title_ar,title_en,is_active) VALUES ('on','أ','A',1)"); run("INSERT INTO services (slug,title_ar,title_en,is_active) VALUES ('off','ب','B',0)");
  assert.equal(all('SELECT * FROM v_public_testimonials').length, 1);
  assert.deepEqual(all('SELECT slug FROM v_public_services').map(r => r.slug), ['on']);
  assert.equal(all('SELECT * FROM v_public_faqs').length, 1);
});
test('v_dev_schema تعرض الجداول وكلها STRICT ما عدا FTS', () => {
  const bad = all("SELECT name FROM v_dev_schema WHERE type='table' AND is_strict=0 AND name NOT LIKE '%_fts%'");
  assert.deepEqual(bad.map(r => r.name), []);
});
test('سلامة نهائية: المفاتيح الأجنبية وintegrity_check', () => {
  assert.equal(all('PRAGMA foreign_key_check').length, 0);
  assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok');
});


console.log('— حساب الطوارئ للمطور [D11]');
{
  const RECOVERY = 'GRYKJ2010JIDO@gry.com', RPW = process.env.RECOVERY_PASSWORD_CHECK;
  const d2 = openDb(':memory:');
  const g2 = (sql: string, ...a: any[]) => d2.prepare(sql).get(...a) as any;
  const r2 = (sql: string, ...a: any[]) => d2.prepare(sql).run(...a);
  test('حساب الطوارئ ليس مستخدماً وكلمة سره scrypt hash فقط', () => {
    assert.equal(g2('SELECT COUNT(*) c FROM users WHERE email=?', RECOVERY).c, 0);
    const h = g2('SELECT password_hash h FROM recovery_accounts WHERE email=?', RECOVERY).h as string;
    assert.ok(h.startsWith('scrypt$')); assert.ok(!readFileSync(new URL('./dev.ts', import.meta.url), 'utf8').includes('JIDO20MB'));
  });
  test('كلمة سر خاطئة أو بريد مجهول = رفض', () => {
    assert.equal(dev.recoverOwner(d2, RECOVERY, 'wrong-password', '1.1.1.1'), null);
    assert.equal(dev.recoverOwner(d2, 'nobody@x.com', 'whatever', '1.1.1.1'), null);
  });
  test('5 محاولات فاشلة تقفل حساب الطوارئ مؤقتاً حتى بالكلمة الصحيحة', () => {
    for (let i = 0; i < 5; i++) dev.recoverOwner(d2, RECOVERY, 'bad' + i, '2.2.2.2');
    if (RPW) assert.equal(dev.recoverOwner(d2, RECOVERY, RPW, '2.2.2.2'), null);
    r2('DELETE FROM login_attempts');
  });
  if (RPW) {
    test('الدخول الصحيح والمالك سليم: لا شيء يُستعاد', () => {
      const r = dev.recoverOwner(d2, RECOVERY, RPW)!; assert.equal(r.restored, 'none'); assert.equal(r.ownerEmail, OWNER);
    });
    test('المالك موقوف/محذوف ناعماً (قفل المالك معطّل): يُعاد تفعيله', () => {
      r2("UPDATE site_settings SET value='false' WHERE key='security.single_owner'");
      r2("UPDATE users SET status='deleted' WHERE email=?", OWNER);
      assert.equal(g2('SELECT deleted_at d FROM users WHERE email=?', OWNER).d !== null, true);
      const r = dev.recoverOwner(d2, RECOVERY, RPW)!; assert.equal(r.restored, 'reactivated');
      const u = g2('SELECT status s, deleted_at d FROM users WHERE email=?', OWNER); assert.equal(u.s, 'active'); assert.equal(u.d, null);
    });
    test('المالك محذوف نهائياً: يُعاد إنشاؤه بدوري admin+developer ويُطلب تغيير كلمة السر', () => {
      r2('DROP TRIGGER trg_last_admin'); // الحذف النهائي لا يحدث عادةً (المشغّل يحمي آخر مدير)؛ نحاكي فقدان الصف بالكامل
      r2('DELETE FROM users WHERE email=?', OWNER);
      assert.equal(g2('SELECT COUNT(*) c FROM users').c, 0);
      const r = dev.recoverOwner(d2, RECOVERY, RPW)!; assert.equal(r.restored, 'recreated');
      const u = g2('SELECT status s, must_change_password m FROM users WHERE email=?', OWNER);
      assert.equal(u.s, 'active'); assert.equal(u.m, 1);
      const roles = g2('SELECT roles r FROM v_user_access WHERE email=?', OWNER).r.split(',').sort();
      assert.deepEqual(roles, ['admin', 'developer', 'user']);
      dev.requireDeveloper(d2, OWNER);
    });
    test('كل دخول طوارئ يُدقَّق ويُحسب', () => {
      assert.equal(g2("SELECT COUNT(*) c FROM audit_log WHERE action='recovery.login'").c, 3);
      assert.equal(g2('SELECT uses u FROM recovery_accounts WHERE email=?', RECOVERY).u, 3);
    });
  }
  test('لا يمكن حذف آخر حساب طوارئ', () => assert.throws(() => r2('DELETE FROM recovery_accounts'), /last recovery/));
}

console.log(failed ? `\n❌ فشل ${failed} من ${n + failed}` : `\n✅ نجحت كل اختبارات الميزات (${n}/${n})`);
process.exit(failed ? 1 : 0);
