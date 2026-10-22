const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const dbPath = config.DB_PATH || path.join(__dirname, '..', 'data', 'events.db');

if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'organizer')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    location    TEXT    NOT NULL,
    event_date  TEXT    NOT NULL,              -- ISO 8601 (UTC)
    capacity    INTEGER NOT NULL CHECK (capacity > 0),
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    full_name    TEXT    NOT NULL,
    phone        TEXT,
    notes        TEXT,
    status       TEXT    NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT
  );

  -- A user can have only ONE active (confirmed) registration per event,
  -- but may re-register after cancelling.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_active_registration
    ON registrations(user_id, event_id) WHERE status = 'confirmed';

  CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
  CREATE INDEX IF NOT EXISTS idx_reg_event ON registrations(event_id);
`);

module.exports = db;
