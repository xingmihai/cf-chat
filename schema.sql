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

CREATE TABLE IF NOT EXISTS online_users (
  qq TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  qq TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER DEFAULT (unixepoch())
);

-- 插入一条初始公告
INSERT OR IGNORE INTO announcements(id,content) VALUES(1,'欢迎来到QQ群聊！');
