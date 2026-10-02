import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Change or inspect the bot's settings for this Discord conversation. Use it when the user asks to switch the model ("claude sonnet 모델로 바꿔줘", "use opus", "gpt-5로 변경") or asks which models exist.

Actions:
- set_model: pass the user's words as "query" (for example "claude sonnet"). The bot matches them against the connected providers' models and picks the newest match. scope "thread" (default) changes only this conversation; scope "default" changes new conversations and is owner-only.
- models: list models, optionally filtered by "query".
- get: show the current thread/default model.
- reset_model: remove the override so the default is used again.

The change takes effect from the user's NEXT message, so tell them to send their next message. Do not edit config files to change the model. If no model matches, say which providers are connected instead of guessing.`,
  args: {
    action: tool.schema.enum(["set_model", "models", "get", "reset_model"]).describe("What to do"),
    query: tool.schema.string().optional().describe("Model words from the user, for example 'claude sonnet' or 'gpt-5'"),
    scope: tool.schema.enum(["thread", "default"]).optional().describe("thread = this conversation (default), default = new conversations (owner only)"),
  },
  async execute(args, context) {
    return call("/settings", { session_id: context.sessionID, ...args })
  },
})
