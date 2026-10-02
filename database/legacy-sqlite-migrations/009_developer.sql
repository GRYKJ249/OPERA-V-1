-- 009: ميزات المطور D01–D10 (D08–D10 دوال في server/dev.ts). لا يصل إليها إلا من يملك صلاحيات dev.*

-- [D01] دور المطور + صلاحيات dev.* ولا يُمنح إلا لمدير
INSERT INTO roles (name, description_ar, description_en, is_system) VALUES ('developer', 'مطور: أدوات القاعدة والتشخيص', 'Developer tools', 1);
INSERT INTO permissions (code, description) VALUES
 ('dev.console','Developer console access'),('dev.sql','Run raw SQL'),('dev.logs','Read developer logs'),
 ('dev.backup','Create database snapshots'),('dev.flags','Manage feature flags'),('dev.inspect','Inspect schema and data');
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'developer' AND p.code LIKE 'dev.%';
CREATE TRIGGER trg_developer_needs_admin BEFORE INSERT ON user_roles
WHEN NEW.role_id = (SELECT id FROM roles WHERE name = 'developer')
 AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = NEW.user_id AND r.name = 'admin')
BEGIN SELECT RAISE(ABORT, 'developer role requires admin role'); END;
CREATE VIEW v_developer_access AS
SELECT user_id, email FROM v_user_access WHERE status = 'active' AND (',' || permissions || ',') LIKE '%,dev.console,%';

-- [D02] سجل أخطاء وتشخيص للمطور + عرض أخطاء آخر 24 ساعة
CREATE TABLE dev_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error','fatal')),
  source TEXT NOT NULL, message TEXT NOT NULL, stack TEXT,
  context TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_devlogs ON dev_logs(level, created_at);
CREATE VIEW v_dev_errors_24h AS
SELECT * FROM dev_logs WHERE level IN ('error','fatal') AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') ORDER BY id DESC;

-- [D03] سجل الاستعلامات البطيئة (يملؤه timed() في dev.ts)
CREATE TABLE slow_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sql TEXT NOT NULL, duration_ms REAL NOT NULL CHECK (duration_ms >= 0), caller TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_slowq ON slow_queries(duration_ms);

-- [D04] ملاحظات ومهام المطور
CREATE TABLE dev_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, body TEXT,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','todo','bug','idea')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TRIGGER trg_devnotes_touch AFTER UPDATE ON dev_notes WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE dev_notes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- [D05] سجل النسخ الاحتياطية (snapshot() في dev.ts يستخدم VACUUM INTO ويحفظ sha256)
CREATE TABLE db_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL, note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- [D06] إعدادات البيئات (تطوير/اختبار/إنتاج) — ترفض أي مفتاح يبدو سرّاً
CREATE TABLE env_config (
  env TEXT NOT NULL CHECK (env IN ('development','staging','production')),
  key TEXT NOT NULL CHECK (key NOT GLOB '*[^A-Z0-9_]*'),
  value TEXT NOT NULL,
  PRIMARY KEY (env, key)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER trg_env_no_secrets BEFORE INSERT ON env_config
WHEN NEW.key LIKE '%PASSWORD%' OR NEW.key LIKE '%SECRET%' OR NEW.key LIKE '%TOKEN%' OR NEW.key LIKE '%KEY%'
BEGIN SELECT RAISE(ABORT, 'secrets belong in environment variables, not the database'); END;

-- [D07] نظرة على بنية القاعدة (جداول، أعمدة، STRICT)
CREATE VIEW v_dev_schema AS
SELECT name, type, ncol, strict AS is_strict, wr AS without_rowid
FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%';
