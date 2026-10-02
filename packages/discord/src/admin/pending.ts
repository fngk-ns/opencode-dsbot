export type PendingAction = {
  id: string
  description: string
  actorId: string
  channelId: string
  expiresAt: number
  run(): Promise<string>
}

/** Destructive actions wait here until the requester (or an owner) presses the confirm button. */
export class PendingActions {
  private readonly actions = new Map<string, PendingAction>()

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  add(input: Omit<PendingAction, "id" | "expiresAt">) {
    this.sweep()
    const id = crypto.randomUUID().slice(0, 8)
    this.actions.set(id, { ...input, id, expiresAt: this.now() + this.ttlMs })
    return id
  }

  /** Confirming consumes the action, so a double click cannot run it twice. */
  take(id: string, userId: string, isOwner: boolean) {
    this.sweep()
    const action = this.actions.get(id)
    if (!action) return { ok: false as const, error: "만료되었거나 이미 처리된 요청입니다." }
    if (action.actorId !== userId && !isOwner) return { ok: false as const, error: "요청한 사람 또는 소유자만 확인할 수 있습니다." }
    this.actions.delete(id)
    return { ok: true as const, action }
  }

  cancel(id: string, userId: string, isOwner: boolean) {
    const found = this.take(id, userId, isOwner)
    return found.ok ? { ok: true as const, description: found.action.description } : found
  }

  private sweep() {
    for (const [id, action] of this.actions) if (action.expiresAt <= this.now()) this.actions.delete(id)
  }
}
