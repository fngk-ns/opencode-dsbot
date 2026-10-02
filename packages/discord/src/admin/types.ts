import type { ChannelInfo, MemberInfo, RoleInfo } from "../cache/directory"

export type AdminPermission =
  | "ModerateMembers"
  | "KickMembers"
  | "BanMembers"
  | "ManageMessages"
  | "ManageChannels"
  | "ManageRoles"
  | "ManageNicknames"
  | "CreatePublicThreads"
  | "CreatePrivateThreads"
  | "SendMessages"

export type ChannelKind = "text" | "voice" | "forum" | "announcement" | "stage"

/** Everything the admin actions need from one Discord server. The discord.js implementation is in discord/guild-port.ts. */
export interface GuildPort {
  guildId: string
  ownerId: string
  botId: string
  members(): MemberInfo[]
  channels(): ChannelInfo[]
  roles(): RoleInfo[]
  can(userId: string, permission: AdminPermission, channelId?: string): boolean
  /** Position of the member's highest role; a higher number outranks a lower one. */
  topRole(userId: string): number
  rolePosition(roleId: string): number

  timeout(userId: string, until: number | null, reason: string): Promise<void>
  kick(userId: string, reason: string): Promise<void>
  ban(userId: string, reason: string, deleteSeconds: number): Promise<void>
  unban(userId: string, reason: string): Promise<void>
  deleteMessages(channelId: string, ids: string[]): Promise<number>
  createChannel(input: { name: string; kind: ChannelKind; categoryId?: string; topic?: string; privateFor?: string[]; reason: string }): Promise<{ id: string; name: string }>
  createCategory(input: { name: string; privateFor?: string[]; reason: string }): Promise<{ id: string; name: string }>
  createThread(input: { name: string; channelId: string; messageId?: string; private?: boolean; firstMessage?: string; reason: string }): Promise<{ id: string; name: string }>
  renameChannel(channelId: string, name: string, reason: string): Promise<void>
  moveChannel(channelId: string, categoryId: string | null, reason: string): Promise<void>
  deleteChannel(channelId: string, reason: string): Promise<void>
  setTopic(channelId: string, topic: string, reason: string): Promise<void>
  setSlowmode(channelId: string, seconds: number, reason: string): Promise<void>
  createRole(input: { name: string; color?: string; reason: string }): Promise<{ id: string; name: string }>
  addRole(userId: string, roleId: string, reason: string): Promise<void>
  removeRole(userId: string, roleId: string, reason: string): Promise<void>
  setNickname(userId: string, nickname: string | null, reason: string): Promise<void>
  sendMessage(channelId: string, content: string): Promise<{ id: string }>
  pin(channelId: string, messageId: string, pinned: boolean, reason: string): Promise<void>
}

export type AdminRequest =
  | { action: "timeout"; user: string; minutes: number; reason?: string }
  | { action: "untimeout"; user: string; reason?: string }
  | { action: "kick"; user: string; reason?: string }
  | { action: "ban"; user: string; reason?: string; delete_days?: number }
  | { action: "unban"; user_id: string; reason?: string }
  | { action: "delete_messages"; count?: number; channel?: string; user?: string; contains?: string; message_ids?: string[] }
  | { action: "create_channel"; name: string; type?: ChannelKind; category?: string; topic?: string; private?: boolean }
  | { action: "create_category"; name: string; private?: boolean }
  | { action: "create_thread"; name: string; channel?: string; message_id?: string; private?: boolean; first_message?: string }
  | { action: "rename_channel"; channel: string; name: string }
  | { action: "move_channel"; channel: string; category?: string }
  | { action: "delete_channel"; channel: string }
  | { action: "set_topic"; channel: string; topic: string }
  | { action: "set_slowmode"; channel: string; seconds: number }
  | { action: "create_role"; name: string; color?: string }
  | { action: "add_role"; user: string; role: string }
  | { action: "remove_role"; user: string; role: string }
  | { action: "set_nickname"; user: string; nickname?: string }
  | { action: "send_message"; channel: string; content: string }
  | { action: "pin"; message: string; channel?: string }
  | { action: "unpin"; message: string; channel?: string }

export type AdminContext = {
  guildId: string
  channelId: string
  speakerId: string
  speakerName: string
}

export type AdminResult =
  | { ok: true; message: string; pending?: undefined }
  | { ok: true; pending: true; confirm_id: string; message: string }
  | { ok: false; error: string; candidates?: string[] }
