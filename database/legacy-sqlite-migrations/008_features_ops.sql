-- 008: الميزات F51–F100 — الأمان والتدقيق والتحليلات والعمليات

-- [F51] رفض كلمة سر غير مشفّرة (نص خام قصير) عند الإدخال أو التحديث
CREATE TRIGGER trg_pw_hashed_ins BEFORE INSERT ON users
WHEN NEW.password_hash IS NOT NULL AND length(NEW.password_hash) < 20
BEGIN SELECT RAISE(ABORT, 'password_hash looks unhashed'); END;
CREATE TRIGGER trg_pw_hashed_upd BEFORE UPDATE OF password_hash ON users
WHEN NEW.password_hash IS NOT NULL AND length(NEW.password_hash) < 20
BEGIN SELECT RAISE(ABORT, 'password_hash looks unhashed'); END;

-- [F52] تاريخ تغيير البريد الإلكتروني
CREATE TABLE user_email_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL, new_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TRIGGER trg_email_history AFTER UPDATE OF email ON users WHEN lower(OLD.email) <> lower(NEW.email)
BEGIN INSERT INTO user_email_history (user_id, old_email, new_email) VALUES (OLD.id, OLD.email, NEW.email); END;

-- [F53] أسماء مستخدمين محجوزة
CREATE TABLE reserved_usernames (name TEXT PRIMARY KEY COLLATE NOCASE) STRICT, WITHOUT ROWID;
INSERT INTO reserved_usernames (name) VALUES ('admin'),('root'),('support'),('system'),('owner'),('moderator'),('null'),('undefined'),('api'),('www'),('opera'),('developer'),('staff');
CREATE TRIGGER trg_username_reserved_ins BEFORE INSERT ON users
WHEN NEW.username IS NOT NULL AND NEW.username IN (SELECT name FROM reserved_usernames)
BEGIN SELECT RAISE(ABORT, 'username is reserved'); END;
CREATE TRIGGER trg_username_reserved_upd BEFORE UPDATE OF username ON users
WHEN NEW.username IS NOT NULL AND NEW.username IN (SELECT name FROM reserved_usernames)
BEGIN SELECT RAISE(ABORT, 'username is reserved'); END;

-- [F54] تعبئة deleted_at تلقائياً عند حذف الحساب
CREATE TRIGGER trg_user_deleted_at AFTER UPDATE OF status ON users WHEN NEW.status = 'deleted' AND NEW.deleted_at IS NULL
BEGIN UPDATE users SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- [F55] منع تسجيل دخول ناجح لحساب غير نشط
CREATE TRIGGER trg_login_active_only BEFORE INSERT ON login_attempts
WHEN NEW.success = 1 AND EXISTS (SELECT 1 FROM users WHERE email = NEW.email AND status <> 'active')
BEGIN SELECT RAISE(ABORT, 'account is not active'); END;

-- [F56] منع إنشاء جلسة لحساب غير نشط
CREATE TRIGGER trg_session_active_only BEFORE INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND status <> 'active')
BEGIN SELECT RAISE(ABORT, 'account is not active'); END;

-- [F57] حد أقصى 10 جلسات نشطة: الأقدم تُنهى تلقائياً
CREATE TRIGGER trg_session_cap AFTER INSERT ON sessions
BEGIN
  UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE user_id = NEW.user_id AND revoked_at IS NULL
    AND rowid NOT IN (SELECT rowid FROM sessions WHERE user_id = NEW.user_id AND revoked_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 10);
END;

-- [F58] كشف إعادة استخدام رمز التجديد: إنهاء العائلة والجلسة + تدقيق
CREATE TRIGGER trg_refresh_reuse AFTER UPDATE OF used_at ON refresh_tokens WHEN OLD.used_at IS NOT NULL
BEGIN
  UPDATE refresh_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE family_id = NEW.family_id AND revoked_at IS NULL;
  UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.session_id AND revoked_at IS NULL;
  INSERT INTO audit_log (action, entity_type, entity_id, metadata)
  VALUES ('auth.refresh_reuse', 'session', NEW.session_id, json_object('family', NEW.family_id));
END;

-- [F59] إنهاء الجلسة ينهي رموز التجديد التابعة لها
CREATE TRIGGER trg_session_revoke_tokens AFTER UPDATE OF revoked_at ON sessions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN UPDATE refresh_tokens SET revoked_at = NEW.revoked_at WHERE session_id = NEW.id AND revoked_at IS NULL; END;

