import { statSync } from "node:fs"
import path from "node:path"
import type { ServiceSummary } from "../memory/digest"
import { run } from "../self/update"
import { findFreePort, isListening, isPortFree, type PortRange } from "./ports"
import { isAlive, scrubEnv, spawnDetached, stopProcess, tailFile } from "./process"
import type { ServiceRecord, ServiceStore } from "./store"

export type ManagerOptions = {
  store: ServiceStore
  logDir: string
  range: PortRange
  /** Ports the bot itself uses (its loopback API, the opencode server). Never handed to a service. */
  reservedPorts(): Set<number>
  allowLowPorts: boolean
  publicHost(): string | undefined
  /** Shell templates with `{port}`, for example `ufw allow {port}/tcp`. Optional. */
  firewall?: { open?: string; close?: string }
  readyTimeoutMs?: number
  notify?(service: ServiceRecord, text: string): void
  now?(): number
}

export type Deploy = {
  name: string
  command: string
  directory: string
  /** A number pins the port, "auto" or undefined keeps the current port or picks one, null means the service has no port. */
  port?: number | "auto" | null
  env?: Record<string, string>
  description?: string
  autorestart?: boolean
  owner_thread?: string | null
  created_by?: string | null
}

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/
const MAX_RAPID_FAILURES = 5
const RAPID_MS = 30_000

type Health = { failures: number; nextAt: number; gaveUp: boolean }

/**
 * Runs long-lived services on the host and remembers which port belongs to which service.
 * Services are detached from the bot: restarting the bot leaves them running, and `tick` adopts or revives them.
 */
export class ServiceManager {
  private readonly health = new Map<string, Health>()
  private ticking = false

  constructor(private readonly options: ManagerOptions) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  async deploy(input: Deploy) {
    if (!NAME.test(input.name)) return fail("service name must be lowercase letters, digits and dashes (max 41 characters)")
    if (!input.command.trim()) return fail("command is required")
    if (!isDirectory(input.directory)) return fail(`directory does not exist: ${input.directory}`)

    const existing = this.options.store.get(input.name)
    if (existing) await this.halt(existing)

    const port = await this.choosePort(input.name, input.port, existing?.port ?? null)
    if (isPortError(port)) return fail(port.error)

    const base = {
      description: input.description ?? existing?.description ?? null,
      directory: path.resolve(input.directory),
      command: input.command,
      port,
      env: input.env ?? existing?.env ?? {},
      desired: "running" as const,
      autorestart: input.autorestart ?? existing?.autorestart ?? true,
      pid: null,
      pid_start: null,
      status: "starting" as const,
      restarts: 0,
      last_exit: null,
      started_at: null,
      owner_thread: input.owner_thread ?? existing?.owner_thread ?? null,
      created_by: input.created_by ?? existing?.created_by ?? null,
    }
    if (existing) this.options.store.update(input.name, base)
    if (!existing) this.options.store.create({ name: input.name, log_file: path.join(this.options.logDir, `${input.name}.log`), ...base })
    this.health.delete(input.name)

    const firewall = port === null ? undefined : await this.firewall("open", port)
    await this.launch(input.name)
    const ready = await this.waitReady(input.name)
    return { ok: true as const, ...(await this.describe(input.name)), ready, firewall, log_tail: await this.logs(input.name, 15) }
  }

  async start(name: string) {
    const service = this.options.store.get(name)
    if (!service) return fail(`unknown service: ${name}`)
    if (await isAlive(service.pid, service.pid_start)) return { ok: true as const, ...(await this.describe(name)), note: "already running" }
    this.options.store.update(name, { desired: "running", restarts: 0 })
    this.health.delete(name)
    await this.launch(name)
    const ready = await this.waitReady(name)
    return { ok: true as const, ...(await this.describe(name)), ready, log_tail: await this.logs(name, 15) }
  }

  async stop(name: string) {
    const service = this.options.store.get(name)
    if (!service) return fail(`unknown service: ${name}`)
    await this.halt(service)
    return { ok: true as const, ...(await this.describe(name)) }
  }

  async restart(name: string) {
    const service = this.options.store.get(name)
    if (!service) return fail(`unknown service: ${name}`)
    await this.halt(service)
    return this.start(name)
  }

