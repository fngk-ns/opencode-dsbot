import { mkdir } from "node:fs/promises"
import path from "node:path"
import { MessageFlags, type Client, type Interaction, type Message, type SendableChannels } from "discord.js"
import type { Lookup } from "./api/server"
import type { Engine } from "./bridge/opencode"
import { systemPrompt, userPrompt, type ReferenceContext } from "./bridge/prompt"
import type { RunManager } from "./bridge/runs"
import type { MemberWarmer } from "./cache/directory"
import { parseModel, type Config } from "./config"
import { HELP_TEXT, parseDirectives, type Directive } from "./directives"
import { saveAttachments, toFilePart } from "./discord/files"
import { findMessageLinks } from "./discord/links"
import { toStored } from "./discord/record"
import type { DiscordSurface } from "./discord/surface"
import type { Binding, BindingStore } from "./store/bindings"
import type { MessageStore, StoredAttachment } from "./store/messages"

export type RouterDeps = {
  client: Client
  config: Config
  messages: MessageStore
  bindings: BindingStore
  runs: RunManager
  engine: Engine
  lookup: Lookup
  warmer: MemberWarmer
  surface: DiscordSurface
  restartNow(reason: string, channelId: string): Promise<void>
}

const IN_PLACE = new Set<Directive["kind"]>(["help", "status", "cache", "stop", "restart"])
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Turns Discord traffic into opencode prompts.
 *  - `@bot request` in a channel starts a thread on that message and a session bound to the thread.
 *  - Inside a bound thread (or a DM) every message from an allowed user continues the session; no mention needed.
 */
