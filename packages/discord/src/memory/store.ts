import type { Db } from "../store/db"

export type MemoryKind = "fact" | "preference" | "decision" | "task" | "note"
export type MemoryStatus = "active" | "open" | "done" | "blocked" | "archived"

export type MemoryEntry = {
  id: number
  scope: string
  kind: MemoryKind
  title: string
  body: string
  status: MemoryStatus
  pinned: boolean
  source_thread: string | null
  author_id: string | null
  created_at: number
  updated_at: number
}

type Row = Omit<MemoryEntry, "pinned"> & { pinned: number }

export type ThreadRecord = {
  thread_id: string
  guild_id: string | null
  parent_thread: string | null
  title: string
  project: string | null
  directory: string | null
  branch: string | null
  summary: string | null
  last_request: string | null
  turns: number
  state: "active" | "closed"
  created_at: number
  updated_at: number
}

/** Scopes visible to a conversation: everything shared, plus this server, project and thread. */
export function scopesFor(input: { guildId: string | null; project: string | null; threadId: string }) {
  return [
    "global",
    ...(input.guildId ? [`guild:${input.guildId}`] : []),
    ...(input.project ? [`project:${input.project}`] : []),
    `thread:${input.threadId}`,
  ]
}

/**
 * Durable memory that outlives any one conversation or context window.
 * Entries are notes the agent or an owner saved on purpose; the journal is the index of every thread ever started.
 */
export class MemoryStore {
  constructor(private readonly db: Db) {}

  /** Saving the same title again in the same scope and kind updates that entry instead of piling up duplicates. */
  save(input: {
    scope: string
    kind: MemoryKind
    title: string
    body: string
    status?: MemoryStatus
    pinned?: boolean
    source_thread?: string | null
    author_id?: string | null
  }) {
    const now = Date.now()
    const existing = this.db
      .query("SELECT id FROM memory WHERE scope = $scope AND kind = $kind AND title = $title AND status != 'archived'")
      .get({ $scope: input.scope, $kind: input.kind, $title: input.title }) as { id: number } | null
    if (existing) {
      this.update(existing.id, { body: input.body, status: input.status, pinned: input.pinned })
      return this.get(existing.id)!
    }
    const status = input.status ?? (input.kind === "task" ? "open" : "active")
    const result = this.db
      .query(
        `INSERT INTO memory (scope, kind, title, body, status, pinned, source_thread, author_id, created_at, updated_at)
         VALUES ($scope, $kind, $title, $body, $status, $pinned, $source_thread, $author_id, $now, $now)`,
      )
      .run({
        $scope: input.scope,
        $kind: input.kind,
        $title: input.title,
        $body: input.body,
        $status: status,
        $pinned: input.pinned ? 1 : 0,
        $source_thread: input.source_thread ?? null,
        $author_id: input.author_id ?? null,
        $now: now,
      })
    return this.get(Number(result.lastInsertRowid))!
  }

