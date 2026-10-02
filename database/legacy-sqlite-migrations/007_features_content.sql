-- 007: الميزات F01–F50 — المحتوى والبحث والتفاعل
-- كل ميزة مسجّلة في db_features (ترحيل 011) ويتحقق الاختبار من وجود كائنها فعلاً.

-- [F01] نسخ المشاريع: كل تعديل على العنوان/الملخص/المحتوى يحفظ النسخة القديمة
CREATE TABLE project_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('ar','en')),
  title TEXT NOT NULL, summary TEXT, body TEXT,
  revised_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_projrev ON project_revisions(project_id, id);
CREATE TRIGGER trg_project_revision BEFORE UPDATE ON project_translations
WHEN OLD.title IS NOT NEW.title OR OLD.summary IS NOT NEW.summary OR OLD.body IS NOT NEW.body
BEGIN
  INSERT INTO project_revisions (project_id, locale, title, summary, body)
  VALUES (OLD.project_id, OLD.locale, OLD.title, OLD.summary, OLD.body);
END;

-- [F02] الاحتفاظ بآخر 20 نسخة لكل مشروع فقط
CREATE TRIGGER trg_project_revision_trim AFTER INSERT ON project_revisions
BEGIN
  DELETE FROM project_revisions WHERE project_id = NEW.project_id
    AND id NOT IN (SELECT id FROM project_revisions WHERE project_id = NEW.project_id ORDER BY id DESC LIMIT 20);
END;

-- [F03] تاريخ الروابط (slug) القديمة للمشاريع
CREATE TABLE project_slug_history (
  old_slug TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;
CREATE TRIGGER trg_slug_history AFTER UPDATE OF slug ON projects WHEN OLD.slug <> NEW.slug
BEGIN
  INSERT OR REPLACE INTO project_slug_history (old_slug, project_id) VALUES (OLD.slug, OLD.id);
  DELETE FROM project_slug_history WHERE old_slug = NEW.slug;
END;

-- [F04] عرض التحويلات من الرابط القديم إلى الحالي
CREATE VIEW v_slug_redirects AS
SELECT h.old_slug, p.slug AS new_slug
FROM project_slug_history h JOIN projects p ON p.id = h.project_id WHERE p.deleted_at IS NULL;

-- [F05] أحداث مشاهدة المشروع + عدّاد تلقائي
CREATE TABLE project_view_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_pve_project ON project_view_events(project_id, created_at);
CREATE TRIGGER trg_project_view AFTER INSERT ON project_view_events
BEGIN UPDATE projects SET view_count = view_count + 1 WHERE id = NEW.project_id; END;

-- [F06] مجموعات المشاريع
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*'),
  title_ar TEXT NOT NULL, title_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1))
) STRICT;

-- [F07] عناصر المجموعات مع الترتيب
CREATE TABLE collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, project_id)
) STRICT, WITHOUT ROWID;

-- [F08] روابط إضافية للمشروع
CREATE TABLE project_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL CHECK (url LIKE 'http://%' OR url LIKE 'https://%'),
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('demo','repo','article','video','store','other')),
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_project_links ON project_links(project_id, sort_order);

-- [F09] وسائط متعددة لكل مشروع
CREATE TABLE project_media (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption_ar TEXT, caption_en TEXT,
  PRIMARY KEY (project_id, media_id)
) STRICT, WITHOUT ROWID;

-- [F10] الخط الزمني للمشروع
CREATE TABLE project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL, title_en TEXT,
  happened_on TEXT NOT NULL CHECK (happened_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_milestones ON project_milestones(project_id, happened_on);

-- [F11] المهارات
CREATE TABLE skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*'),
  name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('frontend','backend','database','design','devops','tools','other')),
  level INTEGER NOT NULL DEFAULT 50 CHECK (level BETWEEN 0 AND 100),
  icon TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1))
) STRICT;

-- [F12] ربط المشاريع بالمهارات
CREATE TABLE project_skills (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, skill_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_project_skills_skill ON project_skills(skill_id);

-- [F13] الخبرات العملية
CREATE TABLE experience (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  role_ar TEXT NOT NULL, role_en TEXT,
  desc_ar TEXT, desc_en TEXT,
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]*'),
  end_date TEXT CHECK (end_date IS NULL OR end_date >= start_date),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1))
) STRICT;