export function createRouter(deps: RouterDeps) {
  const chains = new Map<string, Promise<void>>()

  /** Handles messages from one channel strictly in order, so thread/session setup cannot race itself. */
  function onMessage(message: Message) {
    // Every message is cached first, before any filtering. This is what makes later lookups free of REST calls.
    deps.messages.save(toStored(message))
    const previous = chains.get(message.channelId) ?? Promise.resolve()
    const next = previous
      .then(() => handle(message))
      .catch((error: unknown) => console.error("[router] message failed:", error))
      .finally(() => {
        if (chains.get(message.channelId) === next) chains.delete(message.channelId)
      })
    chains.set(message.channelId, next)
  }

  async function handle(message: Message) {
    if (message.author.bot || message.system) return
    if (message.guildId && deps.config.guildIds.size > 0 && !deps.config.guildIds.has(message.guildId)) return

    const bound = deps.bindings.get(message.channelId)
    const mentioned = mentionsBot(message)
    if (!bound && !mentioned) return
    // `// text` lets people talk among themselves inside a bot thread without triggering it.
    if (bound && !mentioned && message.content.startsWith("//")) return
    if (!deps.config.userIds.has(message.author.id)) {
      if (mentioned) await message.react("🔒").catch(() => undefined)
      return
    }

    const parsed = parseDirectives(stripMention(message.content, deps.client.user!.id))
    // A bare command such as `@bot /status` is answered in place instead of opening a thread for nothing.
    const commandOnly = !parsed.rest && parsed.directives.length > 0 && parsed.directives.every((item) => IN_PLACE.has(item.kind))
    const target = bound || commandOnly ? await sendable(message.channelId) : await openThread(message, parsed.rest)
    if (!target) return

    const owner = deps.config.ownerIds.has(message.author.id)
    const notice = (text: string) => target.send(text).catch(() => undefined)

    const immediate = await runCommands(parsed.directives, { message, target, owner, notice })
    if (immediate) return

    const binding = await ensureBinding({ message, target, directives: parsed.directives, owner, title: parsed.rest, notice })
    if (!binding) return

    const stored = toStored(message)
    const context = await gather(message, binding.directory)
    if (!parsed.rest && stored.attachments.length === 0 && !context.replyTo) {
      if (parsed.directives.some((item) => item.kind === "new" || item.kind === "self" || item.kind === "project"))
        await notice(`✅ 세션 준비됨 — \`${binding.directory}\`${binding.kind === "self" ? " (봇 자신의 코드)" : ""}`)
      return
    }

    const prompt = userPrompt({
      author: { id: message.author.id, name: message.member?.displayName ?? message.author.username },
      channelLabel: channelLabel(message, target),
      now: new Date(),
      text: parsed.rest,
      replyTo: context.replyTo,
      linked: context.linked,
      saved: context.saved,
      skipped: context.skipped,
    })
    const model = parseModel(binding.model ?? undefined) ?? deps.config.model
    const result = await deps.runs.submit(
      { sessionId: binding.session_id, channelId: target.id, directory: binding.directory },
      {
        parts: [{ type: "text", text: prompt }, ...context.saved.flatMap((file) => toFilePart(file) ?? [])],
        system: systemPrompt({
          kind: binding.kind,
          directory: binding.directory,
          selfDir: deps.config.selfDir,
          maxUploadMb: Math.round(deps.config.maxUploadBytes / 1024 / 1024),
        }),
        model,
        agent: binding.agent ?? deps.config.agent,
      },
    )
    if (result === "queued") await message.react("📥").catch(() => undefined)
  }

  async function openThread(message: Message, text: string) {
    const channel = message.channel
    if (channel.isDMBased()) return channel.isSendable() ? channel : undefined
    if (channel.isThread()) {
      if (channel.joinable) await channel.join().catch(() => undefined)
      return channel
    }
    if (message.hasThread && message.thread) return message.thread
    return message
      .startThread({ name: text.replace(/\s+/g, " ").trim().slice(0, 90) || "opencode", autoArchiveDuration: 1440 })
      .catch(async (error: unknown) => {
        await message.reply(`스레드를 만들 수 없습니다: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined)
        return undefined
      })
  }

  async function sendable(channelId: string): Promise<SendableChannels | undefined> {
    return deps.surface.channel(channelId).catch(() => undefined)
  }

  /** Commands that answer immediately and do not need (or must not start) a prompt. Returns true when the message is fully handled. */
  async function runCommands(
    directives: Directive[],
    input: { message: Message; target: SendableChannels; owner: boolean; notice(text: string): Promise<unknown> },
  ) {
    const has = (kind: Directive["kind"]) => directives.some((item) => item.kind === kind)
    const binding = deps.bindings.get(input.target.id)

    if (has("help")) {
      await input.notice(HELP_TEXT)
      return true
    }
    if (has("stop")) {
      const stopped = binding ? await deps.runs.abort(binding.session_id) : false
      await input.notice(stopped ? "⏹️ 작업을 중단했습니다." : "진행 중인 작업이 없습니다.")
      return true
    }
    if (has("restart")) {
      if (!input.owner) {
        await input.notice("재시작은 소유자만 할 수 있습니다.")
        return true
      }
      await deps.restartNow("manual /restart", input.target.id)
      return true
    }
    if (has("cache")) {
      await input.notice(cacheReport())
      return true
    }
    if (has("status")) {
      const lines = binding
        ? [
            `세션 \`${binding.session_id}\` · ${binding.kind === "self" ? "봇 코드(/self)" : "프로젝트"}`,
            `폴더 \`${binding.directory}\``,
            `상태 ${deps.runs.isBusy(binding.session_id) ? `작업 중 (대기열 ${deps.runs.queued(binding.session_id)})` : "대기 중"}`,
            `모델 ${binding.model ?? deps.config.model?.modelID ?? "기본값"} · 에이전트 ${binding.agent ?? deps.config.agent ?? "기본값"}`,
          ]
        : ["아직 세션이 없습니다. 요청 내용을 보내면 시작됩니다."]
      await input.notice([...lines, "", cacheReport()].join("\n"))
      return true
    }
    return false
  }

  function cacheReport() {
    const overall = deps.messages.coverage()
    const guilds = deps.client.guilds.cache.map((guild) => {
      const state = deps.warmer.status(guild.id)
      return `• ${guild.name}: 멤버 ${guild.members.cache.size}/${guild.memberCount} (${state.status})`
    })
    return [
      "**캐시 현황** (조회는 캐시 기준, ID/링크 지정 시에만 API 사용)",
      ...guilds,
      `• 메시지 ${overall.count}개${overall.oldest ? ` · ${new Date(overall.oldest).toISOString()} 이후` : ""}`,
    ].join("\n")
  }

  async function ensureBinding(input: {
    message: Message
    target: SendableChannels
    directives: Directive[]
    owner: boolean
    title: string
    notice(text: string): Promise<unknown>
  }) {
    const existing = deps.bindings.get(input.target.id)
    const find = <K extends Directive["kind"]>(kind: K) => input.directives.find((item): item is Extract<Directive, { kind: K }> => item.kind === kind)
    const fresh = find("new")
    const wantsSelf = find("self")
    const project = find("project")
    const model = find("model")
    const agent = find("agent")

    if (existing && !fresh) {
      if (wantsSelf || project) {
        await input.notice("프로젝트/`/self` 는 새 세션을 시작할 때만 고를 수 있어요. `/new /project 이름 …` 처럼 `/new` 와 함께 쓰세요.")
        return
      }
      if (model || agent) deps.bindings.update(existing.channel_id, { model: model?.model, agent: agent?.name })
      return deps.bindings.get(existing.channel_id)
    }

    if (wantsSelf && !input.owner) {
      await input.notice("`/self` 는 소유자만 사용할 수 있습니다.")
      return
    }
    if (project && !PROJECT_NAME.test(project.name)) {
      await input.notice("프로젝트 이름은 영문/숫자/`.`/`_`/`-` 만 쓸 수 있어요 (최대 64자).")
      return
    }

    const kind = wantsSelf ? ("self" as const) : ("project" as const)
    const directory = wantsSelf ? deps.config.selfDir : path.join(deps.config.workspaceDir, project?.name ?? "default")
    await mkdir(directory, { recursive: true })
    const sessionId = await deps.engine
      .createSession(directory, `Discord ${input.message.author.username}: ${input.title.slice(0, 60) || input.target.id}`)
      .catch(async (error: unknown) => {
        await input.notice(`세션을 만들지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      })
    if (!sessionId) return

    if (existing) deps.runs.forget(existing.session_id)
    const binding: Binding = {
      channel_id: input.target.id,
      session_id: sessionId,
      directory,
      kind,
      owner_id: input.message.author.id,
      model: model?.model ?? existing?.model ?? null,
      agent: agent?.name ?? existing?.agent ?? null,
      created_at: Date.now(),
    }
    deps.bindings.set(binding)
    return binding
  }

  /** Everything around the message text: the message it replies to, linked messages, and uploaded files. */
  async function gather(message: Message, directory: string) {
    const refId = message.reference?.messageId
    let replyTo: ReferenceContext | undefined
    let referenced: StoredAttachment[] = []
    if (refId) {
      // Replying names the message by ID, so a cache miss may use the one allowed API fallback.
      const found = await deps.lookup.message({ ref: refId, channel_id: message.reference?.channelId ?? message.channelId })
      if (found.ok) {
        replyTo = { author: found.message.author.name, content: found.message.content, link: found.message.link }
        referenced = deps.messages.get(refId)?.attachments ?? []
      }
    }

    const linked: ReferenceContext[] = []
    for (const link of findMessageLinks(message.content).slice(0, 3)) {
      if (link.ref.messageId === refId) continue
      const found = await deps.lookup.message({ ref: link.url })
      if (!found.ok) continue
      if (message.guildId && found.message.guild_id !== message.guildId) continue
      linked.push({ author: found.message.author.name, content: found.message.content, link: found.message.link })
    }

    const own = toStored(message).attachments
    const attachments = own.length > 0 ? own : referenced
    const files = await saveAttachments({
      attachments,
      directory,
      messageId: message.id,
      maxBytes: deps.config.maxDownloadBytes,
    })
    return { replyTo, linked, saved: files.saved, skipped: files.skipped }
  }

  async function onInteraction(interaction: Interaction) {
    if (!interaction.isButton()) return
    const [kind, ...rest] = interaction.customId.split(":")
    if (kind !== "perm" && kind !== "restart") return
    if (!deps.config.ownerIds.has(interaction.user.id)) {
      await interaction.reply({ content: "소유자만 승인할 수 있습니다.", flags: MessageFlags.Ephemeral }).catch(() => undefined)
      return
    }

    if (kind === "perm") {
      const [response, sessionId, permissionId] = rest
      const directory = deps.bindings.bySession(sessionId)?.directory
      if (!directory || (response !== "once" && response !== "always" && response !== "reject")) return
      await deps.engine.respondPermission(sessionId, permissionId, response, directory).catch(() => undefined)
      const label = response === "reject" ? "❌ 거부" : response === "always" ? "✅ 항상 허용" : "✅ 한 번 허용"
      await interaction.update({ content: `${interaction.message.content}\n→ ${label} (${interaction.user.username})`, components: [] })
      return
    }

    if (rest[0] === "no") {
      await interaction.update({ content: `${interaction.message.content}\n→ 취소됨`, components: [] })
      return
    }
    await interaction.update({ content: `${interaction.message.content}\n→ 재시작 승인 (${interaction.user.username})`, components: [] })
    await deps.restartNow("self-modification approved", interaction.channelId)
  }

  return { onMessage, onInteraction }
}

export function mentionsBot(message: Message) {
  const user = message.client.user
  return !!user && message.mentions.has(user, { ignoreEveryone: true, ignoreRoles: true, ignoreRepliedUser: true })
}

export function stripMention(content: string, botId: string) {
  return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim()
}

function channelLabel(message: Message, target: SendableChannels) {
  if (message.channel.isDMBased()) return "DM"
  const parent = target.isThread() ? target.parent?.name : undefined
  return `${message.guild?.name ?? "server"} / #${parent ?? ("name" in target ? target.name : target.id)}${target.isThread() ? ` (thread ${target.id})` : ""}`
}
