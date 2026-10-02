import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import net from "node:net"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceManager, type ManagerOptions } from "../src/services/manager"
import { findFreePort, isListening, isPortFree, parsePortRange, waitPortFree } from "../src/services/ports"
import { isAlive, scrubEnv } from "../src/services/process"
import { ServiceStore } from "../src/services/store"
import { openDatabase } from "../src/store/db"

let temp: string
let project: string
const cleanup: Array<() => Promise<unknown>> = []

// A tiny real HTTP server. It answers with the env keys it can see so tests can check what a service inherits.
const SERVER = "bun app.js"
const APP = "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response(Object.keys(process.env).join(',')) }); setInterval(() => {}, 1000)\n"

beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "dsbot-svc-"))
  project = path.join(temp, "project")
  await mkdir(project, { recursive: true })
  await Bun.write(path.join(project, "app.js"), APP)
})

afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop()
})

afterAll(() => rm(temp, { recursive: true, force: true }))

function setup(overrides: Partial<ManagerOptions> = {}, db = openDatabase(":memory:")) {
  const events: string[] = []
  const store = new ServiceStore(db)
  const options: ManagerOptions = {
    store,
    logDir: path.join(temp, "logs"),
    range: { min: 31000, max: 31050 },
    reservedPorts: () => new Set(),
    allowLowPorts: false,
    publicHost: () => "203.0.113.7",
    readyTimeoutMs: 15_000,
    notify: (service, text) => events.push(`${service.name}: ${text}`),
    ...overrides,
  }
  const manager = new ServiceManager(options)
  cleanup.push(async () => {
    for (const service of store.list()) await manager.stop(service.name)
  })
  return { manager, store, events, db, options }
}

describe("ports", () => {
  test("parsePortRange falls back to the default for bad values", () => {
    expect(parsePortRange("31000-31010")).toEqual({ min: 31000, max: 31010 })
    expect(parsePortRange("80-90")).toEqual({ min: 20000, max: 29999 })
    expect(parsePortRange("nope")).toEqual({ min: 20000, max: 29999 })
  })

  test("isPortFree / isListening / findFreePort agree with a real listener", async () => {
    const server = net.createServer().listen(0, "0.0.0.0")
    await new Promise((resolve) => server.once("listening", resolve))
    const port = (server.address() as net.AddressInfo).port
    try {
      expect(await isPortFree(port)).toBe(false)
      expect(await isListening(port)).toBe(true)
      const found = await findFreePort({ min: port, max: port + 3 }, new Set([port + 1]))
      expect(found).toBe(port + 2)
    } finally {
      server.close()
    }
    expect(await isListening(port)).toBe(false)
  })

  test("waitPortFree returns as soon as a port that was busy is released, and gives up on one that never is", async () => {
    const server = net.createServer().listen(0, "0.0.0.0")
    await new Promise((resolve) => server.once("listening", resolve))
    const port = (server.address() as net.AddressInfo).port
    setTimeout(() => server.close(), 200)
    const started = Date.now()
    expect(await waitPortFree(port, 3000)).toBe(true)
    expect(Date.now() - started).toBeLessThan(2000)

    const stuck = net.createServer().listen(0, "0.0.0.0")
    await new Promise((resolve) => stuck.once("listening", resolve))
    try {
      expect(await waitPortFree((stuck.address() as net.AddressInfo).port, 300)).toBe(false)
    } finally {
      stuck.close()
    }
  })

  test("findFreePort returns nothing when the range is exhausted", async () => {
    expect(await findFreePort({ min: 40000, max: 40001 }, new Set([40000, 40001]))).toBeUndefined()
  })
})

describe("scrubEnv", () => {
  test("drops the bot's credentials but keeps ordinary variables", () => {
    const env = scrubEnv({ PATH: "/bin", HOME: "/h", DISCORD_TOKEN: "x", ANTHROPIC_API_KEY: "y", MY_SECRET: "z", OPENCODE_SERVER_PASSWORD: "p", NODE_ENV: "production" })
    expect(Object.keys(env).sort()).toEqual(["HOME", "NODE_ENV", "PATH"])
  })
})

