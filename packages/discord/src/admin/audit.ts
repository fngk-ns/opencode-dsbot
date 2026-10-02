import type { Db } from "../store/db"

export type AuditEntry = {
  at: number
  actor_id: string
  guild_id: string | null
  channel_id: string | null
  action: string
  target: string | null
  detail: string | null
  ok: boolean
}

/** Append-only record of everything the bot did to a server on someone's behalf. */
export class AuditLog {
  constructor(private readonly db: Db) {}

  record(entry: Omit<AuditEntry, "at"> & { at?: number }) {
    this.db
      .query(
        `INSERT INTO audit (at, actor_id, guild_id, channel_id, action, target, detail, ok)
         VALUES ($at, $actor_id, $guild_id, $channel_id, $action, $target, $detail, $ok)`,
      )
      .run({
        $at: entry.at ?? Date.now(),
        $actor_id: entry.actor_id,
        $guild_id: entry.guild_id,
        $channel_id: entry.channel_id,
        $action: entry.action,
        $target: entry.target,
        $detail: entry.detail,
        $ok: entry.ok ? 1 : 0,
      })
  }

  recent(guildId: string, limit = 10) {
    const rows = this.db
      .query("SELECT * FROM audit WHERE guild_id = $guild ORDER BY id DESC LIMIT $limit")
      .all({ $guild: guildId, $limit: Math.min(Math.max(limit, 1), 50) }) as Array<Omit<AuditEntry, "ok"> & { ok: number }>
    return rows.map((row) => ({ ...row, ok: row.ok === 1 }))
  }
}
