-- 重建所有表，适配邮箱登录
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS online_users;
DROP TABLE IF EXISTS admins;

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  time INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(time DESC);

CREATE TABLE IF NOT EXISTS online_users (
  email TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  email TEXT PRIMARY KEY
);
