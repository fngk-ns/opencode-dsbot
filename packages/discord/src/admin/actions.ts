import { scoreMembers } from "../cache/lookup"
import { parseMessageRef } from "../discord/links"
import type { ChannelInfo, MemberInfo, RoleInfo } from "../cache/directory"
import { snowflakeTime, type MessageStore } from "../store/messages"
import type { AuditLog } from "./audit"
import type { PendingActions } from "./pending"
import type { AdminContext, AdminPermission, AdminRequest, AdminResult, GuildPort } from "./types"

export type AdminDeps = {
  guild(guildId: string): GuildPort | undefined
  messages: MessageStore
  audit: AuditLog
  pending: PendingActions
  isOwner(userId: string): boolean
  /** Posts the confirm/cancel buttons for a destructive request. */
  askConfirm(channelId: string, confirmId: string, description: string): Promise<void>
  /** Deleting more messages than this needs a confirmation. */
  confirmDeleteAbove?: number
}

type Prepared = {
  permission: AdminPermission
  channelId?: string
  description: string
  target: string
  confirm: boolean
  run(reason: string): Promise<string>
}

type Failure = { ok: false; error: string; candidates?: string[] }

// Moderation never acts on a fuzzy "contains" hit: the name must match exactly or start with what was typed.
const SERVER_WIDE: Partial<Record<AdminRequest["action"], AdminPermission>> = {
  timeout: "ModerateMembers",
  untimeout: "ModerateMembers",
  kick: "KickMembers",
  ban: "BanMembers",
  unban: "BanMembers",
  create_role: "ManageRoles",
  add_role: "ManageRoles",
  remove_role: "ManageRoles",
  set_nickname: "ManageNicknames",
}

const MIN_MEMBER_SCORE = 60
const MAX_TIMEOUT_MINUTES = 28 * 24 * 60
const DAY_MS = 86_400_000

/**
 * Moderation and server-management requests made in chat ("timeout alice for 10 minutes", "delete the last 5 messages",
 * "make a channel"). The bot acts for a person, so it checks what that person may do, refuses ambiguous targets, asks for
 * a button confirmation before anything hard to undo, and records every attempt.
 */
export class AdminActions {
  constructor(private readonly deps: AdminDeps) {}

  async execute(context: AdminContext, request: AdminRequest): Promise<AdminResult> {
    const port = this.deps.guild(context.guildId)
    if (!port) return fail("서버 정보를 찾을 수 없습니다.")

    // Server-wide permissions are checked first, so a member without them hears "no permission" rather than a target error.
    const early = SERVER_WIDE[request.action]
    if (early && !this.allowed(port, context, { permission: early })) {
      this.log(context, request.action, "-", `permission denied: ${early}`, false)
      return fail(`요청자에게 \`${early}\` 권한이 없어 실행하지 않았습니다.`)
    }

    const prepared = await this.prepare(port, context, request)
    if ("error" in prepared) {
      this.log(context, request.action, "-", `refused: ${prepared.error}`, false)
      return prepared
    }
    if (!this.allowed(port, context, prepared)) {
      this.log(context, request.action, prepared.target, "permission denied", false)
      return fail(`요청자에게 \`${prepared.permission}\` 권한이 없어 실행하지 않았습니다.`)
    }

    const reason = `${("reason" in request && request.reason) || request.action} · ${context.speakerName} 요청 (bot)`.slice(0, 400)
    const execute = async () => {
      const message = await prepared.run(reason).catch((error: unknown) => {
        this.log(context, request.action, prepared.target, errorText(error), false)
        throw error
      })
      this.log(context, request.action, prepared.target, message, true)
      return message
    }

    if (!prepared.confirm) return execute().then(succeed, (error: unknown) => fail(`실패: ${errorText(error)}`))

    const id = this.deps.pending.add({
      description: prepared.description,
      actorId: context.speakerId,
      channelId: context.channelId,
      run: () => execute().catch((error: unknown) => `실패: ${errorText(error)}`),
    })
    await this.deps.askConfirm(context.channelId, id, prepared.description)
    return { ok: true, pending: true, confirm_id: id, message: `확인 버튼을 눌러야 실행됩니다: ${prepared.description}` }
  }

