-- 005: سجل التدقيق، المشغّلات (triggers)، البحث النصي، والعروض (views)

-- سجل لا يُعدَّل ولا يُحذف. بدون مفتاح أجنبي حتى يبقى بعد حذف المستخدم
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_email   TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT, entity_id TEXT,
  ip            TEXT, user_agent TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, created_at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_log(action, created_at);
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;

-- تحديث updated_at تلقائياً
CREATE TRIGGER trg_users_touch AFTER UPDATE ON users WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_projects_touch AFTER UPDATE ON projects WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_comments_touch AFTER UPDATE ON comments WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE comments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_prefs_touch AFTER UPDATE ON user_preferences WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE user_preferences SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = NEW.user_id; END;
CREATE TRIGGER trg_settings_touch AFTER UPDATE ON site_settings WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE site_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = NEW.key; END;

-- مستخدم جديد: تفضيلات افتراضية + دور user + سجل تدقيق
CREATE TRIGGER trg_user_created AFTER INSERT ON users
BEGIN
  INSERT INTO user_preferences (user_id) VALUES (NEW.id);
  INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT NEW.id, id FROM roles WHERE name = 'user';
  INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id)
  VALUES (NEW.id, NEW.email, 'user.created', 'user', NEW.id);
END;

-- قفل الحساب تلقائياً: 5 محاولات فاشلة = قفل 15 دقيقة، والنجاح يصفّر العداد
CREATE TRIGGER trg_attempt_fail AFTER INSERT ON login_attempts WHEN NEW.success = 0
BEGIN
  UPDATE users SET
    failed_login_count = failed_login_count + 1,
    locked_until = CASE WHEN failed_login_count + 1 >= 5
                        THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') ELSE locked_until END
  WHERE email = NEW.email;
END;
CREATE TRIGGER trg_attempt_ok AFTER INSERT ON login_attempts WHEN NEW.success = 1
BEGIN
  UPDATE users SET failed_login_count = 0, locked_until = NULL,
         last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_login_ip = NEW.ip
  WHERE email = NEW.email;
END;

-- تغيير كلمة السر: حفظ القديمة (آخر 5)، تحديث التاريخ، إنهاء كل الجلسات، تدقيق
CREATE TRIGGER trg_password_changed AFTER UPDATE OF password_hash ON users
WHEN OLD.password_hash IS NOT NULL AND NEW.password_hash IS NOT OLD.password_hash
BEGIN
  INSERT INTO password_history (user_id, password_hash) VALUES (OLD.id, OLD.password_hash);
  DELETE FROM password_history WHERE user_id = OLD.id
    AND id NOT IN (SELECT id FROM password_history WHERE user_id = OLD.id ORDER BY id DESC LIMIT 5);
  UPDATE users SET password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), must_change_password = 0 WHERE id = OLD.id;
  UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = OLD.id AND revoked_at IS NULL;
  INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id)
  VALUES (OLD.id, OLD.email, 'user.password_changed', 'user', OLD.id);
END;

-- إيقاف/حذف الحساب: إنهاء الجلسات وتدقيق
CREATE TRIGGER trg_user_status AFTER UPDATE OF status ON users WHEN NEW.status IN ('suspended','deleted') AND OLD.status <> NEW.status
BEGIN
  UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = NEW.id AND revoked_at IS NULL;
  UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = NEW.id AND revoked_at IS NULL;
  INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
  VALUES (NEW.id, NEW.email, 'user.' || NEW.status, 'user', NEW.id, json_object('from', OLD.status));
END;

-- تغيير الأدوار يُسجَّل، ولا يمكن إزالة آخر مدير
CREATE TRIGGER trg_role_granted AFTER INSERT ON user_roles
BEGIN
  INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (NEW.granted_by, 'role.granted', 'user', NEW.user_id,
          json_object('role', (SELECT name FROM roles WHERE id = NEW.role_id)));
END;
CREATE TRIGGER trg_last_admin BEFORE DELETE ON user_roles
WHEN OLD.role_id = (SELECT id FROM roles WHERE name = 'admin')
 AND (SELECT COUNT(*) FROM user_roles WHERE role_id = OLD.role_id) <= 1
