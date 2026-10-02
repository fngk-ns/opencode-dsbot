import { describe, expect, test } from "bun:test"
import { AdminActions } from "../src/admin/actions"
import { AuditLog } from "../src/admin/audit"
import { PendingActions } from "../src/admin/pending"
import type { AdminContext, AdminPermission, GuildPort } from "../src/admin/types"
import type { ChannelInfo, MemberInfo, RoleInfo } from "../src/cache/directory"
import { openDatabase } from "../src/store/db"
import { MessageStore, type StoredMessage } from "../src/store/messages"

const GUILD = "900000000000000001"
const BOT = "100000000000000000"
const GUILD_OWNER = "100000000000000001"
const BOT_OWNER = "100000000000000002"
const MOD = "100000000000000003"
const PLAIN = "100000000000000004"
const ALICE = "100000000000000010"
const ALICIA = "100000000000000011"
const BOB = "100000000000000012"

const member = (id: string, username: string, roles: string[] = []): MemberInfo => ({ id, username, global_name: null, display_name: username, nickname: null, bot: false, roles, joined_at: null })
const channel = (id: string, name: string, type = "GuildText", parent: string | null = null): ChannelInfo => ({ id, name, type, parent_id: parent, topic: null })

const MEMBERS = [
  member(BOT, "helper-bot"),
  member(GUILD_OWNER, "boss"),
  member(BOT_OWNER, "botowner"),
  member(MOD, "moddy", ["r-mod"]),
  member(PLAIN, "plain"),
  member(ALICE, "alice"),
  member(ALICIA, "alicia"),
  member(BOB, "bob", ["r-mod"]),
]
const CHANNELS = [
  channel("700000000000000001", "general"),
  channel("700000000000000002", "dev-chat"),
  channel("700000000000000003", "dev-chat", "GuildText", "700000000000000009"),
  channel("700000000000000009", "Projects", "GuildCategory"),
  channel("700000000000000008", "Archive", "GuildCategory"),
  channel("700000000000000010", "a-thread", "PublicThread", "700000000000000001"),
]
const ROLES: RoleInfo[] = [
  { id: "r-admin", name: "admin", color: "#f00", position: 10, member_count: 1 },
  { id: "r-mod", name: "mod", color: "#0f0", position: 5, member_count: 2 },
  { id: "r-member", name: "member", color: "#00f", position: 1, member_count: 5 },
]
const POSITIONS: Record<string, number> = { [GUILD_OWNER]: 10, [MOD]: 5, [BOB]: 5, [BOT_OWNER]: 0, [PLAIN]: 0, [ALICE]: 0, [ALICIA]: 0, [BOT]: 9 }

// Who has which Discord permission. The moderator can do moderation things; the plain member can only talk.
const GRANTS: Record<string, AdminPermission[]> = {
  [MOD]: ["ModerateMembers", "KickMembers", "BanMembers", "ManageMessages", "ManageChannels", "ManageRoles", "ManageNicknames", "CreatePublicThreads", "SendMessages"],
  [PLAIN]: ["SendMessages", "CreatePublicThreads"],
}

function fakePort() {
  const calls: string[] = []
  const record = (name: string) => async (...args: unknown[]) => void calls.push(`${name}:${JSON.stringify(args)}`)
  const port: GuildPort = {
    guildId: GUILD,
    ownerId: GUILD_OWNER,
    botId: BOT,
    members: () => MEMBERS,
    channels: () => CHANNELS,
    roles: () => ROLES,
    can: (userId, permission) => (GRANTS[userId] ?? []).includes(permission),
    topRole: (userId) => POSITIONS[userId] ?? 0,
    rolePosition: (roleId) => ROLES.find((role) => role.id === roleId)?.position ?? 0,
    timeout: record("timeout"),
    kick: record("kick"),
    ban: record("ban"),
    unban: record("unban"),
    deleteMessages: async (channelId, ids) => (calls.push(`deleteMessages:${channelId}:${ids.length}`), ids.length),
    createChannel: async (input) => (calls.push(`createChannel:${input.name}:${input.kind}:${input.categoryId ?? "-"}:${input.privateFor?.length ?? 0}`), { id: "800000000000000001", name: input.name }),
    createCategory: async (input) => (calls.push(`createCategory:${input.name}`), { id: "800000000000000002", name: input.name }),
    createThread: async (input) => (calls.push(`createThread:${input.channelId}:${input.name}`), { id: "800000000000000003", name: input.name }),
    renameChannel: record("rename"),
    moveChannel: record("move"),
    deleteChannel: record("deleteChannel"),
    setTopic: record("topic"),
    setSlowmode: record("slowmode"),
    createRole: async (input) => (calls.push(`createRole:${input.name}`), { id: "r-new", name: input.name }),
    addRole: record("addRole"),
    removeRole: record("removeRole"),
    setNickname: record("nickname"),
    sendMessage: async (channelId, content) => (calls.push(`send:${channelId}:${content}`), { id: "1" }),
    pin: record("pin"),
  }
  return { port, calls }
}

