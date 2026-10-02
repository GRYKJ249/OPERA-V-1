import assert from 'node:assert/strict';
import { openDb, migrate, purgeExpired, schemaStats } from './db.ts';

const db = openDb(':memory:');
const get = (sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const all = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];
const run = (sql: string, ...a: any[]) => db.prepare(sql).run(...a);
const addUser = (email: string, extra = '') => Number(run(`INSERT INTO users (email, password_hash, status) VALUES (?, 'h_${'x'.repeat(30)}', 'active')`, email).lastInsertRowid);
run("UPDATE site_settings SET value='false' WHERE key='security.single_owner'"); // الاختبارات القديمة تحتاج عدة مستخدمين؛ قفل المالك الوحيد يُختبر في features.test.ts
const future = "strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day')";
let n = 0, failed = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', (e as Error).message); } };

console.log('— البنية');
test('الترحيلات مطبّقة ومسجّلة (15)', () => assert.equal(get('SELECT COUNT(*) c FROM schema_migrations').c, 15));
test('إعادة تشغيل الترحيل لا تطبّق شيئاً', () => assert.deepEqual(migrate(db), []));
test('كل الجداول STRICT', () => {
  const bad = all("SELECT name FROM pragma_table_list WHERE type='table' AND strict=0 AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'");
  assert.deepEqual(bad.map(r => r.name), []);
});
test('المفاتيح الأجنبية سليمة', () => assert.equal(all('PRAGMA foreign_key_check').length, 0));

console.log('— المستخدمون');
const ali = addUser('Ali@Example.com');
test('تفرد البريد بغض النظر عن الحالة', () => assert.throws(() => addUser('ali@example.COM'), /UNIQUE/));
test('رفض بريد غير صالح', () => assert.throws(() => addUser('not-an-email'), /CHECK/));
test('رفض اسم مستخدم فيه رموز', () => assert.throws(() => run("UPDATE users SET username='a b!' WHERE id=?", ali), /CHECK/));
test('اسم مستخدم فريد غير حساس للحالة', () => {
  run("UPDATE users SET username='Ali_99' WHERE id=?", ali);
  const b = addUser('b@example.com');
  assert.throws(() => run("UPDATE users SET username='ali_99' WHERE id=?", b), /UNIQUE/);
});
test('تفضيلات + دور user يُنشآن تلقائياً', () => {
  assert.equal(get('SELECT theme FROM user_preferences WHERE user_id=?', ali).theme, 'system');
  assert.equal(get('SELECT roles FROM v_user_access WHERE user_id=?', ali).roles, 'user');
});
test('updated_at يتحدث تلقائياً', () => {
  const before = get('SELECT updated_at u FROM users WHERE id=?', ali).u;
  run("UPDATE users SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?", ali);
  run("UPDATE users SET bio='hi' WHERE id=?", ali);
  assert.notEqual(get('SELECT updated_at u FROM users WHERE id=?', ali).u, '2000-01-01T00:00:00.000Z');
  assert.ok(before);
});
test('رقم الهاتف بصيغة دولية فقط', () => assert.throws(() => run("UPDATE users SET phone='0912345678' WHERE id=?", ali), /CHECK/));

console.log('— الأدوار والصلاحيات');
test('بيانات أولية: 5 أدوار و22 صلاحية (16 عامة + 6 للمطور)', () => {
  assert.equal(get('SELECT COUNT(*) c FROM roles').c, 5);
  assert.equal(get('SELECT COUNT(*) c FROM permissions').c, 22);
});
test('الدور user لا يملك users.delete، والمدير يملك كل شيء', () => {
  assert.equal(get("SELECT COUNT(*) c FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.name='admin'").c, 16);
  assert.ok(!get('SELECT permissions p FROM v_user_access WHERE user_id=?', ali).p.includes('users.delete'));
});
const adminRole = get("SELECT id FROM roles WHERE name='admin'").id;
test('منح دور يُسجَّل في التدقيق', () => {
  run('INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (?,?,?)', ali, adminRole, ali);
  assert.equal(get("SELECT COUNT(*) c FROM audit_log WHERE action='role.granted' AND entity_id=? AND json_extract(metadata,'$.role')='admin'", String(ali)).c, 1);
});
test('لا يمكن إزالة آخر مدير', () => {
  run('DELETE FROM user_roles WHERE user_id=? AND role_id=?', ali, adminRole);
  const owner = get("SELECT id FROM users WHERE email='grykj249@gmail.com'").id;
  assert.throws(() => run('DELETE FROM user_roles WHERE user_id=? AND role_id=?', owner, adminRole), /last admin/);
});

