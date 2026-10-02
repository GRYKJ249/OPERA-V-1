-- رمز استعادة كلمة السر (6 أرقام) بدل الرابط: عدّاد محاولات خاطئة لكل رمز
ALTER TABLE password_resets ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
