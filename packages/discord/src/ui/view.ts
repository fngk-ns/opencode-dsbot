export type ToolStatus = "pending" | "running" | "completed" | "error"

export type ToolEntry = {
  callID: string
  tool: string
  status: ToolStatus
  /** Short title opencode gave the call, if any. */
  title: string
  input: Record<string, unknown>
  started?: number
  ended?: number
  /** Last lines of the output, for failed commands. */
  tail?: string
  exit?: number
  additions?: number
  deletions?: number
  file?: string
}

export type TodoEntry = { content: string; status: "pending" | "in_progress" | "completed" | "cancelled" }

export type RunState = "running" | "done" | "failed" | "stopped" | "moved"

export type RunMeta = {
  model?: string
  agent?: string
  branch?: string | null
  project?: string | null
  /** Working directory, so file paths can be shown relative to it. */
  directory?: string
}

/** Everything the run card shows. Built by RunManager from opencode events; rendered by ui/run-card.ts. */
export type RunView = RunMeta & {
  state: RunState
  sessionId: string
  startedAt: number
  endedAt?: number
  tools: ToolEntry[]
  /** What the agent said between tool calls, newest last. The final answer is sent as its own message. */
  narration: string[]
  todos: TodoEntry[]
  /** Extra instructions the user sent while the agent was working. */
  steered: number
  retry?: string
  failure?: string
  tokens?: { input: number; output: number; cache: number }
  cost?: number
}
