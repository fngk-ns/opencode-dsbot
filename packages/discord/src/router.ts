import { mkdir } from "node:fs/promises"
import path from "node:path"
import { MessageFlags, type ButtonInteraction, type Client, type Interaction, type Message, type SendableChannels } from "discord.js"
import type { PendingActions } from "./admin/pending"
import type { Lookup } from "./api/server"
import type { Engine } from "./bridge/opencode"
import { systemPrompt, userPrompt, type ReferenceContext } from "./bridge/prompt"
import type { RunManager } from "./bridge/runs"
import { digestKey } from "./memory/compaction"
import { buildDigest, digestHash } from "./memory/digest"
import { scopesFor, type MemoryStore } from "./memory/store"
import type { MemberWarmer } from "./cache/directory"
import { parseModel, type Config } from "./config"
import { resolveModel } from "./models"
import { HELP_TEXT, parseDirectives, type Directive } from "./directives"
import { saveAttachments, toFilePart, type SavedFile } from "./discord/files"
import { findMessageLinks } from "./discord/links"
import { toStored } from "./discord/record"
import type { DiscordSurface } from "./discord/surface"
import type { ServiceManager } from "./services/manager"
import type { Binding, BindingStore, KeyValueStore } from "./store/bindings"
import type { MessageStore, StoredAttachment } from "./store/messages"
import type { ProjectManager } from "./projects/manager"
import type { ProjectStore } from "./projects/store"
import { homeDirectory, HOME_DIR, requestsKey, uploadsKey, type SwitchResult } from "./projects/switch"
import { projectDir, workingCopy, type BranchResult } from "./threads/branch"
import { projectCard, noticeCard } from "./ui/cards"

export type RouterDeps = {
  client: Client
  config: Config
  messages: MessageStore
  bindings: BindingStore
  kv: KeyValueStore
  /** Who spoke last in each session, so tools can tell owners from other users. */
  speakers: Map<string, string>
  runs: RunManager
  engine: Engine
  lookup: Lookup
  warmer: MemberWarmer
  surface: DiscordSurface
  memory: MemoryStore
  services: ServiceManager
  projects: ProjectStore
  projectManager: ProjectManager
  pending: PendingActions
  /** Moves an existing thread into a project (own branch + worktree + fresh agent session). */
  enterProject(binding: Binding, project: string, speakerId: string): Promise<SwitchResult>
  branch(binding: Binding, input: { title: string; history: boolean; prompt?: string; speakerId: string }): Promise<BranchResult>
  restartNow(reason: string, channelId: string): Promise<void>
}