function setup() {
  const { port, calls } = fakePort()
  const db = openDatabase(":memory:")
  const messages = new MessageStore(db)
  const audit = new AuditLog(db)
  const pending = new PendingActions()
  const confirmations: Array<{ channelId: string; id: string; description: string }> = []
  const admin = new AdminActions({
    guild: (id) => (id === GUILD ? port : undefined),
    messages,
    audit,
    pending,
    isOwner: (id) => id === BOT_OWNER,
    askConfirm: async (channelId, id, description) => void confirmations.push({ channelId, id, description }),
  })
  const as = (speakerId: string): AdminContext => ({ guildId: GUILD, channelId: "700000000000000001", speakerId, speakerName: "speaker" })
  return { admin, calls, messages, audit, pending, confirmations, as }
}

function stored(id: string, authorId: string, content: string, channelId = "700000000000000001"): StoredMessage {
  return { id, channel_id: channelId, guild_id: GUILD, author_id: authorId, author_name: "x", author_bot: false, content, attachments: [], reference_id: null, created_at: Number(BigInt(id) >> 22n) + 1420070400000, edited_at: null, deleted_at: null }
}

// Snowflakes that decode to "just now", so they count as younger than 14 days.
const fresh = (offset: number) => String((BigInt(Date.now() - 1420070400000) << 22n) + BigInt(offset))

describe("authorization", () => {
  test("a moderator may time someone out; a plain member may not", async () => {
    const t = setup()
    const ok = await t.admin.execute(t.as(MOD), { action: "timeout", user: "alice", minutes: 10 })
    expect(ok).toMatchObject({ ok: true, message: expect.stringContaining("10분") })
    expect(t.calls[0]).toStartWith(`timeout:["${ALICE}"`)

    const denied = await t.admin.execute(t.as(PLAIN), { action: "timeout", user: "alice", minutes: 10 })
    expect(denied).toMatchObject({ ok: false, error: expect.stringContaining("ModerateMembers") })
    expect(t.calls).toHaveLength(1)
  })

  test("a bot owner is allowed without holding the Discord permission, the guild owner too", async () => {
    const t = setup()
    expect(await t.admin.execute(t.as(BOT_OWNER), { action: "timeout", user: "alice", minutes: 5 })).toMatchObject({ ok: true })
    expect(await t.admin.execute(t.as(GUILD_OWNER), { action: "timeout", user: "alice", minutes: 5 })).toMatchObject({ ok: true })
  })

  test("anyone who can create public threads may create one", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(PLAIN), { action: "create_thread", name: "토론", channel: "general" })
    expect(result).toMatchObject({ ok: true })
    expect(t.calls).toEqual([`createThread:700000000000000001:토론`])
  })

  test("every attempt is audited, including refusals", async () => {
    const t = setup()
    await t.admin.execute(t.as(MOD), { action: "timeout", user: "alice", minutes: 10 })
    await t.admin.execute(t.as(PLAIN), { action: "timeout", user: "alice", minutes: 10 })
    const entries = t.audit.recent(GUILD)
    expect(entries.map((entry) => [entry.actor_id, entry.action, entry.ok])).toEqual([
      [PLAIN, "timeout", false],
      [MOD, "timeout", true],
    ])
    expect(entries[0].detail).toContain("ModerateMembers")
  })
})

