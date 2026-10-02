import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Threads are branches of the conversation. Every thread shares the bot's common memory; a branch can also inherit this conversation's history.

- fork: branch THIS conversation into a new sibling thread. It inherits the full history, and in a git project it gets its own git branch and worktree cut from the current commit, so work in the two threads cannot collide. Give a title and optionally a prompt to start working in the new thread right away.
- new: open a fresh thread with a blank conversation (shared memory only), also on its own git branch in a git project.
- info: details of this thread (parent, branch, summary). list: every thread ever started, searchable with "query". close: archive this thread (its memory and journal are kept).

Use fork when the user wants to try something in parallel or split a task off; use new for an unrelated topic. Merging a branch back is done with git in the main checkout (see your instructions).`,
  args: {
    action: tool.schema.enum(["fork", "new", "info", "list", "close"]).describe("What to do"),
    title: tool.schema.string().optional().describe("Thread title (fork/new)"),
    prompt: tool.schema.string().optional().describe("First instruction for the new thread (fork/new)"),
    query: tool.schema.string().optional().describe("list: words to search thread titles and summaries"),
    limit: tool.schema.number().optional().describe("list: max results"),
  },
  async execute(args, context) {
    return call("/threads", { session_id: context.sessionID, ...args })
  },
})
