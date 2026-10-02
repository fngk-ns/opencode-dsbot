import type { BindingKind } from "../store/bindings"

/** What the bot knows about the Discord thread behind an opencode session. */
export type ApiContext = {
  channelId: string
  guildId: string | null
  directory: string
  /** Project name (worktrees map back to their project), used for project-scoped memory. */
  project: string
  kind: BindingKind
  /** The person whose message is being answered, used for owner-only settings. */
  speakerId: string | null
}

export function reply(status: number, payload: object) {
  return Response.json(payload, { status })
}
