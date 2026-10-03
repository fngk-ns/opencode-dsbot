import { describe, expect, test } from "bun:test"
import { RunManager, type Pending, type RunSummary, type Surface } from "../src/bridge/runs"
import type { Engine, Event } from "../src/bridge/opencode"
import type { RunView } from "../src/ui/view"

const target = { sessionId: "ses_1", channelId: "thread_1", directory: "/work/blog", meta: { model: "anthropic/claude-sonnet-4-6", branch: "thread/x", project: "blog" } }
const text = (value: string): Pending => ({ parts: [{ type: "text", text: value }] })

function harness(options: { autoApprove?: boolean; failPrompt?: string; failSteer?: boolean } = {}) {
  const log = {
    prompts: [] as Array<{ sessionId: string; parts: Pending["parts"] }>,
    answers: [] as string[],
    notices: [] as string[],
    cards: [] as Array<{ id: string; edited: boolean; view: RunView }>,
    permissions: [] as Array<{ id: string; tool: string; detail: string }>,
    approvals: [] as string[],
    aborted: [] as string[],
    typing: 0,
    idle: [] as RunSummary[],
    statuses: {} as Record<string, { type: string }>,
  }
  const engine: Engine = {
    async promptAsync(input) {
      if (options.failPrompt || (options.failSteer && log.prompts.length > 0)) throw new Error(options.failPrompt ?? "steer rejected")
      log.prompts.push({ sessionId: input.sessionId, parts: input.parts })
    },
    async abort(sessionId) {
      log.aborted.push(sessionId)
    },
    async status() {
      return log.statuses
    },
    async respondPermission(_, permissionId, response) {
      log.approvals.push(`${permissionId}:${response}`)
    },
    async createSession() {
      return "ses_new"
    },
    async models() {
      return []
    },
    async fork() {
      return "ses_forked"
    },
    async summarize() {},
    async summaryOf() {
      return undefined
    },
  }
  const surface: Surface = {
    async showRun(_, view, messageId) {
      log.cards.push({ id: messageId ?? "card_1", edited: !!messageId, view: structuredClone(view) })
      return messageId ?? "card_1"
    },
    async sendAnswer(_, value) {
      log.answers.push(value)
    },
    async send(_, value) {
      log.notices.push(value)
    },
    typing() {
      log.typing += 1
    },
    async askPermission(_, permission) {
      log.permissions.push({ id: permission.id, tool: permission.tool, detail: permission.detail })
    },
  }
  let time = 1_000_000
  const runs = new RunManager(engine, surface, { autoApprove: options.autoApprove ?? false, onIdle: (_, __, summary) => log.idle.push(summary), now: () => time })
  const lastCard = () => log.cards.at(-1)!.view
  return { runs, log, lastCard, advance: (ms: number) => (time += ms) }
}

const ev = (value: object) => value as unknown as Event
const user = (id = "u1") => ev({ type: "message.updated", properties: { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "user" } } })
const assistant = (id: string, extra: object = {}) =>
  ev({ type: "message.updated", properties: { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "assistant", providerID: "anthropic", modelID: "claude-sonnet-4-6", ...extra } } })
const textPart = (id: string, messageID: string, value: string, done = true) =>
  ev({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id, sessionID: "ses_1", messageID, type: "text", text: value, time: done ? { start: 1, end: 2 } : { start: 1 } } } })
const toolPart = (callID: string, state: object, tool = "bash", messageID = "a1") =>
  ev({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: `part_${callID}`, sessionID: "ses_1", messageID, type: "tool", callID, tool, state } } })
const status = (type: string, extra: object = {}) => ev({ type: "session.status", properties: { sessionID: "ses_1", status: { type, ...extra } } })
const idle = status("idle")
const busy = status("busy")
const settle = () => Bun.sleep(10)

