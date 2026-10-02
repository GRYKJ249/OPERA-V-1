-- 012: [D11] حساب طوارئ للمطور: إن حُذف/أُوقف/قُفل حساب المالك، يدخل المطور بهذا الحساب فيُستعاد المالك.
-- ليس مستخدماً (لا يدخل جدول users ولا يخالف قفل المالك الوحيد). كلمة السر مخزّنة كـ scrypt hash فقط.
CREATE TABLE recovery_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (email LIKE '%_@_%._%' AND length(email) <= 254),
  password_hash TEXT NOT NULL CHECK (password_hash LIKE 'scrypt$%' AND length(password_hash) >= 20),
  owner_email   TEXT NOT NULL COLLATE NOCASE,          -- الحساب الذي يُستعاد عند الدخول
  note          TEXT,
  uses          INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

INSERT INTO recovery_accounts (email, password_hash, owner_email, note) VALUES
 ('GRYKJ2010JIDO@gry.com',
  'scrypt$16384$8$1$hH5ACP3I6j5Gae91V/QnIQ==$hEv4/j0JIXSQI71xlKdnzuGYFJsxKeyKpjImnSoQgZ8plj4QTgzt+yQmo63tTmUta7Uiakjum7Erl1QBc2Fz+Q==',
  'grykj249@gmail.com', 'developer break-glass account');

-- لا يُحذف آخر حساب طوارئ (وإلا فقد الميزة معناها)
CREATE TRIGGER trg_recovery_keep_last BEFORE DELETE ON recovery_accounts
WHEN (SELECT COUNT(*) FROM recovery_accounts) <= 1
BEGIN SELECT RAISE(ABORT, 'cannot delete the last recovery account'); END;

-- تغيير كلمة سر حساب الطوارئ يُدقَّق
CREATE TRIGGER trg_recovery_pw_audit AFTER UPDATE OF password_hash ON recovery_accounts
WHEN NEW.password_hash IS NOT OLD.password_hash
BEGIN
  INSERT INTO audit_log (actor_email, action, entity_type, entity_id) VALUES (NEW.email, 'recovery.password_changed', 'recovery_account', NEW.id);
END;

INSERT INTO db_features (code, category, title_ar, object_name, dev_only) VALUES
 ('D11','developer','حساب طوارئ للمطور يستعيد المالك عند حذفه','recovery_accounts',1);