  private allowed(port: GuildPort, context: AdminContext, prepared: Pick<Prepared, "permission" | "channelId">) {
    if (this.deps.isOwner(context.speakerId)) return true
    if (context.speakerId === port.ownerId) return true
    return port.can(context.speakerId, prepared.permission, prepared.channelId)
  }

  private log(context: AdminContext, action: string, target: string, detail: string, ok: boolean) {
    this.deps.audit.record({ actor_id: context.speakerId, guild_id: context.guildId, channel_id: context.channelId, action, target, detail: detail.slice(0, 500), ok })
  }

  private async prepare(port: GuildPort, context: AdminContext, request: AdminRequest): Promise<Prepared | Failure> {
    const channelOrHere = (ref: string | undefined) => (ref ? pickChannel(port.channels(), ref) : pickChannel(port.channels(), context.channelId))

    switch (request.action) {
      case "timeout": {
        const member = this.member(port, context, request.user)
        if ("error" in member) return member
        const minutes = Math.floor(request.minutes)
        if (!(minutes >= 1 && minutes <= MAX_TIMEOUT_MINUTES)) return fail("타임아웃은 1분 ~ 28일(40320분) 사이여야 합니다.")
        const name = label(member.target)
        return ready("ModerateMembers", `${name} 타임아웃 ${minutes}분`, name, false, async (reason) => {
          await port.timeout(member.target.id, Date.now() + minutes * 60_000, reason)
          return `${name} 님을 ${minutes}분 동안 타임아웃했습니다.`
        })
      }
      case "untimeout": {
        const member = this.member(port, context, request.user, false)
        if ("error" in member) return member
        const name = label(member.target)
        return ready("ModerateMembers", `${name} 타임아웃 해제`, name, false, async (reason) => {
          await port.timeout(member.target.id, null, reason)
          return `${name} 님의 타임아웃을 해제했습니다.`
        })
      }
      case "kick": {
        const member = this.member(port, context, request.user)
        if ("error" in member) return member
        const name = label(member.target)
        return ready("KickMembers", `${name} 추방`, name, true, async (reason) => {
          await port.kick(member.target.id, reason)
          return `${name} 님을 추방했습니다.`
        })
      }
      case "ban": {
        const member = this.member(port, context, request.user)
        if ("error" in member) return member
        const name = label(member.target)
        const days = Math.min(Math.max(Math.floor(request.delete_days ?? 0), 0), 7)
        return ready("BanMembers", `${name} 차단${days ? ` (메시지 ${days}일치 삭제)` : ""}`, name, true, async (reason) => {
          await port.ban(member.target.id, reason, days * 86_400)
          return `${name} 님을 차단했습니다.`
        })
      }
      case "unban":
        return ready("BanMembers", `차단 해제 ${request.user_id}`, request.user_id, false, async (reason) => {
          await port.unban(request.user_id, reason)
          return `${request.user_id} 의 차단을 해제했습니다.`
        })
      case "delete_messages":
        return this.prepareDelete(port, context, request)
      case "create_channel": {
        const category = request.category ? pickChannel(port.channels(), request.category, "GuildCategory") : undefined
        if (category && "error" in category) return category
        const kind = request.type ?? "text"
        const name = channelName(request.name, kind)
        return ready("ManageChannels", `채널 생성 #${name}`, name, false, async (reason) => {
          const created = await port.createChannel({
            name,
            kind,
            categoryId: category?.target.id,
            topic: request.topic,
            privateFor: request.private ? [context.speakerId, port.botId] : undefined,
            reason,
          })
          return `채널 <#${created.id}> 을(를) 만들었습니다${category ? ` (카테고리 ${category.target.name})` : ""}.`
        })
      }
      case "create_category":
        return ready("ManageChannels", `카테고리 생성 ${request.name}`, request.name, false, async (reason) => {
          const created = await port.createCategory({ name: request.name, privateFor: request.private ? [context.speakerId, port.botId] : undefined, reason })
          return `카테고리 **${created.name}** 을(를) 만들었습니다 (id ${created.id}).`
        })
      case "create_thread": {
        const channel = channelOrHere(request.channel)
        if ("error" in channel) return channel
        // Threads cannot live inside threads; use the thread's parent text channel instead.
        const parentId = channel.target.parent_id && /Thread/.test(channel.target.type) ? channel.target.parent_id : channel.target.id
        return ready(request.private ? "CreatePrivateThreads" : "CreatePublicThreads", `스레드 생성 ${request.name}`, request.name, false, async (reason) => {
          const created = await port.createThread({
            name: request.name.slice(0, 100),
            channelId: parentId,
            messageId: request.message_id,
            private: request.private,
            firstMessage: request.first_message,
            reason,
          })
          return `스레드 <#${created.id}> 을(를) 만들었습니다.`
        })
      }
      case "rename_channel": {
        const channel = channelOrHere(request.channel)
        if ("error" in channel) return channel
        return ready("ManageChannels", `채널 이름 변경 ${channel.target.name} → ${request.name}`, channel.target.name, false, async (reason) => {
          await port.renameChannel(channel.target.id, request.name, reason)
          return `<#${channel.target.id}> 이름을 \`${request.name}\` 로 바꿨습니다.`
        })
      }
      case "move_channel": {
        const channel = channelOrHere(request.channel)
        if ("error" in channel) return channel
        const category = request.category ? pickChannel(port.channels(), request.category, "GuildCategory") : undefined
        if (category && "error" in category) return category
        return ready("ManageChannels", `채널 이동 ${channel.target.name} → ${category?.target.name ?? "(카테고리 없음)"}`, channel.target.name, false, async (reason) => {
          await port.moveChannel(channel.target.id, category?.target.id ?? null, reason)
          return `<#${channel.target.id}> 을(를) ${category ? `**${category.target.name}**` : "카테고리 밖"} 으로 옮겼습니다.`
        })
      }
      case "delete_channel": {
        const channel = channelOrHere(request.channel)
        if ("error" in channel) return channel
        const kind = channel.target.type === "GuildCategory" ? "카테고리" : "채널"
        return ready("ManageChannels", `${kind} 삭제 ${channel.target.name}`, channel.target.name, true, async (reason) => {
          await port.deleteChannel(channel.target.id, reason)
          return `${kind} **${channel.target.name}** 을(를) 삭제했습니다.`
        })
      }
      case "set_topic": {
        const channel = channelOrHere(request.channel)
        if ("error" in channel) return channel
        return ready("ManageChannels", `주제 변경 ${channel.target.name}`, channel.target.name, false, async (reason) => {
          await port.setTopic(channel.target.id, request.topic, reason)
          return `<#${channel.target.id}> 주제를 바꿨습니다.`
        })
      }
      case "set_slowmode": {
        const channel = channelOrHere(request.channel)
        if ("error" in channel) return channel
        const seconds = Math.min(Math.max(Math.floor(request.seconds), 0), 21_600)
        return ready("ManageChannels", `슬로우모드 ${seconds}초 ${channel.target.name}`, channel.target.name, false, async (reason) => {
          await port.setSlowmode(channel.target.id, seconds, reason)
          return `<#${channel.target.id}> 슬로우모드를 ${seconds ? `${seconds}초` : "해제"}했습니다.`
        })
      }
      case "create_role":
        return ready("ManageRoles", `역할 생성 ${request.name}`, request.name, false, async (reason) => {
          const created = await port.createRole({ name: request.name, color: request.color, reason })
          return `역할 **${created.name}** 을(를) 만들었습니다 (권한 없는 일반 역할).`
        })
      case "add_role":
      case "remove_role": {
        const member = this.member(port, context, request.user, false)
        if ("error" in member) return member
        const role = pickRole(port.roles(), request.role)
        if ("error" in role) return role
        const outranked = !this.deps.isOwner(context.speakerId) && context.speakerId !== port.ownerId && port.rolePosition(role.target.id) >= port.topRole(context.speakerId)
        if (outranked) return fail("자신의 최고 역할보다 높거나 같은 역할은 부여/회수할 수 없습니다.")
        const adding = request.action === "add_role"
        const name = label(member.target)
        return ready("ManageRoles", `${name} 역할 ${adding ? "부여" : "회수"} ${role.target.name}`, name, false, async (reason) => {
          await (adding ? port.addRole(member.target.id, role.target.id, reason) : port.removeRole(member.target.id, role.target.id, reason))
          return `${name} 님${adding ? "에게" : "에게서"} **${role.target.name}** 역할을 ${adding ? "부여" : "회수"}했습니다.`
        })
      }
      case "set_nickname": {
        const member = this.member(port, context, request.user, false)
        if ("error" in member) return member
        const name = label(member.target)
        return ready("ManageNicknames", `${name} 닉네임 변경`, name, false, async (reason) => {
          await port.setNickname(member.target.id, request.nickname ?? null, reason)
          return `${name} 님의 닉네임을 ${request.nickname ? `\`${request.nickname}\`` : "초기화"}했습니다.`
        })
      }
      case "send_message": {
        const channel = channelOrHere(request.channel)
        if ("error" in channel) return channel
        return {
          permission: "SendMessages",
          channelId: channel.target.id,
          description: `메시지 전송 #${channel.target.name}`,
          target: channel.target.name,
          confirm: false,
          run: async () => {
            await port.sendMessage(channel.target.id, request.content)
            return `<#${channel.target.id}> 에 메시지를 보냈습니다.`
          },
        }
      }
      case "pin":
      case "unpin": {
        const ref = parseMessageRef(request.message)
        if (!ref) return fail("고정할 메시지의 링크나 ID가 필요합니다.")
        const channel = channelOrHere(ref.channelId ?? request.channel)
        if ("error" in channel) return channel
        const pinned = request.action === "pin"
        return {
          permission: "ManageMessages",
          channelId: channel.target.id,
          description: `메시지 ${pinned ? "고정" : "고정 해제"}`,
          target: ref.messageId,
          confirm: false,
          run: async (reason) => {
            await port.pin(channel.target.id, ref.messageId, pinned, reason)
            return `메시지를 ${pinned ? "고정" : "고정 해제"}했습니다.`
          },
        }
      }
    }
  }

