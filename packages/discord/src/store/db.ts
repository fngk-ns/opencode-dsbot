import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import path from "node:path"

export function openDatabase(file: string) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file, { create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    guild_id TEXT,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_bot INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    reference_id TEXT,
    created_at INTEGER NOT NULL,
    edited_at INTEGER,
    deleted_at INTEGER
  )`)
  db.run("CREATE INDEX IF NOT EXISTS messages_channel_time ON messages (channel_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS messages_author ON messages (author_id, created_at)")
  db.run(`CREATE TABLE IF NOT EXISTS bindings (
    channel_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    directory TEXT NOT NULL,
    kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    model TEXT,
    agent TEXT,
    created_at INTEGER NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS bindings_session ON bindings (session_id)")
  db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  return db
}

export type Db = ReturnType<typeof openDatabase>
