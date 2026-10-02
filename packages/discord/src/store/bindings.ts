import type { Db } from "./db"

export type BindingKind = "project" | "self"

export type Binding = {
  channel_id: string
  session_id: string
  directory: string
  kind: BindingKind
  owner_id: string
  model: string | null
  agent: string | null
  created_at: number
}

/** Maps a Discord thread (or DM channel) to the opencode session that serves it. */
export class BindingStore {
  constructor(private readonly db: Db) {}

  get(channelId: string) {
    return (this.db.query("SELECT * FROM bindings WHERE channel_id = $id").get({ $id: channelId }) ?? undefined) as
      | Binding
      | undefined
  }

  bySession(sessionId: string) {
    return (this.db.query("SELECT * FROM bindings WHERE session_id = $id").get({ $id: sessionId }) ?? undefined) as
      | Binding
      | undefined
  }

  set(binding: Binding) {
    this.db
      .query(
        `INSERT INTO bindings (channel_id, session_id, directory, kind, owner_id, model, agent, created_at)
         VALUES ($channel_id, $session_id, $directory, $kind, $owner_id, $model, $agent, $created_at)
         ON CONFLICT(channel_id) DO UPDATE SET
           session_id = excluded.session_id, directory = excluded.directory, kind = excluded.kind,
           model = excluded.model, agent = excluded.agent`,
      )
      .run({
        $channel_id: binding.channel_id,
        $session_id: binding.session_id,
        $directory: binding.directory,
        $kind: binding.kind,
        $owner_id: binding.owner_id,
        $model: binding.model,
        $agent: binding.agent,
        $created_at: binding.created_at,
      })
  }

  update(channelId: string, patch: { model?: string | null; agent?: string | null }) {
    const current = this.get(channelId)
    if (!current) return
    this.db
      .query("UPDATE bindings SET model = $model, agent = $agent WHERE channel_id = $id")
      .run({
        $id: channelId,
        $model: patch.model === undefined ? current.model : patch.model,
        $agent: patch.agent === undefined ? current.agent : patch.agent,
      })
  }
}

/** Small persistent key/value store for state that must survive a restart (for example a restart notice). */
export class KeyValueStore {
  constructor(private readonly db: Db) {}

  get(key: string) {
    const row = this.db.query("SELECT value FROM kv WHERE key = $key").get({ $key: key }) as { value: string } | null
    return row?.value
  }

  set(key: string, value: string) {
    this.db
      .query("INSERT INTO kv (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run({ $key: key, $value: value })
  }

  delete(key: string) {
    this.db.query("DELETE FROM kv WHERE key = $key").run({ $key: key })
  }
}
