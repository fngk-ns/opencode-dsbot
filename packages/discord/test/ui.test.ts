import { describe, expect, test } from "bun:test"
import { ComponentType, MessageFlags } from "discord.js"
import { answerMessages, confirmCard, permissionCard, projectCard, serviceCard } from "../src/ui/cards"
import { countComponents, fit, MAX_COMPONENTS, MAX_TEXT, textLength, text, box, color } from "../src/ui/components"
import { renderRunCard } from "../src/ui/run-card"
import { clip, compact, describeTool, elapsed } from "../src/ui/tools"
import type { RunView, ToolEntry } from "../src/ui/view"

const tool = (overrides: Partial<ToolEntry> = {}): ToolEntry => ({ callID: "c", tool: "bash", status: "completed", title: "", input: { command: "ls -la" }, ...overrides })

function view(overrides: Partial<RunView> = {}): RunView {
  return { state: "running", sessionId: "ses_1", startedAt: 1_000, tools: [], narration: [], todos: [], steered: 0, directory: "/ws/blog", ...overrides }
}

const allText = (container: ReturnType<typeof renderRunCard>) =>
  container.components.flatMap((child) => (child.type === ComponentType.TextDisplay ? [child.content] : [])).join("\n")

describe("describeTool", () => {
  test("shows commands, relative file paths with diff stats, patterns and hosts", () => {
    expect(describeTool(tool({ input: { command: "npm run build\nmore" } }))).toMatchObject({ icon: "⌨️", name: "bash", detail: "npm run build" })
    expect(describeTool(tool({ tool: "edit", input: { filePath: "/ws/blog/src/a.ts" }, additions: 12, deletions: 3 }), "/ws/blog").detail).toBe("src/a.ts +12 −3")
    expect(describeTool(tool({ tool: "grep", input: { pattern: "TODO" } })).detail).toBe("TODO")
    expect(describeTool(tool({ tool: "webfetch", input: { url: "https://example.com/docs/" } })).detail).toBe("example.com/docs")
  })

  test("bot tools get friendly names and show their action", () => {
    expect(describeTool(tool({ tool: "discord_service", input: { action: "deploy", name: "blog" } }))).toMatchObject({ icon: "🚀", name: "service", detail: "deploy · blog" })
    expect(describeTool(tool({ tool: "discord_admin", input: { action: "timeout" } })).name).toBe("server")
  })

  test("unknown tools fall back to the raw name", () => {
    expect(describeTool(tool({ tool: "mystery", title: "did a thing", input: {} }))).toMatchObject({ icon: "🔧", name: "mystery", detail: "did a thing" })
  })

  test("formatters", () => {
    expect(elapsed(4200)).toBe("4s")
    expect(elapsed(63_000)).toBe("1m 03s")
    expect(elapsed(3_700_000)).toBe("1h 01m")
    expect(compact(950)).toBe("950")
    expect(compact(12_400)).toBe("12.4k")
    expect(clip("a  b\nc", 10)).toBe("a b c")
    expect(clip("x".repeat(20), 5)).toBe("xxxx…")
  })
})

