import type { Part, ToolState } from "@opencode-ai/sdk/v2/client"
import type { Engine, Event } from "./opencode"
import type { OutFile } from "../discord/outbound"

export type PromptPart = Parameters<Engine["promptAsync"]>[0]["parts"][number]

export type Pending = {
  parts: PromptPart[]
  system?: string
  model?: { providerID: string; modelID: string }
  agent?: string
}

/** Everything the run manager needs from Discord. The real implementation lives in discord/surface.ts. */
export type Surface = {
  send(channelId: string, text: string, files?: OutFile[]): Promise<void>
  createProgress(channelId: string, text: string): Promise<string>
  editProgress(channelId: string, messageId: string, text: string): Promise<void>
  typing(channelId: string): void
  askPermission(channelId: string, permission: { sessionId: string; id: string; title: string; detail: string }): Promise<void>
}

type ToolLine = { tool: string; status: "pending" | "running" | "completed" | "error"; label: string }

type Run = {
  sessionId: string
  channelId: string
  directory: string
  busy: boolean
  finishing: boolean
  seenActivity: boolean
  queue: Pending[]
  roles: Map<string, "user" | "assistant">
  stash: Map<string, Part[]>
  texts: Map<string, { text: string; delivered: boolean }>
  tools: Map<string, ToolLine>
  toolCount: number
  progressId?: string
  progressShown: string
  progressDirty: boolean
  lastEdit: number
  failure?: string
  retryNote?: string
  lastEventAt: number
  outbox: Promise<void>
  typingTimer?: ReturnType<typeof setInterval>
  progressTimer?: ReturnType<typeof setTimeout>
}

const PROGRESS_INTERVAL_MS = 2_000
const PROGRESS_LINES = 8
const STALE_AFTER_MS = 20_000

/**
 * Drives opencode sessions on behalf of Discord threads: starts prompts, queues follow-ups while a session is busy,
 * streams text and tool activity back to the thread, and relays permission requests.
 */
export class RunManager {
  private readonly runs = new Map<string, Run>()