describe("starting and finishing", () => {
  test("a prompt starts a run: the agent is called at once and a live card appears", async () => {
    const t = harness()
    expect(await t.runs.submit(target, text("블로그 만들어줘"))).toBe("started")
    await settle()
    expect(t.log.prompts).toHaveLength(1)
    expect(t.log.typing).toBeGreaterThan(0)
    expect(t.log.cards[0].view).toMatchObject({ state: "running", model: "anthropic/claude-sonnet-4-6", branch: "thread/x", project: "blog", directory: "/work/blog" })
    expect(t.runs.isBusy("ses_1")).toBe(true)
  })

  test("the answer is its own message; the card ends as done, and a summary is reported", async () => {
    const t = harness()
    await t.runs.submit(target, text("hi"))
    await t.runs.handle(busy)
    await t.runs.handle(user())
    await t.runs.handle(textPart("p_user", "u1", "hi"))
    await t.runs.handle(assistant("a1"))
    await t.runs.handle(textPart("p1", "a1", "Hel", false))
    await t.runs.handle(textPart("p1", "a1", "Hello!"))
    await t.runs.handle(assistant("a1", { finish: "stop" }))
    await t.runs.handle(textPart("p1", "a1", "Hello!"))
    await t.runs.handle(idle)

    expect(t.log.answers).toEqual(["Hello!"])
    expect(t.lastCard().state).toBe("done")
    expect(t.runs.isBusy("ses_1")).toBe(false)
    expect(t.log.idle).toHaveLength(1)
    expect(t.log.idle[0]).toMatchObject({ state: "done", answer: "Hello!", tools: 0 })
  })

  test("text before a tool call is narration on the card, not a separate answer", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(assistant("a1"))
    await t.runs.handle(textPart("p1", "a1", "먼저 파일 구조를 볼게요"))
    await t.runs.handle(assistant("a1", { finish: "tool-calls" }))
    await t.runs.handle(assistant("a2"))
    await t.runs.handle(textPart("p2", "a2", "끝났어요"))
    await t.runs.handle(assistant("a2", { finish: "stop" }))
    await t.runs.handle(idle)
    expect(t.log.answers).toEqual(["끝났어요"])
    expect(t.lastCard().narration).toEqual(["먼저 파일 구조를 볼게요"])
  })

  test("a part that arrives before its message is held until the role is known", async () => {
    const t = harness()
    await t.runs.submit(target, text("hi"))
    await t.runs.handle(busy)
    await t.runs.handle(textPart("p_user", "u1", "hi"))
    await t.runs.handle(textPart("p1", "a1", "answer"))
    expect(t.log.answers).toEqual([])
    await t.runs.handle(user())
    await t.runs.handle(assistant("a1", { finish: "stop" }))
    await t.runs.handle(idle)
    expect(t.log.answers).toEqual(["answer"])
  })

  test("text of a turn that never reported its end is still delivered when the agent goes idle", async () => {
    const t = harness()
    await t.runs.submit(target, text("hi"))
    await t.runs.handle(busy)
    await t.runs.handle(assistant("a1"))
    await t.runs.handle(textPart("p1", "a1", "partial but final", false))
    await t.runs.handle(idle)
    expect(t.log.answers).toEqual(["partial but final"])
  })

  test("an idle that arrives before any activity belongs to the previous turn and is ignored", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(idle)
    expect(t.runs.isBusy("ses_1")).toBe(true)
    await t.runs.handle(busy)
    await t.runs.handle(idle)
    expect(t.runs.isBusy("ses_1")).toBe(false)
  })

  test("the legacy session.idle event still ends a run", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(ev({ type: "session.idle", properties: { sessionID: "ses_1" } }))
    expect(t.runs.isBusy("ses_1")).toBe(false)
  })
})

