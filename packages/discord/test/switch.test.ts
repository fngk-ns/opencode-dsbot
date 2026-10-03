import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Engine } from "../src/bridge/opencode"
import { digestKey } from "../src/memory/compaction"
import { MemoryStore } from "../src/memory/store"
import { ProjectManager } from "../src/projects/manager"
import { ProjectStore } from "../src/projects/store"
import { handoffText, homeDirectory, requestsKey, switchToProject, uploadsKey } from "../src/projects/switch"
import { BindingStore, KeyValueStore, type Binding } from "../src/store/bindings"
import { openDatabase } from "../src/store/db"

let temp: string

beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "dsbot-switch-"))
})

afterAll(() => rm(temp, { recursive: true, force: true }))

async function setup(name: string, options: { branchPerThread?: boolean; failSession?: boolean } = {}) {
  const workspaceDir = path.join(temp, name)
  await mkdir(homeDirectory(workspaceDir), { recursive: true })
  const db = openDatabase(":memory:")
  const projects = new ProjectStore(db)
  const memory = new MemoryStore(db)
  const bindings = new BindingStore(db)
  const kv = new KeyValueStore(db)
  const manager = new ProjectManager({ store: projects, workspaceDir, memory })
  const created: string[] = []
  const moved: string[] = []
  const prompts: Array<{ binding: Binding; text: string }> = []
  const announced: unknown[] = []
  const engine = {
    createSession: async (directory: string) => {
      if (options.failSession) throw new Error("opencode is down")
      created.push(directory)
      return `ses_new_${created.length}`
    },
  } as unknown as Engine

  const home: Binding = { channel_id: "t1", session_id: "ses_home", directory: homeDirectory(workspaceDir), kind: "project", owner_id: "u1", model: "anthropic/claude-sonnet-4-5", agent: null, created_at: 1 }
  bindings.set(home)
  memory.openThread({ thread_id: "t1", guild_id: "g1", title: "블로그 만들기", project: null, directory: home.directory })
  kv.set(requestsKey("t1"), JSON.stringify(["블로그 사이트 만들어줘", "다크모드도"]))
  kv.set(uploadsKey("t1"), JSON.stringify(["/ws/_home/uploads/logo.png"]))
  kv.set(digestKey("ses_home"), "old-hash")

  const deps = {
    engine,
    bindings,
    memory,
    kv,
    workspaceDir,
    branchPerThread: options.branchPerThread ?? true,
    moveAway: async (sessionId: string) => void moved.push(sessionId),
    prompt: async (binding: Binding, text: string) => void prompts.push({ binding, text }),
    announce: async (_: string, input: unknown) => void announced.push(input),
  }
  return { workspaceDir, projects, memory, bindings, kv, manager, deps, home, created, moved, prompts, announced }
}

const settle = () => Bun.sleep(250)

describe("switchToProject", () => {
  test("the same Discord thread gets its own branch, a fresh agent session, and the request handed over", async () => {
    const t = await setup("enter")
    const made = await t.manager.create({ name: "blog", title: "내 블로그", aliases: ["블로그"] })
    if (!made.ok) throw new Error(made.error)

    const result = await switchToProject(t.deps, { binding: t.home, project: made.project, created: true, speakerId: "u1" })
    expect(result).toMatchObject({ ok: true, trunk: made.project.directory, branch: expect.stringMatching(/^thread\//) })
    if (!result.ok) return
    expect(result.directory).toContain(path.join(".worktrees", "blog"))
    expect(t.created).toEqual([result.directory])

    // The thread now points at the new session and working copy; model and owner are kept.
    expect(t.bindings.get("t1")).toMatchObject({ session_id: "ses_new_1", directory: result.directory, model: "anthropic/claude-sonnet-4-5", owner_id: "u1" })
    expect(t.bindings.bySession("ses_home")).toBeUndefined()
    expect(t.memory.thread("t1")).toMatchObject({ project: "blog", branch: result.branch, directory: result.directory })
    expect(t.announced).toEqual([expect.objectContaining({ name: "blog", created: true, branch: result.branch })])

    await settle()
    expect(t.moved).toEqual(["ses_home"])
    expect(t.prompts).toHaveLength(1)
    expect(t.prompts[0].binding.session_id).toBe("ses_new_1")
    expect(t.prompts[0].text).toContain("블로그 사이트 만들어줘")
    expect(t.prompts[0].text).toContain("다크모드도")
    expect(t.prompts[0].text).toContain("logo.png")
    expect(t.prompts[0].text).toContain(`never edit it directly`)
  })

  test("trunk is never used as a fallback when a branch was wanted but could not be made", async () => {
    const t = await setup("no-branch")
    // A registered project whose folder is not a git repository cannot get a worktree.
    const directory = path.join(t.workspaceDir, "plain")
    await mkdir(directory, { recursive: true })
    const project = t.projects.create({ name: "plain", directory })
    const result = await switchToProject(t.deps, { binding: t.home, project, created: false, speakerId: "u1" })
    expect(result.ok).toBe(false)
    expect(t.created).toEqual([])
    expect(t.bindings.get("t1")?.session_id).toBe("ses_home")
    await settle()
    expect(t.moved).toEqual([])
  })

  test("with branch-per-thread off the project folder itself is used", async () => {
    const t = await setup("shared", { branchPerThread: false })
    const made = await t.manager.create({ name: "blog" })
    if (!made.ok) throw new Error(made.error)
    const result = await switchToProject(t.deps, { binding: t.home, project: made.project, created: false, speakerId: "u1" })
    expect(result).toMatchObject({ ok: true, directory: made.project.directory, branch: null })
  })

  test("a session that cannot be created leaves the thread where it was", async () => {
    const t = await setup("fail", { failSession: true })
    const made = await t.manager.create({ name: "blog" })
    if (!made.ok) throw new Error(made.error)
    expect(await switchToProject(t.deps, { binding: t.home, project: made.project, created: false, speakerId: "u1" })).toMatchObject({ ok: false, error: "opencode is down" })
    expect(t.bindings.get("t1")?.session_id).toBe("ses_home")
  })

  test("the new session gets the shared-memory briefing again", async () => {
    const t = await setup("briefing")
    const made = await t.manager.create({ name: "blog" })
    if (!made.ok) throw new Error(made.error)
    await switchToProject(t.deps, { binding: t.home, project: made.project, created: false, speakerId: "u1" })
    expect(t.kv.get(digestKey("ses_new_1"))).toBeUndefined()
  })
})

describe("handoffText", () => {
  test("lists the thread's instructions oldest first and the last change to the project", async () => {
    const t = await setup("handoff")
    const project = t.projects.create({ name: "blog", directory: "/ws/blog" })
    t.projects.update("blog", { summary: "댓글 기능 추가" })
    const text = handoffText(t.kv, "t1", t.projects.get("blog")!, { directory: "/ws/.worktrees/blog/x", branch: "thread/x" })
    expect(project.name).toBe("blog")
    expect(text).toContain("1. 블로그 사이트 만들어줘")
    expect(text.indexOf("블로그 사이트")).toBeLessThan(text.indexOf("다크모드도"))
    expect(text).toContain("Last change to this project: 댓글 기능 추가")
    expect(text).toContain("git branch thread/x")
  })
})
