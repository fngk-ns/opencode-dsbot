import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Look up Discord data from the bot's local cache. This is the ONLY way to read Discord messages, members, channels or roles.

The cache holds every current member of the server and every message sent since the bot started, so it answers instantly and never hits Discord rate limits. Results say "source": "cache" or "api".

Actions:
- messages: recent messages of a channel/thread (default: this thread). Use limit, before (message id).
- search: text search over cached messages. Filters: query, channel_id, author_id, since/until (ISO time), include_deleted.
- message: one message by link or ID. Cached copy first; ONLY if that exact message was never seen does the bot fetch it from Discord. Pass a full message link whenever you have one.
- member: one member by id, @mention, username or display name.
- members: list/search members (query, role_id, limit, offset).
- channels, roles, guilds: server structure.

Message history older than "cached_since" is not available; ask the user for a message link in that case.`,
  args: {
    action: tool.schema
      .enum(["messages", "search", "message", "member", "members", "channels", "roles", "guilds"])
      .describe("What to look up"),
    ref: tool.schema.string().optional().describe("message: message link or ID. member: id, mention or name"),
    channel_id: tool.schema.string().optional().describe("Channel or thread ID. Defaults to the current thread"),
    guild_id: tool.schema.string().optional().describe("Server ID. Defaults to the current server"),
    query: tool.schema.string().optional().describe("Search text (search) or name filter (members, channels)"),
    author_id: tool.schema.string().optional().describe("search: only messages from this user ID"),
    role_id: tool.schema.string().optional().describe("members: only members with this role ID"),
    since: tool.schema.string().optional().describe("search: ISO timestamp lower bound"),
    until: tool.schema.string().optional().describe("search: ISO timestamp upper bound"),
    before: tool.schema.string().optional().describe("messages: only messages older than this message ID"),
    include_deleted: tool.schema.boolean().optional().describe("search: include messages that were deleted"),
    limit: tool.schema.number().optional().describe("Max results (default 20 for messages, 25 for members, max 100)"),
    offset: tool.schema.number().optional().describe("members: skip this many results"),
  },
  async execute(args, context) {
    return call("/lookup", { session_id: context.sessionID, ...args })
  },
})
