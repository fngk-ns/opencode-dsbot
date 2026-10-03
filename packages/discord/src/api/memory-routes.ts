import { z } from "zod"
import { scopesFor, type MemoryEntry, type MemoryStore } from "../memory/store"
import { reply, type ApiContext } from "./shared"

const kinds = z.enum(["fact", "preference", "decision", "task", "note"])
const statuses = z.enum(["active", "open", "done", "blocked", "archived"])
const scopes = z.enum(["global", "guild", "project", "thread"])

const body = z.object({
  session_id: z.string(),
  action: z.enum(["save", "update", "forget", "get", "search", "list", "threads"]),
  scope: scopes.optional(),
  kind: kinds.optional(),
  status: statuses.optional(),
  title: z.string().min(1).max(120).optional(),
  body: z.string().max(4000).optional(),
  pinned: z.boolean().optional(),
  id: z.number().int().optional(),
  query: z.string().optional(),
  limit: z.number().optional(),
})

export type MemoryDeps = {
  memory: MemoryStore
  isOwner(userId: string | null): boolean
}

export function visibleScopes(context: ApiContext) {
  return scopesFor({ guildId: context.guildId, project: context.project, threadId: context.channelId })
}

/**
 * Memory is replayed into future prompts, so what anyone in a channel can make the agent write there is a
 * prompt-injection risk. Writing to a scope that every conversation shares (global, server) therefore needs an owner.
 */
export function memoryRoute(deps: MemoryDeps, context: ApiContext, raw: unknown) {
  const parsed = body.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const input = parsed.data
  const owner = deps.isOwner(context.speakerId)
  const visible = visibleScopes(context)

  const scopeName = (scope: z.infer<typeof scopes>) => {
    if (scope === "global") return "global"
    if (scope === "guild") return context.guildId ? `guild:${context.guildId}` : undefined
    if (scope === "project") return context.project ? `project:${context.project}` : undefined
    return `thread:${context.channelId}`
  }
  const shared = (scope: string) => scope === "global" || scope.startsWith("guild:")

  if (input.action === "save") {
    // Without an explicit scope, notes belong to the project, or to this thread when it is not in a project.
    const scope = scopeName(input.scope ?? (context.project ? "project" : "thread"))
    if (!scope) return reply(200, { ok: false, error: "that scope does not exist here (no server in a DM, or this thread is not in a project)" })
    if (shared(scope) && !owner) return reply(200, { ok: false, error: "only an owner can save to the shared (global/server) memory; use scope project or thread" })
    if (!input.title || !input.body) return reply(200, { ok: false, error: "title and body are required" })
    const entry = deps.memory.save({
      scope,
      kind: input.kind ?? "fact",
      title: input.title,
      body: input.body,
      status: input.status,
      pinned: owner ? input.pinned : false,
      source_thread: context.channelId,
      author_id: context.speakerId,
    })
    return reply(200, { ok: true, entry: present(entry) })
  }

  if (input.action === "update" || input.action === "forget" || input.action === "get") {
    const entry = input.id === undefined ? undefined : deps.memory.get(input.id)
    if (!entry || !visible.includes(entry.scope)) return reply(200, { ok: false, error: "no such memory entry in this conversation" })
    if (input.action === "get") return reply(200, { ok: true, entry: present(entry) })
    if (shared(entry.scope) && !owner) return reply(200, { ok: false, error: "only an owner can change shared (global/server) memory" })
    const next =
      input.action === "forget"
        ? deps.memory.forget(entry.id)
        : deps.memory.update(entry.id, { title: input.title, body: input.body, status: input.status, pinned: owner ? input.pinned : undefined })
    return reply(200, { ok: true, entry: next && present(next) })
  }

  if (input.action === "threads") {
    const found = deps.memory.threads({ guildId: context.guildId, query: input.query, limit: input.limit })
    return reply(200, {
      ok: true,
      threads: found.map((thread) => ({
        thread: `<#${thread.thread_id}>`,
        title: thread.title,
        state: thread.state,
        parent: thread.parent_thread ? `<#${thread.parent_thread}>` : null,
        branch: thread.branch,
        turns: thread.turns,
        last_request: thread.last_request,
        summary: thread.summary,
      })),
    })
  }

  if (input.action === "search") {
    if (!input.query) return reply(200, { ok: false, error: "query is required" })
    const found = deps.memory.search({ query: input.query, scopes: visible, includeArchived: input.status === "archived", limit: input.limit })
    return reply(200, { ok: true, entries: found.map(present) })
  }

  const found = deps.memory.list({
    scopes: input.scope ? [scopeName(input.scope) ?? ""] : visible,
    kinds: input.kind ? [input.kind] : undefined,
    statuses: input.status ? [input.status] : undefined,
    limit: input.limit,
  })
  return reply(200, { ok: true, entries: found.map(present) })
}

function present(entry: MemoryEntry) {
  return {
    id: entry.id,
    scope: entry.scope,
    kind: entry.kind,
    status: entry.status,
    pinned: entry.pinned,
    title: entry.title,
    body: entry.body,
    updated_at: new Date(entry.updated_at).toISOString(),
  }
}
