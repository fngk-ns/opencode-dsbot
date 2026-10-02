import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Restart the Discord bot so it runs the code you just changed. Only available in a /self session.

The bot first runs "bun run check", "bun test" and the typecheck against its own source. If anything fails you receive the output: fix it and call this tool again. When verification passes, the owner confirms the restart in Discord (or it restarts immediately if auto-restart is on). The thread continues after the restart.`,
  args: {
    reason: tool.schema.string().describe("One short sentence describing what changed"),
  },
  async execute(args, context) {
    return call("/restart", { session_id: context.sessionID, ...args })
  },
})
