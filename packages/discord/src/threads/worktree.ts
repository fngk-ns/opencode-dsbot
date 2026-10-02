import { mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { run } from "../self/update"

async function git(cwd: string, ...args: string[]) {
  return run(["git", ...args], cwd, 30_000)
}

/** The repository root when `directory` is itself the root of a git repo that already has a commit; otherwise nothing. */
export async function branchableRoot(directory: string) {
  const top = await git(directory, "rev-parse", "--show-toplevel")
  if (top.code !== 0) return
  const [root, here] = await Promise.all([realpath(top.output), realpath(directory)])
  if (root !== here) return
  const head = await git(directory, "rev-parse", "--verify", "HEAD")
  return head.code === 0 ? here : undefined
}

export function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "thread"
  )
}

/**
 * Gives a thread its own git branch and working copy, branching from whatever `repo` currently has checked out.
 * Worktrees live outside the repository, so they never show up as untracked files.
 */
export async function createWorktree(input: { repo: string; root: string; project: string; title: string; id: string }) {
  const name = `${slugify(input.title)}-${input.id.replace(/[^a-z0-9]/gi, "").slice(-6)}`
  const branch = `thread/${name}`
  const directory = path.join(input.root, input.project, name)
  await mkdir(path.dirname(directory), { recursive: true })
  const added = await git(input.repo, "worktree", "add", "-b", branch, directory, "HEAD")
  if (added.code !== 0) return { ok: false as const, error: added.output.slice(0, 400) }
  return { ok: true as const, branch, directory }
}
