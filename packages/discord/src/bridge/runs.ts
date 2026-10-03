import type { Part, ToolPart } from "@opencode-ai/sdk/v2/client"
import type { RunMeta, RunView, TodoEntry, ToolEntry } from "../ui/view"
import type { Engine, Event } from "./opencode"

export type PromptPart = Parameters<Engine["promptAsync"]>[0]["parts"][number]

export type Pending = {
  parts: PromptPart[]
  system?: string
  model?: { providerID: string; modelID: string }
  agent?: string
}

/** Everything the run manager needs from Discord. The real implementation lives in discord/surface.ts. */
export type Surface = {
  /** Creates the run card, or edits it when `messageId` is given. Returns the message id. */
  showRun(channelId: string, view: RunView, messageId?: string): Promise<string>
  /** A final answer, rendered as its own message. */
  sendAnswer(channelId: string, text: string): Promise<void>
  send(channelId: string, text: string): Promise<void>
  typing(channelId: string): void
  askPermission(channelId: string, permission: { sessionId: string; id: string; tool: string; detail: string }): Promise<void>
}

/** What a finished run did, for the thread journal and the project's history. */
export type RunSummary = {
  state: RunView["state"]
  tools: number
  files: string[]
  steered: number
  elapsedMs: number
  answer: string
}

export type Target = { sessionId: string; channelId: string; directory: string; meta?: RunMeta }

type Message = { role: "user" | "assistant"; finish?: string; texts: Map<string, { text: string; done: boolean; sent: boolean }> }

type Run = {
  target: Target
  view: RunView
  busy: boolean
  finishing?: Promise<void>
  aborted: boolean
  seenActivity: boolean
  messages: Map<string, Message>
  stash: Map<string, Part[]>
  steps: Map<string, { input: number; output: number; cache: number; cost: number }>
  answers: string[]
  cardId?: string
  cardShown: string
  cardDirty: boolean
  lastCard: number
  lastEventAt: number
  outbox: Promise<void>
  typingTimer?: ReturnType<typeof setInterval>
  cardTimer?: ReturnType<typeof setTimeout>
}

const CARD_INTERVAL_MS = 1_500
const STALE_AFTER_MS = 20_000
// A model turn that ends in a tool call is narration on the way to the answer; any other ending is the answer itself.
const CONTINUES = new Set(["tool-calls", "unknown"])

/**
 * Drives opencode sessions on behalf of Discord threads. Prompts go to the agent immediately, even while it is working:
 * opencode folds them into the running loop at the next step. Progress is shown as one live card per run, the agent's
 * answers arrive as their own messages, and permission requests are relayed to Discord.
 */
export class RunManager {
  private readonly runs = new Map<string, Run>()

