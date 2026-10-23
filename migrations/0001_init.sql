-- One row per ranked thing. ratings is JSON {category: {score, weight}}; unrated categories are left out.
-- photos is a JSON array of R2 keys.
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  ranking TEXT NOT NULL,
  brand TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ratings TEXT NOT NULL DEFAULT '{}',
  overall REAL,
  photos TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX entries_ranking ON entries (ranking);

-- Every create, edit and delete, with the entry as it was after the change.
CREATE TABLE entry_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  ranking TEXT NOT NULL,
  action TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX history_entry ON entry_history (entry_id, changed_at);

-- Emailed one-time codes (hashed). Only the newest unused one works.
CREATE TABLE login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Signed-in devices. id is the hash of the cookie token.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  remember INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Rate limits: count of hits per key in the current window.
CREATE TABLE throttle (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
