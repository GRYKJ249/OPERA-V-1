-- 010: مالك الموقع الوحيد + قفل "مستخدم واحد". كلمة السر مخزّنة كـ scrypt hash فقط.
INSERT INTO users (email, username, display_name, password_hash, status, email_verified_at, terms_accepted_at, password_changed_at, must_change_password)
VALUES ('grykj249@gmail.com', 'grykj', 'GRYKJ', 'scrypt$16384$8$1$KN5eVU3VqST+fj0AZWK7/w==$8dy7RnbSkb7Zz1aKeISz2UO/6cq6PLmxw64YeWDdDqtR5ZKiMbO618OpUcPMAi5Wz3PX+XLxkoGYaOwQBhHSeA==', 'active',
        strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 0);

INSERT INTO user_roles (user_id, role_id, granted_by)
SELECT u.id, r.id, u.id FROM users u, roles r WHERE u.email = 'grykj249@gmail.com' AND r.name = 'admin';
INSERT INTO user_roles (user_id, role_id, granted_by)
SELECT u.id, r.id, u.id FROM users u, roles r WHERE u.email = 'grykj249@gmail.com' AND r.name = 'developer';

INSERT OR REPLACE INTO site_settings (key, value, type, is_public) VALUES
 ('security.single_owner', 'true', 'boolean', 0),
 ('auth.registration_open', 'false', 'boolean', 1);

-- [O1] لا يُقبل أي مستخدم ثانٍ ما دام وضع المالك الوحيد مفعّلاً
CREATE TRIGGER trg_single_owner BEFORE INSERT ON users
WHEN (SELECT value FROM site_settings WHERE key = 'security.single_owner') = 'true'
 AND (SELECT COUNT(*) FROM users) >= 1
BEGIN SELECT RAISE(ABORT, 'single-owner mode: only one user is allowed'); END;

-- [O2] حذف المالك ممنوع في هذا الوضع
CREATE TRIGGER trg_owner_no_delete BEFORE DELETE ON users
WHEN (SELECT value FROM site_settings WHERE key = 'security.single_owner') = 'true'
BEGIN SELECT RAISE(ABORT, 'single-owner mode: the owner cannot be deleted'); END;

-- [O3] لا يمكن إيقاف حساب المالك (حتى لا يُقفل خارج حسابه)
CREATE TRIGGER trg_owner_stay_active BEFORE UPDATE OF status ON users
WHEN (SELECT value FROM site_settings WHERE key = 'security.single_owner') = 'true' AND NEW.status <> 'active'
BEGIN SELECT RAISE(ABORT, 'single-owner mode: the owner must stay active'); END;

-- [O4] لا يُسحب دور المطور من المالك في هذا الوضع
CREATE TRIGGER trg_owner_keep_developer BEFORE DELETE ON user_roles
WHEN OLD.role_id = (SELECT id FROM roles WHERE name = 'developer')
 AND (SELECT value FROM site_settings WHERE key = 'security.single_owner') = 'true'
BEGIN SELECT RAISE(ABORT, 'single-owner mode: developer role is kept'); END;
