import { z } from "zod"
import type { MemoryStore } from "../memory/store"
import type { BranchResult } from "../threads/branch"
import { reply, type ApiContext } from "./shared"

const body = z.object({
  session_id: z.string(),
  action: z.enum(["fork", "new", "info", "list", "close"]),
  title: z.string().min(1).max(100).optional(),
  prompt: z.string().max(4000).optional(),
  query: z.string().optional(),
  limit: z.number().optional(),
})

export type ThreadDeps = {
  memory: MemoryStore
  branch(context: ApiContext, input: { title: string; history: boolean; prompt?: string }): Promise<BranchResult>
  close(context: ApiContext): Promise<{ ok: boolean; message: string }>
}

export async function threadRoute(deps: ThreadDeps, context: ApiContext, raw: unknown) {
  const parsed = body.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const input = parsed.data

  if (input.action === "info") {
    const thread = deps.memory.thread(context.channelId)
    return reply(200, thread ? { ok: true, thread } : { ok: false, error: "this conversation has no journal entry yet" })
  }
  if (input.action === "list") {
    const found = deps.memory.threads({ guildId: context.guildId, query: input.query, limit: input.limit })
    return reply(200, { ok: true, threads: found })
  }
  if (input.action === "close") return reply(200, await deps.close(context))

  if (!input.title) return reply(200, { ok: false, error: "title is required" })
  return reply(200, await deps.branch(context, { title: input.title, history: input.action === "fork", prompt: input.prompt }))
}
