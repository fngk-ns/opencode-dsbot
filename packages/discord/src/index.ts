import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Events } from "discord.js"
import type { Config } from "@opencode-ai/sdk/v2/client"
import { startApi } from "./api/server"
import { createEngine, followEvents, startOpencode } from "./bridge/opencode"
import { RunManager } from "./bridge/runs"
import { createDirectory, MemberWarmer } from "./cache/directory"
import { createLookup } from "./cache/lookup"
import { loadConfig } from "./config"
import { createClient } from "./discord/client"
import { editPatch, toStored } from "./discord/record"
import { DiscordSurface } from "./discord/surface"
import { createRouter, DEFAULT_MODEL_KEY } from "./router"
import { snapshotHealthy, verifySelf } from "./self/update"
import { BindingStore, KeyValueStore } from "./store/bindings"
import { openDatabase } from "./store/db"
import { MessageStore } from "./store/messages"

const EXIT_LOGIN_FAILED = 3
const startedAt = Date.now()
const config = loadConfig()
await mkdir(config.workspaceDir, { recursive: true })

const db = openDatabase(config.dbFile)
const messages = new MessageStore(db)
const bindings = new BindingStore(db)
const kv = new KeyValueStore(db)

const client = createClient()
const warmer = new MemberWarmer(client)
const surface = new DiscordSurface(client)

const lookup = createLookup({
  messages,
  directory: createDirectory(client, warmer),
  restLookupsPerMinute: config.restLookupsPerMinute,
  // The one place a message is read over REST: an explicit message link or ID that the cache has never seen.
  remote: async (channelId, messageId) => {
    const channel = client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId))
    if (!channel?.isTextBased()) return undefined
    return toStored(await channel.messages.fetch({ message: messageId, cache: false, force: true }))
  },
})

const speakers = new Map<string, string>()
const apiToken = crypto.randomUUID()
const api = startApi({
  token: apiToken,
  lookup,
  context(sessionId) {
    const binding = bindings.bySession(sessionId)
    if (!binding) return
    const channel = client.channels.cache.get(binding.channel_id)
    return {
      channelId: binding.channel_id,
      guildId: channel && "guildId" in channel ? channel.guildId : null,
      directory: binding.directory,
      kind: binding.kind,
      speakerId: speakers.get(sessionId) ?? null,
    }
  },
  models: (directory) => engine.models(directory),
  currentModels: (context) => ({
    thread: bindings.get(context.channelId)?.model ?? null,
    default: kv.get(DEFAULT_MODEL_KEY) ?? null,
  }),
  setModel(context, scope, ref) {
    if (scope === "thread") return bindings.update(context.channelId, { model: ref })
    if (!ref) return kv.delete(DEFAULT_MODEL_KEY)
    kv.set(DEFAULT_MODEL_KEY, ref)
  },
  isOwner: (userId) => !!userId && config.ownerIds.has(userId),
  guildOfChannel(channelId) {
    const channel = client.channels.cache.get(channelId)
    if (!channel) return
    return "guildId" in channel ? channel.guildId : null
  },
  roots: (context) => [context.directory, config.workspaceDir, ...(context.kind === "self" ? [config.selfDir] : [])],
  maxUploadBytes: config.maxUploadBytes,
  send: (channelId, text, files) => surface.send(channelId, text, files),
  async restart(context, reason) {
    const verified = await verifySelf(config.selfDir)
    if (!verified.ok) return { ok: false, message: `Verification failed, the bot was NOT restarted. Fix this and call discord_restart again.\n${verified.report}` }
    if (config.restartMode === "auto") {
      setTimeout(() => void restartNow(reason, context.channelId), 1_500)
      return { ok: true, message: `Verification passed:\n${verified.report}\nThe bot restarts in a moment; this thread continues afterwards.` }
    }
    await surface.askRestart(context.channelId, reason)
    return { ok: true, message: `Verification passed:\n${verified.report}\nWaiting for the owner to approve the restart in Discord. After approval the bot restarts and this thread continues.` }
  },
})

const opencode = await startOpencode({
  cmd: config.opencodeCmd,
  cwd: config.workspaceDir,
  env: {
    OPENCODE_CONFIG_DIR: path.join(config.packageDir, "opencode"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig()),
    DISCORD_BRIDGE_URL: `http://127.0.0.1:${api.port}`,
    DISCORD_BRIDGE_TOKEN: apiToken,
  },
})
console.log(`[opencode] ready at ${opencode.url}`)
void opencode.exited.then((code) => {
  console.error(`[opencode] server exited (${code}); exiting so the supervisor can restart everything`)
  void shutdown(1)
})