  /** Targets are picked from the local message cache, so deleting "the last 5 messages" costs no history reads. */
  private prepareDelete(port: GuildPort, context: AdminContext, request: Extract<AdminRequest, { action: "delete_messages" }>): Prepared | Failure {
    const channel = pickChannel(port.channels(), request.channel ?? context.channelId)
    if ("error" in channel) return channel

    let ids = request.message_ids?.filter((id) => /^\d{15,25}$/.test(id))
    let who = ""
    if (!ids || ids.length === 0) {
      let authorId: string | undefined
      if (request.user) {
        const member = this.member(port, context, request.user, false)
        if ("error" in member) return member
        authorId = member.target.id
        who = ` (${label(member.target)})`
      }
      const needle = request.contains?.toLowerCase()
      const wanted = Math.min(Math.max(Math.floor(request.count ?? 10), 1), 100)
      ids = this.deps.messages
        .recent(channel.target.id, { limit: 100 })
        .filter((message) => (!authorId || message.author_id === authorId) && (!needle || message.content.toLowerCase().includes(needle)))
        .slice(0, wanted)
        .map((message) => message.id)
    }
    if (ids.length === 0) return fail("조건에 맞는 캐시된 메시지가 없습니다. (봇이 켜진 뒤의 메시지만 알고 있어요. 오래된 메시지는 링크/ID로 지정해 주세요.)")

    const selected = ids
    const threshold = this.deps.confirmDeleteAbove ?? 10
    const tooOld = selected.filter((id) => Date.now() - snowflakeTime(id) > 14 * DAY_MS).length
    return {
      permission: "ManageMessages",
      channelId: channel.target.id,
      description: `<#${channel.target.id}> 메시지 ${selected.length}개 삭제${who}${tooOld ? ` (14일 지난 ${tooOld}개는 하나씩 삭제)` : ""}`,
      target: channel.target.name,
      confirm: selected.length > threshold,
      run: async () => {
        const deleted = await port.deleteMessages(channel.target.id, selected)
        this.deps.messages.markDeleted(selected)
        return `메시지 ${deleted}개를 삭제했습니다.`
      },
    }
  }