  /** Stops the service and forgets it, which frees its port. The log file is kept. */
  async remove(name: string) {
    const service = this.options.store.get(name)
    if (!service) return fail(`unknown service: ${name}`)
    await this.halt(service)
    if (service.port !== null) await this.firewall("close", service.port)
    this.options.store.remove(name)
    this.health.delete(name)
    return { ok: true as const, removed: name, freed_port: service.port }
  }

  async setPort(name: string, port: number | "auto") {
    const service = this.options.store.get(name)
    if (!service) return fail(`unknown service: ${name}`)
    const chosen = await this.choosePort(name, port, null)
    if (isPortError(chosen)) return fail(chosen.error)
    const wasRunning = service.desired === "running"
    await this.halt(service)
    if (service.port !== null && service.port !== chosen) await this.firewall("close", service.port)
    this.options.store.update(name, { port: chosen })
    if (chosen !== null) await this.firewall("open", chosen)
    return wasRunning ? this.start(name) : { ok: true as const, ...(await this.describe(name)) }
  }

  async logs(name: string, lines = 50) {
    const service = this.options.store.get(name)
    return service ? tailFile(service.log_file, Math.min(Math.max(lines, 1), 500)) : ""
  }

  async list() {
    return Promise.all(this.options.store.list().map((service) => this.describe(service.name)))
  }

  async describe(name: string) {
    const service = this.options.store.get(name)!
    const alive = await isAlive(service.pid, service.pid_start)
    const listening = service.port !== null && alive ? await isListening(service.port) : false
    return {
      name: service.name,
      status: service.status,
      desired: service.desired,
      alive,
      listening,
      port: service.port,
      url: this.urlFor(service.port),
      local_url: service.port === null ? null : `http://127.0.0.1:${service.port}`,
      command: service.command,
      directory: service.directory,
      description: service.description,
      restarts: service.restarts,
      uptime_s: alive && service.started_at ? Math.round((this.now() - service.started_at) / 1000) : 0,
      last_exit: service.last_exit,
      log_file: service.log_file,
    }
  }

  /** Every service with its port and public URL, straight from the ledger (no process probing). */
  summaries(): ServiceSummary[] {
    return this.options.store.list().map((service) => ({
      name: service.name,
      port: service.port,
      status: service.status,
      command: service.command,
      directory: service.directory,
      description: service.description,
      url: this.urlFor(service.port),
    }))
  }

  private urlFor(port: number | null) {
    const host = this.options.publicHost()
    return port === null || !host ? null : `${port === 443 ? "https" : "http"}://${host}:${port}`
  }

  /** The port ledger, including how much of the range is left. */
  ledger() {
    const used = this.options.store.list().flatMap((service) => (service.port === null ? [] : [{ port: service.port, service: service.name }]))
    const size = this.options.range.max - this.options.range.min + 1
    return { range: this.options.range, used, free_in_range: size - used.filter((item) => item.port >= this.options.range.min && item.port <= this.options.range.max).length }
  }

