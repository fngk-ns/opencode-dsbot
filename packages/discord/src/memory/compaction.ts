import type { Engine, Event } from "../bridge/opencode"
import type { BindingStore, KeyValueStore } from "../store/bindings"
import type { MemoryStore } from "./store"

export const digestKey = (sessionId: string) => `digest:${sessionId}`

export type CompactionDeps = {
  engine: Engine
  memory: MemoryStore
  bindings: BindingStore
  kv: KeyValueStore
  /** Context window of a model in tokens, if known. */
  contextLimit(providerID: string, modelID: string): Promise<number | undefined>
  notify(channelId: string, text: string): Promise<void>
  /** Compact once the conversation uses this share of the window (default 0.7). */
  ratio?: number
  /** Threshold in tokens when the window size is unknown. */
  fallbackTokens?: number
  /** Do not compact the same session again within this time. */
  cooldownMs?: number
  now?: () => number
}

type Usage = { tokens: number; providerID: string; modelID: string }

/**
 * Keeps long conversations alive. opencode compacts on its own when the window is nearly full; this also compacts at a
 * calm moment (when the session is idle) before that point, keeps the summary in the thread journal, and makes the next
 * prompt carry the shared memory again, so nothing important depends on what survived the summary.
 */
export class CompactionManager {
  private readonly usage = new Map<string, Usage>()
  private readonly working = new Set<string>()
  private readonly lastRun = new Map<string, number>()

  constructor(private readonly deps: CompactionDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now()
  }

  /** Feed every opencode event here. */
  async observe(event: Event) {
    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.role !== "assistant" || !info.time.completed || info.summary) return
      this.usage.set(info.sessionID, {
        tokens: info.tokens.input + info.tokens.output + info.tokens.cache.read + info.tokens.cache.write,
        providerID: info.providerID,
        modelID: info.modelID,
      })
      return
    }
    // opencode compacted by itself: keep its summary and refresh the memory briefing.
    if (event.type === "session.compacted" && !this.working.has(event.properties.sessionID)) {
      await this.capture(event.properties.sessionID, "auto")
    }
  }

  /** Call when a session has just gone idle with nothing queued. Returns whether it compacted. */
  async afterIdle(sessionId: string) {
    const usage = this.usage.get(sessionId)
    const binding = this.deps.bindings.bySession(sessionId)
    if (!usage || !binding || this.working.has(sessionId)) return false

    const limit = await this.deps.contextLimit(usage.providerID, usage.modelID)
    const threshold = limit ? limit * (this.deps.ratio ?? 0.7) : (this.deps.fallbackTokens ?? 120_000)
    if (usage.tokens < threshold) return false
    if (this.now() - (this.lastRun.get(sessionId) ?? -Infinity) < (this.deps.cooldownMs ?? 5 * 60_000)) return false

    this.working.add(sessionId)
    this.lastRun.set(sessionId, this.now())
    try {
      await this.deps.notify(binding.channel_id, "🗜️ 대화가 길어져서 지금 요약해 둘게요. 공통 메모리와 작업 목록은 따로 저장되어 있어서 그대로 유지됩니다.")
      await this.deps.engine.summarize(sessionId, binding.directory, { providerID: usage.providerID, modelID: usage.modelID })
      await this.capture(sessionId, "proactive")
      return true
    } catch (error) {
      await this.deps.notify(binding.channel_id, `⚠️ 대화 요약에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined)
      return false
    } finally {
      this.working.delete(sessionId)
    }
  }

  private async capture(sessionId: string, source: "auto" | "proactive") {
    const binding = this.deps.bindings.bySession(sessionId)
    if (!binding) return
    this.usage.delete(sessionId)
    this.lastRun.set(sessionId, this.now())
    // After a compaction the earlier briefing may be gone from the window, so the next prompt must repeat it.
    this.deps.kv.delete(digestKey(sessionId))
    const summary = await this.deps.engine.summaryOf(sessionId, binding.directory).catch(() => undefined)
    if (summary) this.deps.memory.setSummary(binding.channel_id, summary.slice(0, 6000))
    if (source === "auto") await this.deps.notify(binding.channel_id, "🗜️ 대화를 자동으로 요약했어요.").catch(() => undefined)
  }
}
