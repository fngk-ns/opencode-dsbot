import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `The bot's persistent memory, shared by EVERY thread and kept even when this conversation is compacted or restarted. Use it for anything that must not be forgotten.

Save (action=save): durable facts, user preferences, decisions and their reasons, and every ongoing task.
- kind: fact | preference | decision | task | note. Tasks start "open"; set status to done/blocked as work progresses (action=update with id).
- scope: global = true everywhere (owner only); guild = this server (owner only); project = this project (default); thread = only this thread.
- Saving the same title again updates that entry. Never store secrets or passwords.
Recall: action=search (words), list (optionally by kind/status/scope), get (id).
Other threads: action=threads lists every thread ever started with what it was about, so you can find earlier work ("the deployment thread from last week").
Remove: action=forget (id) archives an entry.

The "Shared memory" briefing at the top of a message is built from this same store.`,
  args: {
    action: tool.schema.enum(["save", "update", "forget", "get", "search", "list", "threads"]).describe("What to do"),
    scope: tool.schema.enum(["global", "guild", "project", "thread"]).optional().describe("Where the note applies (default project)"),
    kind: tool.schema.enum(["fact", "preference", "decision", "task", "note"]).optional().describe("Type of note (default fact)"),
    status: tool.schema.enum(["active", "open", "done", "blocked", "archived"]).optional().describe("Tasks: open/blocked/done"),
    title: tool.schema.string().optional().describe("Short unique title (max 120 chars)"),
    body: tool.schema.string().optional().describe("The content (max 4000 chars)"),
    pinned: tool.schema.boolean().optional().describe("Always show in the briefing (owner only)"),
    id: tool.schema.number().optional().describe("Entry id for get/update/forget"),
    query: tool.schema.string().optional().describe("Words to search for"),
    limit: tool.schema.number().optional().describe("Max results"),
  },
  async execute(args, context) {
    return call("/memory", { session_id: context.sessionID, ...args })
  },
})
