import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Engine } from "../src/bridge/opencode"
import { MemoryStore } from "../src/memory/store"
import { run } from "../src/self/update"
import { BindingStore, type Binding } from "../src/store/bindings"
import { openDatabase } from "../src/store/db"
import { branchThread, projectDir, type DiscordThreads } from "../src/threads/branch"
import { branchableRoot, createWorktree, slugify } from "../src/threads/worktree"

let temp: string
let workspace: string

async function git(cwd: string, ...args: string[]) {
  const result = await run(["git", ...args], cwd, 20_000)
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.output}`)
  return result.output
}

async function makeRepo(name: string, commit = true) {
  const dir = path.join(workspace, name)
  await mkdir(dir, { recursive: true })
  await git(dir, "init", "-q", "-b", "main")
  await git(dir, "config", "user.email", "t@e.com")
  await git(dir, "config", "user.name", "t")
  if (commit) {
    await Bun.write(path.join(dir, "a.txt"), "one\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-q", "-m", "init")
  }
  return dir
}

beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "dsbot-branch-"))
  workspace = path.join(temp, "ws")
  await mkdir(workspace, { recursive: true })
})

afterAll(() => rm(temp, { recursive: true, force: true }))

describe("worktree", () => {
  test("branchableRoot needs a repo root with at least one commit", async () => {
    const repo = await makeRepo("ok")
    const empty = await makeRepo("empty", false)
    const plain = path.join(workspace, "plain")
    await mkdir(plain, { recursive: true })
    expect(await branchableRoot(repo)).toBeDefined()
    expect(await branchableRoot(empty)).toBeUndefined()
    expect(await branchableRoot(plain)).toBeUndefined()
    await mkdir(path.join(repo, "sub"), { recursive: true })
    expect(await branchableRoot(path.join(repo, "sub"))).toBeUndefined()
  })

  test("createWorktree cuts a branch from the current commit in a folder outside the repo", async () => {
    const repo = await makeRepo("wt")
    const made = await createWorktree({ repo, root: path.join(workspace, ".worktrees"), project: "wt", title: "Dark Mode!", id: "1234567890" })
    expect(made).toMatchObject({ ok: true, branch: "thread/dark-mode-567890" })
    if (!made.ok) return
    expect(made.directory).toBe(path.join(workspace, ".worktrees", "wt", "dark-mode-567890"))
    expect(await Bun.file(path.join(made.directory, "a.txt")).text()).toBe("one\n")
    expect(await git(made.directory, "rev-parse", "--abbrev-ref", "HEAD")).toBe("thread/dark-mode-567890")
    expect(await git(repo, "status", "--porcelain")).toBe("")

    // A worktree is itself branchable, so a branch can be branched again from where it is.
    expect(await branchableRoot(made.directory)).toBeDefined()
  })

  test("slugify handles non-latin titles", () => {
    expect(slugify("로그인 만들기")).toBe("thread")
    expect(slugify("Fix  the   bug #12")).toBe("fix-the-bug-12")
  })

  test("projectDir reads the project name from plain and worktree paths", () => {
    expect(projectDir("/ws", "/ws/blog")).toBe("blog")
    expect(projectDir("/ws", "/ws/.worktrees/blog/dark-mode-1")).toBe("blog")
    expect(projectDir("/ws", "/elsewhere/x")).toBe("..")
  })
})

describe("branchThread", () => {
  function setup(options: { parent?: string | undefined; failThread?: boolean; branchPerThread?: boolean } = {}) {
    const db = openDatabase(":memory:")
    const bindings = new BindingStore(db)
    const memory = new MemoryStore(db)
    const sent: string[] = []
    const engineCalls: string[] = []
    const kicks: string[] = []
    const engine = {
      fork: async (sessionId: string, directory: string) => (engineCalls.push(`fork:${sessionId}:${directory}`), "ses_forked"),
      createSession: async (directory: string, title: string) => (engineCalls.push(`create:${directory}:${title}`), "ses_new"),
    } as unknown as Engine
    const discord: DiscordThreads = {
      parentOf: () => ("parent" in options ? options.parent : "c-parent"),
      guildOf: () => "g1",
      createThread: async (_, name) => (options.failThread ? { error: "Missing Access" } : { id: `thread-${name}` }),
      send: async (channelId, text) => void sent.push(`${channelId}: ${text}`),
      archive: async () => undefined,
    }
    const deps = {
      engine,
      bindings,
      memory,
      discord,
      workspaceDir: workspace,
      branchPerThread: options.branchPerThread ?? true,
      kickoff: async (binding: Binding, text: string) => void kicks.push(`${binding.channel_id}: ${text}`),
    }
    return { deps, bindings, memory, sent, engineCalls, kicks }
  }

  function parentBinding(directory: string): Binding {
    return { channel_id: "t-parent", session_id: "ses_parent", directory, kind: "project", owner_id: "u1", model: "anthropic/claude-sonnet-4-6", agent: null, created_at: 1 }
  }

  test("a fork in a git project gets its own branch and worktree, inherits history and the model, and is linked to its parent", async () => {
    const repo = await makeRepo("proj")
    const t = setup()
    t.memory.openThread({ thread_id: "t-parent", guild_id: "g1", title: "원본", project: "proj", directory: repo })
    const result = await branchThread(t.deps, { from: parentBinding(repo), title: "dark mode", history: true, prompt: "다크모드 구현해줘", speakerId: "u2" })

    expect(result).toMatchObject({ ok: true, thread: "<#thread-dark mode>", session_id: "ses_forked", inherited_history: true })
    if (!result.ok) return
    expect(result.branch).toStartWith("thread/dark-mode-")
    expect(result.directory).toStartWith(path.join(workspace, ".worktrees", "proj"))
    // The session is forked INTO the worktree, so history is copied but work happens on the new branch.
    expect(t.engineCalls).toEqual([`fork:ses_parent:${result.directory}`])

    expect(t.bindings.get("thread-dark mode")).toMatchObject({ session_id: "ses_forked", directory: result.directory, model: "anthropic/claude-sonnet-4-6" })
    expect(t.memory.thread("thread-dark mode")).toMatchObject({ parent_thread: "t-parent", branch: result.branch, project: "proj" })
    expect(t.sent.some((line) => line.startsWith("thread-dark mode") && line.includes("분기"))).toBe(true)
    expect(t.sent.some((line) => line.startsWith("t-parent") && line.includes("<#thread-dark mode>"))).toBe(true)
    expect(t.kicks).toEqual(["thread-dark mode: 다크모드 구현해줘"])
  })

  test("a branch of a branch starts from the parent branch's commit", async () => {
    const repo = await makeRepo("proj2")
    const t = setup()
    const first = await branchThread(t.deps, { from: parentBinding(repo), title: "first", history: true, speakerId: "u" })
    if (!first.ok) throw new Error("first failed")
    await Bun.write(path.join(first.directory, "feature.txt"), "x\n")
    await git(first.directory, "add", "-A")
    await git(first.directory, "commit", "-q", "-m", "feature")

    const second = await branchThread(t.deps, { from: { ...parentBinding(first.directory), channel_id: "t-first" }, title: "second", history: true, speakerId: "u" })
    if (!second.ok) throw new Error("second failed")
    expect(await Bun.file(path.join(second.directory, "feature.txt")).exists()).toBe(true)
    expect(await Bun.file(path.join(repo, "feature.txt")).exists()).toBe(false)
  })

  test("without git, or with branching switched off, the thread shares the project folder", async () => {
    const plain = path.join(workspace, "plainproj")
    await mkdir(plain, { recursive: true })
    const a = setup()
    const noGit = await branchThread(a.deps, { from: parentBinding(plain), title: "x", history: true, speakerId: "u" })
    expect(noGit).toMatchObject({ ok: true, directory: plain, branch: null })

    const repo = await makeRepo("off")
    const b = setup({ branchPerThread: false })
    expect(await branchThread(b.deps, { from: parentBinding(repo), title: "y", history: true, speakerId: "u" })).toMatchObject({ ok: true, directory: repo, branch: null })
  })

  test("when the worktree cannot be created the thread says so instead of silently sharing the folder", async () => {
    const repo = await makeRepo("clash")
    const t = setup()
    // Occupy the branch name the new thread would use.
    await git(repo, "branch", "thread/clash-dclash")
    const result = await branchThread(t.deps, { from: parentBinding(repo), title: "clash", history: true, speakerId: "u" })
    expect(result).toMatchObject({ ok: true, directory: repo, branch: null })
    expect(t.sent.some((line) => line.includes("⚠️") && line.includes("같은 폴더"))).toBe(true)
  })

  test("a fresh thread (no history) starts a blank session but still joins the shared memory", async () => {
    const repo = await makeRepo("fresh")
    const t = setup()
    const result = await branchThread(t.deps, { from: parentBinding(repo), title: "새 주제", history: false, speakerId: "u" })
    expect(result).toMatchObject({ ok: true, session_id: "ses_new", inherited_history: false })
    expect(t.engineCalls[0]).toStartWith("create:")
  })

  test("it refuses DMs, /self sessions and a failure to create the Discord thread", async () => {
    const repo = await makeRepo("refuse")
    expect(await branchThread(setup({ parent: undefined }).deps, { from: parentBinding(repo), title: "x", history: true, speakerId: "u" })).toMatchObject({ ok: false })
    expect(await branchThread(setup().deps, { from: { ...parentBinding(repo), kind: "self" }, title: "x", history: true, speakerId: "u" })).toMatchObject({ ok: false })
    const failing = setup({ failThread: true })
    expect(await branchThread(failing.deps, { from: parentBinding(repo), title: "x", history: true, speakerId: "u" })).toEqual({ ok: false, error: "Missing Access" })
    expect(failing.engineCalls).toEqual([])
  })
})
