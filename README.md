# Opera

موقع عربي/إنجليزي مبني بـ Node.js وTypeScript. الخادم يستخدم PostgreSQL الخاص بمشروع Replit؛ SQLite لم تعد قاعدة التشغيل.

## التشغيل

- اضغط **Run** أو شغّل `npm run dev`.
- واجهة المعاينة تستخدم المنفذ 5000.
- الاتصال بقاعدة Replit PostgreSQL يتم عبر `DATABASE_URL` الذي يوفّره Replit.
- `npm run db:init` يفحص اتصال القاعدة والمخطط فقط؛ الخادم لا ينشئ جداول عند التشغيل.
- مصدر مخطط PostgreSQL: `database/schema.sql`.
- لتشغيل فحوص قاعدة البيانات: `npm run db:test`.
- لترجمة واجهة TypeScript بعد تعديل `src/`: `npm run build`.

تم نقل بيانات SQLite الموجودة في ملف Opera إلى قاعدة التطوير. أداة الاستيراد لمرة واحدة موجودة في `scripts/import-sqlite.ts`، وتعمل فقط عند تحديد `SQLITE_IMPORT_FILE` وعندما تكون قاعدة PostgreSQL خالية.

## تنظيم المجلدات

- `src/`: مصدر واجهة الموقع.
- `assets/` و`pages/`: ملفات الموقع.
- `server/`: خادم Node.js وواجهات الحسابات والمصادقة.
- `database/schema.sql`: مخطط PostgreSQL الحالي.
- `database/postgresql-source/`: مصدر PostgreSQL الأصلي الذي كان في المشروع قبل استيراد Opera؛ محفوظ كمرجع منفصل وليس الخادم الذي يتصل به الموقع.
- `database/legacy-sqlite-*`: ملفات SQLite القديمة المؤرشفة للرجوع إليها فقط.

## إعدادات اختيارية

- البريد يحتاج `RESEND_API_KEY` و`MAIL_FROM`.
- OAuth يحتاج `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET` أو `GITHUB_CLIENT_ID` و`GITHUB_CLIENT_SECRET`.
- أضف القيم السرية من Replit Secrets، ولا ترفع ملف `.env`.
- اضبط `PUBLIC_URL` لروابط OAuth، و`TRUST_PROXY=1` عند التشغيل خلف وكيل موثوق.

مخطط PostgreSQL الحالي يغطي جداول الموقع والمصادقة وعرضي الصلاحيات المستخدمين في الخادم. ملفات الترحيل والاختبارات الأصلية الخاصة بمشغلات SQLite وواجهاته محفوظة في `database/legacy-sqlite-*`؛ لم تُنقل كل تلك المشغلات والعروض بعد.