describe("targets", () => {
  test("an ambiguous name is refused and the candidates are listed", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(MOD), { action: "timeout", user: "ali", minutes: 10 })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.candidates?.join(" ")).toContain("alice")
    expect(t.calls).toEqual([])
  })

  test("a fuzzy substring hit is not enough to moderate someone", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(MOD), { action: "kick", user: "lic", minutes: 1 } as never)
    expect(result).toMatchObject({ ok: false })
    expect(t.calls).toEqual([])
  })

  test("exact names, mentions and ids all pick one person", async () => {
    const t = setup()
    for (const user of ["alice", `<@${ALICE}>`, ALICE, "@Alice"]) {
      expect(await t.admin.execute(t.as(MOD), { action: "timeout", user, minutes: 1 })).toMatchObject({ ok: true })
    }
    expect(t.calls.every((call) => call.includes(ALICE))).toBe(true)
  })

  test("never acts on the bot, the server owner or a bot owner (unless an owner asks)", async () => {
    const t = setup()
    expect(await t.admin.execute(t.as(MOD), { action: "timeout", user: BOT, minutes: 1 })).toMatchObject({ ok: false })
    expect(await t.admin.execute(t.as(MOD), { action: "timeout", user: GUILD_OWNER, minutes: 1 })).toMatchObject({ ok: false })
    expect(await t.admin.execute(t.as(MOD), { action: "timeout", user: BOT_OWNER, minutes: 1 })).toMatchObject({ ok: false })
    expect(t.calls).toEqual([])
  })

  test("a moderator cannot act on someone of equal or higher role", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(MOD), { action: "timeout", user: "bob", minutes: 1 })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("역할") })
    expect(t.calls).toEqual([])
  })

  test("timeout length is bounded", async () => {
    const t = setup()
    expect(await t.admin.execute(t.as(MOD), { action: "timeout", user: "alice", minutes: 0 })).toMatchObject({ ok: false })
    expect(await t.admin.execute(t.as(MOD), { action: "timeout", user: "alice", minutes: 99999 })).toMatchObject({ ok: false })
  })
})

describe("confirmation for destructive actions", () => {
  test("kick, ban and deleting a channel wait for a button and run once when confirmed", async () => {
    const t = setup()
    for (const request of [
      { action: "kick", user: "alice" },
      { action: "ban", user: "alicia", delete_days: 1 },
      { action: "delete_channel", channel: "general" },
    ] as const) {
      const result = await t.admin.execute(t.as(MOD), request)
      expect(result).toMatchObject({ ok: true, pending: true })
    }
    expect(t.calls).toEqual([])
    expect(t.confirmations).toHaveLength(3)

    const first = t.confirmations[0]
    const taken = t.pending.take(first.id, MOD, false)
    expect(taken.ok && (await taken.action.run())).toContain("추방")
    expect(t.calls).toHaveLength(1)
    expect(t.pending.take(first.id, MOD, false)).toMatchObject({ ok: false })
  })

  test("only the requester or an owner can confirm, and a cancel runs nothing", async () => {
    const t = setup()
    await t.admin.execute(t.as(MOD), { action: "kick", user: "alice" })
    const id = t.confirmations[0].id
    expect(t.pending.take(id, PLAIN, false)).toMatchObject({ ok: false })
    expect(t.pending.cancel(id, BOT_OWNER, true)).toMatchObject({ ok: true })
    expect(t.calls).toEqual([])
  })

  test("reversible actions run immediately", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(MOD), { action: "timeout", user: "alice", minutes: 5 })
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.pending).toBeUndefined()
    expect(t.confirmations).toEqual([])
  })

  test("a failure from Discord is reported, not thrown, and audited", async () => {
    const t = setup()
    t.admin["deps"].guild(GUILD)!.timeout = async () => {
      throw new Error("Missing Permissions")
    }
    const result = await t.admin.execute(t.as(MOD), { action: "timeout", user: "alice", minutes: 5 })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Missing Permissions") })
    expect(t.audit.recent(GUILD)[0]).toMatchObject({ ok: false })
  })
})

describe("deleting messages from the cache", () => {
  function seeded() {
    const t = setup()
    const ids = Array.from({ length: 30 }, (_, index) => fresh(index + 1))
    ids.forEach((id, index) => t.messages.save(stored(id, index % 3 === 0 ? ALICE : BOB, index === 4 ? "spam link here" : `message ${index}`)))
    return { t, ids }
  }

  test("'delete 5 messages' removes the 5 newest cached ones without confirmation", async () => {
    const { t, ids } = seeded()
    const result = await t.admin.execute(t.as(MOD), { action: "delete_messages", count: 5 })
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("5개") })
    expect(t.calls).toEqual(["deleteMessages:700000000000000001:5"])
    expect(t.messages.get(ids[29])?.deleted_at).not.toBeNull()
    expect(t.messages.get(ids[0])?.deleted_at).toBeNull()
  })

  test("it can be limited to one person or to messages containing a word", async () => {
    const { t, ids } = seeded()
    await t.admin.execute(t.as(MOD), { action: "delete_messages", user: "alice", count: 100 })
    expect(t.messages.get(ids[0])?.deleted_at).not.toBeNull()
    expect(t.messages.get(ids[1])?.deleted_at).toBeNull()

    await t.admin.execute(t.as(MOD), { action: "delete_messages", contains: "SPAM" })
    expect(t.messages.get(ids[4])?.deleted_at).not.toBeNull()
  })

  test("more than ten messages need a confirmation", async () => {
    const { t } = seeded()
    const result = await t.admin.execute(t.as(MOD), { action: "delete_messages", count: 25 })
    expect(result).toMatchObject({ ok: true, pending: true })
    expect(t.calls).toEqual([])
    const taken = t.pending.take(t.confirmations[0].id, MOD, false)
    if (taken.ok) await taken.action.run()
    expect(t.calls).toEqual(["deleteMessages:700000000000000001:25"])
  })

  test("a plain member cannot delete, and an empty cache says so", async () => {
    const { t } = seeded()
    expect(await t.admin.execute(t.as(PLAIN), { action: "delete_messages", count: 3 })).toMatchObject({ ok: false })
    expect(await t.admin.execute(t.as(MOD), { action: "delete_messages", channel: "dev-chat", count: 3 })).toMatchObject({ ok: false })
  })

  test("explicit message ids are deleted as given", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(MOD), { action: "delete_messages", message_ids: [fresh(1), fresh(2), "not-an-id"] })
    expect(result).toMatchObject({ ok: true })
    expect(t.calls).toEqual(["deleteMessages:700000000000000001:2"])
  })
})