console.log('— قفل الحساب والجلسات');
const sara = addUser('sara@example.com');
const sess = (id: string, uid: number) => run(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,${future})`, id, uid);
test('4 محاولات فاشلة لا تقفل', () => {
  for (let i = 0; i < 4; i++) run("INSERT INTO login_attempts (email, ip, success) VALUES ('sara@example.com','1.1.1.1',0)");
  const u = get('SELECT failed_login_count c, locked_until l FROM users WHERE id=?', sara);
  assert.equal(u.c, 4); assert.equal(u.l, null);
});
test('الخامسة تقفل الحساب', () => {
  run("INSERT INTO login_attempts (email, ip, success) VALUES ('SARA@example.com','1.1.1.1',0)");
  assert.equal(get('SELECT is_locked l FROM v_user_security WHERE user_id=?', sara).l, 1);
});
test('الدخول الناجح يصفّر العداد ويسجل آخر دخول', () => {
  run("INSERT INTO login_attempts (email, ip, success) VALUES ('sara@example.com','2.2.2.2',1)");
  const u = get('SELECT failed_login_count c, locked_until l, last_login_ip ip FROM users WHERE id=?', sara);
  assert.deepEqual([u.c, u.l, u.ip], [0, null, '2.2.2.2']);
});
test('الجلسة النشطة تظهر في العرض', () => { sess('sess-1', sara); assert.equal(get('SELECT COUNT(*) c FROM v_active_sessions WHERE user_id=?', sara).c, 1); });
test('تغيير كلمة السر: يحفظ القديمة، ينهي الجلسات، يسجل تدقيقاً', () => {
  run("UPDATE users SET password_hash=? WHERE id=?", 'new_' + 'y'.repeat(30), sara);
  assert.equal(get('SELECT COUNT(*) c FROM password_history WHERE user_id=?', sara).c, 1);
  assert.equal(get('SELECT COUNT(*) c FROM v_active_sessions WHERE user_id=?', sara).c, 0);
  assert.ok(get('SELECT password_changed_at p FROM users WHERE id=?', sara).p);
  assert.equal(get("SELECT COUNT(*) c FROM audit_log WHERE action='user.password_changed'").c, 1);
});
test('سجل كلمات السر يحتفظ بآخر 5 فقط', () => {
  for (let i = 0; i < 8; i++) run('UPDATE users SET password_hash=? WHERE id=?', `p${i}_` + 'z'.repeat(30), sara);
  assert.equal(get('SELECT COUNT(*) c FROM password_history WHERE user_id=?', sara).c, 5);
});
test('إيقاف الحساب ينهي الجلسات ومفاتيح API', () => {
  sess('sess-2', sara);
  run("INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES (?, 'k', 'op_', 'hash-k1')", sara);
  run("UPDATE users SET status='suspended' WHERE id=?", sara);
  assert.equal(get('SELECT COUNT(*) c FROM v_active_sessions WHERE user_id=?', sara).c, 0);
  assert.equal(get('SELECT COUNT(*) c FROM api_keys WHERE user_id=? AND revoked_at IS NULL', sara).c, 0);
});

console.log('— MFA، مفاتيح المرور، OAuth');
test('رمز استرداد MFA لا يتكرر لنفس المستخدم', () => {
  run("INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, 'c1')", ali);
  assert.throws(() => run("INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, 'c1')", ali), /UNIQUE/);
});
test('حساب Google واحد لا يُربط بمستخدمين', () => {
  run("INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'google', 'g-1')", ali);
  assert.throws(() => run("INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'google', 'g-1')", sara), /UNIQUE/);
  assert.throws(() => run("INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, 'myspace', 'x')", ali), /CHECK/);
});
test('مفتاح مرور: BLOB وعدّاد التوقيع لا ينقص', () => {
  run("INSERT INTO passkeys (user_id, credential_id, public_key) VALUES (?, 'cred-1', ?)", ali, new Uint8Array([1, 2, 3]));
  assert.throws(() => run("UPDATE passkeys SET sign_count=-1 WHERE credential_id='cred-1'"), /CHECK/);
  assert.equal(get('SELECT passkeys p FROM v_user_security WHERE user_id=?', ali).p, 1);
});
test('حساب اجتماعي بدون كلمة سر مسموح', () => {
  run("INSERT INTO users (email, status) VALUES ('social@example.com','active')");
  assert.equal(get("SELECT password_hash h FROM users WHERE email='social@example.com'").h, null);
});

console.log('— المحتوى والبحث');
const proj = Number(run("INSERT INTO projects (slug) VALUES ('opera-site')").lastInsertRowid);
run("INSERT INTO project_translations (project_id, locale, title, summary, body) VALUES (?,'ar','موقع أوبرا','معرض أعمال تفاعلي','تصميم وتطوير')", proj);
run("INSERT INTO project_translations (project_id, locale, title, summary) VALUES (?,'en','Opera Site','Interactive portfolio')", proj);
test('slug بحروف صغيرة وشرطات فقط', () => assert.throws(() => run("INSERT INTO projects (slug) VALUES ('Bad Slug!')"), /CHECK/));
test('المسودة لا تظهر في العرض العام', () => assert.equal(all('SELECT * FROM v_public_projects').length, 0));
test('النشر يضبط published_at ويظهر المشروع بلغتين', () => {
  run("UPDATE projects SET status='published' WHERE id=?", proj);
  const r = all('SELECT * FROM v_public_projects');
  assert.equal(r.length, 1); assert.ok(r[0].published_at);
  assert.equal(r[0].title_ar, 'موقع أوبرا'); assert.equal(r[0].title_en, 'Opera Site');
});
test('بحث نصي عربي وإنجليزي', () => {
  assert.equal(all("SELECT project_id FROM projects_fts WHERE projects_fts MATCH 'تفاعلي'").length, 1);
  assert.equal(all("SELECT project_id FROM projects_fts WHERE projects_fts MATCH 'portfolio'").length, 1);
});
test('تعديل الترجمة يحدّث الفهرس', () => {
  run("UPDATE project_translations SET title='متجر' WHERE project_id=? AND locale='ar'", proj);
  assert.equal(all("SELECT 1 FROM projects_fts WHERE projects_fts MATCH 'متجر'").length, 1);
  assert.equal(all("SELECT 1 FROM projects_fts WHERE projects_fts MATCH 'أوبرا'").length, 0);
});
test('عداد الإعجابات تلقائي ولا يتكرر إعجاب المستخدم', () => {
  run('INSERT INTO project_likes (user_id, project_id) VALUES (?,?)', ali, proj);
  assert.throws(() => run('INSERT INTO project_likes (user_id, project_id) VALUES (?,?)', ali, proj), /UNIQUE/);
  assert.equal(get('SELECT like_count c FROM projects WHERE id=?', proj).c, 1);
  run('DELETE FROM project_likes WHERE user_id=? AND project_id=?', ali, proj);
  assert.equal(get('SELECT like_count c FROM projects WHERE id=?', proj).c, 0);
});
test('تقييم الشهادة بين 1 و5', () => assert.throws(() => run("INSERT INTO testimonials (author_name, rating) VALUES ('x', 6)"), /CHECK/));
test('رسالة تواصل: بريد صالح ونص غير فارغ', () => {
  assert.throws(() => run("INSERT INTO contact_messages (name,email,body) VALUES ('a','bad','hi')"), /CHECK/);
  assert.throws(() => run("INSERT INTO contact_messages (name,email,body) VALUES ('a','a@b.co','')"), /CHECK/);
});
test('رفع نفس الملف مرتين مرفوض (sha256)', () => {
  run("INSERT INTO media (path,mime,size_bytes,sha256) VALUES ('a.png','image/png',10,'abc')");
  assert.throws(() => run("INSERT INTO media (path,mime,size_bytes,sha256) VALUES ('b.png','image/png',10,'abc')"), /UNIQUE/);
});

console.log('— الدردشة والإشعارات والعروض');
test('رسالة جديدة تحدّث وقت المحادثة', () => {
  const c = Number(run("INSERT INTO chat_conversations (user_id, title) VALUES (?, 't')", ali).lastInsertRowid);
  run("UPDATE chat_conversations SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?", c);
  run("INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'user', 'مرحبا')", c);
  assert.notEqual(get('SELECT updated_at u FROM chat_conversations WHERE id=?', c).u, '2000-01-01T00:00:00.000Z');
  assert.throws(() => run("INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'hacker', 'x')", c), /CHECK/);
});
test('عرض الإشعارات غير المقروءة', () => {
  run("INSERT INTO notifications (user_id, type, title) VALUES (?, 'welcome', 'أهلاً')", ali);
  run("INSERT INTO notifications (user_id, type, title, read_at) VALUES (?, 'old', 'قديم', '2026-01-01')", ali);
  assert.equal(get('SELECT unread u FROM v_unread_notifications WHERE user_id=?', ali).u, 1);
});
test('JSON غير صالح مرفوض', () => assert.throws(() => run("INSERT INTO jobs (type, payload) VALUES ('x', '{bad')"), /CHECK/));
test('إحصاءات الزيارات اليومية', () => {
  for (const h of ['s1', 's1', 's2']) run("INSERT INTO page_views (path, session_hash) VALUES ('/', ?)", h);
  const v = get('SELECT views, visitors FROM v_daily_views WHERE path=?', '/');
  assert.deepEqual([v.views, v.visitors], [3, 2]);
});

console.log('— التدقيق والتنظيف');
test('سجل التدقيق لا يُعدَّل ولا يُحذف', () => {
  assert.throws(() => run("UPDATE audit_log SET action='x'"), /append-only/);
  assert.throws(() => run('DELETE FROM audit_log'), /append-only/);
});
test('حذف مستخدم يحذف بياناته ويبقي التدقيق', () => {
  const d = addUser('del@example.com'); sess('sess-del', d);
  run("INSERT INTO chat_conversations (user_id) VALUES (?)", d);
  const auditBefore = get('SELECT COUNT(*) c FROM audit_log').c;
  run('DELETE FROM users WHERE id=?', d);
  assert.equal(get('SELECT COUNT(*) c FROM sessions WHERE user_id=?', d).c, 0);
  assert.equal(get('SELECT COUNT(*) c FROM chat_conversations WHERE user_id=?', d).c, 0);
  assert.ok(get('SELECT COUNT(*) c FROM audit_log').c >= auditBefore);
});
test('purgeExpired يحذف المنتهي فقط', () => {
  run("INSERT INTO sessions (id,user_id,expires_at) VALUES ('old',?,'2000-01-01T00:00:00.000Z')", ali);
  run("INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?, 'rt-old','2000-01-01T00:00:00.000Z')", ali);
  run(`INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?, 'rt-new', ${future})`, ali);
  const r = purgeExpired(db);
  assert.equal(r.sessions, 1); assert.equal(r.password_resets, 1);
  assert.equal(get("SELECT COUNT(*) c FROM password_resets WHERE token_hash='rt-new'").c, 1);
});

const s = schemaStats(db);
console.log(`\nالبنية: ${s.tables} جدول، ${s.views} عروض، ${s.triggers} مشغّل، ${s.indexes} فهرس`);
console.log(failed ? `❌ فشل ${failed} من ${n + failed}` : `✅ نجحت كل الاختبارات (${n}/${n})`);
process.exit(failed ? 1 : 0);
