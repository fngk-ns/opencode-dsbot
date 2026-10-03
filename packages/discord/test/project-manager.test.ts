import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MemoryStore } from "../src/memory/store"
import { ProjectManager } from "../src/projects/manager"
import { ProjectStore } from "../src/projects/store"
import { run } from "../src/self/update"
import { openDatabase } from "../src/store/db"
import { workingCopy } from "../src/threads/branch"

let temp: string

beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "dsbot-proj-"))
})

afterAll(() => rm(temp, { recursive: true, force: true }))

async function git(cwd: string, ...args: string[]) {
  const result = await run(["git", ...args], cwd, 20_000, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e.com" })
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.output}`)
  return result.output
}

async function setup(name: string) {
  const workspaceDir = path.join(temp, name)
  await mkdir(workspaceDir, { recursive: true })
  const db = openDatabase(":memory:")
  const store = new ProjectStore(db)
  const memory = new MemoryStore(db)
  const manager = new ProjectManager({ store, workspaceDir, memory })
  /** A thread's branch in its own worktree, the way the router creates it. */
  const thread = async (project: string, title: string, id: string) => {
    const trunk = store.get(project)!.directory
    const copy = await workingCopy({ branchPerThread: true, workspaceDir }, { directory: trunk }, title, id)
    if (!copy.branch) throw new Error(`no worktree: ${"note" in copy ? copy.note : "?"}`)
    return { worktree: copy.directory, branch: copy.branch, id, title }
  }
  const finish = (project: string, t: Awaited<ReturnType<typeof thread>>, summary: string) =>
    manager.finish({ project, worktree: t.worktree, branch: t.branch, title: t.title, summary, threadId: t.id })
  return { workspaceDir, store, memory, manager, thread, finish }
}

describe("create", () => {
  test("makes a git repository with an initial commit and registers it", async () => {
    const t = await setup("create")
    const result = await t.manager.create({ name: "blog", title: "내 블로그", description: "개인 블로그", aliases: ["블로그"], createdBy: "u1", thread: "t1" })
    expect(result).toMatchObject({ ok: true, project: { name: "blog", directory: path.join(t.workspaceDir, "blog"), aliases: ["블로그"], last_thread: "t1" } })
    expect(await git(path.join(t.workspaceDir, "blog"), "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
    expect(await git(path.join(t.workspaceDir, "blog"), "log", "--oneline")).toContain("init")
    expect(t.store.get("blog")?.title).toBe("내 블로그")
  })

  test("rejects bad names, duplicates and non-empty folders", async () => {
    const t = await setup("create2")
    expect(await t.manager.create({ name: "Bad Name" })).toMatchObject({ ok: false })
    expect(await t.manager.create({ name: "../x" })).toMatchObject({ ok: false })
    await t.manager.create({ name: "blog" })
    expect(await t.manager.create({ name: "blog" })).toMatchObject({ ok: false, error: expect.stringContaining("already exists") })
    await mkdir(path.join(t.workspaceDir, "taken"), { recursive: true })
    await Bun.write(path.join(t.workspaceDir, "taken", "file.txt"), "x")
    expect(await t.manager.create({ name: "taken" })).toMatchObject({ ok: false, error: expect.stringContaining("not empty") })
    expect(t.store.get("taken")).toBeUndefined()
  })
})

describe("finish", () => {
  test("a thread's work is committed, merged into trunk, and recorded in the registry and shared memory", async () => {
    const t = await setup("finish")
    await t.manager.create({ name: "blog", title: "블로그" })
    const thread = await t.thread("blog", "홈페이지 만들기", "100000000001")
    await Bun.write(path.join(thread.worktree, "index.html"), "<h1>hello</h1>\n")

    const result = await t.finish("blog", thread, "홈페이지 첫 버전")
    expect(result).toMatchObject({ ok: true, merged: true, files: ["index.html"] })
    // Trunk now has the work, without anyone having edited it directly.
    expect(await Bun.file(path.join(t.workspaceDir, "blog", "index.html")).text()).toBe("<h1>hello</h1>\n")
    expect(await git(path.join(t.workspaceDir, "blog"), "status", "--porcelain")).toBe("")
    expect(await git(path.join(t.workspaceDir, "blog"), "log", "--oneline", "-3")).toContain("merge thread/")

    expect(t.store.get("blog")).toMatchObject({ summary: "홈페이지 첫 버전", last_thread: "100000000001" })
    const notes = t.memory.list({ scopes: ["project:blog"] })
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toContain("홈페이지 첫 버전")
    expect(notes[0].body).toContain("index.html")
  })

  test("finishing again with nothing new merges nothing", async () => {
    const t = await setup("finish-twice")
    await t.manager.create({ name: "blog" })
    const thread = await t.thread("blog", "a", "100000000002")
    await Bun.write(path.join(thread.worktree, "a.txt"), "a\n")
    await t.finish("blog", thread, "first")
    const again = await t.finish("blog", thread, "again")
    expect(again).toMatchObject({ ok: true, merged: false })
    expect(t.memory.list({ scopes: ["project:blog"] })).toHaveLength(1)
  })

  test("the next thread starts from everything earlier threads merged", async () => {
    const t = await setup("later")
    await t.manager.create({ name: "blog" })
    const first = await t.thread("blog", "first", "100000000003")
    await Bun.write(path.join(first.worktree, "index.html"), "v1\n")
    await t.finish("blog", first, "v1")

    const second = await t.thread("blog", "comments", "100000000004")
    expect(await Bun.file(path.join(second.worktree, "index.html")).text()).toBe("v1\n")
    await Bun.write(path.join(second.worktree, "comments.js"), "// comments\n")
    expect(await t.finish("blog", second, "댓글 기능")).toMatchObject({ ok: true, merged: true, files: ["comments.js"] })
    expect(await Bun.file(path.join(t.workspaceDir, "blog", "comments.js")).exists()).toBe(true)
  })

  test("a thread that was branched earlier picks up what other threads merged in the meantime", async () => {
    const t = await setup("parallel")
    await t.manager.create({ name: "blog" })
    const a = await t.thread("blog", "a", "100000000005")
    const b = await t.thread("blog", "b", "100000000006")
    await Bun.write(path.join(a.worktree, "a.txt"), "a\n")
    await Bun.write(path.join(b.worktree, "b.txt"), "b\n")
    await t.finish("blog", a, "a")
    const result = await t.finish("blog", b, "b")
    expect(result).toMatchObject({ ok: true, merged: true })
    expect(await Bun.file(path.join(t.workspaceDir, "blog", "a.txt")).exists()).toBe(true)
    expect(await Bun.file(path.join(t.workspaceDir, "blog", "b.txt")).exists()).toBe(true)
    // The second thread's worktree also received the first thread's file.
    expect(await Bun.file(path.join(b.worktree, "a.txt")).exists()).toBe(true)
  })

  test("a conflict is reported on the branch side, trunk stays clean, and finishing works after it is resolved", async () => {
    const t = await setup("conflict")
    await t.manager.create({ name: "blog" })
    const base = await t.thread("blog", "base", "100000000007")
    await Bun.write(path.join(base.worktree, "style.css"), "body { color: black }\n")
    await t.finish("blog", base, "base")

    const a = await t.thread("blog", "dark", "100000000008")
    const b = await t.thread("blog", "red", "100000000009")
    await Bun.write(path.join(a.worktree, "style.css"), "body { color: white }\n")
    await Bun.write(path.join(b.worktree, "style.css"), "body { color: red }\n")
    expect(await t.finish("blog", a, "dark")).toMatchObject({ ok: true, merged: true })

    const conflict = await t.finish("blog", b, "red")
    expect(conflict).toMatchObject({ ok: false, reason: "conflict", where: "branch", files: ["style.css"] })
    expect(conflict.ok === false && conflict.reason === "conflict" && conflict.hint).toContain(b.worktree)
    // Trunk is untouched by the failed attempt.
    expect(await Bun.file(path.join(t.workspaceDir, "blog", "style.css")).text()).toBe("body { color: white }\n")
    expect(await git(path.join(t.workspaceDir, "blog"), "status", "--porcelain")).toBe("")

    // The agent resolves it in its worktree and finishes again.
    await Bun.write(path.join(b.worktree, "style.css"), "body { color: red; background: white }\n")
    await git(b.worktree, "add", "-A")
    await git(b.worktree, "commit", "-q", "-m", "resolve")
    expect(await t.finish("blog", b, "red")).toMatchObject({ ok: true, merged: true })
    expect(await Bun.file(path.join(t.workspaceDir, "blog", "style.css")).text()).toBe("body { color: red; background: white }\n")
  })

  test("two threads finishing at the same moment are serialised and both land", async () => {
    const t = await setup("race")
    await t.manager.create({ name: "blog" })
    const threads = await Promise.all(["x", "y", "z"].map((name, index) => t.thread("blog", name, `20000000000${index}`)))
    for (const thread of threads) await Bun.write(path.join(thread.worktree, `${thread.title}.txt`), `${thread.title}\n`)
    const results = await Promise.all(threads.map((thread) => t.finish("blog", thread, thread.title)))
    expect(results.every((item) => item.ok)).toBe(true)
    for (const name of ["x", "y", "z"]) expect(await Bun.file(path.join(t.workspaceDir, "blog", `${name}.txt`)).exists()).toBe(true)
  })

  test("an unknown project is an error, and a dirty trunk is refused", async () => {
    const t = await setup("errors")
    await t.manager.create({ name: "blog" })
    const thread = await t.thread("blog", "a", "300000000000")
    expect(await t.manager.finish({ project: "nope", worktree: thread.worktree, branch: thread.branch, title: "a", summary: "s", threadId: "t" })).toMatchObject({ ok: false, reason: "error" })

    await Bun.write(path.join(thread.worktree, "a.txt"), "a\n")
    await Bun.write(path.join(t.workspaceDir, "blog", "stray.txt"), "someone edited trunk\n")
    const refused = await t.finish("blog", thread, "a")
    expect(refused).toMatchObject({ ok: false, reason: "error", error: expect.stringContaining("uncommitted") })
    expect(await Bun.file(path.join(t.workspaceDir, "blog", "a.txt")).exists()).toBe(false)
  })
})