describe("deploy", () => {
  test("starts a real server on an allocated port and reports where it is reachable", async () => {
    const { manager, store } = setup()
    const result = await manager.deploy({ name: "blog", command: SERVER, directory: project, description: "my blog" })
    expect(result).toMatchObject({ ok: true, ready: true, listening: true, status: "running", port: 31000, url: "http://203.0.113.7:31000" })
    expect(store.get("blog")).toMatchObject({ port: 31000, desired: "running" })
    expect(await (await fetch("http://127.0.0.1:31000")).text()).toContain("PORT")
  })

  test("services never see the bot's secrets", async () => {
    const previous = process.env.DISCORD_TOKEN
    process.env.DISCORD_TOKEN = "super-secret"
    try {
      const { manager } = setup()
      await manager.deploy({ name: "envcheck", command: SERVER, directory: project, env: { APP_MODE: "prod" } })
      const keys = (await (await fetch("http://127.0.0.1:31000")).text()).split(",")
      expect(keys).toContain("APP_MODE")
      expect(keys).toContain("PORT")
      expect(keys).not.toContain("DISCORD_TOKEN")
    } finally {
      if (previous === undefined) delete process.env.DISCORD_TOKEN
      else process.env.DISCORD_TOKEN = previous
    }
  })

  test("each service gets its own port and a port belongs to one service only", async () => {
    const { manager } = setup()
    const a = await manager.deploy({ name: "a", command: SERVER, directory: project })
    const b = await manager.deploy({ name: "b", command: SERVER, directory: project })
    expect([a, b].map((item) => (item.ok ? item.port : null))).toEqual([31000, 31001])

    const clash = await manager.deploy({ name: "c", command: SERVER, directory: project, port: 31000 })
    expect(clash).toMatchObject({ ok: false })
    expect(clash.ok === false && clash.error).toContain('assigned to service "a"')
  })

  test("a redeploy keeps the same port", async () => {
    const { manager } = setup()
    const first = await manager.deploy({ name: "blog", command: SERVER, directory: project })
    const again = await manager.deploy({ name: "blog", command: SERVER, directory: project, description: "v2" })
    expect(first.ok && again.ok && again.port === first.port).toBe(true)
    expect(again.ok && again.description).toBe("v2")
  })

  test("a port taken by a foreign process, a privileged port and bot-reserved ports are refused", async () => {
    const foreign = net.createServer().listen(31040, "0.0.0.0")
    await new Promise((resolve) => foreign.once("listening", resolve))
    cleanup.push(async () => void foreign.close())
    const { manager } = setup({ reservedPorts: () => new Set([31041]) })
    expect(await manager.deploy({ name: "x", command: SERVER, directory: project, port: 31040 })).toMatchObject({ ok: false })
    expect(await manager.deploy({ name: "x", command: SERVER, directory: project, port: 80 })).toMatchObject({ ok: false })
    expect(await manager.deploy({ name: "x", command: SERVER, directory: project, port: 31041 })).toMatchObject({ ok: false })
  })

  test("invalid input is rejected without side effects", async () => {
    const { manager, store } = setup()
    expect(await manager.deploy({ name: "Bad Name", command: SERVER, directory: project })).toMatchObject({ ok: false })
    expect(await manager.deploy({ name: "ok", command: "  ", directory: project })).toMatchObject({ ok: false })
    expect(await manager.deploy({ name: "ok", command: SERVER, directory: path.join(temp, "missing") })).toMatchObject({ ok: false })
    expect(store.list()).toEqual([])
  })

  test("a command that dies at startup is reported with its log", async () => {
    const { manager } = setup({ readyTimeoutMs: 5_000 })
    const result = await manager.deploy({ name: "broken", command: `sh -c 'echo boom-from-app >&2; exit 3'`, directory: project })
    expect(result).toMatchObject({ ok: true, ready: false, status: "crashed" })
    expect(result.ok && result.log_tail).toContain("boom-from-app")
  })

  test("firewall templates run with the port filled in", async () => {
    const marker = path.join(temp, "firewall.txt")
    const { manager } = setup({ firewall: { open: `echo open-{port} >> ${marker}`, close: `echo close-{port} >> ${marker}` } })
    const deployed = await manager.deploy({ name: "fw", command: SERVER, directory: project })
    expect(deployed.ok && deployed.firewall).toBe("open: ok")
    await manager.remove("fw")
    expect((await Bun.file(marker).text()).trim().split("\n")).toEqual(["open-31000", "close-31000"])
  })
})

describe("lifecycle", () => {
  test("stop frees the port but the service keeps its assignment; start brings it back", async () => {
    const { manager, store } = setup()
    await manager.deploy({ name: "blog", command: SERVER, directory: project })
    const stopped = await manager.stop("blog")
    expect(stopped).toMatchObject({ ok: true, alive: false, status: "stopped", port: 31000 })
    expect(await isPortFree(31000)).toBe(true)
    expect(store.get("blog")?.port).toBe(31000)

    const started = await manager.start("blog")
    expect(started).toMatchObject({ ok: true, ready: true, port: 31000 })
  })

  test("remove frees the port for another service", async () => {
    const { manager, store } = setup()
    await manager.deploy({ name: "old", command: SERVER, directory: project })
    expect(await manager.remove("old")).toMatchObject({ ok: true, freed_port: 31000 })
    expect(store.list()).toEqual([])
    const next = await manager.deploy({ name: "new", command: SERVER, directory: project })
    expect(next.ok && next.port).toBe(31000)
  })

  test("setPort moves a running service to another port", async () => {
    const { manager } = setup()
    await manager.deploy({ name: "blog", command: SERVER, directory: project })
    const moved = await manager.setPort("blog", 31020)
    expect(moved).toMatchObject({ ok: true, port: 31020, listening: true })
    expect(await isPortFree(31000)).toBe(true)
  })

  test("logs and ledger report what is deployed", async () => {
    const { manager } = setup()
    await manager.deploy({ name: "blog", command: `echo hello-log && cd . && ${SERVER}`, directory: project })
    expect(await manager.logs("blog", 5)).toContain("hello-log")
    expect(manager.ledger()).toMatchObject({ used: [{ port: 31000, service: "blog" }], free_in_range: 50 })
  })
})