  /** Finds one member, refusing anything ambiguous or fuzzy, then applies the safety rules for acting on that person. */
  private member(port: GuildPort, context: AdminContext, ref: string, hierarchy = true): { target: MemberInfo } | Failure {
    const ranked = scoreMembers(port.members(), ref)
    const best = ranked[0]
    if (!best) return fail(`'${ref}' 에 해당하는 멤버를 캐시에서 찾지 못했습니다.`)
    const tied = ranked.filter((entry) => entry.score === best.score)
    if (best.score < MIN_MEMBER_SCORE || tied.length > 1)
      return { ok: false, error: `'${ref}' 가 누구인지 확실하지 않습니다. ID나 멘션으로 다시 지정해 주세요.`, candidates: ranked.slice(0, 5).map((entry) => `${label(entry.item)} (${entry.item.id})`) }

    const target = best.item
    const owner = this.deps.isOwner(context.speakerId)
    if (target.id === port.botId) return fail("봇 자신에게는 실행할 수 없습니다.")
    if (hierarchy && target.id === port.ownerId) return fail("서버 소유자에게는 실행할 수 없습니다.")
    if (hierarchy && !owner && this.deps.isOwner(target.id)) return fail("봇 소유자에게는 실행할 수 없습니다.")
    if (hierarchy && !owner && context.speakerId !== port.ownerId && port.topRole(target.id) >= port.topRole(context.speakerId))
      return fail("대상의 최고 역할이 요청자와 같거나 더 높아 실행할 수 없습니다.")
    return { target }
  }
}

