// SQLite storage layer. Uses better-sqlite3 (synchronous, fast, transactional).
// The schema is created idempotently on first run.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH, DATA_DIR } from '../config.js';

let db = null;

export function getDb() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch {
    /* best effort */
  }
  migrate(db);
  return db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS panels (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      base_url      TEXT NOT NULL,
      api_token_enc TEXT NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      insecure      INTEGER NOT NULL DEFAULT 0,
      last_status   TEXT DEFAULT 'unknown',
      last_error    TEXT DEFAULT '',
      last_checked  INTEGER DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      days        INTEGER NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resellers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      username          TEXT UNIQUE,
      token_hash        TEXT NOT NULL,
      token_hint        TEXT NOT NULL DEFAULT '',
      panel_id          INTEGER,
      allowed_inbounds  TEXT NOT NULL DEFAULT '[]',
      price_per_gb      INTEGER NOT NULL DEFAULT 0,
      balance           INTEGER NOT NULL DEFAULT 0,
      default_days      INTEGER NOT NULL DEFAULT 30,
      max_gb            INTEGER NOT NULL DEFAULT 100,
      default_limit_ip  INTEGER NOT NULL DEFAULT 0,
      enabled           INTEGER NOT NULL DEFAULT 1,
      note              TEXT DEFAULT '',
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      FOREIGN KEY (panel_id) REFERENCES panels(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS vpn_users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      reseller_id  INTEGER NOT NULL,
      panel_id     INTEGER,
      email        TEXT NOT NULL,
      sub_id       TEXT DEFAULT '',
      uuid         TEXT DEFAULT '',
      inbound_ids  TEXT NOT NULL DEFAULT '[]',
      gb           INTEGER NOT NULL DEFAULT 0,
      days         INTEGER NOT NULL DEFAULT 0,
      expiry_time  INTEGER NOT NULL DEFAULT 0,
      cost         INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'active',
      plan_id      INTEGER DEFAULT 0,
      plan_name    TEXT DEFAULT '',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vpn_users_email ON vpn_users(email);
    CREATE INDEX IF NOT EXISTS idx_vpn_users_reseller ON vpn_users(reseller_id);

    CREATE TABLE IF NOT EXISTS transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      reseller_id   INTEGER NOT NULL,
      amount        INTEGER NOT NULL,
      type          TEXT NOT NULL,
      balance_after INTEGER NOT NULL,
      actor         TEXT NOT NULL,
      note          TEXT DEFAULT '',
      created_at    INTEGER NOT NULL,
      FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tx_reseller ON transactions(reseller_id);

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,          -- sha256 of the raw session id
      kind        TEXT NOT NULL,             -- 'admin' | 'reseller'
      subject_id  INTEGER NOT NULL DEFAULT 0,
      csrf        TEXT NOT NULL,
      ip          TEXT DEFAULT '',
      user_agent  TEXT DEFAULT '',
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      actor      TEXT NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT DEFAULT '',
      ip         TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

    CREATE TABLE IF NOT EXISTS login_attempts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL,   -- 'admin' or 'reseller'
      ip         TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(scope, ip, created_at);
  `);

  // Lightweight column migrations for DBs created by older versions.
  ensureColumn(d, 'vpn_users', 'plan_id', 'plan_id INTEGER DEFAULT 0');
  ensureColumn(d, 'vpn_users', 'plan_name', "plan_name TEXT DEFAULT ''");
  ensureColumn(d, 'panels', 'insecure', 'insecure INTEGER NOT NULL DEFAULT 0');
}

// Adds a column if it does not already exist (SQLite has no IF NOT EXISTS for columns).
function ensureColumn(d, table, column, ddl) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  const v = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, v);
}

export function now() {
  return Date.now();
}
