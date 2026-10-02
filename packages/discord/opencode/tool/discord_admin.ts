import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Moderate and manage the Discord server on behalf of the person who asked. Examples: "timeout alice for 10 minutes", "delete the last 5 messages", "create a channel", "make a thread", "create a category", "give bob the member role".

Actions: timeout (user, minutes 1-40320), untimeout, kick, ban (delete_days), unban (user_id), delete_messages (count, optional user / contains / channel / message_ids), create_channel (name, type text|voice|forum|announcement|stage, category, topic, private), create_category, create_thread (name, channel, message_id, private, first_message), rename_channel, move_channel (category omitted = out of any category), delete_channel, set_topic, set_slowmode, create_role (plain role, no permissions), add_role / remove_role, set_nickname, send_message (channel, content), pin / unpin (message link or id), audit (owner only).

How it behaves:
- The requester's real Discord permissions are checked (owners of the bot are always allowed). If the bot answers "no permission", tell the user; do not try to work around it.
- Users, channels and roles are matched against the server cache. An ambiguous or fuzzy name is refused with candidates: ask the user which one, or pass an id / @mention / #channel.
- kick, ban, delete_channel and deleting more than 10 messages need a button confirmation: the result says "pending"; tell the user to press the button. Do not repeat the request.
- Messages to delete are chosen from the bot's cache (everything since it started). For older messages ask for links or ids.
- Every attempt is audited.`,
  args: {
    action: tool.schema
      .enum([
        "timeout",
        "untimeout",
        "kick",
        "ban",
        "unban",
        "delete_messages",
        "create_channel",
        "create_category",
        "create_thread",
        "rename_channel",
        "move_channel",
        "delete_channel",
        "set_topic",
        "set_slowmode",
        "create_role",
        "add_role",
        "remove_role",
        "set_nickname",
        "send_message",
        "pin",
        "unpin",
        "audit",
      ])
      .describe("What to do"),
    user: tool.schema.string().optional().describe("Member: id, @mention or exact name"),
    user_id: tool.schema.string().optional().describe("unban: the user id"),
    minutes: tool.schema.number().optional().describe("timeout length in minutes"),
    reason: tool.schema.string().optional().describe("Reason recorded in the audit log"),
    delete_days: tool.schema.number().optional().describe("ban: days of messages to delete (0-7)"),
    count: tool.schema.number().optional().describe("delete_messages: how many (default 10, max 100)"),
    contains: tool.schema.string().optional().describe("delete_messages: only messages containing this text"),
    message_ids: tool.schema.array(tool.schema.string()).optional().describe("delete_messages: explicit message ids"),
    channel: tool.schema.string().optional().describe("Channel: id, #mention or name (default: this thread)"),
    category: tool.schema.string().optional().describe("Category name or id"),
    name: tool.schema.string().optional().describe("Name for a new or renamed channel, category, thread or role"),
    type: tool.schema.enum(["text", "voice", "forum", "announcement", "stage"]).optional().describe("create_channel type (default text)"),
    topic: tool.schema.string().optional().describe("Channel topic"),
    private: tool.schema.boolean().optional().describe("Only the requester and the bot can see it"),
    message_id: tool.schema.string().optional().describe("create_thread: start the thread from this message"),
    message: tool.schema.string().optional().describe("pin/unpin: message link or id"),
    first_message: tool.schema.string().optional().describe("create_thread: first message in the thread"),
    seconds: tool.schema.number().optional().describe("set_slowmode seconds (0 = off)"),
    color: tool.schema.string().optional().describe("create_role color like #ffd700"),
    role: tool.schema.string().optional().describe("Role name or id"),
    nickname: tool.schema.string().optional().describe("set_nickname: new nickname (omit to clear)"),
    content: tool.schema.string().optional().describe("send_message: text"),
    limit: tool.schema.number().optional().describe("audit: entries"),
  },
  async execute(args, context) {
    return call("/admin", { session_id: context.sessionID, ...args })
  },
})