-- [F60] حظر IP تلقائياً بعد 20 محاولة فاشلة خلال 10 دقائق
CREATE TRIGGER trg_ip_autoblock AFTER INSERT ON login_attempts
WHEN NEW.success = 0 AND NEW.ip IS NOT NULL
 AND (SELECT COUNT(*) FROM login_attempts WHERE ip = NEW.ip AND success = 0
      AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')) >= 20
BEGIN
  INSERT OR IGNORE INTO ip_blocklist (ip, reason, expires_at)
  VALUES (NEW.ip, 'auto: 20 failed logins in 10 minutes', strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'));
END;

-- [F61] رفض أي محاولة دخول من IP محظور
CREATE TRIGGER trg_ip_blocked BEFORE INSERT ON login_attempts
WHEN NEW.ip IS NOT NULL AND EXISTS (SELECT 1 FROM ip_blocklist WHERE ip = NEW.ip
     AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')))
BEGIN SELECT RAISE(ABORT, 'ip is blocked'); END;

-- [F62] تدقيق تفعيل المصادقة الثنائية
CREATE TRIGGER trg_audit_mfa AFTER UPDATE OF enabled_at ON mfa_totp WHEN OLD.enabled_at IS NULL AND NEW.enabled_at IS NOT NULL
BEGIN
  INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id)
  VALUES (NEW.user_id, (SELECT email FROM users WHERE id = NEW.user_id), 'mfa.enabled', 'user', NEW.user_id);
END;

-- [F63] تدقيق إنشاء مفاتيح API وإلغائها
CREATE TRIGGER trg_audit_apikey_new AFTER INSERT ON api_keys
BEGIN
  INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
  VALUES (NEW.user_id, (SELECT email FROM users WHERE id = NEW.user_id), 'apikey.created', 'api_key', NEW.id, json_object('name', NEW.name));
END;
CREATE TRIGGER trg_audit_apikey_revoked AFTER UPDATE OF revoked_at ON api_keys WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
  VALUES (NEW.user_id, (SELECT email FROM users WHERE id = NEW.user_id), 'apikey.revoked', 'api_key', NEW.id, json_object('name', NEW.name));
END;

-- [F64] تدقيق إضافة مفاتيح المرور وحذفها
CREATE TRIGGER trg_audit_passkey_add AFTER INSERT ON passkeys
BEGIN INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id) VALUES (NEW.user_id, 'passkey.added', 'passkey', NEW.id); END;
CREATE TRIGGER trg_audit_passkey_del AFTER DELETE ON passkeys
BEGIN INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id) VALUES (OLD.user_id, 'passkey.removed', 'passkey', OLD.id); END;

-- [F65] تدقيق ربط الحسابات الاجتماعية
CREATE TRIGGER trg_audit_oauth AFTER INSERT ON oauth_accounts
BEGIN INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (NEW.user_id, 'oauth.linked', 'user', NEW.user_id, json_object('provider', NEW.provider)); END;

-- [F66] تدقيق تغيير إعدادات الموقع (القيمة القديمة والجديدة)
CREATE TRIGGER trg_audit_settings AFTER UPDATE OF value ON site_settings WHEN OLD.value <> NEW.value
BEGIN INSERT INTO audit_log (action, entity_type, entity_id, metadata)
  VALUES ('settings.changed', 'setting', NEW.key, json_object('from', OLD.value, 'to', NEW.value)); END;

-- [F67] تدقيق تغيير حالة المشروع
CREATE TRIGGER trg_audit_project_status AFTER UPDATE OF status ON projects WHEN OLD.status <> NEW.status
BEGIN INSERT INTO audit_log (action, entity_type, entity_id, metadata)
  VALUES ('project.status', 'project', NEW.id, json_object('from', OLD.status, 'to', NEW.status)); END;

-- [F68] تدقيق إشراف التعليقات
CREATE TRIGGER trg_audit_comment_status AFTER UPDATE OF status ON comments WHEN OLD.status <> NEW.status
BEGIN INSERT INTO audit_log (action, entity_type, entity_id, metadata)
  VALUES ('comment.status', 'comment', NEW.id, json_object('from', OLD.status, 'to', NEW.status)); END;

-- [F69] تدقيق سحب الأدوار
CREATE TRIGGER trg_audit_role_revoked AFTER DELETE ON user_roles
BEGIN INSERT INTO audit_log (action, entity_type, entity_id, metadata)
  VALUES ('role.revoked', 'user', OLD.user_id, json_object('role', (SELECT name FROM roles WHERE id = OLD.role_id))); END;

-- [F70] تدقيق تغيير البريد
CREATE TRIGGER trg_audit_email AFTER UPDATE OF email ON users WHEN lower(OLD.email) <> lower(NEW.email)
BEGIN INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
  VALUES (NEW.id, NEW.email, 'user.email_changed', 'user', NEW.id, json_object('from', OLD.email)); END;

-- [F71] آخر 200 حدث تدقيق
CREATE VIEW v_audit_recent AS SELECT * FROM audit_log ORDER BY id DESC LIMIT 200;

