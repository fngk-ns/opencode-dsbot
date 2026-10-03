import { describe, expect, test } from "bun:test"
import { buildDigest, digestHash } from "../src/memory/digest"
import { MemoryStore, scopesFor } from "../src/memory/store"
import { openDatabase } from "../src/store/db"

function store() {
  return new MemoryStore(openDatabase(":memory:"))
}

describe("MemoryStore", () => {
  test("saving the same title again updates the entry instead of duplicating it", () => {
    const memory = store()
    const first = memory.save({ scope: "global", kind: "decision", title: "배포 포트", body: "20000번대 사용" })
    const second = memory.save({ scope: "global", kind: "decision", title: "배포 포트", body: "21000번대로 변경" })
    expect(second.id).toBe(first.id)
    expect(second.body).toBe("21000번대로 변경")
    expect(memory.list({ scopes: ["global"] })).toHaveLength(1)
  })

  test("tasks default to open and can be completed; done tasks leave the default list", () => {
    const memory = store()
    const task = memory.save({ scope: "global", kind: "task", title: "블로그 배포", body: "블로그를 24001에 올린다" })
    expect(task.status).toBe("open")
    expect(memory.list({ scopes: ["global"] }).map((entry) => entry.id)).toEqual([task.id])
    memory.update(task.id, { status: "done" })
    expect(memory.list({ scopes: ["global"] })).toEqual([])
    expect(memory.list({ scopes: ["global"], statuses: ["done"] })).toHaveLength(1)
  })

  test("only scopes the conversation can see are returned", () => {
    const memory = store()
    memory.save({ scope: "global", kind: "fact", title: "g", body: "shared" })
    memory.save({ scope: "guild:1", kind: "fact", title: "g1", body: "server one" })
    memory.save({ scope: "guild:2", kind: "fact", title: "g2", body: "server two" })
    memory.save({ scope: "thread:9", kind: "note", title: "t9", body: "this thread" })
    memory.save({ scope: "thread:8", kind: "note", title: "t8", body: "other thread" })
    const scopes = scopesFor({ guildId: "1", project: null, threadId: "9" })
    expect(memory.list({ scopes }).map((entry) => entry.title).sort()).toEqual(["g", "g1", "t9"])
  })

  test("forget archives, search hides archived unless asked, and can find by several words", () => {
    const memory = store()
    const entry = memory.save({ scope: "global", kind: "fact", title: "DB 비밀번호 위치", body: "vault 에 있음 (production)" })
    expect(memory.search({ query: "production vault", scopes: ["global"] })).toHaveLength(1)
    memory.forget(entry.id)
    expect(memory.search({ query: "vault", scopes: ["global"] })).toEqual([])
    expect(memory.search({ query: "vault", scopes: ["global"], includeArchived: true })).toHaveLength(1)
    expect(memory.get(entry.id)?.status).toBe("archived")
  })

  test("pinned entries sort first", () => {
    const memory = store()
    memory.save({ scope: "global", kind: "fact", title: "old", body: "x" })
    memory.save({ scope: "global", kind: "fact", title: "pinned", body: "x", pinned: true })
    memory.save({ scope: "global", kind: "fact", title: "new", body: "x" })
    expect(memory.list({ scopes: ["global"] })[0].title).toBe("pinned")
  })
})

describe("thread journal", () => {
  test("records threads, counts turns, keeps summaries and finds threads by words", () => {
    const memory = store()
    memory.openThread({ thread_id: "t1", guild_id: "g", title: "블로그 만들기", project: "blog", directory: "/w/blog" })
    memory.openThread({ thread_id: "t2", guild_id: "g", title: "서버 점검", parent_thread: "t1" })
    memory.touchThread("t1", "다크모드 추가해줘")
    memory.touchThread("t1", "배포해줘")
    memory.setSummary("t1", "블로그 Next.js 로 구현, 24001 포트 배포 완료")
    expect(memory.thread("t1")).toMatchObject({ turns: 2, last_request: "배포해줘", project: "blog" })
    expect(memory.thread("t2")?.parent_thread).toBe("t1")
    expect(memory.threads({ query: "next.js 배포" }).map((thread) => thread.thread_id)).toEqual(["t1"])
    memory.closeThread("t1")
    expect(memory.threads({ state: "active" }).map((thread) => thread.thread_id)).toEqual(["t2"])
  })

  test("reopening a thread keeps its branch and counters", () => {
    const memory = store()
    memory.openThread({ thread_id: "t1", guild_id: "g", title: "a", branch: "thread/a" })
    memory.touchThread("t1", "x")
    memory.openThread({ thread_id: "t1", guild_id: "g", title: "renamed" })
    expect(memory.thread("t1")).toMatchObject({ title: "renamed", branch: "thread/a", turns: 1 })
  })
})

