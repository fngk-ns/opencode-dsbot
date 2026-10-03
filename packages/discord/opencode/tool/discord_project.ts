import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Projects are the sites and apps this bot has built. Each is a git repository whose main checkout (trunk) is never edited directly: every Discord thread works on its own git branch in its own worktree, and finish merges that work back so the next thread, in any channel, starts from everything built so far.

A new thread starts in the workspace home, outside any project. Your first job is to place it:
- find: look up existing projects from the user's words ("저번에 만든 블로그"); open the best match. list shows all of them.
- open: move this thread into an existing project. create: start a new project (name: lowercase letters, digits, dashes; add a title, a description and aliases the user would say, such as 블로그). Both give this thread its own branch and worktree and start a fresh agent session there with the user's request handed over.
- After open or create, STOP: end your turn without further tool calls. The new session continues the task in the project.
- finish: when the work is done and, if asked, deployed, merge this thread's branch into trunk. Give a summary of what changed; it is stored in the project's history and the shared memory. Deploy with discord_service from the project (it runs trunk, so finish first).
- info: where this thread is (project, branch, worktree, trunk). describe: update a project's title, description or aliases so it can be found later.`,
  args: {
    action: tool.schema.enum(["list", "find", "create", "open", "finish", "info", "describe"]).describe("What to do"),
    name: tool.schema.string().optional().describe("Project name (open/create/describe)"),
    title: tool.schema.string().optional().describe("Human title, for example 내 블로그 (create/describe)"),
    description: tool.schema.string().optional().describe("What the project is (create/describe)"),
    aliases: tool.schema.array(tool.schema.string()).optional().describe("Other names the user may call it, for finding it again (create/describe)"),
    query: tool.schema.string().optional().describe("find: the user's words about the project"),
    summary: tool.schema.string().optional().describe("finish: one or two sentences on what changed"),
  },
  async execute(args, context) {
    return call("/projects", { session_id: context.sessionID, ...args })
  },
})
