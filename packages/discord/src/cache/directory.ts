import { ChannelType, type Client, type Guild, type GuildMember } from "discord.js"

export type MemberInfo = {
  id: string
  username: string
  global_name: string | null
  display_name: string
  nickname: string | null
  bot: boolean
  roles: string[]
  joined_at: number | null
}

export type ChannelInfo = {
  id: string
  name: string
  type: string
  parent_id: string | null
  topic: string | null
}

export type RoleInfo = {
  id: string
  name: string
  color: string
  position: number
  member_count: number
}

export type GuildInfo = {
  id: string
  name: string
  member_count: number
  cached_members: number
  members_ready: boolean
}

/** Read-only view of what the gateway already delivered. Nothing here may call the REST API. */
export type Directory = {
  guilds(): GuildInfo[]
  members(guildId: string): MemberInfo[] | undefined
  channels(guildId: string): ChannelInfo[] | undefined
  roles(guildId: string): RoleInfo[] | undefined
}

export type WarmStatus = { status: "pending" | "warming" | "ready" | "failed"; cached: number; error?: string }

export class MemberWarmer {
  private readonly states = new Map<string, WarmStatus>()

  constructor(private readonly client: Client) {}

  status(guildId: string): WarmStatus {
    return this.states.get(guildId) ?? { status: "pending", cached: 0 }
  }

  async warmAll() {
    // One guild at a time keeps REQUEST_GUILD_MEMBERS well below the gateway send limit.
    for (const guild of this.client.guilds.cache.values()) await this.warm(guild)
  }

  async warm(guild: Guild) {
    if (this.status(guild.id).status === "ready" || this.status(guild.id).status === "warming") return
    for (const attempt of [1, 2, 3]) {
      this.states.set(guild.id, { status: "warming", cached: guild.members.cache.size })
      const failure = await guild.members
        .fetch({ time: 180_000 })
        .then(() => undefined)
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
      if (failure === undefined) {
        this.states.set(guild.id, { status: "ready", cached: guild.members.cache.size })
        console.log(`[members] ${guild.name}: cached ${guild.members.cache.size}/${guild.memberCount} members`)
        return
      }
      this.states.set(guild.id, { status: "failed", cached: guild.members.cache.size, error: failure })
      console.warn(`[members] ${guild.name}: attempt ${attempt} failed: ${failure}`)
      await Bun.sleep(attempt * 5_000)
    }
  }
}

export function createDirectory(client: Client, warmer: MemberWarmer): Directory {
  return {
    guilds: () =>
      [...client.guilds.cache.values()].map((guild) => ({
        id: guild.id,
        name: guild.name,
        member_count: guild.memberCount,
        cached_members: guild.members.cache.size,
        members_ready: warmer.status(guild.id).status === "ready",
      })),
    members: (guildId) => {
      const guild = client.guilds.cache.get(guildId)
      return guild && [...guild.members.cache.values()].map(memberInfo)
    },
    channels: (guildId) => {
      const guild = client.guilds.cache.get(guildId)
      return (
        guild &&
        [...guild.channels.cache.values()].map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: ChannelType[channel.type] ?? String(channel.type),
          parent_id: channel.parentId,
          topic: "topic" in channel ? (channel.topic ?? null) : null,
        }))
      )
    },
    roles: (guildId) => {
      const guild = client.guilds.cache.get(guildId)
      return (
        guild &&
        [...guild.roles.cache.values()].map((role) => ({
          id: role.id,
          name: role.name,
          color: role.hexColor,
          position: role.position,
          member_count: role.members.size,
        }))
      )
    },
  }
}

export function memberInfo(member: GuildMember): MemberInfo {
  return {
    id: member.id,
    username: member.user.username,
    global_name: member.user.globalName,
    display_name: member.displayName,
    nickname: member.nickname,
    bot: member.user.bot,
    roles: [...member.roles.cache.keys()].filter((id) => id !== member.guild.id),
    joined_at: member.joinedTimestamp,
  }
}
