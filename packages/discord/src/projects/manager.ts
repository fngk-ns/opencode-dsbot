import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import type { MemoryStore } from "../memory/store"
import { run } from "../self/update"
import type { ProjectRecord, ProjectStore } from "./store"

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

// Commits made by the bot, kept apart from anyone's own git identity.
const IDENTITY = {
  GIT_AUTHOR_NAME: "opencode-discord",
  GIT_AUTHOR_EMAIL: "opencode-discord@localhost",
  GIT_COMMITTER_NAME: "opencode-discord",
  GIT_COMMITTER_EMAIL: "opencode-discord@localhost",
}

export type FinishResult =
  | { ok: true; merged: boolean; commit: string; files: string[]; trunk: string; note: string }
  | { ok: false; reason: "conflict"; where: "branch" | "trunk"; files: string[]; hint: string }
  | { ok: false; reason: "error"; error: string }

export type CreateResult = { ok: true; project: ProjectRecord } | { ok: false; error: string }

/**
 * Projects are git repositories under the workspace. The checkout in the project folder is trunk: nobody edits it directly.
 * Each thread works on its own branch in a separate worktree, and `finish` brings the branch into trunk, so the next
 * thread, in any channel, starts from everything the earlier ones built.
 */
export class ProjectManager {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly deps: {
      store: ProjectStore
      workspaceDir: string
      memory: MemoryStore
    },
  ) {}

  async create(input: { name: string; title?: string; description?: string; aliases?: string[]; createdBy?: string | null; thread?: string | null }): Promise<CreateResult> {
    if (!NAME.test(input.name)) return { ok: false, error: "project name must be lowercase letters, digits and dashes (max 40 characters)" }
    if (this.deps.store.get(input.name)) return { ok: false, error: `project "${input.name}" already exists; use open` }

    const directory = path.join(this.deps.workspaceDir, input.name)
    await mkdir(directory, { recursive: true })
    if ((await readdir(directory)).length > 0) return { ok: false, error: `${directory} already exists and is not empty` }

    const steps: string[][] = [["init", "-q"], ["symbolic-ref", "HEAD", "refs/heads/main"]]
    for (const args of steps) {
      const result = await this.git(directory, args)
      if (result.code !== 0) return { ok: false, error: `git ${args[0]} failed: ${result.output.slice(0, 300)}` }
    }
    await Bun.write(path.join(directory, ".gitignore"), "node_modules\n.env\n.DS_Store\n")
    for (const args of [["add", "-A"], ["commit", "-q", "-m", "init"]]) {
      const result = await this.git(directory, args)
      if (result.code !== 0) return { ok: false, error: `git ${args[0]} failed: ${result.output.slice(0, 300)}` }
    }

    const project = this.deps.store.create({
      name: input.name,
      title: input.title ?? null,
      description: input.description ?? null,
      directory,
      aliases: input.aliases ?? [],
      created_by: input.createdBy ?? null,
      last_thread: input.thread ?? null,
    })
    return { ok: true, project }
  }

  /**
   * Merges a thread's branch into trunk. Trunk is merged into the branch first, so a conflict is resolved where the
   * agent is working (the worktree is left mid-merge for it to finish) and trunk itself never ends up half-merged.
   */
  finish(input: { project: string; worktree: string; branch: string; title: string; summary: string; threadId: string }) {
    return this.serialized(input.project, () => this.merge(input))
  }

  private async merge(input: { project: string; worktree: string; branch: string; title: string; summary: string; threadId: string }): Promise<FinishResult> {
    const project = this.deps.store.get(input.project)
    if (!project) return { ok: false, reason: "error", error: `unknown project: ${input.project}` }
    const trunk = project.directory
    const message = `${input.title}: ${input.summary}`.replace(/\s+/g, " ").slice(0, 200)

    const dirty = await this.git(input.worktree, ["status", "--porcelain"])
    if (dirty.output.trim()) {
      const committed = await this.all(input.worktree, [["add", "-A"], ["commit", "-q", "-m", message]])
      if (committed) return { ok: false, reason: "error", error: `could not commit the worktree: ${committed}` }
    }

    const trunkBranch = (await this.git(trunk, ["symbolic-ref", "--short", "HEAD"])).output.trim() || "main"
    const synced = await this.git(input.worktree, ["merge", "--no-edit", "-m", `sync with ${trunkBranch}`, trunkBranch])
    if (synced.code !== 0) {
      const files = await this.conflicts(input.worktree)
      if (files.length > 0)
        return { ok: false, reason: "conflict", where: "branch", files, hint: `Resolve the conflicts in ${input.worktree} (edit the files, git add them, git commit), then call finish again.` }
      await this.git(input.worktree, ["merge", "--abort"])
      return { ok: false, reason: "error", error: `could not bring ${trunkBranch} into the branch: ${synced.output.slice(0, 300)}` }
    }

    const ahead = Number((await this.git(trunk, ["rev-list", "--count", `${trunkBranch}..${input.branch}`])).output.trim())
    if (!ahead) return { ok: true, merged: false, commit: (await this.git(trunk, ["rev-parse", "--short", "HEAD"])).output.trim(), files: [], trunk, note: "nothing new to merge; trunk already has this branch's work" }

    if ((await this.git(trunk, ["status", "--porcelain"])).output.trim()) return { ok: false, reason: "error", error: `the trunk checkout ${trunk} has uncommitted changes; an owner has to clean it up` }

    const before = (await this.git(trunk, ["rev-parse", "HEAD"])).output.trim()
    const merged = await this.git(trunk, ["merge", "--no-ff", "--no-edit", "-m", `merge ${input.branch}: ${message}`, input.branch])
    if (merged.code !== 0) {
      const files = await this.conflicts(trunk)
      await this.git(trunk, ["merge", "--abort"])
      return files.length > 0
        ? { ok: false, reason: "conflict", where: "trunk", files, hint: "trunk changed while merging; call finish again to pick up the latest changes." }
        : { ok: false, reason: "error", error: merged.output.slice(0, 300) }
    }

    const files = (await this.git(trunk, ["diff", "--name-only", before, "HEAD"])).output.split("\n").filter(Boolean)
    const commit = (await this.git(trunk, ["rev-parse", "--short", "HEAD"])).output.trim()
    this.record(project, input, files, commit)
    return { ok: true, merged: true, commit, files, trunk, note: `merged into ${trunkBranch}. Deploy from ${trunk} if this project is served.` }
  }

  /** Writes what changed into the registry and the shared memory, which is how a later thread knows about this work. */
  private record(project: ProjectRecord, input: { title: string; summary: string; threadId: string }, files: string[], commit: string) {
    this.deps.store.update(project.name, { summary: input.summary, last_thread: input.threadId })
    const day = new Date().toISOString().slice(0, 10)
    this.deps.memory.save({
      scope: `project:${project.name}`,
      kind: "note",
      title: `${day} ${input.title}`.slice(0, 120),
      body: `${input.summary} (commit ${commit}; ${files.length} files: ${files.slice(0, 8).join(", ")}${files.length > 8 ? ", …" : ""})`.slice(0, 1500),
      source_thread: input.threadId,
    })
  }

  private async conflicts(directory: string) {
    return (await this.git(directory, ["diff", "--name-only", "--diff-filter=U"])).output.split("\n").filter(Boolean)
  }

  private git(directory: string, args: string[]) {
    return run(["git", ...args], directory, 60_000, IDENTITY)
  }

  /** Runs git commands in order and returns the first failure's output. */
  private async all(directory: string, commands: string[][]) {
    for (const args of commands) {
      const result = await this.git(directory, args)
      if (result.code !== 0) return result.output.slice(0, 300)
    }
    return undefined
  }

  /** Merges into one project must not overlap, or git's own index lock would fail one of them. */
  private serialized<T>(key: string, work: () => Promise<T>) {
    const next = (this.locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(work)
    this.locks.set(key, next)
    return next
  }
}