  constructor(
    private readonly engine: Engine,
    private readonly surface: Surface,
    private readonly options: {
      autoApprove: boolean
      onIdle?: (sessionId: string, channelId: string, summary: RunSummary) => void
      now?: () => number
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  isBusy(sessionId: string) {
    return this.runs.get(sessionId)?.busy ?? false
  }

  view(sessionId: string) {
    return this.runs.get(sessionId)?.view
  }

  /**
   * Hands the prompt to the agent right away. If it is already working the prompt joins the current run ("steered");
   * otherwise it starts a new run. Throws when opencode rejects a steering prompt.
   */
  async submit(target: Target, pending: Pending) {
    const run = this.runFor(target)
    if (run.finishing) await run.finishing
    if (run.busy) {
      await this.engine.promptAsync({ sessionId: run.target.sessionId, directory: run.target.directory, ...pending })
      run.view.steered += 1
      this.scheduleCard(run)
      return "steered" as const
    }
    await this.start(run, pending)
    return "started" as const
  }

  /** Stops the agent. The card ends as "stopped" rather than "done". */
  async abort(sessionId: string) {
    const run = this.runs.get(sessionId)
    if (!run?.busy) return false
    run.aborted = true
    await this.engine.abort(sessionId, run.target.directory).catch(() => undefined)
    return true
  }

  /** The thread moved to another session (a new project, say): close this run's card and stop tracking it. */
  async moveAway(sessionId: string) {
    const run = this.runs.get(sessionId)
    if (!run) return
    if (run.busy) await this.engine.abort(sessionId, run.target.directory).catch(() => undefined)
    run.view.state = "moved"
    run.view.endedAt = this.now()
    this.clearTimers(run)
    await this.flushCard(run).catch(report("card"))
    this.runs.delete(sessionId)
  }

  forget(sessionId: string) {
    const run = this.runs.get(sessionId)
    if (!run) return
    this.clearTimers(run)
    this.runs.delete(sessionId)
  }

  /** Safety net for a missed idle event: asks the server whether quiet runs are really still running. */
  async reconcile() {
    for (const run of [...this.runs.values()]) {
      if (!run.busy || run.finishing || this.now() - run.lastEventAt < STALE_AFTER_MS) continue
      const statuses = await this.engine.status(run.target.directory).catch(() => undefined)
      if (!statuses) continue
      const status = statuses[run.target.sessionId]
      if (!status || status.type === "idle") await this.finish(run)
    }
  }

  async handle(event: Event) {
    if (event.type === "message.updated") return this.onMessage(event.properties.info)
    if (event.type === "message.part.updated") return this.onPart(event.properties.part)
    if (event.type === "todo.updated") return this.onTodos(event.properties.sessionID, event.properties.todos)
    if (event.type === "permission.asked") return this.onPermission(event.properties)
    if (event.type === "session.status") return this.onStatus(event.properties.sessionID, event.properties.status)
    if (event.type === "session.error") return this.onError(event.properties.sessionID, event.properties.error)
    if (event.type === "session.idle") return this.onStatus(event.properties.sessionID, { type: "idle" })
  }

  private runFor(target: Target) {
    const existing = this.runs.get(target.sessionId)
    if (existing) {
      existing.target = { ...existing.target, ...target, meta: target.meta ?? existing.target.meta }
      return existing
    }
    const run: Run = {
      target,
      view: this.freshView(target),
      busy: false,
      aborted: false,
      seenActivity: false,
      messages: new Map(),
      stash: new Map(),
      steps: new Map(),
      answers: [],
      cardShown: "",
      cardDirty: false,
      lastCard: 0,
      lastEventAt: this.now(),
      outbox: Promise.resolve(),
    }
    this.runs.set(target.sessionId, run)
    return run
  }

  private freshView(target: Target): RunView {
    return { ...target.meta, directory: target.directory, state: "running", sessionId: target.sessionId, startedAt: this.now(), tools: [], narration: [], todos: [], steered: 0 }
  }

  private async start(run: Run, pending: Pending) {
    this.begin(run)
    const failure = await this.engine
      .promptAsync({ sessionId: run.target.sessionId, directory: run.target.directory, ...pending })
      .then(() => undefined)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    if (failure === undefined) return
    run.view.failure = failure
    await this.finish(run)
  }

  /** Resets per-run state and puts up a fresh card. */
  private begin(run: Run) {
    run.busy = true
    run.aborted = false
    run.seenActivity = false
    run.messages.clear()
    run.stash.clear()
    run.steps.clear()
    run.answers = []
    run.cardId = undefined
    run.cardShown = ""
    run.view = this.freshView(run.target)
    run.lastEventAt = this.now()
    this.surface.typing(run.target.channelId)
    run.typingTimer = setInterval(() => this.surface.typing(run.target.channelId), 8_000)
    this.scheduleCard(run, true)
  }

  private onMessage(info: { id: string; sessionID: string; role: string; finish?: string; error?: { name: string; data?: unknown }; providerID?: string; modelID?: string }) {
    const run = this.runs.get(info.sessionID)
    if (!run?.busy) return
    run.lastEventAt = this.now()
    run.seenActivity = true
    if (info.role !== "user" && info.role !== "assistant") return

    const message: Message = run.messages.get(info.id) ?? { role: info.role, texts: new Map() }
    message.role = info.role
    message.finish = info.finish ?? message.finish
    run.messages.set(info.id, message)
    if (info.role !== "assistant") return

    if (!run.view.model && info.providerID && info.modelID) run.view.model = `${info.providerID}/${info.modelID}`
    if (info.error && info.error.name !== "MessageAbortedError") run.view.failure = describeError(info.error)

    const stashed = run.stash.get(info.id)
    if (stashed) {
      run.stash.delete(info.id)
      for (const part of stashed) this.onPart(part)
    }
    if (message.finish) this.settle(run, info.id)
    this.scheduleCard(run)
  }

  private onPart(part: Part) {
    const run = this.runs.get(part.sessionID)
    if (!run?.busy) return
    run.lastEventAt = this.now()
    run.seenActivity = true

    const message = run.messages.get(part.messageID)
    if (message?.role === "user") return
    if (!message) {
      // The part arrived before its message; hold it until we know whose message it is.
      run.stash.set(part.messageID, [...(run.stash.get(part.messageID) ?? []).filter((item) => item.id !== part.id), part])
      return
    }

    if (part.type === "text") {
      if (part.synthetic || part.ignored) return
      const entry = message.texts.get(part.id) ?? { text: "", done: false, sent: false }
      entry.text = part.text
      entry.done = !!part.time?.end
      message.texts.set(part.id, entry)
      // A message that already ended as an answer sends each text as soon as it completes.
      if (entry.done && message.finish && !CONTINUES.has(message.finish)) this.settle(run, part.messageID)
      return
    }

    if (part.type === "tool") {
      this.upsertTool(run, part)
      this.scheduleCard(run)
      return
    }

    if (part.type === "step-finish") {
      run.steps.set(part.id, { input: part.tokens.input, output: part.tokens.output + part.tokens.reasoning, cache: part.tokens.cache.read + part.tokens.cache.write, cost: part.cost })
      const all = [...run.steps.values()]
      run.view.tokens = { input: sum(all, "input"), output: sum(all, "output"), cache: sum(all, "cache") }
      run.view.cost = sum(all, "cost")
    }
  }

  /** A model turn ended: its text is an answer if the turn ended the exchange, narration if it was heading into more tool calls. */
  private settle(run: Run, messageId: string, force = false) {
    const message = run.messages.get(messageId)
    if (!message || message.role !== "assistant" || !message.finish) return
    for (const entry of message.texts.values()) {
      // `force` is for the end of the run: text that never reported its end is still the agent's words.
      if ((!entry.done && !force) || entry.sent || !entry.text.trim()) continue
      entry.sent = true
      if (CONTINUES.has(message.finish)) {
        run.view.narration.push(entry.text.trim())
        continue
      }
      run.answers.push(entry.text)
      const text = entry.text
      run.outbox = run.outbox.then(() => this.surface.sendAnswer(run.target.channelId, text)).catch(report("answer"))
    }
  }

  private upsertTool(run: Run, part: ToolPart) {
    const entry = toolEntry(part)
    const known = run.view.tools.findIndex((item) => item.callID === entry.callID)
    if (known === -1) run.view.tools.push(entry)
    else run.view.tools[known] = entry
  }

  private onTodos(sessionId: string, todos: Array<{ content: string; status: string }>) {
    const run = this.runs.get(sessionId)
    if (!run?.busy) return
    run.lastEventAt = this.now()
    run.view.todos = todos.map((todo): TodoEntry => ({ content: todo.content, status: todoStatus(todo.status) }))
    this.scheduleCard(run)
  }

  private async onPermission(permission: { id: string; sessionID: string; permission: string; patterns: string[] }) {
    const run = this.runs.get(permission.sessionID)
    if (!run) return
    run.lastEventAt = this.now()
    run.seenActivity = true
    if (this.options.autoApprove) {
      await this.engine.respondPermission(run.target.sessionId, permission.id, "once", run.target.directory).catch(() => undefined)
      return
    }
    await this.surface
      .askPermission(run.target.channelId, { sessionId: run.target.sessionId, id: permission.id, tool: permission.permission, detail: permission.patterns.join(", ") })
      .catch(() => undefined)
  }

  private async onStatus(sessionId: string, status: { type: string; attempt?: number; message?: string }) {
    const run = this.runs.get(sessionId)
    if (!run) return
    run.lastEventAt = this.now()

    if (status.type === "idle") {
      // An idle that arrives before the server did anything for this prompt belongs to the previous turn.
      if (run.busy && run.seenActivity) await this.finish(run)
      return
    }
    if (!run.busy) {
      // The agent started working without us asking (a prompt that raced the previous run's end, or opencode continuing
      // on its own): show it instead of letting its output vanish.
      if (run.finishing) await run.finishing
      this.begin(run)
    }
    run.seenActivity = true
    run.view.retry = status.type === "retry" ? `재시도 ${status.attempt ?? ""}회: ${status.message ?? ""}`.trim() : undefined
    this.scheduleCard(run)
  }

  private onError(sessionId: string | undefined, error: { name: string; data?: unknown } | undefined) {
    const run = sessionId ? this.runs.get(sessionId) : undefined
    if (!run) return
    run.seenActivity = true
    if (!error || error.name === "MessageAbortedError") return
    run.view.failure = describeError(error)
  }

  private scheduleCard(run: Run, immediate = false) {
    run.cardDirty = true
    if (run.cardTimer) return
    const wait = immediate ? 0 : Math.max(0, run.lastCard + CARD_INTERVAL_MS - this.now())
    run.cardTimer = setTimeout(() => {
      run.cardTimer = undefined
      run.outbox = run.outbox.then(() => this.flushCard(run)).catch(report("card"))
    }, wait)
  }

  private async flushCard(run: Run) {
    const snapshot = JSON.stringify({ ...run.view, tools: run.view.tools.map((tool) => [tool.callID, tool.status, tool.ended]), narration: run.view.narration.length })
    if (!run.cardDirty && run.cardShown === snapshot) return
    run.cardDirty = false
    run.cardShown = snapshot
    run.lastCard = this.now()
    run.cardId = await this.surface.showRun(run.target.channelId, run.view, run.cardId)
  }

  private finish(run: Run) {
    if (!run.busy || run.finishing) return run.finishing ?? Promise.resolve()
    // `busy` stays true until the outbox is drained, so a prompt that arrives meanwhile waits for the end of this run
    // and then starts a new one, instead of being steered into a run that is already over.
    run.finishing = this.close(run).finally(() => {
      run.finishing = undefined
    })
    return run.finishing
  }

  private async close(run: Run) {
    this.clearTimers(run)
    for (const id of run.messages.keys()) {
      const message = run.messages.get(id)!
      // Anything still unsent when the agent goes idle is the answer, whatever the last turn's finish reason was.
      if (message.role === "assistant" && !message.finish) message.finish = "stop"
      this.settle(run, id, true)
    }
    run.view.state = run.aborted ? "stopped" : run.view.failure ? "failed" : "done"
    run.view.endedAt = this.now()
    run.cardDirty = true
    run.outbox = run.outbox.then(() => this.flushCard(run)).catch(report("card"))
    await run.outbox
    run.busy = false

    const files = [...new Set(run.view.tools.flatMap((tool) => (tool.status === "completed" && tool.file ? [tool.file] : [])))]
    this.options.onIdle?.(run.target.sessionId, run.target.channelId, {
      state: run.view.state,
      tools: run.view.tools.length,
      files,
      steered: run.view.steered,
      elapsedMs: (run.view.endedAt ?? this.now()) - run.view.startedAt,
      answer: run.answers.at(-1) ?? "",
    })
  }

  private clearTimers(run: Run) {
    if (run.typingTimer) clearInterval(run.typingTimer)
    if (run.cardTimer) clearTimeout(run.cardTimer)
    run.typingTimer = undefined
    run.cardTimer = undefined
  }
}

function toolEntry(part: ToolPart): ToolEntry {
  const state = part.state
  const metadata = "metadata" in state && state.metadata ? state.metadata : {}
  const diff = metadata.filediff as { file?: string; additions?: number; deletions?: number } | undefined
  const filePath = typeof state.input.filePath === "string" ? state.input.filePath : diff?.file
  const exit = typeof metadata.exit === "number" ? metadata.exit : undefined
  // A shell command that exits non-zero is a completed tool call as far as opencode is concerned, but a failure to a reader.
  const failed = state.status === "error" || (state.status === "completed" && exit !== undefined && exit !== 0)
  const output = state.status === "completed" ? state.output : state.status === "error" ? state.error : undefined
  return {
    callID: part.callID,
    tool: part.tool,
    status: failed ? "error" : state.status,
    title: state.status === "completed" || (state.status === "running" && state.title) ? (state.title ?? "") : "",
    input: state.input,
    started: "time" in state ? state.time.start : undefined,
    ended: state.status === "completed" || state.status === "error" ? state.time.end : undefined,
    exit,
    tail: failed && output ? output.trim().split("\n").slice(-4).join("\n") : undefined,
    file: part.tool === "edit" || part.tool === "write" || part.tool === "apply_patch" ? filePath : undefined,
    additions: diff?.additions,
    deletions: diff?.deletions,
  }
}

function todoStatus(status: string): TodoEntry["status"] {
  return status === "completed" || status === "in_progress" || status === "cancelled" ? status : "pending"
}

function sum<T extends string>(items: Array<Record<T, number>>, key: T) {
  return items.reduce((total, item) => total + item[key], 0)
}

function describeError(error: { name: string; data?: unknown }) {
  const data = error.data as { message?: string } | undefined
  return data?.message ? `${error.name}: ${data.message}` : error.name
}

function report(what: string) {
  return (error: unknown) => console.warn(`[runs] ${what} failed:`, error instanceof Error ? error.message : error)
}
