import { describe, expect, test } from "bun:test"
import type { Engine, Event } from "../src/bridge/opencode"
import { CompactionManager, digestKey } from "../src/memory/compaction"
import { MemoryStore } from "../src/memory/store"
import { BindingStore, KeyValueStore } from "../src/store/bindings"
import { openDatabase } from "../src/store/db"

function setup(options: { limit?: number; summary?: string; failSummarize?: boolean } = {}) {
  const db = openDatabase(":memory:")
  const bindings = new BindingStore(db)
  const memory = new MemoryStore(db)
  const kv = new KeyValueStore(db)
  bindings.set({ channel_id: "t1", session_id: "ses_1", directory: "/w/blog", kind: "project", owner_id: "u", model: null, agent: null, created_at: 1 })
  memory.openThread({ thread_id: "t1", guild_id: "g", title: "blog" })
  kv.set(digestKey("ses_1"), "old-hash")

  const calls: string[] = []
  const notices: string[] = []
  const engine = {
    summarize: async (sessionId: string, directory: string, model: { providerID: string; modelID: string }) => {
      calls.push(`summarize:${sessionId}:${directory}:${model.providerID}/${model.modelID}`)
      if (options.failSummarize) throw new Error("model overloaded")
    },
    summaryOf: async () => options.summary ?? "## Objective\n- build the blog",
  } as unknown as Engine
  let time = 1_000_000
  const manager = new CompactionManager({
    engine,
    memory,
    bindings,
    kv,
    contextLimit: async () => options.limit,
    notify: async (channelId, text) => void notices.push(`${channelId}: ${text}`),
    now: () => time,
  })
  const assistant = (tokens: { input: number; output?: number; read?: number; write?: number }, extra: object = {}) =>
    ({
      type: "message.updated",
      properties: {
        info: {
          id: "m1",
          sessionID: "ses_1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
          time: { created: 1, completed: 2 },
          tokens: { input: tokens.input, output: tokens.output ?? 0, reasoning: 0, cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 } },
          ...extra,
        },
      },
    }) as unknown as Event
  return { manager, calls, notices, memory, kv, assistant, advance: (ms: number) => (time += ms) }
}

describe("CompactionManager", () => {
  test("compacts at idle once usage passes 70% of the window, stores the summary and re-arms the memory briefing", async () => {
    const t = setup({ limit: 200_000 })
    await t.manager.observe(t.assistant({ input: 20_000, read: 130_000, output: 2_000 }))
    expect(await t.manager.afterIdle("ses_1")).toBe(true)
    expect(t.calls).toEqual(["summarize:ses_1:/w/blog:anthropic/claude-sonnet-4-6"])
    expect(t.memory.thread("t1")?.summary).toContain("build the blog")
    expect(t.kv.get(digestKey("ses_1"))).toBeUndefined()
    expect(t.notices[0]).toContain("공통 메모리")
  })

  test("does nothing below the threshold", async () => {
    const t = setup({ limit: 200_000 })
    await t.manager.observe(t.assistant({ input: 50_000 }))
    expect(await t.manager.afterIdle("ses_1")).toBe(false)
    expect(t.calls).toEqual([])
    expect(t.kv.get(digestKey("ses_1"))).toBe("old-hash")
  })

  test("uses a fixed token threshold when the window size is unknown", async () => {
    const t = setup({ limit: undefined })
    await t.manager.observe(t.assistant({ input: 100_000 }))
    expect(await t.manager.afterIdle("ses_1")).toBe(false)
    await t.manager.observe(t.assistant({ input: 125_000 }))
    expect(await t.manager.afterIdle("ses_1")).toBe(true)
  })

  test("a session is not compacted again during the cool-down", async () => {
    const t = setup({ limit: 100_000 })
    await t.manager.observe(t.assistant({ input: 90_000 }))
    expect(await t.manager.afterIdle("ses_1")).toBe(true)
    await t.manager.observe(t.assistant({ input: 90_000 }))
    expect(await t.manager.afterIdle("ses_1")).toBe(false)
    t.advance(10 * 60_000)
    expect(await t.manager.afterIdle("ses_1")).toBe(true)
  })

  test("summary messages do not count as usage", async () => {
    const t = setup({ limit: 100_000 })
    await t.manager.observe(t.assistant({ input: 99_000 }, { summary: true }))
    expect(await t.manager.afterIdle("ses_1")).toBe(false)
  })

  test("a failed summary is reported and leaves the briefing alone", async () => {
    const t = setup({ limit: 100_000, failSummarize: true })
    await t.manager.observe(t.assistant({ input: 90_000 }))
    expect(await t.manager.afterIdle("ses_1")).toBe(false)
    expect(t.notices.at(-1)).toContain("model overloaded")
    expect(t.kv.get(digestKey("ses_1"))).toBe("old-hash")
  })

  test("when opencode compacts on its own, the summary is kept and the briefing is re-armed", async () => {
    const t = setup({ summary: "auto summary text" })
    await t.manager.observe({ type: "session.compacted", properties: { sessionID: "ses_1" } } as unknown as Event)
    expect(t.memory.thread("t1")?.summary).toBe("auto summary text")
    expect(t.kv.get(digestKey("ses_1"))).toBeUndefined()
    expect(t.notices[0]).toContain("자동")
  })

  test("unknown sessions and sessions never seen are ignored", async () => {
    const t = setup({ limit: 1000 })
    expect(await t.manager.afterIdle("ses_1")).toBe(false)
    expect(await t.manager.afterIdle("ses_other")).toBe(false)
  })
})
