import path from "node:path"
import type { Engine } from "../bridge/opencode"
import { digestKey } from "../memory/compaction"
import type { MemoryStore } from "../memory/store"
import type { Binding, BindingStore, KeyValueStore } from "../store/bindings"
import { workingCopy } from "../threads/branch"
import type { ProjectRecord } from "./store"

export const HOME_DIR = "_home"

/** What the user has asked in this thread so far; the new session cannot see the old one's history. */
export const requestsKey = (channelId: string) => `requests:${channelId}`
export const uploadsKey = (channelId: string) => `uploads:${channelId}`

export type SwitchDeps = {
  engine: Engine
  bindings: BindingStore
  memory: MemoryStore
  kv: KeyValueStore
  workspaceDir: string
  branchPerThread: boolean
  /** Stops tracking the old session and closes its card. */
  moveAway(sessionId: string): Promise<void>
  /** Sends a prompt into the (new) session of a thread. */
  prompt(binding: Binding, text: string, authorId: string): Promise<void>
  announce(channelId: string, input: { name: string; title: string | null; branch: string | null; directory: string; created: boolean; summary: string | null }): Promise<void>
}

export type SwitchResult = { ok: true; directory: string; branch: string | null; trunk: string } | { ok: false; error: string }

/**
 * Moves a thread into a project: its own git branch and worktree, a fresh agent session working there, and the thread's
 * instructions so far handed over. The thread stays the same Discord thread; only the agent behind it changes.
 */
export async function switchToProject(
  deps: SwitchDeps,
  input: { binding: Binding; project: ProjectRecord; created: boolean; speakerId: string },
): Promise<SwitchResult> {
  const { binding, project } = input
  const title = deps.memory.thread(binding.channel_id)?.title ?? project.title ?? project.name

  const copy = await workingCopy(deps, { directory: project.directory }, title, binding.channel_id)
  // Trunk is never edited directly. If a branch was wanted and could not be made, stop instead of falling back to it.
  if (deps.branchPerThread && !copy.branch) return { ok: false, error: "note" in copy ? copy.note : "could not create a git branch for this thread" }

  const sessionId = await deps.engine.createSession(copy.directory, title).catch((error: unknown) => error as Error)
  if (sessionId instanceof Error) return { ok: false, error: sessionId.message }

  const moved: Binding = { ...binding, session_id: sessionId, directory: copy.directory }
  deps.bindings.set(moved)
  deps.memory.openThread({ thread_id: binding.channel_id, guild_id: deps.memory.thread(binding.channel_id)?.guild_id ?? null, title, project: project.name, directory: copy.directory, branch: copy.branch })
  deps.kv.delete(digestKey(sessionId))

  await deps.announce(binding.channel_id, { name: project.name, title: project.title, branch: copy.branch, directory: copy.directory, created: input.created, summary: project.summary })
  const handoff = handoffText(deps.kv, binding.channel_id, project, copy)

  // The tool call that triggered this is still running in the old session. Let it return first, then retire that session.
  setTimeout(() => void deps.moveAway(binding.session_id).then(() => deps.prompt(moved, handoff, input.speakerId)).catch((error: unknown) => console.warn("[project] handoff failed:", error)), 100)
  return { ok: true, directory: copy.directory, branch: copy.branch, trunk: project.directory }
}

export function handoffText(kv: KeyValueStore, channelId: string, project: ProjectRecord, copy: { directory: string; branch: string | null }) {
  const requests = JSON.parse(kv.get(requestsKey(channelId)) ?? "[]") as string[]
  const uploads = JSON.parse(kv.get(uploadsKey(channelId)) ?? "[]") as string[]
  return [
    `You were moved into project "${project.name}"${project.title ? ` (${project.title})` : ""}. Your working directory is now ${copy.directory}${copy.branch ? `, on git branch ${copy.branch}` : ""}.`,
    `Trunk is ${project.directory}: never edit it directly; call discord_project finish when your work is done and it will be merged there.`,
    project.summary ? `Last change to this project: ${project.summary}` : "",
    "",
    "The user's instructions in this thread so far (oldest first):",
    ...requests.map((request, index) => `${index + 1}. ${request}`),
    uploads.length > 0 ? `\nFiles the user attached: ${uploads.join(", ")}` : "",
    "",
    "Continue with that task now. Do not ask the user to repeat anything.",
  ]
    .filter((line) => line !== "")
    .join("\n")
}

/** Directory for a thread that is not in a project yet. */
export function homeDirectory(workspaceDir: string) {
  return path.join(workspaceDir, HOME_DIR)
}
