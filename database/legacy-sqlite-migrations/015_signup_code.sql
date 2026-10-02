-- 015: تأكيد الحساب برمز من 6 أرقام (بدل الرابط): عدّاد محاولات خاطئة لكل رمز
ALTER TABLE email_verifications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
