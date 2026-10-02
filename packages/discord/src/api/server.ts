import { timingSafeEqual } from "node:crypto"
import { z } from "zod"
import type { createLookup } from "../cache/lookup"
import { resolveSendable } from "../discord/files"
import type { OutFile } from "../discord/outbound"
import type { BindingKind } from "../store/bindings"

export type Lookup = ReturnType<typeof createLookup>

/** What the bot knows about the Discord thread behind an opencode session. */
export type ApiContext = {
  channelId: string
  guildId: string | null
  directory: string
  kind: BindingKind
}

export type ApiDeps = {
  token: string
  lookup: Lookup
  context(sessionId: string): ApiContext | undefined
  guildOfChannel(channelId: string): string | null | undefined
  roots(context: ApiContext): string[]
  maxUploadBytes: number
  send(channelId: string, text: string, files: OutFile[]): Promise<void>
  restart(context: ApiContext, reason: string): Promise<{ ok: boolean; message: string }>
}

const lookupBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), ref: z.string(), channel_id: z.string().optional() }),
  z.object({
    action: z.literal("messages"),
    channel_id: z.string().optional(),
    limit: z.number().optional(),
    before: z.string().optional(),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().optional(),
    channel_id: z.string().optional(),
    author_id: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    include_deleted: z.boolean().optional(),
    limit: z.number().optional(),
  }),
  z.object({ action: z.literal("member"), ref: z.string(), guild_id: z.string().optional() }),
  z.object({
    action: z.literal("members"),
    guild_id: z.string().optional(),
    query: z.string().optional(),
    role_id: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  z.object({ action: z.literal("channels"), guild_id: z.string().optional(), query: z.string().optional() }),
  z.object({ action: z.literal("roles"), guild_id: z.string().optional() }),
  z.object({ action: z.literal("guilds") }),
])

const withSession = { session_id: z.string() }
const sendFileBody = z.object({ ...withSession, path: z.string(), caption: z.string().optional() })
const restartBody = z.object({ ...withSession, reason: z.string().min(1) })

/**
 * HTTP surface for the custom opencode tools. It listens on loopback only and needs the bearer token that the bot
 * hands to the opencode server it spawned. Every call is tied to a session so it can be scoped to that thread's guild.
 */
export function createApiHandler(deps: ApiDeps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return reply(405, { ok: false, error: "method not allowed" })
    if (!authorized(request.headers.get("authorization"), deps.token)) return reply(401, { ok: false, error: "unauthorized" })

    const body: unknown = await request.json().catch(() => undefined)
    const sessionId = (body as { session_id?: unknown } | undefined)?.session_id
    const context = typeof sessionId === "string" ? deps.context(sessionId) : undefined
    if (!context) return reply(404, { ok: false, error: "unknown session" })

    const route = new URL(request.url).pathname
    if (route === "/lookup") return lookup(deps, context, body)
    if (route === "/send-file") return sendFile(deps, context, body)
    if (route === "/restart") return restart(deps, context, body)
    return reply(404, { ok: false, error: "not found" })
  }
}

export function startApi(deps: ApiDeps) {
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createApiHandler(deps) })
}

async function lookup(deps: ApiDeps, context: ApiContext, raw: unknown) {
  const parsed = lookupBody.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const input = parsed.data

  // A thread may only see data from its own guild. In a DM there is no guild, so an explicit guild_id is accepted.
  const guildFor = (requested: string | undefined) => {
    const guildId = requested ?? context.guildId ?? undefined
    if (!guildId) return { error: "guild_id is required outside a server" }
    if (context.guildId && guildId !== context.guildId) return { error: "this thread can only read its own server" }
    return { guildId }
  }

  if (input.action === "message") {
    const result = await deps.lookup.message({ ref: input.ref, channel_id: input.channel_id ?? context.channelId })
    if (result.ok && (result.message.guild_id ?? null) !== context.guildId && context.guildId)
      return reply(200, { ok: false, error: "that message belongs to another server" })
    return reply(200, result)
  }

  if (input.action === "messages") {
    const channelId = input.channel_id ?? context.channelId
    const sameServer = context.guildId !== null && deps.guildOfChannel(channelId) === context.guildId
    if (channelId !== context.channelId && !sameServer)
      return reply(200, { ok: false, error: "unknown channel or a channel in another server" })
    return reply(200, deps.lookup.messages({ channel_id: channelId, limit: input.limit, before: input.before }))
  }

  if (input.action === "search") {
    // Without a guild (DM) the search is limited to the current conversation.
    return reply(
      200,
      deps.lookup.search({
        query: input.query,
        channel_id: context.guildId ? input.channel_id : context.channelId,
        guild_id: context.guildId ?? undefined,
        author_id: input.author_id,
        since: input.since ? Date.parse(input.since) : undefined,
        until: input.until ? Date.parse(input.until) : undefined,
        include_deleted: input.include_deleted,
        limit: input.limit,
      }),
    )
  }

  if (input.action === "guilds") {
    const all = deps.lookup.guilds()
    return reply(200, context.guildId ? { ...all, guilds: all.guilds.filter((item) => item.id === context.guildId) } : all)
  }

  const scope = guildFor(input.guild_id)
  if ("error" in scope) return reply(200, { ok: false, error: scope.error })
  if (input.action === "member") return reply(200, deps.lookup.member({ guild_id: scope.guildId, ref: input.ref }))
  if (input.action === "members") return reply(200, deps.lookup.memberList({ ...input, guild_id: scope.guildId }))
  if (input.action === "channels") return reply(200, deps.lookup.channels({ guild_id: scope.guildId, query: input.query }))
  return reply(200, deps.lookup.roles({ guild_id: scope.guildId }))
}

async function sendFile(deps: ApiDeps, context: ApiContext, raw: unknown) {
  const parsed = sendFileBody.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const file = await resolveSendable({
    requested: parsed.data.path,
    baseDirectory: context.directory,
    roots: deps.roots(context),
    maxBytes: deps.maxUploadBytes,
  })
  if (!file.ok) return reply(200, file)
  await deps.send(context.channelId, parsed.data.caption ?? "", [{ attachment: file.path, name: file.name }])
  return reply(200, { ok: true, sent: file.name, size: file.size })
}

async function restart(deps: ApiDeps, context: ApiContext, raw: unknown) {
  const parsed = restartBody.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  if (context.kind !== "self") return reply(200, { ok: false, error: "restart is only available in a /self session" })
  return reply(200, await deps.restart(context, parsed.data.reason))
}

function authorized(header: string | null, token: string) {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "")
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

function reply(status: number, payload: object) {
  return Response.json(payload, { status })
}
