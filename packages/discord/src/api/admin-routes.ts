import { z } from "zod"
import type { AdminActions } from "../admin/actions"
import type { AuditLog } from "../admin/audit"
import type { AdminRequest } from "../admin/types"
import { reply, type ApiContext } from "./shared"

const id = z.string().min(1)
const reason = z.string().max(300).optional()

const request = z.discriminatedUnion("action", [
  z.object({ action: z.literal("timeout"), user: id, minutes: z.number(), reason }),
  z.object({ action: z.literal("untimeout"), user: id, reason }),
  z.object({ action: z.literal("kick"), user: id, reason }),
  z.object({ action: z.literal("ban"), user: id, reason, delete_days: z.number().optional() }),
  z.object({ action: z.literal("unban"), user_id: id, reason }),
  z.object({
    action: z.literal("delete_messages"),
    count: z.number().optional(),
    channel: z.string().optional(),
    user: z.string().optional(),
    contains: z.string().optional(),
    message_ids: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("create_channel"),
    name: id,
    type: z.enum(["text", "voice", "forum", "announcement", "stage"]).optional(),
    category: z.string().optional(),
    topic: z.string().max(1024).optional(),
    private: z.boolean().optional(),
  }),
  z.object({ action: z.literal("create_category"), name: id, private: z.boolean().optional() }),
  z.object({
    action: z.literal("create_thread"),
    name: id,
    channel: z.string().optional(),
    message_id: z.string().optional(),
    private: z.boolean().optional(),
    first_message: z.string().max(2000).optional(),
  }),
  z.object({ action: z.literal("rename_channel"), channel: id, name: id }),
  z.object({ action: z.literal("move_channel"), channel: id, category: z.string().optional() }),
  z.object({ action: z.literal("delete_channel"), channel: id }),
  z.object({ action: z.literal("set_topic"), channel: id, topic: z.string().max(1024) }),
  z.object({ action: z.literal("set_slowmode"), channel: id, seconds: z.number() }),
  z.object({ action: z.literal("create_role"), name: id, color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }),
  z.object({ action: z.literal("add_role"), user: id, role: id }),
  z.object({ action: z.literal("remove_role"), user: id, role: id }),
  z.object({ action: z.literal("set_nickname"), user: id, nickname: z.string().max(32).optional() }),
  z.object({ action: z.literal("send_message"), channel: id, content: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("pin"), message: id, channel: z.string().optional() }),
  z.object({ action: z.literal("unpin"), message: id, channel: z.string().optional() }),
])

const audit = z.object({ action: z.literal("audit"), limit: z.number().optional() })

export type AdminRouteDeps = {
  admin: AdminActions
  audit: AuditLog
  isOwner(userId: string | null): boolean
  speakerName(guildId: string, userId: string): string
}

/** Moderation and server management on behalf of whoever asked. The request is validated here; permissions are decided in AdminActions. */
export async function adminRoute(deps: AdminRouteDeps, context: ApiContext, raw: unknown) {
  if (!context.guildId) return reply(200, { ok: false, error: "server management is only available inside a server" })
  if (!context.speakerId) return reply(200, { ok: false, error: "could not tell who is asking" })

  const input = (raw ?? {}) as { action?: unknown }
  if (input.action === "audit") {
    const parsed = audit.safeParse(raw)
    if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
    if (!deps.isOwner(context.speakerId)) return reply(200, { ok: false, error: "only an owner can read the audit log" })
    return reply(200, {
      ok: true,
      entries: deps.audit.recent(context.guildId, parsed.data.limit).map((entry) => ({
        at: new Date(entry.at).toISOString(),
        actor: `<@${entry.actor_id}>`,
        action: entry.action,
        target: entry.target,
        ok: entry.ok,
        detail: entry.detail,
      })),
    })
  }

  const parsed = request.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const result = await deps.admin.execute(
    { guildId: context.guildId, channelId: context.channelId, speakerId: context.speakerId, speakerName: deps.speakerName(context.guildId, context.speakerId) },
    parsed.data as AdminRequest,
  )
  return reply(200, result)
}