  update(id: number, patch: { title?: string; body?: string; status?: MemoryStatus; pinned?: boolean }) {
    this.db
      .query(
        `UPDATE memory SET
           title = COALESCE($title, title), body = COALESCE($body, body), status = COALESCE($status, status),
           pinned = COALESCE($pinned, pinned), updated_at = $now
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $title: patch.title ?? null,
        $body: patch.body ?? null,
        $status: patch.status ?? null,
        $pinned: patch.pinned === undefined ? null : patch.pinned ? 1 : 0,
        $now: Date.now(),
      })
    return this.get(id)
  }

  /** Archived, not deleted, so a mistaken "forget" can be undone and the history stays inspectable. */
  forget(id: number) {
    return this.update(id, { status: "archived" })
  }

  get(id: number) {
    const row = this.db.query("SELECT * FROM memory WHERE id = $id").get({ $id: id }) as Row | null
    return row ? decode(row) : undefined
  }

  list(input: { scopes: string[]; kinds?: MemoryKind[]; statuses?: MemoryStatus[]; limit?: number }) {
    const rows = this.db.query("SELECT * FROM memory ORDER BY pinned DESC, updated_at DESC").all() as Row[]
    const kinds = input.kinds && new Set<string>(input.kinds)
    const statuses = new Set<string>(input.statuses ?? ["active", "open", "blocked"])
    return rows
      .filter((row) => input.scopes.includes(row.scope) && statuses.has(row.status) && (!kinds || kinds.has(row.kind)))
      .slice(0, input.limit ?? 200)
      .map(decode)
  }

  search(input: { query: string; scopes: string[]; includeArchived?: boolean; limit?: number }) {
    const words = input.query.toLowerCase().split(/\s+/).filter(Boolean)
    return this.list({
      scopes: input.scopes,
      statuses: input.includeArchived ? ["active", "open", "done", "blocked", "archived"] : ["active", "open", "done", "blocked"],
      limit: 1000,
    })
      .filter((entry) => {
        const haystack = `${entry.title} ${entry.body}`.toLowerCase()
        return words.every((word) => haystack.includes(word))
      })
      .slice(0, input.limit ?? 20)
  }

  // ---- thread journal --------------------------------------------------------------------------------------------

  openThread(input: {
    thread_id: string
    guild_id: string | null
    title: string
    parent_thread?: string | null
    project?: string | null
    directory?: string | null
    branch?: string | null
  }) {
    const now = Date.now()
    this.db
      .query(
        `INSERT INTO threads (thread_id, guild_id, parent_thread, title, project, directory, branch, created_at, updated_at)
         VALUES ($thread_id, $guild_id, $parent_thread, $title, $project, $directory, $branch, $now, $now)
         ON CONFLICT(thread_id) DO UPDATE SET
           title = excluded.title, project = excluded.project, directory = excluded.directory,
           branch = COALESCE(excluded.branch, threads.branch), state = 'active', updated_at = excluded.updated_at`,
      )
      .run({
        $thread_id: input.thread_id,
        $guild_id: input.guild_id,
        $parent_thread: input.parent_thread ?? null,
        $title: input.title,
        $project: input.project ?? null,
        $directory: input.directory ?? null,
        $branch: input.branch ?? null,
        $now: now,
      })
  }

  /** Called for every prompt: keeps the "what was this thread about" index current without any model call. */
  touchThread(threadId: string, lastRequest: string) {
    this.db
      .query("UPDATE threads SET turns = turns + 1, last_request = $request, updated_at = $now WHERE thread_id = $id")
      .run({ $id: threadId, $request: lastRequest.replace(/\s+/g, " ").trim().slice(0, 300), $now: Date.now() })
  }

  setSummary(threadId: string, summary: string) {
    this.db
      .query("UPDATE threads SET summary = $summary, updated_at = $now WHERE thread_id = $id")
      .run({ $id: threadId, $summary: summary, $now: Date.now() })
  }

  closeThread(threadId: string) {
    this.db.query("UPDATE threads SET state = 'closed', updated_at = $now WHERE thread_id = $id").run({ $id: threadId, $now: Date.now() })
  }

  thread(threadId: string) {
    return (this.db.query("SELECT * FROM threads WHERE thread_id = $id").get({ $id: threadId }) ?? undefined) as ThreadRecord | undefined
  }

  threads(input: { guildId?: string | null; query?: string; state?: "active" | "closed"; limit?: number } = {}) {
    const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean)
    const rows = this.db.query("SELECT * FROM threads ORDER BY updated_at DESC").all() as ThreadRecord[]
    return rows
      .filter((row) => !input.guildId || row.guild_id === input.guildId)
      .filter((row) => !input.state || row.state === input.state)
      .filter((row) => {
        const haystack = `${row.title} ${row.last_request ?? ""} ${row.summary ?? ""}`.toLowerCase()
        return words.every((word) => haystack.includes(word))
      })
      .slice(0, input.limit ?? 20)
  }
}

function decode(row: Row): MemoryEntry {
  return { ...row, pinned: row.pinned === 1 }
}
