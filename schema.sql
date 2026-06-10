CREATE TABLE IF NOT EXISTS users (
  qq TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qq TEXT NOT NULL,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  time INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(time DESC);