describe("instructions while the agent is working", () => {
  test("go to the agent immediately instead of waiting, and show on the card", async () => {
    const t = harness()
    await t.runs.submit(target, text("first"))
    await t.runs.handle(busy)
    expect(await t.runs.submit(target, text("스타일은 어둡게"))).toBe("steered")
    expect(await t.runs.submit(target, text("그리고 로고도"))).toBe("steered")
    expect(t.log.prompts.map((item) => item.parts)).toEqual([[{ type: "text", text: "first" }], [{ type: "text", text: "스타일은 어둡게" }], [{ type: "text", text: "그리고 로고도" }]])
    await settle()
    expect(t.runs.view("ses_1")?.steered).toBe(2)
    expect(t.runs.isBusy("ses_1")).toBe(true)
  })

  test("a rejected steering prompt is reported to the caller", async () => {
    const t = harness({ failSteer: true })
    await t.runs.submit(target, text("first"))
    await t.runs.handle(busy)
    await expect(t.runs.submit(target, text("more"))).rejects.toThrow("steer rejected")
    expect(t.runs.view("ses_1")?.steered).toBe(0)
  })

  test("a prompt that arrives while the run is closing starts a new run instead of joining the finished one", async () => {
    const t = harness()
    await t.runs.submit(target, text("first"))
    await t.runs.handle(busy)
    const finishing = t.runs.handle(idle)
    const second = t.runs.submit(target, text("second"))
    await finishing
    expect(await second).toBe("started")
    expect(t.log.prompts).toHaveLength(2)
    expect(t.runs.view("ses_1")).toMatchObject({ state: "running", steered: 0 })
  })

  test("work that starts on its own (a prompt that raced the end of the last run) gets a card instead of vanishing", async () => {
    const t = harness()
    await t.runs.submit(target, text("first"))
    await t.runs.handle(busy)
    await t.runs.handle(idle)
    expect(t.runs.isBusy("ses_1")).toBe(false)
    await t.runs.handle(busy)
    expect(t.runs.isBusy("ses_1")).toBe(true)
    await t.runs.handle(assistant("a9"))
    await t.runs.handle(textPart("p9", "a9", "late answer"))
    await t.runs.handle(assistant("a9", { finish: "stop" }))
    await t.runs.handle(idle)
    expect(t.log.answers).toEqual(["late answer"])
  })
})

describe("the live card", () => {
  test("tool calls appear with their state, timing, files and diff stats", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(assistant("a1"))
    await t.runs.handle(toolPart("c1", { status: "running", input: { command: "npm test" }, time: { start: 1000 } }))
    await t.runs.handle(toolPart("c1", { status: "completed", input: { command: "npm test" }, output: "ok", title: "", metadata: { exit: 0 }, time: { start: 1000, end: 4200 } }))
    await t.runs.handle(
      toolPart("c2", {
        status: "completed",
        input: { filePath: "/work/blog/src/a.ts" },
        output: "ok",
        title: "src/a.ts",
        metadata: { filediff: { file: "src/a.ts", additions: 12, deletions: 3 } },
        time: { start: 5000, end: 5100 },
      }, "edit"),
    )
    await t.runs.handle(idle)
    const tools = t.lastCard().tools
    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({ tool: "bash", status: "completed", started: 1000, ended: 4200 })
    expect(tools[1]).toMatchObject({ tool: "edit", file: "/work/blog/src/a.ts", additions: 12, deletions: 3 })
    expect(t.log.idle[0].files).toEqual(["/work/blog/src/a.ts"])
  })

  test("a command that exits non-zero shows as failed with the tail of its output", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(assistant("a1"))
    await t.runs.handle(toolPart("c1", { status: "completed", input: { command: "npm run build" }, output: "line1\nline2\nError: boom", title: "", metadata: { exit: 1 }, time: { start: 1, end: 2 } }))
    await t.runs.handle(toolPart("c2", { status: "error", input: { command: "x" }, error: "command not found", time: { start: 1, end: 2 } }))
    await t.runs.handle(idle)
    const [first, second] = t.lastCard().tools
    expect(first).toMatchObject({ status: "error", exit: 1, tail: "line1\nline2\nError: boom" })
    expect(second).toMatchObject({ status: "error", tail: "command not found" })
  })

  test("todo updates, token usage and cost are tracked", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(ev({ type: "todo.updated", properties: { sessionID: "ses_1", todos: [{ content: "빌드", status: "completed" }, { content: "배포", status: "in_progress" }, { content: "?", status: "weird" }] } }))
    await t.runs.handle(assistant("a1"))
    await t.runs.handle(ev({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "s1", sessionID: "ses_1", messageID: "a1", type: "step-finish", reason: "stop", cost: 0.01, tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 300, write: 100 } } } } }))
    await t.runs.handle(ev({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "s1", sessionID: "ses_1", messageID: "a1", type: "step-finish", reason: "stop", cost: 0.01, tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 300, write: 100 } } } } }))
    await t.runs.handle(ev({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "s2", sessionID: "ses_1", messageID: "a1", type: "step-finish", reason: "stop", cost: 0.02, tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } } } }))
    await t.runs.handle(idle)
    const view = t.lastCard()
    expect(view.todos.map((todo) => todo.status)).toEqual(["completed", "in_progress", "pending"])
    expect(view.tokens).toEqual({ input: 1500, output: 350, cache: 400 })
    expect(view.cost).toBeCloseTo(0.03)
  })

  test("card edits are throttled but the first card and the final card always go out", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(assistant("a1"))
    await settle()
    const before = t.log.cards.length
    for (let index = 0; index < 20; index++) await t.runs.handle(toolPart(`c${index}`, { status: "completed", input: { command: `c${index}` }, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } }))
    await settle()
    expect(t.log.cards.length - before).toBeLessThanOrEqual(1)
    expect(t.log.cards.every((card, index) => index === 0 || card.edited)).toBe(true)
    await t.runs.handle(idle)
    expect(t.lastCard().tools).toHaveLength(20)
    expect(t.lastCard().state).toBe("done")
  })
})