const IN_PLACE = new Set<Directive["kind"]>(["help", "status", "cache", "models", "tasks", "memory", "services", "projects", "threads", "stop", "restart"])
export const DEFAULT_MODEL_KEY = "default_model"
const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

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
    if (!bound && parsed.directives.some((item) => item.kind === "fork")) {
      await message.reply("`/fork` 는 봇이 만든 스레드 안에서 쓰는 명령이에요. 스레드에서 `/fork 제목` 으로 분기하세요.").catch(() => undefined)
      return
    }
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

    if (parsed.directives.some((item) => item.kind === "fork")) {
      const forked = await deps.branch(binding, { title: parsed.rest || "branch", history: true, prompt: parsed.rest || undefined, speakerId: message.author.id })
      if (!forked.ok) await notice(`분기하지 못했어요: ${forked.error}`)
      return
    }

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
    const result = await submit(binding, { prompt, files: context.saved, authorId: message.author.id, summary: parsed.rest || "(첨부파일)", guildId: message.guildId }).catch(async (error: unknown) => {
      await message.react("❌").catch(() => undefined)
      await notice(`⚠️ 에이전트에게 전달하지 못했어요: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    })
    // Delivered to a running agent right away; the reaction confirms it was not left waiting.
    if (result === "steered") await message.react("📨").catch(() => undefined)
  }

  /** Sends one prompt into a bound conversation, with the shared-memory briefing when it is new or has changed. */
  async function submit(binding: Binding, input: { prompt: string; files: SavedFile[]; authorId: string; summary: string; guildId: string | null }) {
    deps.speakers.set(binding.session_id, input.authorId)
    ensureJournal(binding, input.guildId, input.summary)
    deps.memory.touchThread(binding.channel_id, input.summary)
    rememberRequest(binding.channel_id, input.summary, input.files)

    const briefing = briefingFor(binding, input.guildId)
    const record = deps.memory.thread(binding.channel_id)
    const project = projectOf(binding)
    const trunk = project ? deps.projects.get(project)?.directory : undefined
    const model = modelFor(binding)
    const result = await deps.runs.submit(
      {
        sessionId: binding.session_id,
        channelId: binding.channel_id,
        directory: binding.directory,
        meta: { model: model ? `${model.providerID}/${model.modelID}` : undefined, agent: binding.agent ?? deps.config.agent, branch: record?.branch ?? null, project, directory: binding.directory },
      },
      {
        parts: [
          ...(briefing ? [{ type: "text" as const, text: briefing.text }] : []),
          { type: "text" as const, text: input.prompt },
          ...input.files.flatMap((file) => toFilePart(file) ?? []),
        ],
        system: systemPrompt({
          kind: binding.kind,
          directory: binding.directory,
          selfDir: deps.config.selfDir,
          maxUploadMb: Math.round(deps.config.maxUploadBytes / 1024 / 1024),
          home: binding.kind === "project" && project === null,
          project: project && trunk && binding.kind === "project" ? { name: project, trunk, branch: record?.branch ?? null } : undefined,
        }),
        model,
        agent: binding.agent ?? deps.config.agent,
      },
    )
    // Remember what the conversation has been told only once the prompt was accepted.
    if (briefing) deps.kv.set(digestKey(binding.session_id), briefing.hash)
    return result
  }

  /** The thread's instructions and uploads, kept so a move into a project can hand them to the new session. */
  function rememberRequest(channelId: string, text: string, files: SavedFile[]) {
    const requests = JSON.parse(deps.kv.get(requestsKey(channelId)) ?? "[]") as string[]
    deps.kv.set(requestsKey(channelId), JSON.stringify([...requests, text.slice(0, 2000)].slice(-5)))
    if (files.length === 0) return
    const uploads = JSON.parse(deps.kv.get(uploadsKey(channelId)) ?? "[]") as string[]
    deps.kv.set(uploadsKey(channelId), JSON.stringify([...uploads, ...files.map((file) => file.path)].slice(-10)))
  }

  function briefingFor(binding: Binding, guildId: string | null) {
    const thread = deps.memory.thread(binding.channel_id)
    const text = buildDigest({
      entries: deps.memory.list({ scopes: scopesFor({ guildId, project: projectOf(binding), threadId: binding.channel_id }), limit: 300 }),
      services: deps.services.summaries(),
      projects: deps.projects.list().slice(0, 15).map((project) => ({
        name: project.name,
        title: project.title,
        description: project.description,
        aliases: project.aliases,
        url: deps.services.summaries().find((service) => service.project === project.name)?.url ?? null,
        summary: project.summary,
        directory: project.directory,
      })),
      thread,
      parent: thread?.parent_thread ? deps.memory.thread(thread.parent_thread) : undefined,
      recent: deps.memory.threads({ guildId, limit: 8 }),
      budget: deps.config.memoryBudgetChars,
    })
    const hash = digestHash(text)
    if (!text || deps.kv.get(digestKey(binding.session_id)) === hash) return
    return { text, hash }
  }

  /** The project a conversation works in, or null in the workspace home. */
  function projectOf(binding: Binding) {
    if (binding.kind === "self") return "self"
    const name = projectDir(deps.config.workspaceDir, binding.directory)
    return name === HOME_DIR || name.startsWith("..") ? null : name
  }

  /** Every conversation has a journal row, including ones that predate the journal. */
  function ensureJournal(binding: Binding, guildId: string | null, title: string) {
    if (deps.memory.thread(binding.channel_id)) return
    const channel = deps.client.channels.cache.get(binding.channel_id)
    deps.memory.openThread({
      thread_id: binding.channel_id,
      guild_id: guildId,
      title: channel && "name" in channel && channel.name ? channel.name : title.slice(0, 90) || "DM",
      project: projectOf(binding),
      directory: binding.directory,
    })
  }

  /** Starts work in a conversation without a user message, for example the first prompt of a branched thread. */
  async function promptThread(binding: Binding, text: string, authorId: string) {
    const record = deps.memory.thread(binding.channel_id)
    const prompt = userPrompt({
      author: { id: authorId, name: deps.client.users.cache.get(authorId)?.username ?? authorId },
      channelLabel: `thread ${binding.channel_id}`,
      now: new Date(),
      text,
      linked: [],
      saved: [],
      skipped: [],
    })
    await submit(binding, { prompt, files: [], authorId, summary: text, guildId: record?.guild_id ?? null })
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
      // The agent may have been stopped before it used the memory briefing it was just given, so send it again next time.
      if (binding) deps.kv.delete(digestKey(binding.session_id))
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
    if (has("projects")) {
      await input.notice(projectsReport())
      return true
    }
    if (has("tasks") || has("memory") || has("services") || has("threads")) {
      await input.notice(summaryReport(has, binding, input.message))
      return true
    }
    if (has("models")) {
      await input.notice(await modelReport(binding?.directory ?? deps.config.workspaceDir))
      return true
    }
    if (has("cache")) {
      await input.notice(cacheReport())
      return true
    }
    if (has("status")) {
      const lines = binding
        ? [
            `세션 \`${binding.session_id}\` · ${binding.kind === "self" ? "봇 코드(/self)" : (projectOf(binding) ?? "홈")}`,
            `폴더 \`${binding.directory}\``,
            `상태 ${deps.runs.isBusy(binding.session_id) ? `작업 중 (추가 지시 ${deps.runs.view(binding.session_id)?.steered ?? 0}건 전달됨)` : "대기 중"}`,
            `모델 ${binding.model ?? deps.kv.get(DEFAULT_MODEL_KEY) ?? deps.config.model?.modelID ?? "기본값"} · 에이전트 ${binding.agent ?? deps.config.agent ?? "기본값"}`,
          ]
        : ["아직 세션이 없습니다. 요청 내용을 보내면 시작됩니다."]
      await input.notice([...lines, "", cacheReport()].join("\n"))
      return true
    }
    return false
  }

  async function modelReport(directory: string) {
    const models = await deps.engine.models(directory).catch(() => [])
    if (models.length === 0) return "연결된 모델 제공자가 없습니다. 호스트에서 `ANTHROPIC_API_KEY` 등 키를 설정하거나 `opencode auth login` 을 실행하세요."
    const byProvider = Map.groupBy(models, (model) => model.provider)
    const lines = [...byProvider].map(([provider, list]) => {
      const names = list.slice(0, 8).map((model) => `\`${model.id}\``).join(" ")
      return `• **${provider}** (${list.length}): ${names}${list.length > 8 ? " …" : ""}`
    })
    return ["**쓸 수 있는 모델** — `/model provider/model` 또는 `/model sonnet` 처럼 이름 일부로 선택", ...lines].join("\n")
  }

  /** Turns `/model` text into a `provider/model` ref, accepting loose words such as `sonnet`. Tells the user when nothing matches. */
  async function chooseModel(value: string, directory: string, notice: (text: string) => Promise<unknown>) {
    const models = await deps.engine.models(directory).catch(() => [])
    const found = resolveModel(value, models)
    if (found) return found.ref
    // No catalog to check against (for example the server is still starting): trust an explicit provider/model.
    if (models.length === 0 && parseModel(value)) return value
    await notice(`\`${value}\` 에 맞는 모델을 찾지 못했어요. \`/models\` 로 목록을 확인하세요.`)
    return undefined
  }

  /** The model for this thread: its own override, else the owner-set default, else the configured one. */
  function modelFor(binding: Binding) {
    return parseModel(binding.model ?? deps.kv.get(DEFAULT_MODEL_KEY) ?? undefined) ?? deps.config.model
  }

  function summaryReport(has: (kind: Directive["kind"]) => boolean, binding: Binding | undefined, message: Message) {
    const scopes = scopesFor({ guildId: message.guildId, project: binding ? projectOf(binding) : null, threadId: message.channelId })
    if (has("services")) return servicesReport()
    if (has("threads")) {
      const found = deps.memory.threads({ guildId: message.guildId, limit: 10 })
      if (found.length === 0) return "아직 기록된 스레드가 없습니다."
      return ["**최근 스레드**", ...found.map((item) => `• <#${item.thread_id}> ${item.title} (${item.state}, ${item.turns}턴)${item.parent_thread ? ` ← <#${item.parent_thread}>` : ""}${item.branch ? ` \`${item.branch}\`` : ""} — ${(item.summary ?? item.last_request ?? "").replace(/\s+/g, " ").slice(0, 80)}`)].join("\n")
    }
    if (has("tasks")) {
      const tasks = deps.memory.list({ scopes, kinds: ["task"], statuses: ["open", "blocked"], limit: 25 })
      if (tasks.length === 0) return "열린 작업이 없습니다."
      return ["**열린 작업**", ...tasks.map((item) => `• #${item.id} [${item.status}] **${item.title}** — ${item.body.replace(/\s+/g, " ").slice(0, 100)}`)].join("\n")
    }
    const entries = deps.memory.list({ scopes, limit: 25 }).filter((item) => item.kind !== "task")
    if (entries.length === 0) return "저장된 공통 메모리가 없습니다. 에이전트에게 \"이거 기억해\" 라고 하면 저장해요."
    return ["**공통 메모리**", ...entries.map((item) => `• #${item.id} [${item.kind}${item.scope === "global" ? "" : ` ${item.scope}`}]${item.pinned ? " 📌" : ""} **${item.title}** — ${item.body.replace(/\s+/g, " ").slice(0, 100)}`)].join("\n")
  }

  function projectsReport() {
    const projects = deps.projects.list()
    if (projects.length === 0) return "아직 만든 프로젝트가 없습니다. `@봇 블로그 사이트 만들어줘` 처럼 요청하면 새 프로젝트로 시작해요."
    const services = deps.services.summaries()
    return [
      "**프로젝트**",
      ...projects.slice(0, 20).map((item) => {
        const url = services.find((service) => service.project === item.name)?.url
        return `• \`${item.name}\`${item.title ? ` ${item.title}` : ""} — ${url ?? "배포 안 됨"}${item.summary ? ` · ${item.summary.replace(/\s+/g, " ").slice(0, 80)}` : ""}`
      }),
    ].join("\n")
  }

  function servicesReport() {
    const services = deps.services.summaries()
    if (services.length === 0) return "배포된 서비스가 없습니다."
    return ["**서비스 / 포트**", ...services.map((item) => `• \`${item.name}\` ${item.port === null ? "(포트 없음)" : `:${item.port}`} ${item.status}${item.url ? ` ${item.url}` : ""}`)].join("\n")
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
      if (wantsSelf) {
        await input.notice("`/self` 는 새 세션을 시작할 때만 고를 수 있어요. `/new /self …` 처럼 `/new` 와 함께 쓰세요.")
        return
      }
      const chosen = model ? await chooseModel(model.model, existing.directory, input.notice) : undefined
      if (model && !chosen) return
      if (chosen || agent) deps.bindings.update(existing.channel_id, { model: chosen, agent: agent?.name })
      if (project) {
        // Same thread, different agent: it continues in the project on its own branch.
        const entered = await enterNamedProject(existing, project.name, input)
        if (!entered) return
        return deps.bindings.get(existing.channel_id)
      }
      return deps.bindings.get(existing.channel_id)
    }

    if (wantsSelf && !input.owner) {
      await input.notice("`/self` 는 소유자만 사용할 수 있습니다.")
      return
    }
    if (project && !PROJECT_NAME.test(project.name)) {
      await input.notice("프로젝트 이름은 영문 소문자/숫자/`-` 만 쓸 수 있어요 (최대 40자).")
      return
    }

    // Which project does this thread work in? An explicit /project, else the one the request clearly names, else the home folder.
    const named = project ? await namedProject(project.name, input) : undefined
    if (project && !named) return
    const matched = named ? undefined : wantsSelf ? undefined : deps.projects.match(input.title)
    const chosenProject = named ?? matched

    const kind = wantsSelf ? ("self" as const) : ("project" as const)
    const trunk = wantsSelf ? deps.config.selfDir : (chosenProject?.directory ?? homeDirectory(deps.config.workspaceDir))
    await mkdir(trunk, { recursive: true })
    const chosen = model ? await chooseModel(model.model, trunk, input.notice) : undefined
    if (model && !chosen) return

    // Trunk is never edited directly: in a project every thread works on its own branch and worktree.
    const workdir = kind === "project" && chosenProject ? await workingCopy(deps.config, { directory: trunk }, input.title || "thread", input.target.id) : { directory: trunk, branch: null }
    if ("note" in workdir) await input.notice(`⚠️ ${workdir.note}`)
    if (chosenProject && deps.config.branchPerThread && !workdir.branch) {
      await input.notice("⚠️ 브랜치를 만들지 못해 프로젝트 본 폴더를 수정하지 않도록 중단했어요. 위 사유를 확인해 주세요.")
      return
    }

    const sessionId = await deps.engine
      .createSession(workdir.directory, `Discord ${input.message.author.username}: ${input.title.slice(0, 60) || input.target.id}`)
      .catch(async (error: unknown) => {
        await input.notice(`세션을 만들지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      })
    if (!sessionId) return

    if (existing) deps.runs.forget(existing.session_id)
    const binding: Binding = {
      channel_id: input.target.id,
      session_id: sessionId,
      directory: workdir.directory,
      kind,
      owner_id: input.message.author.id,
      model: chosen ?? existing?.model ?? null,
      agent: agent?.name ?? existing?.agent ?? null,
      created_at: Date.now(),
    }
    deps.bindings.set(binding)
    deps.memory.openThread({
      thread_id: input.target.id,
      guild_id: input.message.guildId,
      title: ("name" in input.target && input.target.name) || input.title.slice(0, 90) || "thread",
      project: kind === "self" ? "self" : (chosenProject?.name ?? null),
      directory: workdir.directory,
      branch: workdir.branch,
    })
    if (chosenProject) {
      deps.projects.update(chosenProject.name, { last_thread: input.target.id })
      await deps.surface
        .sendCard(input.target.id, projectCard({ name: chosenProject.name, title: chosenProject.title, branch: workdir.branch, directory: workdir.directory, created: false, summary: chosenProject.summary }))
        .catch(() => undefined)
    }
    return binding
  }

  /** `/project name`: the registered project, or a new one created on the spot. */
  async function namedProject(name: string, input: { message: Message; target: SendableChannels; notice(text: string): Promise<unknown> }) {
    const found = deps.projects.get(name)
    if (found) return found
    const created = await deps.projectManager.create({ name, createdBy: input.message.author.id, thread: input.target.id })
    if (created.ok) return created.project
    await input.notice(`프로젝트를 만들지 못했어요: ${created.error}`)
  }

  async function enterNamedProject(existing: Binding, name: string, input: { message: Message; target: SendableChannels; notice(text: string): Promise<unknown> }) {
    const project = await namedProject(name, input)
    if (!project) return false
    const moved = await deps.enterProject(existing, project.name, input.message.author.id)
    if (!moved.ok) await input.notice(`프로젝트로 옮기지 못했어요: ${moved.error}`)
    return moved.ok
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
    if (kind !== "perm" && kind !== "restart" && kind !== "admin" && kind !== "run" && kind !== "svc") return
    const owner = deps.config.ownerIds.has(interaction.user.id)

    // Buttons on the run card and service card: usable by anyone allowed to talk to the bot (restart is owner-only).
    if (kind === "run" || kind === "svc") return cardButton(interaction, kind, rest, owner)

    // Server-management confirmations belong to whoever asked (or an owner); the other buttons are owner-only.
    if (kind === "admin") return confirmAdmin(interaction, rest[0], rest[1], owner)
    if (!owner) {
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

  async function cardButton(interaction: ButtonInteraction, kind: "run" | "svc", rest: string[], owner: boolean) {
    const ephemeral = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
    if (!deps.config.userIds.has(interaction.user.id)) return void (await ephemeral("이 봇을 쓸 수 있는 사용자가 아닙니다."))

    if (kind === "run") {
      const [verb, sessionId] = rest
      if (verb !== "stop" || !sessionId) return
      const stopped = await deps.runs.abort(sessionId)
      deps.kv.delete(digestKey(sessionId))
      await ephemeral(stopped ? "⏹️ 작업을 중단했습니다." : "이미 끝났거나 진행 중인 작업이 없습니다.")
      return
    }

    const [verb, name] = rest
    if (!name) return
    if (verb === "logs") {
      const log = (await deps.services.logs(name, 25)).replace(/```/g, "ˋˋˋ").slice(-1800)
      await ephemeral(log ? `**${name}** 로그 (최근)\n\`\`\`\n${log}\n\`\`\`` : `\`${name}\` 로그가 비어 있어요.`)
      return
    }
    if (verb === "restart") {
      if (!owner) return void (await ephemeral("서비스 재시작은 소유자만 할 수 있습니다."))
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined)
      const result = await deps.services.restart(name).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }))
      await interaction.editReply(result.ok ? `🔄 \`${name}\` 을(를) 재시작했어요.` : `재시작하지 못했어요: ${"error" in result ? result.error : "알 수 없는 오류"}`).catch(() => undefined)
    }
  }

  async function confirmAdmin(interaction: ButtonInteraction, verb: string, id: string, owner: boolean) {
    if (verb === "no") {
      const cancelled = deps.pending.cancel(id, interaction.user.id, owner)
      if (!cancelled.ok) return void (await interaction.reply({ content: cancelled.error, flags: MessageFlags.Ephemeral }).catch(() => undefined))
      await interaction.update({ content: `${interaction.message.content}\n→ 취소됨`, components: [] })
      return
    }
    const taken = deps.pending.take(id, interaction.user.id, owner)
    if (!taken.ok) return void (await interaction.reply({ content: taken.error, flags: MessageFlags.Ephemeral }).catch(() => undefined))
    await interaction.update({ content: `${interaction.message.content}\n→ 실행 중… (${interaction.user.username})`, components: [] })
    const outcome = await taken.action.run()
    await interaction.followUp({ content: outcome }).catch(() => undefined)
  }

  return { onMessage, onInteraction, promptThread }
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