-- [F14] التعليم
CREATE TABLE education (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institution TEXT NOT NULL,
  degree_ar TEXT NOT NULL, degree_en TEXT,
  start_year INTEGER CHECK (start_year BETWEEN 1950 AND 2100),
  end_year INTEGER CHECK (end_year IS NULL OR end_year >= start_year),
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;

-- [F15] الشهادات
CREATE TABLE certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, issuer TEXT NOT NULL,
  issued_on TEXT CHECK (issued_on IS NULL OR issued_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expires_on TEXT CHECK (expires_on IS NULL OR expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  credential_url TEXT CHECK (credential_url IS NULL OR credential_url LIKE 'https://%'),
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL
) STRICT;

-- [F16] روابط التواصل الاجتماعي
CREATE TABLE social_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL UNIQUE CHECK (platform IN ('github','linkedin','x','instagram','youtube','facebook','telegram','whatsapp','behance','dribbble','tiktok','email')),
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1))
) STRICT;

-- [F17] صفحات ثابتة قابلة للتحرير (ثنائية اللغة)
CREATE TABLE static_pages (
  slug TEXT PRIMARY KEY CHECK (slug NOT GLOB '*[^a-z0-9-]*'),
  title_ar TEXT NOT NULL, title_en TEXT,
  body_ar TEXT, body_en TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;
CREATE TRIGGER trg_static_pages_touch AFTER UPDATE ON static_pages WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE static_pages SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug = NEW.slug; END;

-- [F18] قوائم التنقل
CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location TEXT NOT NULL DEFAULT 'header' CHECK (location IN ('header','footer')),
  parent_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
  label_ar TEXT NOT NULL, label_en TEXT NOT NULL,
  href TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1))
) STRICT;
CREATE INDEX idx_menu ON menu_items(location, parent_id, sort_order);

-- [F19] تحويلات المسارات مع عدّاد الزيارات
CREATE TABLE redirects (
  from_path TEXT PRIMARY KEY CHECK (from_path LIKE '/%'),
  to_path TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301 CHECK (status_code IN (301,302,307,308)),
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_path <> to_path)
) STRICT, WITHOUT ROWID;

-- [F20] شريط الإعلانات بفترة بداية ونهاية
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_ar TEXT NOT NULL, text_en TEXT,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','success')),
  starts_at TEXT, ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) STRICT;

