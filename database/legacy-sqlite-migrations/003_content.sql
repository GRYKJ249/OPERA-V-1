-- 003: محتوى الموقع (ثنائي اللغة عربي/إنجليزي)
CREATE TABLE site_settings (
  key       TEXT PRIMARY KEY CHECK (key NOT GLOB '*[^a-z0-9_.]*'),
  value     TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'string' CHECK (type IN ('string','number','boolean','json')),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;

CREATE TABLE media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  path        TEXT NOT NULL UNIQUE,
  mime        TEXT NOT NULL CHECK (mime GLOB '*/*'),
  size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
  width       INTEGER, height INTEGER,
  sha256      TEXT UNIQUE,                           -- منع رفع نفس الملف مرتين
  alt_ar      TEXT, alt_en TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE projects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*' AND length(slug) BETWEEN 2 AND 80),
  cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  url            TEXT, repo_url TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  featured       INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  like_count     INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  view_count     INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  published_at   TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
) STRICT;
CREATE INDEX idx_projects_status ON projects(status, sort_order);

CREATE TABLE project_translations (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  locale     TEXT NOT NULL CHECK (locale IN ('ar','en')),
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  summary    TEXT, body TEXT,
  PRIMARY KEY (project_id, locale)
) STRICT, WITHOUT ROWID;

CREATE TABLE tags (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug    TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*'),
  name_ar TEXT NOT NULL, name_en TEXT NOT NULL
) STRICT;
CREATE TABLE project_tags (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_project_tags_tag ON project_tags(tag_id);

CREATE TABLE gallery_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title_ar   TEXT, title_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1))
) STRICT;

CREATE TABLE services (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  icon       TEXT,
  title_ar   TEXT NOT NULL, title_en TEXT NOT NULL,
  desc_ar    TEXT, desc_en TEXT,
  price_from REAL CHECK (price_from IS NULL OR price_from >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE faqs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  q_ar TEXT NOT NULL, a_ar TEXT NOT NULL,
  q_en TEXT, a_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE testimonials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_name TEXT NOT NULL, author_role TEXT,
  quote_ar    TEXT, quote_en TEXT,
  rating      INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  approved    INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE CHECK (email LIKE '%_@_%._%'),
  subject    TEXT, body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','spam','archived')),
  ip         TEXT, user_agent TEXT,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  handled_at TEXT
) STRICT;
CREATE INDEX idx_contact_status ON contact_messages(status, created_at);

CREATE TABLE newsletter_subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (email LIKE '%_@_%._%'),
  locale          TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  token_hash      TEXT UNIQUE,
  confirmed_at    TEXT, unsubscribed_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE page_views (                           -- إحصاءات بدون تتبع شخصي (جلسة مجزّأة)
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT NOT NULL,
  referrer     TEXT, country TEXT,
  device       TEXT CHECK (device IS NULL OR device IN ('mobile','desktop','tablet','bot')),
  locale       TEXT,
  session_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_views_path ON page_views(path, created_at);
CREATE INDEX idx_views_created ON page_views(created_at);
