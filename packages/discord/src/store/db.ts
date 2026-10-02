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
  db.run(`CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    pinned INTEGER NOT NULL DEFAULT 0,
    source_thread TEXT,
    author_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS memory_scope ON memory (scope, status)")
  db.run(`CREATE TABLE IF NOT EXISTS threads (
    thread_id TEXT PRIMARY KEY,
    guild_id TEXT,
    parent_thread TEXT,
    title TEXT NOT NULL,
    project TEXT,
    directory TEXT,
    branch TEXT,
    summary TEXT,
    last_request TEXT,
    turns INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS services (
    name TEXT PRIMARY KEY,
    description TEXT,
    directory TEXT NOT NULL,
    command TEXT NOT NULL,
    port INTEGER UNIQUE,
    env TEXT NOT NULL DEFAULT '{}',
    desired TEXT NOT NULL DEFAULT 'running',
    autorestart INTEGER NOT NULL DEFAULT 1,
    pid INTEGER,
    pid_start TEXT,
    status TEXT NOT NULL,
    restarts INTEGER NOT NULL DEFAULT 0,
    last_exit TEXT,
    started_at INTEGER,
    log_file TEXT NOT NULL,
    owner_thread TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    ok INTEGER NOT NULL
  )`)
  db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  return db
}

export type Db = ReturnType<typeof openDatabase>