-- [F21] الإعلانات الفعّالة الآن فقط
CREATE VIEW v_active_announcements AS
SELECT * FROM announcements
WHERE is_active = 1
  AND (starts_at IS NULL OR starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  AND (ends_at IS NULL OR ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- [F22] كتل نصوص قابلة لإعادة الاستخدام
CREATE TABLE content_blocks (
  key TEXT PRIMARY KEY CHECK (key NOT GLOB '*[^a-z0-9_.]*'),
  ar TEXT, en TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;

-- [F23] بحث نصي كامل في الخدمات (عربي/إنجليزي)
CREATE VIRTUAL TABLE services_fts USING fts5(
  title, description, locale UNINDEXED, service_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER trg_svc_fts_ins AFTER INSERT ON services BEGIN
  INSERT INTO services_fts (title, description, locale, service_id) VALUES (NEW.title_ar, NEW.desc_ar, 'ar', NEW.id);
  INSERT INTO services_fts (title, description, locale, service_id) VALUES (NEW.title_en, NEW.desc_en, 'en', NEW.id);
END;
CREATE TRIGGER trg_svc_fts_upd AFTER UPDATE ON services BEGIN
  DELETE FROM services_fts WHERE service_id = OLD.id;
  INSERT INTO services_fts (title, description, locale, service_id) VALUES (NEW.title_ar, NEW.desc_ar, 'ar', NEW.id);
  INSERT INTO services_fts (title, description, locale, service_id) VALUES (NEW.title_en, NEW.desc_en, 'en', NEW.id);
END;
CREATE TRIGGER trg_svc_fts_del AFTER DELETE ON services BEGIN DELETE FROM services_fts WHERE service_id = OLD.id; END;

-- [F24] بحث نصي كامل في الأسئلة الشائعة
CREATE VIRTUAL TABLE faqs_fts USING fts5(
  question, answer, locale UNINDEXED, faq_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER trg_faq_fts_ins AFTER INSERT ON faqs BEGIN
  INSERT INTO faqs_fts (question, answer, locale, faq_id) VALUES (NEW.q_ar, NEW.a_ar, 'ar', NEW.id);
  INSERT INTO faqs_fts (question, answer, locale, faq_id) SELECT NEW.q_en, NEW.a_en, 'en', NEW.id WHERE NEW.q_en IS NOT NULL;
END;
CREATE TRIGGER trg_faq_fts_upd AFTER UPDATE ON faqs BEGIN
  DELETE FROM faqs_fts WHERE faq_id = OLD.id;
  INSERT INTO faqs_fts (question, answer, locale, faq_id) VALUES (NEW.q_ar, NEW.a_ar, 'ar', NEW.id);
  INSERT INTO faqs_fts (question, answer, locale, faq_id) SELECT NEW.q_en, NEW.a_en, 'en', NEW.id WHERE NEW.q_en IS NOT NULL;
END;
CREATE TRIGGER trg_faq_fts_del AFTER DELETE ON faqs BEGIN DELETE FROM faqs_fts WHERE faq_id = OLD.id; END;

-- [F25] سجل عمليات البحث
CREATE TABLE search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL CHECK (length(query) BETWEEN 1 AND 200),
  locale TEXT, results INTEGER NOT NULL DEFAULT 0 CHECK (results >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_search_log ON search_log(created_at);

-- [F26] مرادفات البحث
CREATE TABLE search_synonyms (
  term TEXT NOT NULL COLLATE NOCASE, synonym TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (term, synonym), CHECK (term <> synonym)
) STRICT, WITHOUT ROWID;

-- [F27] المشاريع الأكثر شعبية (إعجاب = 5 مشاهدات)
CREATE VIEW v_popular_projects AS
SELECT id, slug, like_count, view_count, (like_count * 5 + view_count) AS score
FROM projects WHERE status = 'published' AND deleted_at IS NULL ORDER BY score DESC, id;

-- [F28] المشاريع المتشابهة حسب الوسوم المشتركة
CREATE VIEW v_related_projects AS
SELECT a.project_id, b.project_id AS related_id, COUNT(*) AS shared_tags
FROM project_tags a JOIN project_tags b ON a.tag_id = b.tag_id AND a.project_id <> b.project_id
GROUP BY a.project_id, b.project_id;

-- [F29] عدد استخدامات كل وسم
CREATE VIEW v_tag_usage AS
SELECT t.id, t.slug, t.name_ar, t.name_en, COUNT(pt.project_id) AS uses
FROM tags t LEFT JOIN project_tags pt ON pt.tag_id = t.id GROUP BY t.id;

-- [F30] المشروع كاملاً: الترجمتان + الوسوم كـ JSON
CREATE VIEW v_project_full AS
SELECT p.id, p.slug, p.status, p.featured, p.url, p.repo_url, p.like_count, p.view_count, p.published_at,
       ta.title AS title_ar, ta.summary AS summary_ar, ta.body AS body_ar,
       te.title AS title_en, te.summary AS summary_en, te.body AS body_en,
       (SELECT json_group_array(t.slug) FROM project_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.project_id = p.id) AS tags_json
FROM projects p
LEFT JOIN project_translations ta ON ta.project_id = p.id AND ta.locale = 'ar'
LEFT JOIN project_translations te ON te.project_id = p.id AND te.locale = 'en'
WHERE p.deleted_at IS NULL;

-- [F31] تصويت على التعليقات + مجموع تلقائي
ALTER TABLE comments ADD COLUMN vote_score INTEGER NOT NULL DEFAULT 0;
CREATE TABLE comment_votes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, comment_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER trg_cvote_add AFTER INSERT ON comment_votes
BEGIN UPDATE comments SET vote_score = vote_score + NEW.value WHERE id = NEW.comment_id; END;
CREATE TRIGGER trg_cvote_chg AFTER UPDATE OF value ON comment_votes
BEGIN UPDATE comments SET vote_score = vote_score - OLD.value + NEW.value WHERE id = NEW.comment_id; END;
CREATE TRIGGER trg_cvote_del AFTER DELETE ON comment_votes
BEGIN UPDATE comments SET vote_score = vote_score - OLD.value WHERE id = OLD.comment_id; END;

-- [F32] بلاغات التعليقات
CREATE TABLE comment_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam','abuse','offtopic','other')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (comment_id, user_id)
) STRICT;

-- [F33] إخفاء التعليق تلقائياً بعد 3 بلاغات
CREATE TRIGGER trg_comment_autohide AFTER INSERT ON comment_reports
WHEN (SELECT COUNT(*) FROM comment_reports WHERE comment_id = NEW.comment_id) >= 3
BEGIN UPDATE comments SET status = 'hidden' WHERE id = NEW.comment_id AND status <> 'hidden'; END;

-- [F34] أقصى عمق للردود 3 مستويات
CREATE TRIGGER trg_comment_depth BEFORE INSERT ON comments
WHEN NEW.parent_id IS NOT NULL AND (
  WITH RECURSIVE up(id, parent_id, d) AS (
    SELECT id, parent_id, 1 FROM comments WHERE id = NEW.parent_id
    UNION ALL SELECT c.id, c.parent_id, up.d + 1 FROM comments c JOIN up ON c.id = up.parent_id)
  SELECT MAX(d) FROM up) >= 3
BEGIN SELECT RAISE(ABORT, 'reply depth limit reached'); END;

-- [F35] الرد يجب أن يكون على تعليق من نفس المشروع
CREATE TRIGGER trg_comment_same_project BEFORE INSERT ON comments
WHEN NEW.parent_id IS NOT NULL AND (SELECT project_id FROM comments WHERE id = NEW.parent_id) IS NOT NEW.project_id
BEGIN SELECT RAISE(ABORT, 'parent comment belongs to another project'); END;

-- [F36] منع التعليقات عند إيقاف الميزة من الإعدادات
CREATE TRIGGER trg_comments_enabled BEFORE INSERT ON comments
WHEN (SELECT value FROM site_settings WHERE key = 'features.comments') = 'false'
BEGIN SELECT RAISE(ABORT, 'comments are disabled'); END;

-- [F37] إشعار المديرين برسالة تواصل جديدة
CREATE TRIGGER trg_notify_contact AFTER INSERT ON contact_messages
BEGIN
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT ur.user_id, 'contact.new', 'رسالة تواصل جديدة', NEW.subject, json_object('message_id', NEW.id)
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.name = 'admin';
END;

-- [F38] إشعار المديرين بتعليق ينتظر المراجعة
CREATE TRIGGER trg_notify_comment AFTER INSERT ON comments WHEN NEW.status = 'pending'
BEGIN
  INSERT INTO notifications (user_id, type, title, data)
  SELECT ur.user_id, 'comment.pending', 'تعليق ينتظر المراجعة', json_object('comment_id', NEW.id, 'project_id', NEW.project_id)
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.name = 'admin';
END;

-- [F39] المفضلة: حفظ المشاريع مع ملاحظة
CREATE TABLE bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, project_id)
) STRICT, WITHOUT ROWID;

-- [F40] أحداث المشاركة حسب المنصة
CREATE TABLE share_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('x','facebook','whatsapp','telegram','linkedin','copy','other')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_share_project ON share_events(project_id, platform);

-- [F41] الشهادات المعتمدة فقط للعرض العام
CREATE VIEW v_public_testimonials AS
SELECT id, author_name, author_role, quote_ar, quote_en, rating, created_at
FROM testimonials WHERE approved = 1 ORDER BY created_at DESC;

-- [F42] الخدمات الفعّالة للعرض العام
CREATE VIEW v_public_services AS
SELECT id, slug, icon, title_ar, title_en, desc_ar, desc_en, price_from
FROM services WHERE is_active = 1 ORDER BY sort_order, id;

-- [F43] الأسئلة الشائعة الفعّالة للعرض العام
CREATE VIEW v_public_faqs AS
SELECT id, q_ar, a_ar, q_en, a_en FROM faqs WHERE is_active = 1 ORDER BY sort_order, id;

-- [F44] لوحة ما ينتظر المراجعة
CREATE VIEW v_pending_moderation AS
SELECT (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS pending_comments,
       (SELECT COUNT(*) FROM contact_messages WHERE status = 'new') AS new_messages,
       (SELECT COUNT(*) FROM testimonials WHERE approved = 0) AS pending_testimonials;

-- [F45] الحملات البريدية
CREATE TABLE newsletter_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_ar TEXT NOT NULL, subject_en TEXT,
  body_ar TEXT NOT NULL, body_en TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent')),
  scheduled_at TEXT, sent_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- [F46] تسليم الحملة لكل مشترك
CREATE TABLE campaign_deliveries (
  campaign_id INTEGER NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','bounced')),
  sent_at TEXT,
  PRIMARY KEY (campaign_id, subscriber_id)
) STRICT, WITHOUT ROWID;

-- [F47] كشف الرسائل المزعجة: 3 روابط أو أكثر = spam
ALTER TABLE contact_messages ADD COLUMN spam_score INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER trg_contact_spam AFTER INSERT ON contact_messages
WHEN (length(NEW.body) - length(replace(lower(NEW.body), 'http', ''))) / 4 >= 3
BEGIN UPDATE contact_messages SET status = 'spam', spam_score = 100 WHERE id = NEW.id; END;

-- [F48] حد معدل الرسائل: 5 في الساعة لكل بريد
CREATE TRIGGER trg_contact_rate BEFORE INSERT ON contact_messages
WHEN (SELECT COUNT(*) FROM contact_messages WHERE email = NEW.email
      AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) >= 5
BEGIN SELECT RAISE(ABORT, 'contact rate limit exceeded'); END;

-- [F49] ردود الرسائل: الرد يحدّث حالة الرسالة تلقائياً
CREATE TABLE message_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TRIGGER trg_reply_marks AFTER INSERT ON message_replies
BEGIN
  UPDATE contact_messages SET status = 'replied', handled_by = NEW.user_id,
         handled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.message_id;
END;

-- [F50] تسجيل وقت المعالجة عند خروج الرسالة من حالة new
CREATE TRIGGER trg_contact_handled AFTER UPDATE OF status ON contact_messages
WHEN OLD.status = 'new' AND NEW.status <> 'new' AND NEW.handled_at IS NULL
BEGIN UPDATE contact_messages SET handled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
