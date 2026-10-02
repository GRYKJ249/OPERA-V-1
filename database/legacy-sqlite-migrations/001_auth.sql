-- 001: المستخدمون والأدوار والصلاحيات (RBAC)
CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id            TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE
                       CHECK (email LIKE '%_@_%._%' AND length(email) <= 254),
  username             TEXT UNIQUE COLLATE NOCASE
                       CHECK (username IS NULL OR (length(username) BETWEEN 3 AND 30 AND username NOT GLOB '*[^A-Za-z0-9_.]*')),
  display_name         TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
  password_hash        TEXT,                       -- NULL = حساب اجتماعي/مفتاح مرور فقط
  avatar_url           TEXT,
  bio                  TEXT CHECK (bio IS NULL OR length(bio) <= 500),
  locale               TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  timezone             TEXT NOT NULL DEFAULT 'Africa/Khartoum',
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','deleted')),
  email_verified_at    TEXT,
  phone                TEXT UNIQUE CHECK (phone IS NULL OR phone GLOB '+[0-9]*'),
  phone_verified_at    TEXT,
  failed_login_count   INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until         TEXT,
  last_login_at        TEXT,
  last_login_ip        TEXT,
  password_changed_at  TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  terms_accepted_at    TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at           TEXT
) STRICT;
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created ON users(created_at);

CREATE TABLE roles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE CHECK (name NOT GLOB '*[^a-z_]*'),
  description_ar TEXT,
  description_en TEXT,
  is_system      INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE CHECK (code GLOB '[a-z]*.[a-z]*'),
  description TEXT
) STRICT;

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE user_roles (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, role_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

CREATE TABLE user_preferences (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme            TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('dark','light','system')),
  reduce_motion    INTEGER NOT NULL DEFAULT 0 CHECK (reduce_motion IN (0,1)),
  notify_email     INTEGER NOT NULL DEFAULT 1 CHECK (notify_email IN (0,1)),
  newsletter_optin INTEGER NOT NULL DEFAULT 0 CHECK (newsletter_optin IN (0,1)),
  extra            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
