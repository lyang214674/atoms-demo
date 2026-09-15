-- Users register themselves with email + password (PBKDF2 hashed).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Cookie sessions live in D1 (KV free tier only allows 1000 writes/day).
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One idea = one project. share_slug is NULL until the owner publishes it.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  share_slug TEXT UNIQUE,
  forked_from TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_share ON projects(share_slug);

-- Every generation / iteration is a version. html is the runnable single-file app.
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  user_message TEXT NOT NULL,
  plan_json TEXT,
  html TEXT,
  review_json TEXT,
  status TEXT NOT NULL DEFAULT 'planning', -- planning | planned | building | done | failed
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, n DESC);

-- Agent timeline, replayable in the UI. Evidence that generation is agent-driven.
CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,      -- planner | builder | reviewer | system
  type TEXT NOT NULL,      -- start | message | done | error
  content TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_version ON agent_events(version_id, id);

-- Daily generation counter per user (spend guard).
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,       -- YYYY-MM-DD (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
