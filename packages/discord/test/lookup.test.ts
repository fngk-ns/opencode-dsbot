import { describe, expect, test } from "bun:test"
import { createLookup, RestBudget, rankMembers } from "../src/cache/lookup"
import type { Directory, MemberInfo } from "../src/cache/directory"
import { openDatabase } from "../src/store/db"
import { MessageStore, type StoredMessage } from "../src/store/messages"

function stored(id: string, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id,
    channel_id: "500000000000000001",
    guild_id: "600000000000000001",
    author_id: "700000000000000001",
    author_name: "bob",
    author_bot: false,
    content: `hello ${id}`,
    attachments: [],
    reference_id: null,
    created_at: 1_700_000_000_000 + Number(id.slice(-4)),
    edited_at: null,
    deleted_at: null,
    ...overrides,
  }
}

function member(id: string, username: string, display: string, roles: string[] = []): MemberInfo {
  return { id, username, global_name: null, display_name: display, nickname: null, bot: false, roles, joined_at: null }
}

const members = [
  member("1", "alice", "Alice", ["r1"]),
  member("2", "alicia", "Ali", ["r2"]),
  member("3", "bob", "Robert the Builder", ["r1"]),
]

const directory: Directory = {
  guilds: () => [{ id: "g1", name: "Guild", member_count: 3, cached_members: 3, members_ready: true }],
  members: (guildId) => (guildId === "g1" ? members : undefined),
  channels: (guildId) =>
    guildId === "g1"
      ? [
          { id: "c1", name: "general", type: "GuildText", parent_id: null, topic: null },
          { id: "c2", name: "dev-chat", type: "GuildText", parent_id: null, topic: null },
        ]
      : undefined,
  roles: (guildId) =>
    guildId === "g1"
      ? [
          { id: "r1", name: "mod", color: "#fff", position: 1, member_count: 2 },
          { id: "r2", name: "admin", color: "#000", position: 5, member_count: 1 },
        ]
      : undefined,
}

function setup(remote: (channelId: string, messageId: string) => Promise<StoredMessage | undefined>, perMinute = 5) {
  const store = new MessageStore(openDatabase(":memory:"))
  const calls: string[] = []
  const lookup = createLookup({
    messages: store,
    directory,
    restLookupsPerMinute: perMinute,
    remote: (channelId, messageId) => {
      calls.push(`${channelId}/${messageId}`)
      return remote(channelId, messageId)
    },
  })
  return { store, lookup, calls }
}

const ID = "800000000000000001"