describe("renderRunCard", () => {
  test("a running card shows the header, latest tools, and a stop button for this session", () => {
    const card = renderRunCard(
      view({
        model: "anthropic/claude-sonnet-4-6",
        branch: "thread/blog-1",
        project: "blog",
        tools: [tool({ status: "completed", started: 0, ended: 3200 }), tool({ tool: "edit", status: "running", input: { filePath: "/ws/blog/a.ts" } })],
      }),
      11_000,
    )
    const content = allText(card)
    expect(content).toContain("⏳ 작업 중")
    expect(content).toContain("🤖 anthropic/claude-sonnet-4-6 · 🌿 thread/blog-1 · 📦 blog · ⏱ 10s")
    expect(content).toContain("✅ ⌨️ **bash** `ls -la` · 3s")
    expect(content).toContain("⏳ ✏️ **edit** `a.ts`")
    const row = card.components.find((child) => child.type === ComponentType.ActionRow)
    expect(row && "components" in row && row.components[0]).toMatchObject({ custom_id: "run:stop:ses_1" })
  })

  test("only the last six tool calls are listed, with a count of the rest", () => {
    const tools = Array.from({ length: 20 }, (_, index) => tool({ callID: `c${index}`, input: { command: `cmd ${index}` } }))
    const content = allText(renderRunCard(view({ tools })))
    expect(content).toContain("앞선 14개 생략")
    expect(content).toContain("cmd 19")
    expect(content).not.toContain("cmd 5`")
  })

  test("the checklist keeps the active item visible and counts what is done", () => {
    const todos = Array.from({ length: 12 }, (_, index) => ({ content: `step ${index}`, status: index < 8 ? ("completed" as const) : index === 8 ? ("in_progress" as const) : ("pending" as const) }))
    const content = allText(renderRunCard(view({ todos })))
    expect(content).toContain("**할 일** 8/12")
    expect(content).toContain("🔄 step 8")
    expect(content).not.toContain("step 0")
  })

  test("changed files are summarised with totals", () => {
    const tools = [
      tool({ tool: "edit", file: "/ws/blog/src/a.ts", additions: 10, deletions: 2 }),
      tool({ tool: "edit", file: "/ws/blog/src/a.ts", additions: 5, deletions: 0 }),
      tool({ tool: "write", file: "/ws/blog/b.md" }),
    ]
    const content = allText(renderRunCard(view({ tools })))
    expect(content).toContain("**변경** 2개 파일 · +15 −2")
    expect(content).toContain("`src/a.ts` +15 −2")
  })

  test("a failed command shows the tail of its output", () => {
    const content = allText(renderRunCard(view({ tools: [tool({ status: "error", exit: 1, tail: "Error: build failed\n  at x" })] })))
    expect(content).toContain("❌ ⌨️ **bash**")
    expect(content).toContain("exit 1")
    expect(content).toContain("Error: build failed")
  })

  test("steered instructions, retries and failures are called out", () => {
    const content = allText(renderRunCard(view({ steered: 2, retry: "재시도 1회", failure: "ProviderAuthError: bad key" })))
    expect(content).toContain("📨 추가 지시 2건을 바로 전달했어요")
    expect(content).toContain("⏳ 재시도 1회")
    expect(content).toContain("⚠️ ProviderAuthError: bad key")
  })

  test("a finished card collapses the tool list into counts and drops the stop button", () => {
    const tools = [tool(), tool(), tool({ tool: "edit", file: "/ws/blog/a.ts", additions: 1 }), tool({ tool: "read", input: { filePath: "x" } })]
    const card = renderRunCard(view({ state: "done", endedAt: 64_000, tools, tokens: { input: 9000, output: 1200, cache: 2000 }, cost: 0.0421 }))
    const content = allText(card)
    expect(content).toContain("✅ 완료")
    expect(content).toContain("⏱ 1m 03s")
    expect(content).toContain("⌨️ bash ×2 · ✏️ edit ×1 · 📖 read ×1")
    expect(content).toContain("12.2k tokens · $0.042")
    expect(content).not.toContain("**bash** `ls")
    expect(card.components.some((child) => child.type === ComponentType.ActionRow)).toBe(false)
    expect(card.accent_color).toBe(color.done)
  })

  test("states have their own look", () => {
    expect(allText(renderRunCard(view({ state: "failed", failure: "x" })))).toContain("❌ 실패")
    expect(allText(renderRunCard(view({ state: "stopped" })))).toContain("⏹️ 중단됨")
    expect(allText(renderRunCard(view({ state: "moved" })))).toContain("📦 프로젝트로 이동")
  })

  test("even a huge run stays inside Discord's limits", () => {
    const tools = Array.from({ length: 300 }, (_, index) => tool({ callID: `c${index}`, tool: "edit", file: `/ws/blog/${"deep/".repeat(10)}f${index}.ts`, additions: index, deletions: 1, input: { filePath: `/ws/blog/f${index}.ts` } }))
    const todos = Array.from({ length: 40 }, (_, index) => ({ content: "t".repeat(300) + index, status: "pending" as const }))
    const card = renderRunCard(view({ tools, todos, narration: ["n".repeat(1000)], failure: "f".repeat(2000), steered: 3 }))
    const [fitted] = fit([card])
    expect(countComponents([fitted])).toBeLessThanOrEqual(MAX_COMPONENTS)
    expect(textLength([fitted])).toBeLessThanOrEqual(MAX_TEXT)
  })
})