-- [F72] محاولات الدخول الفاشلة آخر 24 ساعة
CREATE VIEW v_failed_logins_24h AS
SELECT email, ip, COUNT(*) AS failures, MAX(created_at) AS last_at
FROM login_attempts WHERE success = 0 AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
GROUP BY email, ip;

-- [F73] عناوين IP المشبوهة (5 فشل أو أكثر في الساعة)
CREATE VIEW v_suspicious_ips AS
SELECT ip, COUNT(*) AS failures, COUNT(DISTINCT email) AS emails_tried
FROM login_attempts WHERE success = 0 AND ip IS NOT NULL AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')
GROUP BY ip HAVING COUNT(*) >= 5;

-- [F74] مفاتيح API التي تنتهي خلال 14 يوماً
CREATE VIEW v_expiring_api_keys AS
SELECT id, user_id, name, prefix, expires_at FROM api_keys
WHERE revoked_at IS NULL AND expires_at IS NOT NULL
  AND expires_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ','now') AND strftime('%Y-%m-%dT%H:%M:%fZ','now','+14 days');

-- [F75] مديرون بدون مصادقة ثنائية
CREATE VIEW v_admins_without_mfa AS
SELECT u.id, u.email FROM users u
JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.name = 'admin'
WHERE NOT EXISTS (SELECT 1 FROM mfa_totp m WHERE m.user_id = u.id AND m.enabled_at IS NOT NULL);

-- [F76] جلسات نشطة بلا نشاط منذ 30 يوماً
CREATE VIEW v_stale_sessions AS
SELECT * FROM v_active_sessions WHERE last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days');

-- [F77] نظرة صحة الموقع بالأرقام
CREATE VIEW v_site_health AS
SELECT (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
       (SELECT COUNT(*) FROM projects WHERE status = 'published' AND deleted_at IS NULL) AS published_projects,
       (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS pending_comments,
       (SELECT COUNT(*) FROM contact_messages WHERE status = 'new') AS new_messages,
       (SELECT COUNT(*) FROM jobs WHERE status = 'queued') AS queued_jobs,
       (SELECT COUNT(*) FROM email_outbox WHERE status = 'queued') AS queued_emails;

-- [F78] الزيارات حسب الدولة
CREATE VIEW v_traffic_by_country AS
SELECT COALESCE(country, 'unknown') AS country, COUNT(*) AS views, COUNT(DISTINCT session_hash) AS visitors
FROM page_views GROUP BY 1 ORDER BY views DESC;

-- [F79] الزيارات حسب نوع الجهاز
CREATE VIEW v_traffic_by_device AS
SELECT COALESCE(device, 'unknown') AS device, COUNT(*) AS views FROM page_views GROUP BY 1 ORDER BY views DESC;

-- [F80] أهم المصادر المُحيلة
CREATE VIEW v_top_referrers AS
SELECT referrer, COUNT(*) AS views FROM page_views WHERE referrer IS NOT NULL AND referrer <> '' GROUP BY referrer ORDER BY views DESC;

-- [F81] الزيارات بالساعة
CREATE VIEW v_hourly_views AS
SELECT substr(created_at, 1, 13) AS hour, COUNT(*) AS views FROM page_views GROUP BY 1;

-- [F82] أكثر الصفحات زيارة آخر 7 أيام
CREATE VIEW v_top_pages_7d AS
SELECT path, COUNT(*) AS views, COUNT(DISTINCT session_hash) AS visitors
FROM page_views WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
GROUP BY path ORDER BY views DESC;

-- [F83] الزيارات الشهرية
CREATE VIEW v_monthly_views AS
SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS views, COUNT(DISTINCT session_hash) AS visitors
FROM page_views GROUP BY 1;

-- [F84] جدول تجميع يومي سريع للزيارات
CREATE TABLE daily_stats (
  day TEXT NOT NULL, path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (day, path)
) STRICT, WITHOUT ROWID;

-- [F85] تحديث التجميع اليومي تلقائياً مع كل زيارة
CREATE TRIGGER trg_daily_stats AFTER INSERT ON page_views
BEGIN
  INSERT INTO daily_stats (day, path, views) VALUES (substr(NEW.created_at, 1, 10), NEW.path, 1)
  ON CONFLICT (day, path) DO UPDATE SET views = views + 1;
END;

-- [F86] تجاهل زيارات الروبوتات
CREATE TRIGGER trg_views_ignore_bots BEFORE INSERT ON page_views WHEN NEW.device = 'bot'
BEGIN SELECT RAISE(IGNORE); END;

-- [F87] مسار الزيارة يجب أن يبدأ بـ /
CREATE TRIGGER trg_views_path BEFORE INSERT ON page_views WHEN NEW.path NOT LIKE '/%'
BEGIN SELECT RAISE(ABORT, 'path must start with /'); END;

-- [F88] سياسات الاحتفاظ بالبيانات (بالأيام)
CREATE TABLE data_retention_policies (
  table_name TEXT PRIMARY KEY,
  days INTEGER NOT NULL CHECK (days > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
) STRICT, WITHOUT ROWID;
INSERT INTO data_retention_policies (table_name, days) VALUES ('page_views',180),('search_log',90),('dev_logs',30),('slow_queries',14),('email_outbox',60);

-- [F89] طلبات تصدير بيانات المستخدم
CREATE TABLE data_export_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','ready','expired')),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ready_at TEXT, file_path TEXT
) STRICT;

-- [F90] طلبات حذف الحساب مع مهلة 30 يوماً وطلب مفتوح واحد فقط
CREATE TABLE account_deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  execute_after TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days')),
  cancelled_at TEXT, executed_at TEXT
) STRICT;
CREATE UNIQUE INDEX idx_one_open_deletion ON account_deletion_requests(user_id) WHERE cancelled_at IS NULL AND executed_at IS NULL;

-- [F91] سجل الموافقات (الشروط، الخصوصية، الكوكيز)
CREATE TABLE consent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session_hash TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('terms','privacy','cookies_analytics','cookies_marketing','newsletter')),
  granted INTEGER NOT NULL CHECK (granted IN (0,1)),
  version TEXT, ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_consent_user ON consent_log(user_id, kind, created_at);

