import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createApiHandler, type ApiContext, type ApiDeps } from "../src/api/server"
import { createLookup } from "../src/cache/lookup"
import type { Directory } from "../src/cache/directory"
import type { OutFile } from "../src/discord/outbound"
import { openDatabase } from "../src/store/db"
import { MessageStore, type StoredMessage } from "../src/store/messages"
import type { ModelInfo } from "../src/models"

const TOKEN = "secret-token"
const model = (provider: string, id: string, name: string, released: string): ModelInfo => ({
  ref: `${provider}/${id}`,
  provider,
  id,
  name,
  status: "active",
  released,
})
const CATALOG = [
  model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", "2025-09-29"),
  model("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", "2026-02-17"),
  model("anthropic", "claude-opus-4-6", "Claude Opus 4.6", "2026-02-05"),
  model("openai", "gpt-5", "GPT-5", "2025-08-07"),
]
let temp: string

beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "dsbot-api-"))
  await mkdir(path.join(temp, "project"), { recursive: true })
  await Bun.write(path.join(temp, "project", "report.txt"), "hello")
  await Bun.write(path.join(temp, "outside.txt"), "no")
})

afterAll(() => rm(temp, { recursive: true, force: true }))

function stored(id: string, guild: string | null, channel: string, content: string): StoredMessage {
  return {
    id,
    channel_id: channel,
    guild_id: guild,
    author_id: "u1",
    author_name: "alice",
    author_bot: false,
    content,
    attachments: [],
    reference_id: null,
    created_at: Number(id),
    edited_at: null,
    deleted_at: null,
  }
}

const directory: Directory = {
  guilds: () => [
    { id: "g1", name: "One", member_count: 1, cached_members: 1, members_ready: true },
    { id: "g2", name: "Two", member_count: 1, cached_members: 1, members_ready: true },
  ],
  members: (guild) =>
    guild === "g1" || guild === "g2"
      ? [{ id: "m1", username: "alice", global_name: null, display_name: "Alice", nickname: null, bot: false, roles: [], joined_at: null }]
      : undefined,
  channels: () => [],
  roles: () => [],
}

