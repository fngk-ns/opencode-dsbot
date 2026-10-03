import { describe, expect, test } from "bun:test"
import { ProjectStore } from "../src/projects/store"
import { openDatabase } from "../src/store/db"

function store() {
  const projects = new ProjectStore(openDatabase(":memory:"))
  projects.create({ name: "blog", title: "내 블로그 사이트", description: "Next.js 로 만든 개인 블로그, 마크다운 글 지원", directory: "/ws/blog", aliases: ["블로그", "blog"] })
  projects.create({ name: "shop", title: "쇼핑몰", description: "상품 목록과 장바구니가 있는 쇼핑몰 사이트", directory: "/ws/shop", aliases: ["쇼핑몰", "shop", "store"] })
  projects.create({ name: "portfolio", title: "포트폴리오 사이트", description: "디자이너 포트폴리오", directory: "/ws/portfolio", aliases: ["포트폴리오"] })
  return projects
}

describe("ProjectStore", () => {
  test("creates, reads, updates and lists newest first", () => {
    const projects = store()
    expect(projects.get("blog")).toMatchObject({ title: "내 블로그 사이트", aliases: ["블로그", "blog"], summary: null })
    projects.update("blog", { summary: "댓글 기능 추가", last_thread: "t1" })
    expect(projects.get("blog")).toMatchObject({ summary: "댓글 기능 추가", last_thread: "t1", title: "내 블로그 사이트" })
    expect(projects.list()[0].name).toBe("blog")
    expect(projects.get("nope")).toBeUndefined()
  })

  test("a duplicate name is rejected by the database", () => {
    const projects = store()
    expect(() => projects.create({ name: "blog", directory: "/x" })).toThrow()
  })
})

describe("matching a request to a project", () => {
  test("finds the project when its alias appears inside Korean text with particles", () => {
    const projects = store()
    expect(projects.match("저번에 만든 블로그에 댓글 기능 추가해서 배포해줘")?.name).toBe("blog")
    expect(projects.match("쇼핑몰에 결제 붙여줘")?.name).toBe("shop")
    expect(projects.match("fix the shop checkout")?.name).toBe("shop")
  })

  test("a project name works as a keyword too", () => {
    expect(store().match("portfolio 에 다크모드")?.name).toBe("portfolio")
  })

  test("two title words are enough, but a generic word alone is not", () => {
    const projects = store()
    expect(projects.match("내 블로그 사이트 헤더 색을 바꿔줘")?.name).toBe("blog")
    expect(projects.match("새로운 사이트 만들어줘")).toBeUndefined()
  })

  test("a request that fits several projects is ambiguous and matches none", () => {
    expect(store().match("블로그랑 쇼핑몰 둘 다 점검해줘")).toBeUndefined()
  })

  test("unrelated or empty text matches nothing", () => {
    const projects = store()
    expect(projects.match("날씨 어때?")).toBeUndefined()
    expect(projects.match("   ")).toBeUndefined()
    expect(projects.find("")).toEqual([])
  })

  test("find returns ranked candidates for the agent to choose from", () => {
    const projects = store()
    const found = projects.find("블로그 사이트")
    expect(found.map((item) => item.project.name)[0]).toBe("blog")
    expect(found.length).toBeGreaterThan(1)
  })
})

describe("database migration", () => {
  test("a services table created before projects gets the project column", () => {
    const db = openDatabase(":memory:")
    expect((db.query("PRAGMA table_info(services)").all() as Array<{ name: string }>).some((column) => column.name === "project")).toBe(true)
  })
})
