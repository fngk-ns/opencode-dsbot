import { describe, expect, test } from "bun:test"
import { openDatabase } from "../src/store/db"
import { MessageStore, snowflakeTime, type StoredMessage } from "../src/store/messages"
import { BindingStore, KeyValueStore } from "../src/store/bindings"

function message(id: string, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id,
    channel_id: "100000000000000001",
    guild_id: "200000000000000001",
    author_id: "300000000000000001",
    author_name: "alice",
    author_bot: false,
    content: `message ${id}`,
    attachments: [],
    reference_id: null,
    created_at: Number(id),
    edited_at: null,
    deleted_at: null,
    ...overrides,
  }
}

describe("MessageStore", () => {
  test("round-trips a message including attachments and bot flag", () => {
    const store = new MessageStore(openDatabase(":memory:"))
    const attachment = { id: "9", name: "a.ts", url: "https://cdn/a.ts", size: 12, content_type: "text/plain" }
    store.save(message("1", { author_bot: true, attachments: [attachment] }))
    const saved = store.get("1")
    expect(saved?.author_bot).toBe(true)
    expect(saved?.attachments).toEqual([attachment])
  })

  test("recent returns newest first, honours limit and before", () => {
    const store = new MessageStore(openDatabase(":memory:"))
    for (const id of ["10", "20", "30", "40"]) store.save(message(id))
    expect(store.recent("100000000000000001", { limit: 2 }).map((item) => item.id)).toEqual(["40", "30"])
    expect(store.recent("100000000000000001", { before: "30" }).map((item) => item.id)).toEqual(["20", "10"])
    expect(store.recent("100000000000000001", { before: 25 }).map((item) => item.id)).toEqual(["20", "10"])
  })

  test("edit keeps cached content when the gateway omits it", () => {
    const store = new MessageStore(openDatabase(":memory:"))
    store.save(message("1", { content: "original" }))
    store.edit("1", { edited_at: 5 })
    expect(store.get("1")?.content).toBe("original")
    store.edit("1", { content: "changed", edited_at: 6 })
    expect(store.get("1")).toMatchObject({ content: "changed", edited_at: 6 })
  })

  test("deleted messages are hidden from reads but kept for explicit lookup", () => {
    const store = new MessageStore(openDatabase(":memory:"))
    store.save(message("1"))
    store.save(message("2"))
    store.markDeleted(["1"], 99)
    expect(store.recent("100000000000000001").map((item) => item.id)).toEqual(["2"])
    expect(store.search({ include_deleted: true }).map((item) => item.id)).toEqual(["2", "1"])
    expect(store.get("1")?.deleted_at).toBe(99)
  })

  test("search escapes LIKE wildcards and combines filters", () => {
    const store = new MessageStore(openDatabase(":memory:"))
    store.save(message("1", { content: "100% done" }))
    store.save(message("2", { content: "1000 done" }))
    store.save(message("3", { content: "100% done", author_id: "other" }))
    expect(store.search({ query: "100%" }).map((item) => item.id)).toEqual(["3", "1"])
    expect(store.search({ query: "100%", author_id: "other" }).map((item) => item.id)).toEqual(["3"])
    expect(store.search({ query: "_" })).toEqual([])
  })

  test("search can be scoped to one guild", () => {
    const store = new MessageStore(openDatabase(":memory:"))
    store.save(message("1", { guild_id: "g1", content: "alpha" }))
    store.save(message("2", { guild_id: "g2", content: "alpha" }))
    expect(store.search({ query: "alpha", guild_id: "g2" }).map((item) => item.id)).toEqual(["2"])
  })

  test("coverage reports the oldest cached message and prune removes old rows", () => {
    const store = new MessageStore(openDatabase(":memory:"))
    store.save(message("10"))
    store.save(message("50"))
    expect(store.coverage()).toEqual({ oldest: 10, count: 2 })
    expect(store.prune(30)).toBe(1)
    expect(store.coverage("100000000000000001").count).toBe(1)
  })

  test("snowflakeTime decodes the Discord epoch", () => {
    expect(snowflakeTime("175928847299117063")).toBe(1462015105796)
  })
})

describe("BindingStore and KeyValueStore", () => {
  test("binds a thread to a session and updates model/agent", () => {
    const db = openDatabase(":memory:")
    const bindings = new BindingStore(db)
    bindings.set({
      channel_id: "t1",
      session_id: "s1",
      directory: "/work/a",
      kind: "project",
      owner_id: "u1",
      model: null,
      agent: null,
      created_at: 1,
    })
    bindings.update("t1", { model: "anthropic/claude" })
    expect(bindings.get("t1")).toMatchObject({ model: "anthropic/claude", agent: null })
    expect(bindings.bySession("s1")?.channel_id).toBe("t1")
    expect(bindings.get("missing")).toBeUndefined()
  })

  test("key/value store persists and deletes", () => {
    const kv = new KeyValueStore(openDatabase(":memory:"))
    kv.set("a", "1")
    kv.set("a", "2")
    expect(kv.get("a")).toBe("2")
    kv.delete("a")
    expect(kv.get("a")).toBeUndefined()
  })
})
