import { z } from "zod"
import type { ProjectManager } from "../projects/manager"
import type { ProjectStore } from "../projects/store"
import type { SwitchResult } from "../projects/switch"
import type { ServiceSummary } from "../memory/digest"
import { reply, type ApiContext } from "./shared"

const body = z.object({
  session_id: z.string(),
  action: z.enum(["list", "find", "create", "open", "finish", "info", "describe"]),
  name: z.string().optional(),
  title: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  aliases: z.array(z.string().max(40)).max(12).optional(),
  query: z.string().optional(),
  summary: z.string().max(1500).optional(),
})

export type ProjectDeps = {
  projects: ProjectStore
  manager: ProjectManager
  serviceSummaries(): ServiceSummary[]
  /** Moves this thread into the project. Implemented by switchToProject. */
  moveThread(context: ApiContext, projectName: string, created: boolean): Promise<SwitchResult>
}

/** The tool that lets the agent find, create and enter projects, and hand finished work back to trunk. */
export async function projectRoute(deps: ProjectDeps, context: ApiContext, raw: unknown) {
  const parsed = body.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const input = parsed.data
  const present = (name: string) => {
    const project = deps.projects.get(name)
    if (!project) return undefined
    const service = deps.serviceSummaries().find((item) => item.project === name)
    return {
      name: project.name,
      title: project.title,
      description: project.description,
      aliases: project.aliases,
      trunk: project.directory,
      url: service?.url ?? null,
      service: service?.name ?? null,
      last_change: project.summary,
      updated_at: new Date(project.updated_at).toISOString(),
    }
  }

  if (input.action === "list") return reply(200, { ok: true, projects: deps.projects.list().map((item) => present(item.name)) })

  if (input.action === "find") {
    if (!input.query) return reply(200, { ok: false, error: "query is required" })
    return reply(200, { ok: true, candidates: deps.projects.find(input.query).slice(0, 5).map((item) => ({ ...present(item.project.name), score: item.score })) })
  }

  if (input.action === "info") {
    const current = context.project ? present(context.project) : undefined
    return reply(200, { ok: true, project: current ?? null, worktree: context.directory, branch: context.branch, trunk: context.trunk })
  }

  if (input.action === "describe") {
    const name = input.name ?? context.project
    if (!name || !deps.projects.get(name)) return reply(200, { ok: false, error: "unknown project" })
    deps.projects.update(name, { title: input.title, description: input.description, aliases: input.aliases })
    return reply(200, { ok: true, project: present(name) })
  }

  if (input.action === "create") {
    if (!input.name) return reply(200, { ok: false, error: "name is required (lowercase letters, digits, dashes)" })
    const created = await deps.manager.create({ name: input.name, title: input.title, description: input.description, aliases: input.aliases, createdBy: context.speakerId, thread: context.channelId })
    if (!created.ok) return reply(200, created)
    const moved = await deps.moveThread(context, input.name, true)
    return reply(200, moved.ok ? { ok: true, created: true, ...entered(moved) } : { ok: false, error: `project created but this thread could not enter it: ${moved.error}` })
  }

  if (input.action === "open") {
    if (!input.name || !deps.projects.get(input.name)) {
      const near = input.name ? deps.projects.find(input.name).slice(0, 3).map((item) => item.project.name) : []
      return reply(200, { ok: false, error: `unknown project${input.name ? ` "${input.name}"` : ""}`, did_you_mean: near, all: deps.projects.list().map((item) => item.name) })
    }
    if (context.project === input.name && context.branch) return reply(200, { ok: true, already: true, note: "this thread is already working on that project", worktree: context.directory, branch: context.branch })
    const moved = await deps.moveThread(context, input.name, false)
    return reply(200, moved.ok ? { ok: true, ...entered(moved) } : { ok: false, error: moved.error })
  }

  // finish
  if (!context.project || !context.branch) return reply(200, { ok: false, error: "this thread is not working on a project branch; call create or open first" })
  if (!input.summary) return reply(200, { ok: false, error: "summary is required: one or two sentences on what changed, for the project's history" })
  const result = await deps.manager.finish({
    project: context.project,
    worktree: context.directory,
    branch: context.branch,
    title: input.title ?? context.project,
    summary: input.summary,
    threadId: context.channelId,
  })
  return reply(200, result)
}

function entered(moved: Extract<SwitchResult, { ok: true }>) {
  return {
    message: "You are being moved into the project now. STOP here: end your turn without further tool calls; a fresh session continues the task in the new working directory.",
    worktree: moved.directory,
    branch: moved.branch,
    trunk: moved.trunk,
  }
}
