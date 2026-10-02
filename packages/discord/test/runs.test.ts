import { describe, expect, test } from "bun:test"
import { RunManager, type Pending, type Surface } from "../src/bridge/runs"
import type { Engine, Event } from "../src/bridge/opencode"

const target = { sessionId: "ses_1", channelId: "thread_1", directory: "/work/a" }
const text = (value: string): Pending => ({ parts: [{ type: "text", text: value }] })

function harness(options: { autoApprove?: boolean; failPrompt?: string } = {}) {
  const log = {
    prompts: [] as Array<{ sessionId: string; parts: Pending["parts"] }>,
    sent: [] as string[],
    progress: [] as string[],
    permissions: [] as string[],
    permissionInfo: [] as Array<{ title: string; detail: string }>,
    approvals: [] as string[],
    aborted: [] as string[],
    typing: 0,
    idle: [] as string[],
    statuses: {} as Record<string, { type: string }>,
  }
  const engine: Engine = {
    async promptAsync(input) {
      if (options.failPrompt) throw new Error(options.failPrompt)
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
    async send(_, value) {
      log.sent.push(value)
    },
    async createProgress(_, value) {
      log.progress.push(`create:${value}`)
      return "progress_1"
    },
    async editProgress(_, id, value) {
      log.progress.push(`edit:${id}:${value}`)
    },
    typing() {
      log.typing += 1
    },
    async askPermission(_, permission) {
      log.permissions.push(permission.id)
      log.permissionInfo.push({ title: permission.title, detail: permission.detail })
    },
  }
  let time = 1_000_000
  const runs = new RunManager(engine, surface, {
    autoApprove: options.autoApprove ?? false,
    onIdle: (sessionId) => log.idle.push(sessionId),
    now: () => time,
  })
  return { runs, log, advance: (ms: number) => (time += ms) }
}

const message = (id: string, role: "user" | "assistant", extra: object = {}) =>
  ({ type: "message.updated", properties: { info: { id, sessionID: "ses_1", role, ...extra } } }) as unknown as Event

const textPart = (id: string, messageID: string, value: string, done: boolean) =>
  ({
    type: "message.part.updated",
    properties: { part: { id, sessionID: "ses_1", messageID, type: "text", text: value, time: done ? { start: 1, end: 2 } : { start: 1 } } },
  }) as unknown as Event

const toolPart = (callID: string, status: string, title = "") =>
  ({
    type: "message.part.updated",
    properties: {
      part: {
        id: `part_${callID}`,
        sessionID: "ses_1",
        messageID: "a1",
        type: "tool",
        callID,
        tool: "bash",
        state: { status, input: { command: "ls" }, title, output: "", metadata: {}, time: { start: 1, end: 2 } },
      },
    },
  }) as unknown as Event

const status = (type: string) => ({ type: "session.status", properties: { sessionID: "ses_1", status: { type } } }) as unknown as Event
const idle = status("idle")
const busy = status("busy")

describe("RunManager", () => {
  test("sends completed assistant text once, skips the user's own text, and goes idle", async () => {
    const { runs, log } = harness()
    expect(await runs.submit(target, text("hi"))).toBe("started")
    expect(log.prompts).toHaveLength(1)

    await runs.handle(message("u1", "user"))
    await runs.handle(textPart("p_user", "u1", "hi", true))
    await runs.handle(message("a1", "assistant"))
    await runs.handle(textPart("p1", "a1", "Hel", false))
    await runs.handle(textPart("p1", "a1", "Hello!", true))
    await runs.handle(textPart("p1", "a1", "Hello!", true))
    await runs.handle(idle)

    expect(log.sent).toEqual(["Hello!"])
    expect(log.idle).toEqual(["ses_1"])
    expect(runs.isBusy("ses_1")).toBe(false)
  })

  test("a part that arrives before its message is held until the role is known", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("hi"))
    await runs.handle(textPart("p_user", "u1", "hi", true))
    await runs.handle(textPart("p1", "a1", "answer", true))
    expect(log.sent).toEqual([])
    await runs.handle(message("u1", "user"))
    await runs.handle(message("a1", "assistant"))
    await runs.handle(idle)
    expect(log.sent).toEqual(["answer"])
  })

  test("text that never reported an end is flushed when the session goes idle", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("hi"))
    await runs.handle(message("a1", "assistant"))
    await runs.handle(textPart("p1", "a1", "partial but final", false))
    await runs.handle(idle)
    expect(log.sent).toEqual(["partial but final"])
  })

  test("messages that arrive while busy are queued and sent together as one follow-up", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("first"))
    expect(await runs.submit(target, text("second"))).toBe("queued")
    expect(await runs.submit(target, text("third"))).toBe("queued")
    expect(runs.queued("ses_1")).toBe(2)
    expect(log.prompts).toHaveLength(1)

    await runs.handle(busy)
    await runs.handle(idle)
    expect(log.prompts).toHaveLength(2)
    expect(log.prompts[1].parts).toEqual([
      { type: "text", text: "second" },
      { type: "text", text: "third" },
    ])
    expect(runs.isBusy("ses_1")).toBe(true)
    expect(log.idle).toEqual([])
  })

  test("a message submitted while the run is finishing is queued, never started concurrently", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("first"))
    await runs.handle(busy)
    const finishing = runs.handle(idle)
    const second = await runs.submit(target, text("second"))
    await finishing
    expect(second).toBe("queued")
    expect(log.prompts.map((item) => item.parts)).toEqual([[{ type: "text", text: "first" }], [{ type: "text", text: "second" }]])
  })

  test("tool activity is shown as one progress message that is edited, then finalised", async () => {
    const { runs, log, advance } = harness()
    await runs.submit(target, text("go"))
    await runs.handle(message("a1", "assistant"))
    await runs.handle(toolPart("c1", "running"))
    await Bun.sleep(5)
    advance(5_000)
    await runs.handle(toolPart("c1", "completed", "ls -la"))
    await runs.handle(idle)

    expect(log.progress[0]).toStartWith("create:")
    expect(log.progress.some((item) => item.startsWith("edit:progress_1:"))).toBe(true)
    const last = log.progress[log.progress.length - 1]
    expect(last).toContain("✅ 작업 완료 · 도구 1회")
    expect(last).toContain("ls -la")
  })

  test("provider errors are reported to the thread, aborts are not", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("go"))
    await runs.handle({ type: "session.error", properties: { sessionID: "ses_1", error: { name: "MessageAbortedError", data: { message: "x" } } } } as unknown as Event)
    await runs.handle(idle)
    expect(log.sent).toEqual([])

    await runs.submit(target, text("again"))
    await runs.handle({ type: "session.error", properties: { sessionID: "ses_1", error: { name: "ProviderAuthError", data: { message: "bad key" } } } } as unknown as Event)
    await runs.handle(idle)
    expect(log.sent).toEqual(["⚠️ ProviderAuthError: bad key"])
  })

  test("a failed prompt start is reported and the session is usable again", async () => {
    const { runs, log } = harness({ failPrompt: "server down" })
    await runs.submit(target, text("go"))
    expect(log.sent).toEqual(["⚠️ server down"])
    expect(runs.isBusy("ses_1")).toBe(false)
  })

  test("permission requests go to Discord, or are approved automatically", async () => {
    const asking = harness()
    await asking.runs.submit(target, text("go"))
    await asking.runs.handle({ type: "permission.asked", properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["rm -rf build"], metadata: {}, always: [] } } as unknown as Event)
    expect(asking.log.permissions).toEqual(["per_1"])
    expect(asking.log.approvals).toEqual([])

    const auto = harness({ autoApprove: true })
    await auto.runs.submit(target, text("go"))
    await auto.runs.handle({ type: "permission.asked", properties: { id: "per_2", sessionID: "ses_1", permission: "bash", patterns: ["ls"], metadata: {}, always: [] } } as unknown as Event)
    expect(auto.log.approvals).toEqual(["per_2:once"])
    expect(auto.log.permissions).toEqual([])
  })

  test("abort clears the queue and asks the server to stop", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("first"))
    await runs.submit(target, text("second"))
    expect(await runs.abort("ses_1")).toBe(true)
    expect(log.aborted).toEqual(["ses_1"])
    expect(runs.queued("ses_1")).toBe(0)
    expect(await runs.abort("unknown")).toBe(false)
  })

  test("reconcile finishes a run whose idle event was missed, but leaves a running one alone", async () => {
    const { runs, log, advance } = harness()
    await runs.submit(target, text("go"))
    await runs.handle(message("a1", "assistant"))
    await runs.handle(textPart("p1", "a1", "done", true))

    advance(30_000)
    log.statuses = { ses_1: { type: "busy" } }
    await runs.reconcile()
    expect(runs.isBusy("ses_1")).toBe(true)

    log.statuses = {}
    await runs.reconcile()
    expect(runs.isBusy("ses_1")).toBe(false)
    expect(log.sent).toEqual(["done"])
  })

  test("an idle status that arrives before any activity belongs to the previous turn and is ignored", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("go"))
    await runs.handle(idle)
    expect(runs.isBusy("ses_1")).toBe(true)

    await runs.handle(busy)
    await runs.handle(idle)
    expect(runs.isBusy("ses_1")).toBe(false)
    expect(log.idle).toEqual(["ses_1"])
  })

  test("the legacy session.idle event still ends a run that showed activity", async () => {
    const { runs } = harness()
    await runs.submit(target, text("go"))
    await runs.handle(busy)
    await runs.handle({ type: "session.idle", properties: { sessionID: "ses_1" } } as unknown as Event)
    expect(runs.isBusy("ses_1")).toBe(false)
  })

  test("the permission prompt carries the tool name and the patterns", async () => {
    const { runs, log } = harness()
    await runs.submit(target, text("go"))
    await runs.handle({
      type: "permission.asked",
      properties: { id: "per_9", sessionID: "ses_1", permission: "bash", patterns: ["rm -rf build", "ls"], metadata: {}, always: [] },
    } as unknown as Event)
    expect(log.permissionInfo).toEqual([{ title: "bash", detail: "rm -rf build, ls" }])
  })

  test("events for unknown sessions are ignored", async () => {
    const { runs, log } = harness()
    await runs.handle(textPart("p1", "a1", "stray", true))
    await runs.handle(idle)
    expect(log.sent).toEqual([])
  })
})
