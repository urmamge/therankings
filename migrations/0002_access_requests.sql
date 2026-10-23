-- People asking for editing access. The owner approves or declines them on the site.
CREATE TABLE access_requests (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL, -- pending, approved, declined, revoked
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

-- One-time codes are now emailed to approved people and never expire; each works once.
DROP TABLE login_codes;
CREATE TABLE login_codes (
  code_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Who each device belongs to: the owner (permanent code) or an approved editor.
ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE sessions ADD COLUMN email TEXT;

-- Who made each change. Only the owner sees it.
ALTER TABLE entry_history ADD COLUMN editor TEXT;
