const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'gravefinder.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cemeteries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  bounds TEXT,
  boundary TEXT
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
CREATE TABLE IF NOT EXISTS road_nodes (
  id INTEGER PRIMARY KEY,
  cemetery_id INTEGER NOT NULL REFERENCES cemeteries(id),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS road_edges (
  id INTEGER PRIMARY KEY,
  cemetery_id INTEGER NOT NULL REFERENCES cemeteries(id),
  node_a_id INTEGER NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
  node_b_id INTEGER NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
  UNIQUE(node_a_id, node_b_id)
);
CREATE INDEX IF NOT EXISTS idx_graves_section ON graves(section);
CREATE INDEX IF NOT EXISTS idx_records_name ON burial_records(full_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_road_edges_a ON road_edges(node_a_id);
CREATE INDEX IF NOT EXISTS idx_road_edges_b ON road_edges(node_b_id);
`);

const cemeteryCols = db.prepare('PRAGMA table_info(cemeteries)').all().map((c) => c.name);
if (!cemeteryCols.includes('bounds')) db.exec('ALTER TABLE cemeteries ADD COLUMN bounds TEXT');
if (!cemeteryCols.includes('boundary')) db.exec('ALTER TABLE cemeteries ADD COLUMN boundary TEXT');

module.exports = db;