describe("fit", () => {
  test("shortens text from the end and drops separators when there are too many components", () => {
    const many = box(Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? text("a") : { type: ComponentType.Separator as const, divider: true })), color.info)
    expect(countComponents(fit([many]))).toBeLessThanOrEqual(MAX_COMPONENTS)

    const long = box([text("x".repeat(3000)), text("y".repeat(3000))], color.info)
    const [fitted] = fit([long])
    expect(textLength([fitted])).toBeLessThanOrEqual(MAX_TEXT)
    expect(fitted.components[0]).toMatchObject({ content: "x".repeat(3000) })
  })

  test("messages are flagged as Components V2 and never ping anyone", () => {
    const payload = permissionCard({ tool: "bash", detail: "rm -rf build", sessionId: "s", permissionId: "p" })
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2)
    expect(payload.allowedMentions).toEqual({ parse: [] })
  })
})

describe("answerMessages", () => {
  test("a short answer is one container card", () => {
    const messages = answerMessages("안녕하세요")
    expect(messages).toHaveLength(1)
    expect(messages[0].components[0].components[0]).toMatchObject({ type: ComponentType.TextDisplay, content: "안녕하세요" })
  })

  test("long text continues in more cards, each inside the text budget", () => {
    const messages = answerMessages(Array.from({ length: 400 }, (_, index) => `line ${index} ${"x".repeat(30)}`).join("\n"))
    expect(messages.length).toBeGreaterThan(1)
    for (const item of messages) expect(textLength(item.components)).toBeLessThanOrEqual(MAX_TEXT)
  })

  test("long code becomes an attachment shown as a file component on the last card", () => {
    const code = "const x = 1\n".repeat(300)
    const messages = answerMessages(`여기 있어요\n\`\`\`ts\n${code}\`\`\``)
    const last = messages.at(-1)!
    expect(last.files?.[0].name).toBe("snippet-1.ts")
    expect(last.components[0].components.some((child) => child.type === ComponentType.File && child.file.url === "attachment://snippet-1.ts")).toBe(true)
  })

  test("empty answers produce nothing", () => {
    expect(answerMessages("   ")).toEqual([])
  })
})

describe("cards", () => {
  test("a deployed service shows the address as a link button plus log and restart buttons", () => {
    const payload = serviceCard({ name: "blog", url: "http://1.2.3.4:24001", localUrl: "http://127.0.0.1:24001", port: 24001, status: "running", ready: true, project: "blog", description: "내 블로그" })
    const container = payload.components[0]
    expect(JSON.stringify(container)).toContain("http://1.2.3.4:24001")
    const row = container.components.find((child) => child.type === ComponentType.ActionRow)
    const buttons = row && "components" in row ? row.components : []
    expect(buttons.map((item) => ("url" in item ? "link" : "custom_id" in item ? item.custom_id : "?"))).toEqual(["link", "svc:logs:blog", "svc:restart:blog"])
    expect(container.accent_color).toBe(color.done)
  })

  test("without a known public address the card says how to fix it and has no link button", () => {
    const payload = serviceCard({ name: "blog", url: null, localUrl: "http://127.0.0.1:24001", port: 24001, status: "running", ready: false })
    const json = JSON.stringify(payload.components[0])
    expect(json).toContain("PUBLIC_HOST")
    expect(json).toContain("아직 포트가 열리지 않았어요")
    expect(json).not.toContain('"style":5')
  })

  test("confirm and project cards carry their ids and details", () => {
    const confirm = confirmCard({ title: "⚠️ 확인", description: "kick alice", yesId: "admin:yes:1", noId: "admin:no:1" })
    expect(JSON.stringify(confirm.components)).toContain("admin:yes:1")
    const project = projectCard({ name: "blog", title: "내 블로그", branch: "thread/x", directory: "/ws/blog", created: true })
    expect(JSON.stringify(project.components)).toContain("새 프로젝트")
  })
})