describe("channels, categories and threads", () => {
  test("creates a text channel inside a named category with a Discord-style name", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(MOD), { action: "create_channel", name: "New Ideas", category: "projects" })
    expect(result).toMatchObject({ ok: true })
    expect(t.calls).toEqual(["createChannel:new-ideas:text:700000000000000009:0"])
  })

  test("a private channel is visible to the requester and the bot only", async () => {
    const t = setup()
    await t.admin.execute(t.as(MOD), { action: "create_channel", name: "secret", private: true })
    expect(t.calls).toEqual(["createChannel:secret:text:-:2"])
  })

  test("voice channels keep their spelling; categories are created as categories", async () => {
    const t = setup()
    await t.admin.execute(t.as(MOD), { action: "create_channel", name: "Game Night", type: "voice" })
    await t.admin.execute(t.as(MOD), { action: "create_category", name: "Events" })
    expect(t.calls).toEqual(["createChannel:Game Night:voice:-:0", "createCategory:Events"])
  })

  test("duplicate channel names are ambiguous until an id is used", async () => {
    const t = setup()
    const result = await t.admin.execute(t.as(MOD), { action: "rename_channel", channel: "dev-chat", name: "dev" })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.candidates).toHaveLength(2)
    expect(await t.admin.execute(t.as(MOD), { action: "rename_channel", channel: "700000000000000003", name: "dev" })).toMatchObject({ ok: true })
  })

  test("a thread requested inside a thread is created in the thread's parent channel", async () => {
    const t = setup()
    await t.admin.execute(t.as(PLAIN), { action: "create_thread", name: "분기", channel: "700000000000000010" })
    expect(t.calls).toEqual(["createThread:700000000000000001:분기"])
  })

  test("moving a channel needs a real category, and omitting it removes the channel from its category", async () => {
    const t = setup()
    expect(await t.admin.execute(t.as(MOD), { action: "move_channel", channel: "general", category: "nothing-here" })).toMatchObject({ ok: false })
    expect(await t.admin.execute(t.as(MOD), { action: "move_channel", channel: "general", category: "archive" })).toMatchObject({ ok: true })
    expect(await t.admin.execute(t.as(MOD), { action: "move_channel", channel: "general" })).toMatchObject({ ok: true })
    expect(t.calls[1]).toContain("null")
  })

  test("unknown servers and unknown channels fail cleanly", async () => {
    const t = setup()
    expect(await t.admin.execute({ ...t.as(MOD), guildId: "nope" }, { action: "create_category", name: "x" })).toMatchObject({ ok: false })
    expect(await t.admin.execute(t.as(MOD), { action: "set_topic", channel: "missing", topic: "x" })).toMatchObject({ ok: false })
  })
})

describe("roles", () => {
  test("a moderator can hand out a lower role but not one at or above their own", async () => {
    const t = setup()
    expect(await t.admin.execute(t.as(MOD), { action: "add_role", user: "alice", role: "member" })).toMatchObject({ ok: true })
    expect(await t.admin.execute(t.as(MOD), { action: "add_role", user: "alice", role: "mod" })).toMatchObject({ ok: false })
    expect(await t.admin.execute(t.as(MOD), { action: "add_role", user: "alice", role: "admin" })).toMatchObject({ ok: false })
    expect(t.calls).toHaveLength(1)
  })

  test("roles are created plain, and removing works like adding", async () => {
    const t = setup()
    expect(await t.admin.execute(t.as(MOD), { action: "create_role", name: "VIP", color: "#ffd700" })).toMatchObject({ ok: true })
    expect(await t.admin.execute(t.as(MOD), { action: "remove_role", user: "alice", role: "member" })).toMatchObject({ ok: true })
    expect(t.calls[1]).toStartWith("removeRole")
  })
})