BEGIN SELECT RAISE(ABORT, 'cannot remove the last admin'); END;

-- عدّاد الإعجابات
CREATE TRIGGER trg_like_add AFTER INSERT ON project_likes
BEGIN UPDATE projects SET like_count = like_count + 1 WHERE id = NEW.project_id; END;
CREATE TRIGGER trg_like_del AFTER DELETE ON project_likes
BEGIN UPDATE projects SET like_count = max(like_count - 1, 0) WHERE id = OLD.project_id; END;

-- تحديث نشاط المحادثة، وتاريخ نشر المشروع تلقائياً
CREATE TRIGGER trg_chat_activity AFTER INSERT ON chat_messages
BEGIN UPDATE chat_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.conversation_id; END;
CREATE TRIGGER trg_project_published AFTER UPDATE OF status ON projects
WHEN NEW.status = 'published' AND NEW.published_at IS NULL
BEGIN UPDATE projects SET published_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- بحث نصي كامل في المشاريع (يدعم العربية بإزالة التشكيل)
CREATE VIRTUAL TABLE projects_fts USING fts5(
  title, summary, body, locale UNINDEXED, project_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER trg_fts_ins AFTER INSERT ON project_translations BEGIN
  INSERT INTO projects_fts (title, summary, body, locale, project_id)
  VALUES (NEW.title, NEW.summary, NEW.body, NEW.locale, NEW.project_id);
END;
CREATE TRIGGER trg_fts_del AFTER DELETE ON project_translations BEGIN
  DELETE FROM projects_fts WHERE project_id = OLD.project_id AND locale = OLD.locale;
END;
CREATE TRIGGER trg_fts_upd AFTER UPDATE ON project_translations BEGIN
  DELETE FROM projects_fts WHERE project_id = OLD.project_id AND locale = OLD.locale;
  INSERT INTO projects_fts (title, summary, body, locale, project_id)
  VALUES (NEW.title, NEW.summary, NEW.body, NEW.locale, NEW.project_id);
END;

-- عروض جاهزة للاستعلام
CREATE VIEW v_user_access AS
SELECT u.id AS user_id, u.email, u.status,
       group_concat(DISTINCT r.name) AS roles,
       group_concat(DISTINCT p.code) AS permissions
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
LEFT JOIN role_permissions rp ON rp.role_id = r.id
LEFT JOIN permissions p ON p.id = rp.permission_id
GROUP BY u.id;

CREATE VIEW v_active_sessions AS
SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now');

CREATE VIEW v_user_security AS
SELECT u.id AS user_id, u.email,
       (SELECT COUNT(*) FROM mfa_totp m WHERE m.user_id = u.id AND m.enabled_at IS NOT NULL) AS has_mfa,
       (SELECT COUNT(*) FROM passkeys k WHERE k.user_id = u.id) AS passkeys,
       (SELECT COUNT(*) FROM v_active_sessions s WHERE s.user_id = u.id) AS active_sessions,
       u.failed_login_count,
       (u.locked_until IS NOT NULL AND u.locked_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS is_locked,
       u.email_verified_at IS NOT NULL AS email_verified
FROM users u;

CREATE VIEW v_public_projects AS
SELECT p.id, p.slug, p.featured, p.like_count, p.view_count, p.published_at, p.url, p.repo_url,
       ta.title AS title_ar, ta.summary AS summary_ar,
       te.title AS title_en, te.summary AS summary_en
FROM projects p
LEFT JOIN project_translations ta ON ta.project_id = p.id AND ta.locale = 'ar'
LEFT JOIN project_translations te ON te.project_id = p.id AND te.locale = 'en'
WHERE p.status = 'published' AND p.deleted_at IS NULL
ORDER BY p.featured DESC, p.sort_order, p.published_at DESC;

CREATE VIEW v_daily_views AS
SELECT substr(created_at,1,10) AS day, path, COUNT(*) AS views, COUNT(DISTINCT session_hash) AS visitors
FROM page_views GROUP BY day, path;

CREATE VIEW v_unread_notifications AS
SELECT user_id, COUNT(*) AS unread FROM notifications WHERE read_at IS NULL GROUP BY user_id;