const engine = createEngine(opencode.client)
const runs = new RunManager(engine, surface, { autoApprove: config.permissionMode === "auto" })
const stopEvents = new AbortController()
void followEvents(opencode.client, (event) => void runs.handle(event).catch(logError("event")), stopEvents.signal)
const reconcileTimer = setInterval(() => void runs.reconcile().catch(logError("reconcile")), 30_000)

const router = createRouter({ client, config, messages, bindings, kv, speakers, runs, engine, lookup, warmer, surface, restartNow })

let ready = false
client.on(Events.MessageCreate, router.onMessage)
client.on(Events.MessageUpdate, (_before, after) => {
  if (!after.partial) return messages.save(toStored(after))
  messages.edit(after.id, editPatch(after))
})
client.on(Events.MessageDelete, (message) => messages.markDeleted([message.id]))
client.on(Events.MessageBulkDelete, (deleted) => messages.markDeleted([...deleted.keys()]))
client.on(Events.InteractionCreate, (interaction) => void router.onInteraction(interaction).catch(logError("interaction")))
client.on(Events.GuildCreate, (guild) => {
  if (ready) void warmer.warm(guild)
})
client.on(Events.Error, logError("discord"))

client.once(Events.ClientReady, (self) => {
  ready = true
  console.log(`[discord] logged in as ${self.user.tag} in ${self.guilds.cache.size} server(s)`)
  // Members are cached once, here. After this the gateway keeps the cache current (join/leave/update events).
  void warmer.warmAll().catch(logError("members"))
  void announceRestart()
  setTimeout(() => void markHealthy(), 30_000)
})

await client.login(config.token).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[discord] login failed: ${message}`)
  if (/disallowed intents/i.test(message))
    console.error("Enable SERVER MEMBERS INTENT and MESSAGE CONTENT INTENT in the Discord Developer Portal (Bot tab).")
  // Exit code 3 tells deploy/run.sh this is an environment problem (token, intents, network), not a bad code change.
  return shutdown(EXIT_LOGIN_FAILED)
})

if (config.messageRetentionDays > 0) {
  const prune = () => console.log(`[messages] pruned ${messages.prune(Date.now() - config.messageRetentionDays * 86_400_000)} old message(s)`)
  prune()
  setInterval(prune, 3_600_000)
}

process.on("SIGINT", () => void shutdown(0))
process.on("SIGTERM", () => void shutdown(0))
process.on("unhandledRejection", logError("unhandled"))

async function restartNow(reason: string, channelId: string) {
  kv.set("restart_notice", JSON.stringify({ channel_id: channelId, reason, at: Date.now() }))
  await surface.send(channelId, `🔄 재시작합니다… (${reason})`).catch(() => undefined)
  await shutdown(0)
}

async function announceRestart() {
  const raw = kv.get("restart_notice")
  if (!raw) return
  kv.delete("restart_notice")
  const notice = JSON.parse(raw) as { channel_id: string; reason: string; at: number }
  const seconds = Math.round((Date.now() - notice.at) / 1000)
  await surface.send(notice.channel_id, `✅ 재시작 완료 (${notice.reason}) · ${seconds}초 걸렸어요.`).catch(() => undefined)
}

async function markHealthy() {
  const result = await snapshotHealthy(config.selfDir)
  console.log(result.ok ? `[self] healthy snapshot ${result.commit.slice(0, 8)}` : `[self] no snapshot: ${result.reason}`)
}

async function shutdown(code: number) {
  clearInterval(reconcileTimer)
  stopEvents.abort()
  opencode.stop()
  api.stop(true)
  await client.destroy()
  db.close()
  process.exit(code)
}

function opencodeConfig(): Config {
  return {
    model: config.model ? `${config.model.providerID}/${config.model.modelID}` : undefined,
    share: "disabled",
    autoupdate: false,
    permission:
      config.permissionMode === "auto"
        ? { edit: "allow", bash: "allow", webfetch: "allow" }
        : { edit: "ask", bash: "ask", webfetch: "allow" },
  }
}

function logError(scope: string) {
  return (error: unknown) => console.error(`[${scope}]`, error instanceof Error ? (error.stack ?? error.message) : error)
}

console.log(`[bot] started in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