describe("failures, stops and moves", () => {
  test("provider errors end the card as failed with the reason", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(ev({ type: "session.error", properties: { sessionID: "ses_1", error: { name: "ProviderAuthError", data: { message: "bad key" } } } }))
    await t.runs.handle(idle)
    expect(t.lastCard()).toMatchObject({ state: "failed", failure: "ProviderAuthError: bad key" })
  })

  test("stopping ends the card as stopped and an abort error is not a failure", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    expect(await t.runs.abort("ses_1")).toBe(true)
    expect(t.log.aborted).toEqual(["ses_1"])
    await t.runs.handle(ev({ type: "session.error", properties: { sessionID: "ses_1", error: { name: "MessageAbortedError", data: { message: "x" } } } }))
    await t.runs.handle(idle)
    expect(t.lastCard()).toMatchObject({ state: "stopped" })
    expect(t.lastCard().failure).toBeUndefined()
    expect(await t.runs.abort("ses_1")).toBe(false)
  })

  test("a prompt that cannot be started fails the card and frees the session", async () => {
    const t = harness({ failPrompt: "server down" })
    await t.runs.submit(target, text("go"))
    expect(t.lastCard()).toMatchObject({ state: "failed", failure: "server down" })
    expect(t.runs.isBusy("ses_1")).toBe(false)
  })

  test("moving the thread to another session closes the card as moved", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.moveAway("ses_1")
    expect(t.lastCard().state).toBe("moved")
    expect(t.log.aborted).toEqual(["ses_1"])
    expect(t.runs.view("ses_1")).toBeUndefined()
  })
})

describe("permissions and housekeeping", () => {
  test("permission requests go to Discord with the tool and patterns, or are approved automatically", async () => {
    const asking = harness()
    await asking.runs.submit(target, text("go"))
    await asking.runs.handle(ev({ type: "permission.asked", properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["rm -rf build", "ls"], metadata: {}, always: [] } }))
    expect(asking.log.permissions).toEqual([{ id: "per_1", tool: "bash", detail: "rm -rf build, ls" }])
    expect(asking.log.approvals).toEqual([])

    const auto = harness({ autoApprove: true })
    await auto.runs.submit(target, text("go"))
    await auto.runs.handle(ev({ type: "permission.asked", properties: { id: "per_2", sessionID: "ses_1", permission: "bash", patterns: ["ls"], metadata: {}, always: [] } }))
    expect(auto.log.approvals).toEqual(["per_2:once"])
  })

  test("reconcile finishes a run whose idle event was missed, but leaves a running one alone", async () => {
    const t = harness()
    await t.runs.submit(target, text("go"))
    await t.runs.handle(busy)
    await t.runs.handle(assistant("a1"))
    await t.runs.handle(textPart("p1", "a1", "done"))
    t.advance(30_000)
    t.log.statuses = { ses_1: { type: "busy" } }
    await t.runs.reconcile()
    expect(t.runs.isBusy("ses_1")).toBe(true)
    t.log.statuses = {}
    await t.runs.reconcile()
    expect(t.runs.isBusy("ses_1")).toBe(false)
    expect(t.log.answers).toEqual(["done"])
  })

  test("events for unknown sessions are ignored", async () => {
    const t = harness()
    await t.runs.handle(textPart("p1", "a1", "stray"))
    await t.runs.handle(idle)
    expect(t.log.answers).toEqual([])
    expect(t.log.cards).toEqual([])
  })
})
