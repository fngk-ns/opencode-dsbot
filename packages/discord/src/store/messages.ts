import type { Db } from "./db"

export type StoredAttachment = {
  id: string
  name: string
  url: string
  size: number
  content_type: string | null
}

export type StoredMessage = {
  id: string
  channel_id: string
  guild_id: string | null
  author_id: string
  author_name: string
  author_bot: boolean
  content: string
  attachments: StoredAttachment[]
  reference_id: string | null
  created_at: number
  edited_at: number | null
  deleted_at: number | null
}

type Row = Omit<StoredMessage, "author_bot" | "attachments"> & { author_bot: number; attachments: string }

export type SearchInput = {
  query?: string
  channel_id?: string
  guild_id?: string
  author_id?: string
  since?: number
  until?: number
  include_deleted?: boolean
  limit?: number
}

const DISCORD_EPOCH = 1420070400000n

export function snowflakeTime(id: string) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
}

/**
 * Local copy of every message the bot has seen since it started. All message reads go through here;
 * the REST API is only used by the lookup layer for an explicit message ID or link that is missing.
 */
export class MessageStore {
  constructor(private readonly db: Db) {}

  save(message: StoredMessage) {
    this.db
      .query(
        `INSERT INTO messages (id, channel_id, guild_id, author_id, author_name, author_bot, content, attachments, reference_id, created_at, edited_at, deleted_at)
         VALUES ($id, $channel_id, $guild_id, $author_id, $author_name, $author_bot, $content, $attachments, $reference_id, $created_at, $edited_at, $deleted_at)
         ON CONFLICT(id) DO UPDATE SET
           author_name = excluded.author_name,
           content = excluded.content,
           attachments = excluded.attachments,
           edited_at = COALESCE(excluded.edited_at, messages.edited_at)`,
      )
      .run({
        $id: message.id,
        $channel_id: message.channel_id,
        $guild_id: message.guild_id,
        $author_id: message.author_id,
        $author_name: message.author_name,
        $author_bot: message.author_bot ? 1 : 0,
        $content: message.content,
        $attachments: JSON.stringify(message.attachments),
        $reference_id: message.reference_id,
        $created_at: message.created_at,
        $edited_at: message.edited_at,
        $deleted_at: message.deleted_at,
      })
  }

  /** Applies an edit. Fields that the gateway omitted (undefined) keep their cached value. */
  edit(id: string, patch: { content?: string; attachments?: StoredAttachment[]; edited_at: number }) {
    this.db
      .query(
        `UPDATE messages SET
           content = COALESCE($content, content),
           attachments = COALESCE($attachments, attachments),
           edited_at = $edited_at
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $content: patch.content ?? null,
        $attachments: patch.attachments ? JSON.stringify(patch.attachments) : null,
        $edited_at: patch.edited_at,
      })
  }

  markDeleted(ids: string[], at = Date.now()) {
    const statement = this.db.query("UPDATE messages SET deleted_at = $at WHERE id = $id AND deleted_at IS NULL")
    this.db.transaction(() => ids.forEach((id) => statement.run({ $id: id, $at: at })))()
  }

  get(id: string) {
    const row = this.db.query("SELECT * FROM messages WHERE id = $id").get({ $id: id }) as Row | null
    return row ? decode(row) : undefined
  }

  /** Newest first. `before` is a message ID inside the same channel or a timestamp in ms. */
  recent(channelId: string, input: { limit?: number; before?: string | number } = {}) {
    const before = typeof input.before === "string" ? this.timeOf(input.before) : input.before
    const rows = this.db
      .query(
        `SELECT * FROM messages
         WHERE channel_id = $channel_id AND deleted_at IS NULL AND ($before IS NULL OR created_at < $before)
         ORDER BY created_at DESC, id DESC LIMIT $limit`,
      )
      .all({ $channel_id: channelId, $before: before ?? null, $limit: clamp(input.limit, 1, 100, 20) }) as Row[]
    return rows.map(decode)
  }

  search(input: SearchInput) {
    const rows = this.db
      .query(
        `SELECT * FROM messages
         WHERE ($query IS NULL OR content LIKE $query ESCAPE '\\')
           AND ($channel_id IS NULL OR channel_id = $channel_id)
           AND ($guild_id IS NULL OR guild_id = $guild_id)
           AND ($author_id IS NULL OR author_id = $author_id)
           AND ($since IS NULL OR created_at >= $since)
           AND ($until IS NULL OR created_at < $until)
           AND ($include_deleted = 1 OR deleted_at IS NULL)
         ORDER BY created_at DESC, id DESC LIMIT $limit`,
      )
      .all({
        $query: input.query ? `%${input.query.replace(/[\\%_]/g, "\\$&")}%` : null,
        $channel_id: input.channel_id ?? null,
        $guild_id: input.guild_id ?? null,
        $author_id: input.author_id ?? null,
        $since: input.since ?? null,
        $until: input.until ?? null,
        $include_deleted: input.include_deleted ? 1 : 0,
        $limit: clamp(input.limit, 1, 100, 20),
      }) as Row[]
    return rows.map(decode)
  }

  /** Oldest cached timestamp, so callers can tell how far back the cache reaches. */
  coverage(channelId?: string) {
    const row = this.db
      .query(
        `SELECT MIN(created_at) AS oldest, COUNT(*) AS count FROM messages WHERE ($channel_id IS NULL OR channel_id = $channel_id)`,
      )
      .get({ $channel_id: channelId ?? null }) as { oldest: number | null; count: number }
    return { oldest: row.oldest, count: row.count }
  }

  prune(olderThan: number) {
    return this.db.query("DELETE FROM messages WHERE created_at < $at").run({ $at: olderThan }).changes
  }

  private timeOf(id: string) {
    const row = this.db.query("SELECT created_at FROM messages WHERE id = $id").get({ $id: id }) as {
      created_at: number
    } | null
    return row?.created_at ?? snowflakeTime(id)
  }
}

function decode(row: Row): StoredMessage {
  return { ...row, author_bot: row.author_bot === 1, attachments: JSON.parse(row.attachments) as StoredAttachment[] }
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}
