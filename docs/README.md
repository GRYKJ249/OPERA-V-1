# بنية Opera

```text
index.html, pages/      صفحات الموقع
assets/                 التنسيقات والملفات الثابتة وJavaScript الناتج
src/                    مصدر الواجهة بـ TypeScript
server/                 خادم Node.js وواجهات الحسابات
config/                 إعداد TypeScript للواجهة
database/
  schema.sql            مخطط PostgreSQL للتطبيق
  postgresql-source/    مصدر PostgreSQL الأصلي محفوظ منفصلاً
  legacy-sqlite-*       ترحيلات واختبارات SQLite المؤرشفة
scripts/                أدوات الصيانة والاستيراد لمرة واحدة
docs/                   أدلة المشروع
```

مصدر الواجهة في `src/` يُترجم إلى `assets/js/` عبر `npm run build`. بيانات التطبيق تُقرأ وتُكتب على PostgreSQL من الخادم، وليس من متصفح المستخدم.

إعدادات Replit التشغيلية في `.replit`، وأسرار الخدمات تُضاف عبر Secrets. لا تنسخ ملفات `.env` من أرشيفات المشروع إلى المستودع.