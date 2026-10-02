import os from "node:os"
import path from "node:path"
import { parsePortRange } from "./services/ports"

export type Config = ReturnType<typeof loadConfig>

const packageDir = path.resolve(import.meta.dir, "..")

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.DISCORD_TOKEN
  if (!token) throw new Error("DISCORD_TOKEN is required")

  const ownerIds = new Set(list(env.DISCORD_OWNER_IDS))
  // The agent can run shell commands and edit this bot's own code, so there is no open-by-default mode.
  if (ownerIds.size === 0) throw new Error("DISCORD_OWNER_IDS is required (comma separated Discord user IDs)")

  const permissionMode = env.PERMISSION_MODE ?? "ask"
  if (permissionMode !== "ask" && permissionMode !== "auto") throw new Error("PERMISSION_MODE must be ask or auto")

  const restartMode = env.SELF_RESTART ?? "confirm"
  if (restartMode !== "confirm" && restartMode !== "auto") throw new Error("SELF_RESTART must be confirm or auto")

  const dataDir = expand(env.DATA_DIR) ?? path.join(packageDir, "data")

  return {
    token,
    ownerIds,
    userIds: new Set([...ownerIds, ...list(env.DISCORD_USER_IDS)]),
    guildIds: new Set(list(env.DISCORD_GUILD_IDS)),
    packageDir,
    dataDir,
    dbFile: path.join(dataDir, "bot.sqlite"),
    workspaceDir: expand(env.WORKSPACE_DIR) ?? path.join(os.homedir(), "opencode-workspace"),
    selfDir: expand(env.SELF_DIR) ?? packageDir,
    opencodeCmd: (env.OPENCODE_CMD ?? "opencode").split(/\s+/).filter(Boolean),
    model: parseModel(env.OPENCODE_MODEL),
    agent: env.OPENCODE_AGENT || undefined,
    permissionMode,
    restartMode,
    // Discord's default upload limit for guilds without boosts.
    maxUploadBytes: number(env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
    maxDownloadBytes: number(env.MAX_DOWNLOAD_MB, 25) * 1024 * 1024,
    // 0 keeps every cached message forever.
    messageRetentionDays: number(env.MESSAGE_RETENTION_DAYS, 0),
    // Safety valve for the only REST message reads: explicit message ID or link lookups that miss the cache.
    restLookupsPerMinute: number(env.REST_LOOKUPS_PER_MINUTE, 20),

    // Deployment: services get ports from this range, and are reachable at PUBLIC_HOST (auto-detected when empty).
    servicesDir: path.join(dataDir, "services"),
    portRange: parsePortRange(env.PORT_RANGE),
    allowLowPorts: env.ALLOW_LOW_PORTS === "true",
    publicHost: env.PUBLIC_HOST || undefined,
    firewallOpen: env.FIREWALL_OPEN_CMD || undefined,
    firewallClose: env.FIREWALL_CLOSE_CMD || undefined,

    // Memory and long conversations.
    memoryBudgetChars: number(env.MEMORY_BUDGET_CHARS, 6000),
    compactRatio: Math.min(Math.max(number(env.COMPACT_RATIO, 0.7), 0.3), 0.95),
    compactFallbackTokens: number(env.COMPACT_FALLBACK_TOKENS, 120_000),
    // Each new thread in a git project gets its own branch and worktree.
    branchPerThread: env.BRANCH_PER_THREAD !== "false",
  }
}

export function parseModel(value: string | undefined) {
  if (!value) return
  const index = value.indexOf("/")
  if (index <= 0 || index === value.length - 1) return
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function number(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return value !== undefined && value !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function expand(value: string | undefined) {
  if (!value) return
  if (value === "~") return os.homedir()
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2))
  return path.resolve(value)
}