-- [F92] أعلام الميزات مع نسبة الإطلاق
CREATE TABLE feature_flags (
  name TEXT PRIMARY KEY CHECK (name NOT GLOB '*[^a-z0-9_.]*'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  rollout_percent INTEGER NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;
CREATE TRIGGER trg_flags_touch AFTER UPDATE ON feature_flags WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE feature_flags SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = NEW.name; END;

-- [F93] استثناءات أعلام الميزات لمستخدم معيّن
CREATE TABLE user_feature_flags (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_name TEXT NOT NULL REFERENCES feature_flags(name) ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  PRIMARY KEY (user_id, flag_name)
) STRICT, WITHOUT ROWID;

-- [F94] الويب هوك
CREATE TABLE webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL CHECK (url LIKE 'https://%'),
  secret_enc TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(events) AND json_type(events) = 'array'),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- [F95] سجل تسليم الويب هوك مع إعادة المحاولة
CREATE TABLE webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, response_code INTEGER,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_whd_queue ON webhook_deliveries(status, next_attempt_at);

-- [F96] نشر مشروع يُنشئ تسليمات ويب هوك للمشتركين في project.published
CREATE TRIGGER trg_webhook_project_published AFTER UPDATE OF status ON projects
WHEN OLD.status <> 'published' AND NEW.status = 'published'
BEGIN
  INSERT INTO webhook_deliveries (webhook_id, event, payload)
  SELECT w.id, 'project.published', json_object('project_id', NEW.id, 'slug', NEW.slug)
  FROM webhooks w WHERE w.is_active = 1
    AND EXISTS (SELECT 1 FROM json_each(w.events) WHERE value = 'project.published');
END;

-- [F97] مهام مجدولة (cron)
CREATE TABLE scheduled_tasks (
  name TEXT PRIMARY KEY,
  cron TEXT NOT NULL, job_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_run_at TEXT, next_run_at TEXT
) STRICT, WITHOUT ROWID;
INSERT INTO scheduled_tasks (name, cron, job_type) VALUES ('purge_expired','0 3 * * *','db.purge'),('retention','30 3 * * *','db.retention'),('optimize','0 4 * * 0','db.optimize');

-- [F98] إعادة محاولة المهام الفاشلة تلقائياً (حتى 5 مرات، تأخير تربيعي بالدقائق)
CREATE TRIGGER trg_job_retry AFTER UPDATE OF status ON jobs WHEN NEW.status = 'failed' AND NEW.attempts < 5
BEGIN
  UPDATE jobs SET status = 'queued',
         run_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','+' || (NEW.attempts * NEW.attempts) || ' minutes'),
         locked_at = NULL
  WHERE id = NEW.id;
END;

-- [F99] المهام العالقة (تعمل منذ أكثر من 15 دقيقة)
CREATE VIEW v_stuck_jobs AS
SELECT * FROM jobs WHERE status = 'running' AND locked_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes');

-- [F100] قائمة منع البريد (ارتداد/شكوى/إلغاء اشتراك) وتجاهل الإرسال إليها
CREATE TABLE email_suppressions (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT NOT NULL CHECK (reason IN ('bounce','complaint','unsubscribe','manual')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;
CREATE TRIGGER trg_outbox_suppressed BEFORE INSERT ON email_outbox
WHEN EXISTS (SELECT 1 FROM email_suppressions WHERE email = NEW.to_email COLLATE NOCASE)
BEGIN SELECT RAISE(IGNORE); END;
