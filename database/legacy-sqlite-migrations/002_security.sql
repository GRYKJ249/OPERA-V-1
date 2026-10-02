-- 002: الأمان: جلسات، رموز، تحقق، MFA، مفاتيح مرور، API keys، حدود المعدل
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                    -- sha256 للرمز
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  ip           TEXT,
  user_agent   TEXT,
  device_name  TEXT,
  mfa_passed   INTEGER NOT NULL DEFAULT 0 CHECK (mfa_passed IN (0,1))
) STRICT;
CREATE INDEX idx_sessions_user ON sessions(user_id, revoked_at);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- رموز التجديد مع كشف إعادة الاستخدام (عائلة الرموز)
CREATE TABLE refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  family_id   TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  replaced_by INTEGER REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  revoked_at  TEXT
) STRICT;
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_session ON refresh_tokens(session_id);

CREATE TABLE email_verifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email  TEXT COLLATE NOCASE,                   -- عند تغيير البريد
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
) STRICT;
CREATE INDEX idx_emailver_user ON email_verifications(user_id);

CREATE TABLE password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  ip         TEXT
) STRICT;
CREATE INDEX idx_resets_user ON password_resets(user_id);

CREATE TABLE password_history (                    -- منع إعادة استخدام كلمات السر القديمة
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_pwhist_user ON password_history(user_id, id);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT COLLATE NOCASE,
  ip         TEXT,
  success    INTEGER NOT NULL CHECK (success IN (0,1)),
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_attempts_email ON login_attempts(email, created_at);
CREATE INDEX idx_attempts_ip ON login_attempts(ip, created_at);

CREATE TABLE mfa_totp (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc     TEXT NOT NULL,                      -- مشفّر بمفتاح الخادم
  enabled_at     TEXT,
  last_used_step INTEGER,                            -- يمنع إعادة استخدام نفس الرمز
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE mfa_recovery_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at   TEXT,
  UNIQUE (user_id, code_hash)
) STRICT;

CREATE TABLE oauth_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google','github','apple','microsoft')),
  provider_user_id TEXT NOT NULL,
  email            TEXT COLLATE NOCASE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_user_id)
) STRICT;
CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);

CREATE TABLE passkeys (                             -- WebAuthn: الدخول بالبصمة
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    BLOB NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports    TEXT CHECK (transports IS NULL OR json_valid(transports)),
  name          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at  TEXT
) STRICT;
CREATE INDEX idx_passkeys_user ON passkeys(user_id);

CREATE TABLE trusted_devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  UNIQUE (user_id, device_hash)
) STRICT;

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,                        -- أول أحرف للعرض فقط
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT
) STRICT;
CREATE INDEX idx_apikeys_user ON api_keys(user_id);

CREATE TABLE ip_blocklist (
  ip         TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT                                    -- NULL = دائم
) STRICT;

CREATE TABLE rate_limits (                          -- حد عام قابل لأي مفتاح (ip:route مثلاً)
  key          TEXT NOT NULL,
  window_start TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 1 CHECK (hits >= 0),
  PRIMARY KEY (key, window_start)
) STRICT, WITHOUT ROWID;
