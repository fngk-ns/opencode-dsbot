import path from "node:path"
import type { Engine } from "../bridge/opencode"
import type { MemoryStore } from "../memory/store"
import type { Binding, BindingStore } from "../store/bindings"
import { branchableRoot, createWorktree } from "./worktree"

/** The Discord operations branching needs. The discord.js implementation lives in index.ts. */
export type DiscordThreads = {
  /** The text channel a thread belongs to, so a sibling thread can be created next to it. */
  parentOf(threadId: string): string | undefined
  guildOf(channelId: string): string | null
  createThread(parentId: string, name: string): Promise<{ id: string } | { error: string }>
  send(channelId: string, text: string): Promise<void>
  archive(threadId: string): Promise<void>
}

export type BranchDeps = {
  engine: Engine
  bindings: BindingStore
  memory: MemoryStore
  discord: DiscordThreads
  workspaceDir: string
  /** Give each thread its own git branch and worktree when the project is a git repository. */
  branchPerThread: boolean
  /** Starts the first prompt in the new thread. */
  kickoff(binding: Binding, text: string, authorId: string): Promise<void>
}

export type BranchResult =
  | { ok: true; thread: string; session_id: string; directory: string; branch: string | null; inherited_history: boolean }
  | { ok: false; error: string }

/**
 * A thread is a branch of the conversation: it shares the common memory, and when asked it inherits this
 * conversation's history and starts on its own git branch cut from the current commit.
 */
export async function branchThread(
  deps: BranchDeps,
  input: { from: Binding; title: string; history: boolean; prompt?: string; speakerId: string },
): Promise<BranchResult> {
  const parentId = deps.discord.parentOf(input.from.channel_id)
  if (!parentId) return { ok: false, error: "can only branch from a thread inside a server channel" }
  if (input.from.kind === "self") return { ok: false, error: "a /self session edits the bot's own code and cannot be branched" }

  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 90) || "branch"
  const created = await deps.discord.createThread(parentId, title)
  if ("error" in created) return { ok: false, error: created.error }

  const workdir = await workingCopy(deps, input.from, title, created.id)
  const sessionId = await (input.history ? deps.engine.fork(input.from.session_id, workdir.directory) : deps.engine.createSession(workdir.directory, title)).catch(
    (error: unknown) => error as Error,
  )
  if (sessionId instanceof Error) {
    await deps.discord.send(created.id, `세션을 만들지 못했습니다: ${sessionId.message}`).catch(() => undefined)
    return { ok: false, error: sessionId.message }
  }

  const binding: Binding = {
    channel_id: created.id,
    session_id: sessionId,
    directory: workdir.directory,
    kind: "project",
    owner_id: input.speakerId,
    model: input.from.model,
    agent: input.from.agent,
    created_at: Date.now(),
  }
  deps.bindings.set(binding)
  deps.memory.openThread({
    thread_id: created.id,
    guild_id: deps.discord.guildOf(input.from.channel_id),
    title,
    parent_thread: input.from.channel_id,
    project: projectDir(deps.workspaceDir, input.from.directory),
    directory: workdir.directory,
    branch: workdir.branch,
  })

  await deps.discord.send(
    created.id,
    [
      `🌿 <#${input.from.channel_id}> 에서 분기된 스레드입니다.`,
      input.history ? "대화 기록을 이어받았고, 이 스레드의 변경은 원본에 영향을 주지 않습니다." : "새 대화로 시작합니다. 공통 메모리는 그대로 보입니다.",
      workdir.branch ? `git 브랜치 \`${workdir.branch}\` · 작업 폴더 \`${workdir.directory}\`` : "",
      "note" in workdir ? `⚠️ ${workdir.note}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  )
  await deps.discord.send(input.from.channel_id, `🌿 <#${created.id}> 로 분기했어요.`).catch(() => undefined)
  if (input.prompt) await deps.kickoff(binding, input.prompt, input.speakerId)

  return { ok: true, thread: `<#${created.id}>`, session_id: sessionId, directory: workdir.directory, branch: workdir.branch, inherited_history: input.history }
}

/**
 * A new thread's working copy: its own git worktree when possible, otherwise the shared project folder.
 * `note` explains a fallback, so a thread never silently ends up sharing files it was meant to isolate.
 */
export async function workingCopy(deps: Pick<BranchDeps, "branchPerThread" | "workspaceDir">, from: Pick<Binding, "directory">, title: string, threadId: string) {
  const shared = { directory: from.directory, branch: null }
  if (!deps.branchPerThread) return shared
  const repo = await branchableRoot(from.directory)
  if (!repo) return shared
  const project = projectDir(deps.workspaceDir, from.directory)
  const made = await createWorktree({ repo, root: path.join(deps.workspaceDir, ".worktrees"), project, title, id: threadId })
  if (made.ok) return { directory: made.directory, branch: made.branch }
  return { ...shared, note: `git 브랜치를 만들지 못해 원본과 같은 폴더를 씁니다: ${made.error}` }
}

/** Project name for a directory under the workspace: the first path segment (worktrees live under .worktrees/<project>/). */
export function projectDir(workspaceDir: string, directory: string) {
  const relative = path.relative(workspaceDir, directory)
  const parts = relative.split(path.sep)
  return (parts[0] === ".worktrees" ? parts[1] : parts[0]) || "default"
}
