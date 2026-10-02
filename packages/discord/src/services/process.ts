import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

// Environment variables that must never reach a deployed service: the bot's own credentials.
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|^DISCORD_|^OPENCODE_|^ANTHROPIC_|^OPENAI_/i

export function scrubEnv(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !SECRET_NAME.test(entry[0])))
}

/** `starttime` (clock ticks since boot) from /proc. Together with the PID it identifies one process for good. */
export async function startTicks(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined)
  if (!stat) return
  // The command name sits in parentheses and may contain spaces, so count fields after the last ")".
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]
}

export async function isAlive(pid: number | null, ticks: string | null) {
  if (!pid) return false
  const current = await startTicks(pid)
  if (!current) return false
  return !ticks || current === ticks
}

/**
 * Starts `command` in its own session so it keeps running when the bot restarts. Output goes to `logFile`.
 * The command runs through `sh -c` exactly as typed, so `cd app && bun start` works. The recorded PID is the shell
 * (which is the server itself for a single command); stopping signals the whole process group either way.
 */
export async function spawnDetached(input: { command: string; cwd: string; env: Record<string, string>; logFile: string }) {
  mkdirSync(path.dirname(input.logFile), { recursive: true })
  const fd = openSync(input.logFile, "a")
  const child = spawn("sh", ["-c", input.command], {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    stdio: ["ignore", fd, fd],
  })
  closeSync(fd)
  const failure = await new Promise<Error | undefined>((resolve) => {
    child.once("error", resolve)
    setTimeout(() => resolve(undefined), 50)
  })
  if (failure || !child.pid) throw failure ?? new Error("process did not start")
  child.unref()
  return { pid: child.pid, ticks: (await startTicks(child.pid)) ?? null }
}

/** SIGTERM the whole process group, wait, then SIGKILL whatever is left. Safe on a recycled PID. */
export async function stopProcess(pid: number | null, ticks: string | null, graceMs = 8000) {
  if (!(await isAlive(pid, ticks))) return false
  signal(pid!, "SIGTERM")
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!(await isAlive(pid, ticks))) return true
    await Bun.sleep(100)
  }
  signal(pid!, "SIGKILL")
  await Bun.sleep(100)
  return true
}

function signal(pid: number, name: NodeJS.Signals) {
  // A negative PID addresses the process group created by `detached`.
  try {
    process.kill(-pid, name)
  } catch {
    try {
      process.kill(pid, name)
    } catch {
      // already gone
    }
  }
}

export async function tailFile(file: string, lines: number, maxBytes = 200_000) {
  const content = await Bun.file(file)
    .slice(-maxBytes)
    .text()
    .catch(() => "")
  return content.split("\n").slice(-lines).join("\n").trim()
}