describe("buildDigest", () => {
  const memory = store()
  memory.save({ scope: "global", kind: "preference", title: "언어", body: "한국어로 짧게 답한다" })
  memory.save({ scope: "global", kind: "task", title: "블로그 배포", body: "24001 에서 서비스" })
  memory.save({ scope: "global", kind: "fact", title: "서버", body: "Ubuntu 24.04, 공인 IP" })
  const entries = memory.list({ scopes: ["global"] })

  test("sections are labelled and ordered for reading", () => {
    const text = buildDigest({
      entries,
      services: [{ name: "blog", port: 24001, status: "running", command: "bun run start", directory: "/w/blog", description: null, url: "http://1.2.3.4:24001" }],
      recent: [],
    })
    expect(text.startsWith("# Shared memory")).toBe(true)
    const order = ["## Always remember", "## Open tasks", "## Services on this host", "## Decisions, facts and notes"].map((heading) => text.indexOf(heading))
    expect(order.every((index) => index > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text).toContain("blog: port 24001 running")
    expect(text).toContain("한국어로 짧게 답한다")
  })

  test("a small budget drops low-priority notes but keeps preferences, tasks and services", () => {
    const filler = Array.from({ length: 40 }, (_, index) =>
      memory.save({ scope: "global", kind: "note", title: `note ${index}`, body: "x".repeat(200) }),
    )
    expect(filler).toHaveLength(40)
    const text = buildDigest({
      entries: memory.list({ scopes: ["global"], limit: 500 }),
      services: [{ name: "blog", port: 24001, status: "running", command: "c", directory: "/d", description: null, url: null }],
      recent: [],
      budget: 900,
    })
    expect(text.length).toBeLessThan(1500)
    expect(text).toContain("한국어로 짧게 답한다")
    expect(text).toContain("블로그 배포")
    expect(text).toContain("blog: port 24001")
    expect((text.match(/note \d+/g) ?? []).length).toBeLessThan(40)
  })

  test("thread lineage shows the branch point and its parent's summary", () => {
    const parent = { thread_id: "p", guild_id: "g", parent_thread: null, title: "원본", project: null, directory: null, branch: null, summary: "로그인 구현 완료", last_request: null, turns: 3, state: "active" as const, created_at: 1, updated_at: 1 }
    const thread = { ...parent, thread_id: "c", parent_thread: "p", title: "분기", summary: null, branch: "thread/c" }
    const text = buildDigest({ entries: [], services: [], thread, parent, recent: [parent, thread] })
    expect(text).toContain('branched from <#p> "원본": 로그인 구현 완료')
    expect(text).toContain("git branch thread/c")
    expect(text).toContain('<#p> "원본"')
    expect(text.match(/<#c>/g)?.length).toBe(1)
  })

  test("empty memory produces no digest, and the hash only changes with content", () => {
    expect(buildDigest({ entries: [], services: [], recent: [] })).toBe("")
    expect(digestHash("a")).toBe(digestHash("a"))
    expect(digestHash("a")).not.toBe(digestHash("b"))
  })
})

describe("buildDigest projects", () => {
  const projects = [
    { name: "blog", title: "내 블로그", description: "Next.js 개인 블로그", aliases: ["블로그", "blog"], url: "http://1.2.3.4:24001", summary: "댓글 기능 추가", directory: "/ws/blog" },
    { name: "shop", title: null, description: null, aliases: [], url: null, summary: null, directory: "/ws/shop" },
  ]

  test("lists every project with its aliases, address and last change so a request can be matched to it", () => {
    const text = buildDigest({ entries: [], services: [], projects, recent: [] })
    expect(text).toContain("## Projects on this host")
    expect(text).toContain('- blog "내 블로그" [블로그, blog] — Next.js 개인 블로그 · live at http://1.2.3.4:24001 · last change: 댓글 기능 추가')
    expect(text).toContain("- shop · not deployed")
  })

  test("projects outrank plain notes when the budget is small", () => {
    const m = store()
    for (let index = 0; index < 30; index++) m.save({ scope: "global", kind: "note", title: `n${index}`, body: "x".repeat(200) })
    const text = buildDigest({ entries: m.list({ scopes: ["global"], limit: 100 }), services: [], projects, recent: [], budget: 700 })
    expect(text).toContain("blog")
    expect(text).toContain("shop")
  })
})