export function pickChannel(channels: ChannelInfo[], ref: string, type?: string): { target: ChannelInfo } | Failure {
  const pool = type ? channels.filter((channel) => channel.type === type) : channels
  const mention = ref.match(/^<#(\d+)>$/)?.[1]
  const id = mention ?? (/^\d{15,25}$/.test(ref.trim()) ? ref.trim() : undefined)
  if (id) {
    const found = pool.find((channel) => channel.id === id)
    return found ? { target: found } : fail(`id ${id} 에 해당하는 ${type === "GuildCategory" ? "카테고리" : "채널"}가 없습니다.`)
  }

  const needle = normalizeName(ref)
  const exact = pool.filter((channel) => normalizeName(channel.name) === needle)
  const partial = pool.filter((channel) => normalizeName(channel.name).includes(needle))
  const matches = exact.length > 0 ? exact : partial
  if (matches.length === 1) return { target: matches[0] }
  if (matches.length === 0) return fail(`'${ref}' 에 해당하는 ${type === "GuildCategory" ? "카테고리" : "채널"}를 찾지 못했습니다.`)
  return { ok: false, error: `'${ref}' 에 해당하는 항목이 여러 개입니다. ID나 #멘션으로 지정해 주세요.`, candidates: matches.slice(0, 6).map((channel) => `${channel.name} (${channel.id})`) }
}

export function pickRole(roles: RoleInfo[], ref: string): { target: RoleInfo } | Failure {
  const id = ref.match(/^<@&(\d+)>$/)?.[1] ?? (/^\d{15,25}$/.test(ref.trim()) ? ref.trim() : undefined)
  if (id) {
    const found = roles.find((role) => role.id === id)
    return found ? { target: found } : fail(`id ${id} 역할을 찾지 못했습니다.`)
  }
  const needle = ref.trim().replace(/^@/, "").toLowerCase()
  const exact = roles.filter((role) => role.name.toLowerCase() === needle)
  if (exact.length === 1) return { target: exact[0] }
  if (exact.length > 1) return { ok: false, error: `이름이 같은 역할이 여러 개입니다.`, candidates: exact.map((role) => `${role.name} (${role.id})`) }
  return fail(`'${ref}' 역할을 찾지 못했습니다.`)
}

function ready(permission: AdminPermission, description: string, target: string, confirm: boolean, run: (reason: string) => Promise<string>): Prepared {
  return { permission, description, target, confirm, run }
}

function channelName(name: string, kind: string) {
  // Discord lowercases text channel names and replaces spaces with dashes; voice and stage names keep their spelling.
  return kind === "voice" || kind === "stage" ? name.trim().slice(0, 100) : name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 100)
}

function normalizeName(name: string) {
  return name.trim().replace(/^#/, "").toLowerCase().replace(/[\s_]+/g, "-")
}

function label(member: MemberInfo) {
  return member.display_name || member.username
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function fail(error: string): Failure {
  return { ok: false, error }
}

function succeed(message: string): AdminResult {
  return { ok: true, message }
}
