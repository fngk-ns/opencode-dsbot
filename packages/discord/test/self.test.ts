import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { startOpencode } from "../src/bridge/opencode"
import { LAST_GOOD_REF, run, snapshotHealthy } from "../src/self/update"

let temp: string

beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "dsbot-self-"))
})

afterAll(() => rm(temp, { recursive: true, force: true }))

async function git(cwd: string, ...args: string[]) {
  const result = await run(["git", ...args], cwd, 20_000)
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.output}`)
  return result.output
}

describe("snapshotHealthy", () => {
  test("captures tracked and untracked files without touching the index or branch", async () => {
    const repo = path.join(temp, "repo")
    const dir = path.join(repo, "packages", "bot")
    await mkdir(dir, { recursive: true })
    await git(repo, "init", "-q")
    await git(repo, "config", "user.email", "t@example.com")
    await git(repo, "config", "user.name", "t")
    await Bun.write(path.join(dir, "a.ts"), "export const a = 1\n")
    await Bun.write(path.join(dir, ".gitignore"), ".env\n")
    await git(repo, "add", "-A")
    await git(repo, "commit", "-q", "-m", "init")

    // working-tree state: modified tracked file, new untracked file, ignored secret
    await Bun.write(path.join(dir, "a.ts"), "export const a = 2\n")
    await Bun.write(path.join(dir, "b.ts"), "export const b = 1\n")
    await Bun.write(path.join(dir, ".env"), "TOKEN=secret\n")
    const headBefore = await git(repo, "rev-parse", "HEAD")
    const statusBefore = await git(repo, "status", "--porcelain")

    const result = await snapshotHealthy(dir)
    expect(result.ok).toBe(true)

    const files = (await git(repo, "ls-tree", "-r", "--name-only", LAST_GOOD_REF)).split("\n").sort()
    expect(files).toEqual(["packages/bot/.gitignore", "packages/bot/a.ts", "packages/bot/b.ts"])
    expect(await git(repo, "show", `${LAST_GOOD_REF}:packages/bot/a.ts`)).toBe("export const a = 2")

    expect(await git(repo, "rev-parse", "HEAD")).toBe(headBefore)
    expect(await git(repo, "status", "--porcelain")).toBe(statusBefore)
  })

  test("reports a non-git directory instead of throwing", async () => {
    const plain = path.join(temp, "plain")
    await mkdir(plain, { recursive: true })
    expect(await snapshotHealthy(plain)).toEqual({ ok: false, reason: "not a git checkout" })
  })
})

describe("run", () => {
  test("merges output and kills commands that exceed the timeout", async () => {
    const merged = await run(["sh", "-c", "echo out; echo err 1>&2; exit 3"], temp, 5_000)
    expect(merged.code).toBe(3)
    expect(merged.output).toContain("out")
    expect(merged.output).toContain("err")

    const started = Date.now()
    const slow = await run(["sh", "-c", "echo before; sleep 10"], temp, 300)
    expect(slow.code).toBe(124)
    expect(slow.output).toContain("before")
    expect(slow.output).toContain("timed out")
    // Must return near the timeout even though the grandchild `sleep` keeps the pipes open.
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})

describe("startOpencode", () => {
  async function fakeServer(name: string, body: string) {
    const file = path.join(temp, name)
    await Bun.write(file, `#!/bin/sh\n${body}\n`)
    await chmod(file, 0o755)
    return file
  }

  test("parses the listening URL, passes env, and returns an authenticated client", async () => {
    const script = await fakeServer(
      "ok.sh",
      'echo "starting"; echo "opencode server listening on http://127.0.0.1:4567"; echo "$DISCORD_BRIDGE_URL" >&2; exec sleep 30',
    )
    const server = await startOpencode({ cmd: [script], cwd: temp, env: { DISCORD_BRIDGE_URL: "http://bridge" }, timeoutMs: 5_000 })
    try {
      expect(server.url).toBe("http://127.0.0.1:4567")
    } finally {
      server.stop()
    }
  })

  test("fails with the server output when the process exits early", async () => {
    const script = await fakeServer("dies.sh", 'echo "boom: missing config"; exit 2')
    await expect(startOpencode({ cmd: [script], cwd: temp, env: {}, timeoutMs: 5_000 })).rejects.toThrow("boom: missing config")
  })

  test("times out when the server never announces itself", async () => {
    const script = await fakeServer("silent.sh", "exec sleep 30")
    await expect(startOpencode({ cmd: [script], cwd: temp, env: {}, timeoutMs: 300 })).rejects.toThrow("did not start")
  })
})
