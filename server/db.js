const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'gravefinder.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cemeteries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  bounds TEXT
);
CREATE TABLE IF NOT EXISTS graves (
  id INTEGER PRIMARY KEY,
  cemetery_id INTEGER NOT NULL REFERENCES cemeteries(id),
  section TEXT NOT NULL,
  block TEXT NOT NULL,
  row TEXT NOT NULL,
  grave_number TEXT NOT NULL UNIQUE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied'))
);
CREATE TABLE IF NOT EXISTS burial_records (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  date_of_birth TEXT,
  date_of_death TEXT NOT NULL,
  burial_date TEXT,
  grave_id INTEGER UNIQUE REFERENCES graves(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_name ON burial_records(full_name COLLATE NOCASE);
`);

const cemeteryCols = db.prepare('PRAGMA table_info(cemeteries)').all().map((c) => c.name);
if (!cemeteryCols.includes('bounds')) db.exec('ALTER TABLE cemeteries ADD COLUMN bounds TEXT');

module.exports = db;