describe("message lookup", () => {
  test("a cached message never touches the API", async () => {
    const { store, lookup, calls } = setup(async () => undefined)
    store.save(stored(ID))
    const result = await lookup.message({ ref: ID })
    expect(result).toMatchObject({ ok: true, source: "cache" })
    expect(calls).toEqual([])
  })

  test("an uncached message link is fetched once, then served from the cache", async () => {
    const { lookup, calls } = setup(async (_, messageId) => stored(messageId))
    const link = `https://discord.com/channels/600000000000000001/500000000000000001/${ID}`
    expect(await lookup.message({ ref: link })).toMatchObject({ ok: true, source: "api" })
    expect(await lookup.message({ ref: link })).toMatchObject({ ok: true, source: "cache" })
    expect(calls).toEqual([`500000000000000001/${ID}`])
  })

  test("a bare ID without any channel cannot be fetched", async () => {
    const { lookup, calls } = setup(async () => stored(ID))
    const result = await lookup.message({ ref: ID })
    expect(result).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })

  test("a bare ID can use the caller's channel", async () => {
    const { lookup, calls } = setup(async (_, messageId) => stored(messageId))
    expect(await lookup.message({ ref: ID, channel_id: "500000000000000001" })).toMatchObject({ source: "api" })
    expect(calls).toHaveLength(1)
  })

  test("invalid references are rejected without a request", async () => {
    const { lookup, calls } = setup(async () => undefined)
    expect(await lookup.message({ ref: "not a ref" })).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })

  test("failed fetches are remembered so repeated asks do not hit the API", async () => {
    const { lookup, calls } = setup(async () => undefined)
    const link = `https://discord.com/channels/600000000000000001/500000000000000001/${ID}`
    expect(await lookup.message({ ref: link })).toMatchObject({ ok: false })
    expect(await lookup.message({ ref: link })).toMatchObject({ ok: false })
    expect(calls).toHaveLength(1)
  })

  test("concurrent asks for the same message share one request", async () => {
    const { lookup, calls } = setup(async (_, messageId) => {
      await Bun.sleep(10)
      return stored(messageId)
    })
    const link = `https://discord.com/channels/600000000000000001/500000000000000001/${ID}`
    const results = await Promise.all([lookup.message({ ref: link }), lookup.message({ ref: link })])
    expect(results.every((item) => item.ok)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  test("the REST budget caps explicit lookups", async () => {
    const { lookup, calls } = setup(async (_, messageId) => stored(messageId), 2)
    const link = (id: string) => `https://discord.com/channels/600000000000000001/500000000000000001/${id}`
    expect(await lookup.message({ ref: link("800000000000000001") })).toMatchObject({ ok: true })
    expect(await lookup.message({ ref: link("800000000000000002") })).toMatchObject({ ok: true })
    expect(await lookup.message({ ref: link("800000000000000003") })).toMatchObject({ ok: false })
    expect(calls).toHaveLength(2)
  })

  test("a throwing remote is reported as a failure, not an exception", async () => {
    const { lookup } = setup(async () => {
      throw new Error("Missing Access")
    })
    const link = `https://discord.com/channels/600000000000000001/500000000000000001/${ID}`
    expect(await lookup.message({ ref: link })).toMatchObject({ ok: false })
  })
})

describe("bulk message reads are cache-only", () => {
  test("messages() returns oldest-to-newest and reports coverage", () => {
    const { store, lookup, calls } = setup(async () => undefined)
    store.save(stored("800000000000000010"))
    store.save(stored("800000000000000020"))
    const result = lookup.messages({ channel_id: "500000000000000001" })
    expect(result.messages.map((item) => item.id)).toEqual(["800000000000000010", "800000000000000020"])
    expect(result.cached_since).toBe(new Date(1_700_000_000_010).toISOString())
    expect(calls).toEqual([])
  })

  test("search() filters by text and author", () => {
    const { store, lookup } = setup(async () => undefined)
    store.save(stored("800000000000000010", { content: "deploy failed" }))
    store.save(stored("800000000000000020", { content: "deploy ok", author_id: "9" }))
    expect(lookup.search({ query: "deploy" }).messages).toHaveLength(2)
    expect(lookup.search({ query: "deploy", author_id: "9" }).messages.map((item) => item.id)).toEqual(["800000000000000020"])
  })
})

describe("member and directory lookup", () => {
  test("ranks exact id, exact name, prefix, substring", () => {
    expect(rankMembers(members, "<@2>", 5).map((item) => item.id)).toEqual(["2"])
    expect(rankMembers(members, "ali", 5).map((item) => item.id)).toEqual(["2", "1"])
    expect(rankMembers(members, "Alice", 5)[0].id).toBe("1")
    expect(rankMembers(members, "builder", 5).map((item) => item.id)).toEqual(["3"])
    expect(rankMembers(members, "zzz", 5)).toEqual([])
  })

  test("member() and memberList() read only the cache", () => {
    const { lookup } = setup(async () => undefined)
    expect(lookup.member({ guild_id: "g1", ref: "@bob" })).toMatchObject({ ok: true, member: { id: "3" } })
    expect(lookup.member({ guild_id: "g1", ref: "nobody" })).toMatchObject({ ok: false })
    expect(lookup.member({ guild_id: "nope", ref: "bob" })).toMatchObject({ ok: false })
    const list = lookup.memberList({ guild_id: "g1", role_id: "r1" })
    expect(list).toMatchObject({ ok: true, total: 2 })
  })

  test("memberList paginates", () => {
    const { lookup } = setup(async () => undefined)
    const page = lookup.memberList({ guild_id: "g1", limit: 1, offset: 1 })
    expect(page).toMatchObject({ ok: true, total: 3 })
    if (page.ok) expect(page.members).toHaveLength(1)
  })

  test("channels and roles come from the directory", () => {
    const { lookup } = setup(async () => undefined)
    const channels = lookup.channels({ guild_id: "g1", query: "dev" })
    if (channels.ok) expect(channels.channels.map((item) => item.id)).toEqual(["c2"])
    const roles = lookup.roles({ guild_id: "g1" })
    if (roles.ok) expect(roles.roles.map((item) => item.id)).toEqual(["r2", "r1"])
    expect(lookup.guilds().guilds[0].members_ready).toBe(true)
  })
})

describe("RestBudget", () => {
  test("recovers after the window passes", () => {
    let time = 0
    const budget = new RestBudget(1, () => time)
    expect(budget.take()).toBe(true)
    expect(budget.take()).toBe(false)
    time = 61_000
    expect(budget.take()).toBe(true)
  })
})