  /** One supervision pass: adopt services that survived a bot restart, revive the ones that died, give up on crash loops. */
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const service of this.options.store.list()) await this.check(service)
    } finally {
      this.ticking = false
    }
  }

  private async check(service: ServiceRecord) {
    const alive = await isAlive(service.pid, service.pid_start)
    if (service.desired === "stopped") {
      if (alive) await stopProcess(service.pid, service.pid_start)
      if (service.status !== "stopped") this.options.store.update(service.name, { status: "stopped", pid: null, pid_start: null })
      return
    }
    if (alive) {
      if (service.status !== "running") this.options.store.update(service.name, { status: "running" })
      return
    }

    const state = this.health.get(service.name) ?? { failures: 0, nextAt: 0, gaveUp: false }
    if (state.gaveUp) return
    // A process that was alive at the last pass and is gone now has exited; remember when it started to judge a crash loop.
    const uptime = service.started_at ? this.now() - service.started_at : Infinity
    if (service.pid !== null) {
      state.failures = uptime < RAPID_MS ? state.failures + 1 : 1
      this.options.store.update(service.name, { pid: null, pid_start: null, last_exit: `exited after ${Math.round(uptime / 1000)}s` })
      state.nextAt = this.now() + Math.min(60_000, 1000 * 2 ** state.failures)
    }
    this.health.set(service.name, state)

    if (!service.autorestart || state.failures > MAX_RAPID_FAILURES) {
      state.gaveUp = true
      this.options.store.update(service.name, { status: "crashed" })
      this.options.notify?.(service, `❌ 서비스 \`${service.name}\` 이(가) 종료되었고 자동 재시작하지 않습니다.\n\`\`\`\n${await this.logs(service.name, 12)}\n\`\`\``)
      return
    }
    if (this.now() < state.nextAt) return
    this.options.store.update(service.name, { restarts: service.restarts + 1 })
    await this.launch(service.name).catch((error: unknown) => {
      this.options.store.update(service.name, { status: "crashed", last_exit: error instanceof Error ? error.message : String(error) })
    })
    this.options.notify?.(service, `⚠️ 서비스 \`${service.name}\` 이(가) 종료되어 다시 시작했습니다 (재시작 ${service.restarts + 1}회).`)
  }

  private async launch(name: string) {
    const service = this.options.store.get(name)!
    const env = {
      ...scrubEnv(process.env),
      ...service.env,
      HOST: "0.0.0.0",
      ...(service.port === null ? {} : { PORT: String(service.port) }),
    }
    const started = await spawnDetached({ command: service.command, cwd: service.directory, env, logFile: service.log_file })
    this.options.store.update(name, {
      pid: started.pid,
      pid_start: started.ticks,
      status: "starting",
      started_at: this.now(),
      desired: "running",
    })
  }

  private async halt(service: ServiceRecord) {
    this.options.store.update(service.name, { desired: "stopped" })
    await stopProcess(service.pid, service.pid_start)
    this.options.store.update(service.name, { status: "stopped", pid: null, pid_start: null })
  }

  private async waitReady(name: string) {
    const service = this.options.store.get(name)!
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 20_000)
    while (Date.now() < deadline) {
      if (!(await isAlive(service.pid, service.pid_start))) {
        this.options.store.update(name, { status: "crashed", last_exit: "exited during startup" })
        return false
      }
      if (service.port === null || (await isListening(service.port))) {
        this.options.store.update(name, { status: "running" })
        return true
      }
      await Bun.sleep(250)
    }
    return false
  }

  private async choosePort(name: string, requested: number | "auto" | null | undefined, current: number | null) {
    if (requested === null) return null
    const taken = new Set([...this.options.store.ports(), ...this.options.reservedPorts()])
    if (current !== null) taken.delete(current)

    if (typeof requested === "number") {
      if (!Number.isInteger(requested) || requested < 1 || requested > 65535) return { error: `invalid port ${requested}` }
      if (requested < 1024 && !this.options.allowLowPorts) return { error: `port ${requested} is privileged; set ALLOW_LOW_PORTS=true to allow ports below 1024` }
      const owner = this.options.store.byPort(requested)
      if (owner && owner.name !== name) return { error: `port ${requested} is already assigned to service "${owner.name}"` }
      if (this.options.reservedPorts().has(requested)) return { error: `port ${requested} is used by the bot itself` }
      if (requested !== current && !(await isPortFree(requested))) return { error: `port ${requested} is in use by another process on this host` }
      return requested
    }

    // Keep the port a service already owns: its address should not change when it is redeployed.
    if (current !== null) return current
    const port = await findFreePort(this.options.range, taken)
    return port ?? { error: `no free port left in ${this.options.range.min}-${this.options.range.max}` }
  }

  private async firewall(direction: "open" | "close", port: number) {
    const template = this.options.firewall?.[direction]
    if (!template) return undefined
    const result = await run(["sh", "-c", template.replaceAll("{port}", String(port))], "/", 20_000)
    return result.code === 0 ? `${direction}: ok` : `${direction}: failed (${result.output.slice(0, 200)})`
  }
}

function isPortError(value: number | null | { error: string }): value is { error: string } {
  return value !== null && typeof value === "object"
}

function isDirectory(directory: string) {
  try {
    return statSync(directory).isDirectory()
  } catch {
    return false
  }
}

function fail(error: string) {
  return { ok: false as const, error }
}
