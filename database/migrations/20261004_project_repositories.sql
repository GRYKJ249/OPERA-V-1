-- Additive migration: Opera stores the project-to-Gitea mapping only.
-- Gitea stores metadata in its schema in the shared PostgreSQL database; Git objects remain on disk.
CREATE TABLE IF NOT EXISTS project_repositories (
  project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gitea' CHECK (provider = 'gitea'),
  gitea_repository_id BIGINT UNIQUE,
  owner TEXT,
  repository_name TEXT NOT NULL CHECK (repository_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  clone_url TEXT,
  html_url TEXT,
  is_private BIGINT NOT NULL DEFAULT 1 CHECK (is_private IN (0,1)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','failed')),
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE (provider, owner, repository_name)
);
