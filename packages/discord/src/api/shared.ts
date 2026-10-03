import type { BindingKind } from "../store/bindings"

/** What the bot knows about the Discord thread behind an opencode session. */
export type ApiContext = {
  channelId: string
  guildId: string | null
  directory: string
  /** Project name (worktrees map back to their project), or null in the workspace home. Used for project-scoped memory. */
  project: string | null
  /** The project's trunk checkout, where deployments run from. */
  trunk: string | null
  /** The git branch this thread works on, when it has one. */
  branch: string | null
  kind: BindingKind
  /** The person whose message is being answered, used for owner-only settings. */
  speakerId: string | null
}

export function reply(status: number, payload: object) {
  return Response.json(payload, { status })
}
