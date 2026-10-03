import { timingSafeEqual } from "node:crypto"
import { z } from "zod"
import type { createLookup } from "../cache/lookup"
import { resolveSendable } from "../discord/files"
import type { OutFile } from "../discord/outbound"
import { matchModels, type ModelInfo } from "../models"
import type { MemoryStore } from "../memory/store"
import type { ServiceManager } from "../services/manager"
import { memoryRoute } from "./memory-routes"
import { reply, type ApiContext } from "./shared"
import { projectRoute, type ProjectDeps } from "./project-routes"
import { serviceRoute, type ServiceDeps } from "./service-routes"
import { adminRoute, type AdminRouteDeps } from "./admin-routes"
import { threadRoute, type ThreadDeps } from "./thread-routes"

export type Lookup = ReturnType<typeof createLookup>

export type { ApiContext } from "./shared"

export type ApiDeps = AdminRouteDeps & ThreadDeps & ProjectDeps & Pick<ServiceDeps, "confirmServices" | "announceService"> & {
  token: string
  memory: MemoryStore
  services: ServiceManager
  lookup: Lookup
  context(sessionId: string): ApiContext | undefined
  guildOfChannel(channelId: string): string | null | undefined
  roots(context: ApiContext): string[]
  maxUploadBytes: number
  send(channelId: string, text: string, files: OutFile[]): Promise<void>
  restart(context: ApiContext, reason: string): Promise<{ ok: boolean; message: string }>
  models(directory: string): Promise<ModelInfo[]>
  currentModels(context: ApiContext): { thread: string | null; default: string | null }
  setModel(context: ApiContext, scope: "thread" | "default", ref: string | null): void
  isOwner(userId: string | null): boolean
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
const settingsBody = z.object({
  ...withSession,
  action: z.enum(["models", "get", "set_model", "reset_model"]),
  query: z.string().optional(),
  scope: z.enum(["thread", "default"]).optional(),
})

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
    if (route === "/settings") return settings(deps, context, body)
    if (route === "/memory") return memoryRoute(deps, context, body)
    if (route === "/services") return serviceRoute(deps, context, body)
    if (route === "/admin") return adminRoute(deps, context, body)
    if (route === "/threads") return threadRoute(deps, context, body)
    if (route === "/projects") return projectRoute(deps, context, body)
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

async function settings(deps: ApiDeps, context: ApiContext, raw: unknown) {
  const parsed = settingsBody.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const input = parsed.data
  const scope = input.scope ?? "thread"

  if (input.action === "get") return reply(200, { ok: true, ...deps.currentModels(context) })

  const models = await deps.models(context.directory)
  if (input.action === "models") {
    const found = input.query ? matchModels(input.query, models) : models
    return reply(200, { ok: true, total: found.length, models: found.slice(0, 40).map((item) => item.ref) })
  }

  // Everything below changes which model answers, so it needs a connected provider and, for the default, an owner.
  if (scope === "default" && !deps.isOwner(context.speakerId))
    return reply(200, { ok: false, error: "only an owner can change the default model for new conversations; use scope=thread" })

  if (input.action === "reset_model") {
    deps.setModel(context, scope, null)
    return reply(200, { ok: true, scope, message: "model override removed; the default is used again" })
  }

  if (!input.query) return reply(200, { ok: false, error: "query is required, for example \"claude sonnet\"" })
  if (models.length === 0)
    return reply(200, { ok: false, error: "no model provider is connected; set a provider API key (for example ANTHROPIC_API_KEY) or run opencode auth login on the host" })
  const matches = matchModels(input.query, models)
  const best = matches[0]
  if (!best)
    return reply(200, {
      ok: false,
      error: `no connected model matches "${input.query}"`,
      available_providers: [...new Set(models.map((item) => item.provider))],
    })
  deps.setModel(context, scope, best.ref)
  return reply(200, {
    ok: true,
    scope,
    model: best.ref,
    name: best.name,
    alternatives: matches.slice(1, 5).map((item) => item.ref),
    note: "Takes effect from the next message; the reply being written now still uses the previous model.",
  })
}

function authorized(header: string | null, token: string) {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "")
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