  constructor(
    private readonly engine: Engine,
    private readonly surface: Surface,
    private readonly options: {
      autoApprove: boolean
      onIdle?: (sessionId: string, channelId: string) => void
      now?: () => number
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  isBusy(sessionId: string) {
    return this.runs.get(sessionId)?.busy ?? false
  }

  queued(sessionId: string) {
    return this.runs.get(sessionId)?.queue.length ?? 0
  }

  /** Starts the prompt, or queues it behind the one that is running. */
  async submit(target: { sessionId: string; channelId: string; directory: string }, pending: Pending) {
    const run = this.runFor(target)
    if (run.busy) {
      run.queue.push(pending)
      return "queued" as const
    }
    await this.start(run, pending)
    return "started" as const
  }

  async abort(sessionId: string) {
    const run = this.runs.get(sessionId)
    if (!run) return false
    const dropped = run.queue.length
    run.queue.length = 0
    if (run.busy) await this.engine.abort(sessionId, run.directory).catch(() => undefined)
    return run.busy || dropped > 0
  }

  forget(sessionId: string) {
    const run = this.runs.get(sessionId)
    if (!run) return
    this.clearTimers(run)
    this.runs.delete(sessionId)
  }

  /** Safety net for a missed `session.idle`: asks the server whether quiet runs are really still running. */
  async reconcile() {
    for (const run of [...this.runs.values()]) {
      if (!run.busy || this.now() - run.lastEventAt < STALE_AFTER_MS) continue
      const statuses = await this.engine.status(run.directory).catch(() => undefined)
      if (!statuses) continue
      const status = statuses[run.sessionId]
      if (!status || status.type === "idle") await this.finish(run)
    }
  }

  async handle(event: Event) {
    if (event.type === "message.updated") return this.onMessage(event.properties.info)
    if (event.type === "message.part.updated") return this.onPart(event.properties.part)
    if (event.type === "permission.asked") return this.onPermission(event.properties)
    if (event.type === "session.status") return this.onStatus(event.properties.sessionID, event.properties.status)
    if (event.type === "session.error") return this.onError(event.properties.sessionID, event.properties.error)
    if (event.type === "session.idle") return this.onStatus(event.properties.sessionID, { type: "idle" })
  }

  private runFor(target: { sessionId: string; channelId: string; directory: string }) {
    const existing = this.runs.get(target.sessionId)
    if (existing) {
      existing.channelId = target.channelId
      existing.directory = target.directory
      return existing
    }
    const run: Run = {
      sessionId: target.sessionId,
      channelId: target.channelId,
      directory: target.directory,
      busy: false,
      finishing: false,
      seenActivity: false,
      queue: [],
      roles: new Map(),
      stash: new Map(),
      texts: new Map(),
      tools: new Map(),
      toolCount: 0,
      progressShown: "",
      progressDirty: false,
      lastEdit: 0,
      lastEventAt: this.now(),
      outbox: Promise.resolve(),
    }
    this.runs.set(target.sessionId, run)
    return run
  }

  private async start(run: Run, pending: Pending) {
    run.busy = true
    run.seenActivity = false
    run.roles.clear()
    run.texts.clear()
    run.tools.clear()
    run.stash.clear()
    run.toolCount = 0
    run.progressId = undefined
    run.progressShown = ""
    run.progressDirty = false
    run.failure = undefined
    run.retryNote = undefined
    run.lastEventAt = this.now()
    this.surface.typing(run.channelId)
    run.typingTimer = setInterval(() => this.surface.typing(run.channelId), 8_000)

    const failure = await this.engine
      .promptAsync({ sessionId: run.sessionId, directory: run.directory, ...pending })
      .then(() => undefined)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    if (failure === undefined) return
    run.failure = failure
    await this.finish(run)
  }

  private async onMessage(info: { id: string; sessionID: string; role: string; error?: { name: string; data?: unknown } }) {
    const run = this.runs.get(info.sessionID)
    if (!run) return
    run.lastEventAt = this.now()
    run.seenActivity = true
    if (info.role !== "user" && info.role !== "assistant") return
    run.roles.set(info.id, info.role)
    if (info.role === "assistant" && info.error && info.error.name !== "MessageAbortedError")
      run.failure = describeError(info.error)
    const stashed = run.stash.get(info.id)
    if (!stashed) return
    run.stash.delete(info.id)
    if (info.role === "assistant") for (const part of stashed) await this.onPart(part)
  }

  private async onPart(part: Part) {
    const run = this.runs.get(part.sessionID)
    if (!run?.busy) return
    run.lastEventAt = this.now()
    run.seenActivity = true

    const role = run.roles.get(part.messageID)
    if (role === "user") return
    if (role === undefined) {
      // The part arrived before its message; hold it until we know whose message it is.
      run.stash.set(part.messageID, [...(run.stash.get(part.messageID) ?? []).filter((item) => item.id !== part.id), part])
      return
    }

    if (part.type === "text") {
      if (part.synthetic || part.ignored) return
      const entry = run.texts.get(part.id) ?? { text: "", delivered: false }
      entry.text = part.text
      run.texts.set(part.id, entry)
      if (part.time?.end) this.deliverText(run, part.id)
      return
    }

    if (part.type === "tool") {
      if (!run.tools.has(part.callID)) run.toolCount += 1
      run.tools.set(part.callID, { tool: part.tool, status: part.state.status, label: toolLabel(part.state) })
      this.scheduleProgress(run)
    }
  }

  private async onPermission(permission: { id: string; sessionID: string; permission: string; patterns: string[] }) {
    const run = this.runs.get(permission.sessionID)
    if (!run) return
    run.lastEventAt = this.now()
    run.seenActivity = true
    if (this.options.autoApprove) {
      await this.engine.respondPermission(run.sessionId, permission.id, "once", run.directory).catch(() => undefined)
      return
    }
    await this.surface
      .askPermission(run.channelId, {
        sessionId: run.sessionId,
        id: permission.id,
        title: permission.permission,
        detail: permission.patterns.join(", "),
      })
      .catch(() => undefined)
  }

  private async onStatus(sessionId: string, status: { type: string; attempt?: number; message?: string }) {
    const run = this.runs.get(sessionId)
    if (!run?.busy) return
    run.lastEventAt = this.now()
    if (status.type === "idle") {
      // An idle that arrives before the server did anything for this prompt belongs to the previous turn.
      if (run.seenActivity) await this.finish(run)
      return
    }
    run.seenActivity = true
    run.retryNote = status.type === "retry" ? `재시도 ${status.attempt ?? ""}회: ${status.message ?? ""}`.trim() : undefined
    this.scheduleProgress(run)
  }

  private onError(sessionId: string | undefined, error: { name: string; data?: unknown } | undefined) {
    const run = sessionId ? this.runs.get(sessionId) : undefined
    if (!run) return
    run.seenActivity = true
    if (!error || error.name === "MessageAbortedError") return
    run.failure = describeError(error)
  }

  private deliverText(run: Run, partId: string) {
    const entry = run.texts.get(partId)
    if (!entry || entry.delivered || !entry.text.trim()) return
    entry.delivered = true
    const text = entry.text
    run.outbox = run.outbox.then(() => this.surface.send(run.channelId, text)).catch(report("send"))
  }

  private scheduleProgress(run: Run) {
    run.progressDirty = true
    if (run.progressTimer) return
    const wait = Math.max(0, run.lastEdit + PROGRESS_INTERVAL_MS - this.now())
    run.progressTimer = setTimeout(() => {
      run.progressTimer = undefined
      run.outbox = run.outbox.then(() => this.flushProgress(run, false)).catch(report("progress"))
    }, wait)
  }

  private async flushProgress(run: Run, final: boolean) {
    if (!run.progressDirty && !final) return
    const text = renderProgress(run, final)
    if (!text || text === run.progressShown) return
    run.progressDirty = false
    run.progressShown = text
    run.lastEdit = this.now()
    if (run.progressId) return this.surface.editProgress(run.channelId, run.progressId, text)
    run.progressId = await this.surface.createProgress(run.channelId, text)
  }

  private async finish(run: Run) {
    if (!run.busy || run.finishing) return
    // `busy` stays true until the outbox is drained and the queue is checked, so a message arriving meanwhile
    // is queued instead of starting a second prompt on the same session.
    run.finishing = true
    this.clearTimers(run)
    for (const id of run.texts.keys()) this.deliverText(run, id)
    run.outbox = run.outbox.then(() => this.flushProgress(run, true)).catch(report("progress"))
    if (run.failure) {
      const message = `⚠️ ${run.failure}`
      run.outbox = run.outbox.then(() => this.surface.send(run.channelId, message)).catch(report("send"))
    }
    await run.outbox
    run.finishing = false

    const next = run.queue.shift()
    if (!next) {
      run.busy = false
      this.options.onIdle?.(run.sessionId, run.channelId)
      return
    }
    // Everything that arrived while busy goes out as one follow-up turn.
    const rest = run.queue.splice(0)
    await this.start(run, { ...next, parts: [next, ...rest].flatMap((item) => item.parts) })
  }

  private clearTimers(run: Run) {
    if (run.typingTimer) clearInterval(run.typingTimer)
    if (run.progressTimer) clearTimeout(run.progressTimer)
    run.typingTimer = undefined
    run.progressTimer = undefined
  }
}

function renderProgress(run: Run, final: boolean) {
  if (run.tools.size === 0) return run.retryNote ? `⏳ ${run.retryNote}` : ""
  const lines = [...run.tools.values()].slice(-PROGRESS_LINES).map((item) => `${icon(item.status)} **${item.tool}** ${item.label}`.trimEnd())
  const hidden = run.tools.size - lines.length
  const header = final
    ? `${run.failure ? "⚠️" : "✅"} 작업 ${run.failure ? "중단" : "완료"} · 도구 ${run.toolCount}회`
    : `🔧 작업 중… 도구 ${run.toolCount}회${run.retryNote ? ` · ⏳ ${run.retryNote}` : ""}`
  return [header, hidden > 0 ? `… 외 ${hidden}개` : "", ...lines].filter(Boolean).join("\n").slice(0, 1900)
}

function icon(status: ToolLine["status"]) {
  if (status === "completed") return "✅"
  if (status === "error") return "❌"
  return "⚙️"
}

function toolLabel(state: ToolState) {
  if (state.status === "completed") return trim(state.title)
  if (state.status === "error") return trim(state.error)
  if (state.status === "running" && state.title) return trim(state.title)
  const first = Object.values(state.input).find((value): value is string => typeof value === "string")
  return first ? trim(first) : ""
}

function trim(text: string) {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > 90 ? `${line.slice(0, 89)}…` : line
}

function describeError(error: { name: string; data?: unknown }) {
  const data = error.data as { message?: string } | undefined
  return data?.message ? `${error.name}: ${data.message}` : error.name
}

function report(what: string) {
  return (error: unknown) => console.warn(`[runs] ${what} failed:`, error instanceof Error ? error.message : error)
}