function setup(context: Partial<ApiContext> = {}, options: { noModels?: boolean } = {}) {
  const store = new MessageStore(openDatabase(":memory:"))
  store.save(stored("1001", "g1", "c1", "deploy finished"))
  store.save(stored("1002", "g2", "c9", "deploy secret from another server"))
  const sent: Array<{ channelId: string; text: string; files: OutFile[] }> = []
  const restarts: string[] = []
  const remoteCalls: string[] = []
  const modelChanges: Array<{ scope: string; ref: string | null }> = []
  const current: ApiContext = { channelId: "c1", guildId: "g1", directory: path.join(temp, "project"), kind: "project", speakerId: "owner1", ...context }
  const deps: ApiDeps = {
    token: TOKEN,
    lookup: createLookup({
      messages: store,
      directory,
      restLookupsPerMinute: 5,
      remote: async (channelId, messageId) => {
        remoteCalls.push(`${channelId}/${messageId}`)
        return undefined
      },
    }),
    context: (sessionId) => (sessionId === "ses_1" ? current : undefined),
    guildOfChannel: (channelId) => ({ c1: "g1", c2: "g1", c9: "g2" })[channelId],
    roots: (value) => [value.directory],
    maxUploadBytes: 1024,
    send: async (channelId, text, files) => void sent.push({ channelId, text, files }),
    restart: async (_, reason) => (restarts.push(reason), { ok: true, message: "queued" }),
    models: async () => (options.noModels ? [] : CATALOG),
    currentModels: () => ({ thread: null, default: null }),
    setModel: (_, scope, ref) => void modelChanges.push({ scope, ref }),
    isOwner: (userId) => userId === "owner1",
  }
  const handle = createApiHandler(deps)
  const post = (route: string, body: object, token = TOKEN) =>
    handle(
      new Request(`http://127.0.0.1${route}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
  return { post, sent, restarts, remoteCalls, handle, modelChanges }
}

describe("api auth and routing", () => {
  test("rejects wrong tokens, unknown sessions, non-POST and unknown routes", async () => {
    const { post, handle } = setup()
    expect((await post("/lookup", { session_id: "ses_1", action: "guilds" }, "wrong")).status).toBe(401)
    expect((await post("/lookup", { session_id: "nope", action: "guilds" })).status).toBe(404)
    expect((await post("/nothing", { session_id: "ses_1" })).status).toBe(404)
    expect((await handle(new Request("http://127.0.0.1/lookup"))).status).toBe(405)
  })

  test("rejects malformed lookup bodies", async () => {
    const { post } = setup()
    expect((await post("/lookup", { session_id: "ses_1", action: "bogus" })).status).toBe(400)
  })
})

describe("lookup scoping", () => {
  test("search is limited to the thread's own server and defaults to the cache", async () => {
    const { post, remoteCalls } = setup()
    const body = await (await post("/lookup", { session_id: "ses_1", action: "search", query: "deploy" })).json()
    expect(body.messages.map((item: { id: string }) => item.id)).toEqual(["1001"])
    expect(body.source).toBe("cache")
    expect(remoteCalls).toEqual([])
  })

  test("messages defaults to the current thread and refuses other servers", async () => {
    const { post } = setup()
    const own = await (await post("/lookup", { session_id: "ses_1", action: "messages" })).json()
    expect(own.messages.map((item: { id: string }) => item.id)).toEqual(["1001"])
    const other = await (await post("/lookup", { session_id: "ses_1", action: "messages", channel_id: "c9" })).json()
    expect(other.ok).toBe(false)
  })

  test("a cached message from another server is not returned", async () => {
    const { post } = setup()
    const body = await (await post("/lookup", { session_id: "ses_1", action: "message", ref: "1002" })).json()
    expect(body.ok).toBe(false)
  })

  test("member lookups default to the thread's server and refuse a different one", async () => {
    const { post } = setup()
    expect((await (await post("/lookup", { session_id: "ses_1", action: "member", ref: "alice" })).json()).member.id).toBe("m1")
    expect((await (await post("/lookup", { session_id: "ses_1", action: "member", ref: "alice", guild_id: "g2" })).json()).ok).toBe(false)
  })

  test("in a DM the search stays inside the conversation and guild_id must be explicit", async () => {
    const dm = setup({ guildId: null, channelId: "dm1" })
    const search = await (await dm.post("/lookup", { session_id: "ses_1", action: "search", query: "deploy" })).json()
    expect(search.messages).toEqual([])
    expect((await (await dm.post("/lookup", { session_id: "ses_1", action: "members" })).json()).ok).toBe(false)
    expect((await (await dm.post("/lookup", { session_id: "ses_1", action: "members", guild_id: "g1" })).json()).ok).toBe(true)
  })

  test("guilds shows only the current server", async () => {
    const { post } = setup()
    const body = await (await post("/lookup", { session_id: "ses_1", action: "guilds" })).json()
    expect(body.guilds.map((item: { id: string }) => item.id)).toEqual(["g1"])
  })
})

describe("send-file and restart", () => {
  test("sends a file from the project and rejects escapes", async () => {
    const { post, sent } = setup()
    const ok = await (await post("/send-file", { session_id: "ses_1", path: "report.txt", caption: "here" })).json()
    expect(ok).toMatchObject({ ok: true, sent: "report.txt", size: 5 })
    expect(sent[0]).toMatchObject({ channelId: "c1", text: "here" })
    expect(sent[0].files[0].name).toBe("report.txt")

    const escape = await (await post("/send-file", { session_id: "ses_1", path: "../outside.txt" })).json()
    expect(escape.ok).toBe(false)
    expect(sent).toHaveLength(1)
  })

  test("restart is limited to /self sessions", async () => {
    const project = setup()
    expect(await (await project.post("/restart", { session_id: "ses_1", reason: "x" })).json()).toMatchObject({ ok: false })
    expect(project.restarts).toEqual([])

    const self = setup({ kind: "self" })
    expect(await (await self.post("/restart", { session_id: "ses_1", reason: "fix logger" })).json()).toMatchObject({ ok: true })
    expect(self.restarts).toEqual(["fix logger"])
  })
})

describe("settings: changing the model by chat", () => {
  test("a loose request picks the newest matching model and applies it to the thread", async () => {
    const { post, modelChanges } = setup()
    const body = await (await post("/settings", { session_id: "ses_1", action: "set_model", query: "claude sonnet" })).json()
    expect(body).toMatchObject({ ok: true, scope: "thread", model: "anthropic/claude-sonnet-4-6" })
    expect(body.alternatives).toEqual(["anthropic/claude-sonnet-4-5"])
    expect(modelChanges).toEqual([{ scope: "thread", ref: "anthropic/claude-sonnet-4-6" }])
  })

  test("an unknown model changes nothing and lists the connected providers", async () => {
    const { post, modelChanges } = setup()
    const body = await (await post("/settings", { session_id: "ses_1", action: "set_model", query: "llama" })).json()
    expect(body).toMatchObject({ ok: false, available_providers: ["anthropic", "openai"] })
    expect(modelChanges).toEqual([])
  })

  test("with no connected provider it explains how to connect one", async () => {
    const { post, modelChanges } = setup({}, { noModels: true })
    const body = await (await post("/settings", { session_id: "ses_1", action: "set_model", query: "sonnet" })).json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain("ANTHROPIC_API_KEY")
    expect(modelChanges).toEqual([])
  })

  test("only an owner can change the default for new conversations", async () => {
    const stranger = setup({ speakerId: "someone-else" })
    const denied = await (await stranger.post("/settings", { session_id: "ses_1", action: "set_model", query: "sonnet", scope: "default" })).json()
    expect(denied.ok).toBe(false)
    expect(stranger.modelChanges).toEqual([])

    const owner = setup()
    const allowed = await (await owner.post("/settings", { session_id: "ses_1", action: "set_model", query: "sonnet", scope: "default" })).json()
    expect(allowed).toMatchObject({ ok: true, scope: "default" })
    expect(owner.modelChanges).toEqual([{ scope: "default", ref: "anthropic/claude-sonnet-4-6" }])
  })

  test("anyone may change their own thread's model", async () => {
    const { post, modelChanges } = setup({ speakerId: "someone-else" })
    expect((await (await post("/settings", { session_id: "ses_1", action: "set_model", query: "opus" })).json()).ok).toBe(true)
    expect(modelChanges).toEqual([{ scope: "thread", ref: "anthropic/claude-opus-4-6" }])
  })

  test("models lists and filters, get reports, reset clears the override", async () => {
    const { post, modelChanges } = setup()
    const all = await (await post("/settings", { session_id: "ses_1", action: "models" })).json()
    expect(all.total).toBe(4)
    const filtered = await (await post("/settings", { session_id: "ses_1", action: "models", query: "gpt" })).json()
    expect(filtered.models).toEqual(["openai/gpt-5"])
    expect(await (await post("/settings", { session_id: "ses_1", action: "get" })).json()).toMatchObject({ ok: true, thread: null })
    await post("/settings", { session_id: "ses_1", action: "reset_model" })
    expect(modelChanges).toEqual([{ scope: "thread", ref: null }])
  })

  test("set_model without a query is rejected", async () => {
    const { post } = setup()
    expect((await (await post("/settings", { session_id: "ses_1", action: "set_model" })).json()).ok).toBe(false)
  })
})