describe("surviving a bot restart", () => {
  test("a new manager over the same database adopts the running service without restarting it", async () => {
    const first = setup()
    await first.manager.deploy({ name: "blog", command: SERVER, directory: project })
    const before = first.store.get("blog")!

    const second = setup({}, first.db)
    await second.manager.tick()
    const after = second.store.get("blog")!
    expect(after).toMatchObject({ pid: before.pid, status: "running" })
    expect(await isAlive(after.pid, after.pid_start)).toBe(true)
    expect(second.events).toEqual([])
  })

  test("a service that died while the bot was down is revived on the next pass", async () => {
    const first = setup()
    await first.manager.deploy({ name: "blog", command: SERVER, directory: project })
    const deadPid = first.store.get("blog")!.pid!
    process.kill(-deadPid, "SIGKILL")
    await Bun.sleep(200)

    let time = Date.now()
    const second = setup({ now: () => time }, first.db)
    await second.manager.tick()
    time += 10_000 // past the first restart back-off
    await second.manager.tick()
    const revived = second.store.get("blog")!
    expect(revived.pid).not.toBe(deadPid)
    expect(await isAlive(revived.pid, revived.pid_start)).toBe(true)
    expect(revived.restarts).toBe(1)
    expect(second.events.some((event) => event.includes("다시 시작"))).toBe(true)
  })

  test("a crash loop stops being restarted and is announced once", async () => {
    let time = Date.now()
    const { manager, store, events } = setup({ now: () => time, readyTimeoutMs: 2_000 })
    await manager.deploy({ name: "loop", command: `sh -c 'exit 1'`, directory: project, port: null })
    // The supervisor ticks every few seconds, so a process that keeps dying right away stays under the 30s "rapid" limit.
    for (let pass = 0; pass < 14; pass++) {
      time += 20_000
      await manager.tick()
      await Bun.sleep(60)
    }
    expect(store.get("loop")?.status).toBe("crashed")
    const announcements = events.filter((event) => event.includes("자동 재시작하지 않습니다"))
    expect(announcements).toHaveLength(1)
  })

  test("a PID that was recycled by another process is not mistaken for the service", async () => {
    const { manager, store } = setup()
    await manager.deploy({ name: "blog", command: SERVER, directory: project })
    const service = store.get("blog")!
    expect(await isAlive(service.pid, "1")).toBe(false)
    expect(await isAlive(service.pid, service.pid_start)).toBe(true)
    expect(manager).toBeDefined()
  })
})

describe("compound commands", () => {
  test("`cd dir && command` runs the whole chain and can be stopped", async () => {
    const { manager } = setup()
    await mkdir(path.join(project, "sub"), { recursive: true })
    await Bun.write(path.join(project, "sub", "app.js"), APP)
    const result = await manager.deploy({ name: "chain", command: "cd sub && bun app.js", directory: project })
    expect(result).toMatchObject({ ok: true, ready: true, listening: true })
    await manager.stop("chain")
    expect(await isPortFree(31000)).toBe(true)
  })
})

describe("detectPublicHost", () => {
  test("takes the first endpoint that answers with an address and ignores junk and failures", async () => {
    const { detectPublicHost } = await import("../src/services/public-host")
    const answers: Record<string, string | Error> = { a: "<html>error</html>", b: new Error("down"), c: " 198.51.100.4\n", d: "203.0.113.9" }
    const asked: string[] = []
    const host = await detectPublicHost(["a", "b", "c", "d"], async (url) => {
      asked.push(url)
      const answer = answers[url]
      if (answer instanceof Error) throw answer
      return answer
    })
    expect(host).toBe("198.51.100.4")
    expect(asked).toEqual(["a", "b", "c"])
  })

  test("accepts IPv6 and returns nothing when no endpoint works", async () => {
    const { detectPublicHost } = await import("../src/services/public-host")
    expect(await detectPublicHost(["x"], async () => "2001:db8::1")).toBe("2001:db8::1")
    expect(await detectPublicHost(["x"], async () => "not an ip")).toBeUndefined()
  })
})
