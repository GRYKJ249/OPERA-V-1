-- 014: إيقاف وضع المالك الوحيد وفتح التسجيل (بالبريد وعبر Google/GitHub).
-- القفل مجرد إعداد: triggers المالك تقرأ القيمة وقت التنفيذ، فتتعطل عند 'false'. يمكن إعادته من site_settings.
INSERT OR REPLACE INTO site_settings (key, value, type, is_public) VALUES
 ('security.single_owner', 'false', 'boolean', 0),
 ('auth.registration_open', 'true', 'boolean', 1);
