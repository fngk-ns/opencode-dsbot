import { ChannelType, OverwriteType, PermissionFlagsBits, type Client, type Guild, type GuildBasedChannel, type GuildChannelCreateOptions } from "discord.js"
import type { AdminPermission, ChannelKind, GuildPort } from "../admin/types"
import type { Directory } from "../cache/directory"
import { snowflakeTime } from "../store/messages"

const KIND: Record<ChannelKind, GuildChannelCreateOptions["type"]> = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  forum: ChannelType.GuildForum,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
}

const BULK_LIMIT_MS = 14 * 86_400_000
// Messages older than 14 days cannot be bulk deleted and go one by one, so cap how many of those a single request may make.
const MAX_SINGLE_DELETES = 20

/** discord.js implementation of the admin port. Reads come from the gateway cache; only the actions themselves are REST calls. */
export function createGuildPort(client: Client, guildId: string, directory: Directory): GuildPort | undefined {
  const guild = client.guilds.cache.get(guildId)
  if (!guild || !client.user) return
  const botId = client.user.id

  const channel = (id: string) => {
    const found = guild.channels.cache.get(id)
    if (!found) throw new Error(`채널 ${id} 을(를) 찾을 수 없습니다.`)
    return found
  }
  const member = (id: string) => {
    const found = guild.members.cache.get(id)
    if (!found) throw new Error(`멤버 ${id} 이(가) 캐시에 없습니다.`)
    return found
  }
  const privateOverwrites = (viewers: string[] | undefined) =>
    viewers
      ? [
          { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
          ...viewers.map((id) => ({ id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] })),
        ]
      : undefined

  return {
    guildId,
    ownerId: guild.ownerId,
    botId,
    members: () => directory.members(guildId) ?? [],
    channels: () => directory.channels(guildId) ?? [],
    roles: () => directory.roles(guildId) ?? [],

    can(userId: string, permission: AdminPermission, channelId?: string) {
      const who = guild.members.cache.get(userId)
      if (!who) return false
      const where = channelId ? guild.channels.cache.get(channelId) : undefined
      const granted = where ? where.permissionsFor(who) : who.permissions
      return granted?.has(PermissionFlagsBits[permission]) ?? false
    },
    topRole: (userId) => guild.members.cache.get(userId)?.roles.highest.position ?? 0,
    rolePosition: (roleId) => guild.roles.cache.get(roleId)?.position ?? 0,

    timeout: async (userId, until, reason) => void (await member(userId).timeout(until === null ? null : Math.max(until - Date.now(), 1000), reason)),
    kick: async (userId, reason) => void (await guild.members.kick(userId, reason)),
    ban: async (userId, reason, deleteSeconds) => void (await guild.members.ban(userId, { reason, deleteMessageSeconds: deleteSeconds })),
    unban: async (userId, reason) => void (await guild.members.unban(userId, reason)),

    async deleteMessages(channelId, ids) {
      const target = channel(channelId)
      if (!target.isTextBased()) throw new Error("메시지를 지울 수 있는 채널이 아닙니다.")
      const recent = ids.filter((id) => Date.now() - snowflakeTime(id) < BULK_LIMIT_MS)
      const old = ids.filter((id) => !recent.includes(id)).slice(0, MAX_SINGLE_DELETES)
      let deleted = 0
      if (recent.length >= 2) deleted += (await target.bulkDelete(recent, true)).size
      for (const id of recent.length === 1 ? [...recent, ...old] : old) {
        await target.messages.delete(id).then(() => (deleted += 1))
      }
      return deleted
    },

    async createChannel(input) {
      const created = await guild.channels.create({
        name: input.name,
        type: KIND[input.kind],
        parent: input.categoryId,
        topic: input.topic,
        permissionOverwrites: privateOverwrites(input.privateFor),
        reason: input.reason,
      } as GuildChannelCreateOptions)
      return { id: created.id, name: created.name }
    },
    async createCategory(input) {
      const created = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: privateOverwrites(input.privateFor),
        reason: input.reason,
      })
      return { id: created.id, name: created.name }
    },
    async createThread(input) {
      const parent = channel(input.channelId)
      if (!("threads" in parent)) throw new Error("이 채널에서는 스레드를 만들 수 없습니다.")
      if (parent.type === ChannelType.GuildForum || parent.type === ChannelType.GuildMedia) {
        const post = await parent.threads.create({ name: input.name, message: { content: input.firstMessage ?? input.name }, reason: input.reason })
        return { id: post.id, name: post.name }
      }
      // Announcement channels only allow announcement threads, so the thread type is chosen for text channels alone.
      const thread = await (parent.type === ChannelType.GuildText
        ? input.messageId
          ? parent.threads.create({ name: input.name, startMessage: input.messageId, autoArchiveDuration: 1440, reason: input.reason })
          : parent.threads.create({ name: input.name, type: input.private ? ChannelType.PrivateThread : ChannelType.PublicThread, autoArchiveDuration: 1440, reason: input.reason })
        : parent.threads.create({ name: input.name, startMessage: input.messageId, autoArchiveDuration: 1440, reason: input.reason }))
      if (input.firstMessage) await thread.send(input.firstMessage)
      return { id: thread.id, name: thread.name }
    },
    renameChannel: async (channelId, name, reason) => void (await channel(channelId).setName(name, reason)),
    moveChannel: async (channelId, categoryId, reason) => {
      const target = channel(channelId)
      if (!("setParent" in target)) throw new Error("이 채널은 카테고리로 옮길 수 없습니다.")
      await target.setParent(categoryId, { lockPermissions: false, reason })
    },
    deleteChannel: async (channelId, reason) => void (await channel(channelId).delete(reason)),
    setTopic: async (channelId, topic, reason) => {
      const target = channel(channelId)
      if (target.isThread()) throw new Error("스레드에는 주제를 설정할 수 없습니다.")
      await target.edit({ topic, reason })
    },
    setSlowmode: async (channelId, seconds, reason) => {
      const target = channel(channelId)
      if (target.isThread()) return void (await target.setRateLimitPerUser(seconds, reason))
      await target.edit({ rateLimitPerUser: seconds, reason })
    },
    async createRole(input) {
      // Always a plain role without permissions; granting permissions is left to a human in the server settings.
      const created = await guild.roles.create({ name: input.name, color: input.color as `#${string}` | undefined, permissions: [], reason: input.reason })
      return { id: created.id, name: created.name }
    },
    addRole: async (userId, roleId, reason) => void (await member(userId).roles.add(roleId, reason)),
    removeRole: async (userId, roleId, reason) => void (await member(userId).roles.remove(roleId, reason)),
    setNickname: async (userId, nickname, reason) => void (await guild.members.edit(userId, { nick: nickname, reason })),
    async sendMessage(channelId, content) {
      const target = channel(channelId)
      if (!target.isSendable()) throw new Error("메시지를 보낼 수 없는 채널입니다.")
      return { id: (await target.send({ content: content.slice(0, 2000) })).id }
    },
    async pin(channelId, messageId, pinned, reason) {
      const target = channel(channelId)
      if (!target.isTextBased()) throw new Error("메시지를 고정할 수 없는 채널입니다.")
      await (pinned ? target.messages.pin(messageId, reason) : target.messages.unpin(messageId, reason))
    },
  }
}

export type { Guild, GuildBasedChannel }
