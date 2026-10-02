import os from "node:os"
import path from "node:path"

export const LAST_GOOD_REF = "refs/opencode-discord/last-good"

type Result = { code: number; output: string }

/**
 * Runs a command, merging stdout/stderr, and gives up after the timeout (exit code 124).
 * Output is collected separately from the wait: a grandchild that inherited the pipes can outlive the killed
 * process, and must not be able to hold this call open past its timeout.
 */
export async function run(cmd: string[], cwd: string, timeoutMs: number, env: Record<string, string> = {}): Promise<Result> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  let output = ""
  const decoder = new TextDecoder()
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      output += decoder.decode(chunk.value, { stream: true })
    }
  }
  const finished = Promise.all([drain(proc.stdout), drain(proc.stderr), proc.exited]).then((results) => results[2])

  const timeout = Promise.withResolvers<"timeout">()
  const timer = setTimeout(() => {
    proc.kill()
    timeout.resolve("timeout")
  }, timeoutMs)
  const outcome = await Promise.race([finished, timeout.promise]).finally(() => clearTimeout(timer))
  if (outcome === "timeout") return { code: 124, output: `${output.trim()}\n(timed out after ${timeoutMs}ms)`.trim() }
  return { code: outcome, output: output.trim() }
}

/**
 * Gate for self-modification: the new code must bundle, pass its own tests and (when a type checker is installed)
 * typecheck before the bot is allowed to restart into it.
 */
export async function verifySelf(dir: string) {
  const bun = process.execPath
  const steps: Array<{ name: string; cmd: string[]; optional?: boolean }> = [
    { name: "bun run check", cmd: [bun, "run", "check"] },
    { name: "bun test", cmd: [bun, "test"] },
    { name: "bun run typecheck", cmd: [bun, "run", "typecheck"], optional: true },
  ]
  const report: string[] = []
  for (const step of steps) {
    const result = await run(step.cmd, dir, 180_000)
    const missingTool = step.optional && (result.code === 127 || /not found|ENOENT|Script not found/i.test(result.output))
    if (missingTool) {
      report.push(`- ${step.name}: skipped (not available)`)
      continue
    }
    if (result.code !== 0) {
      report.push(`- ${step.name}: FAILED (exit ${result.code})`, tail(result.output))
      return { ok: false as const, report: report.join("\n") }
    }
    report.push(`- ${step.name}: ok`)
  }
  return { ok: true as const, report: report.join("\n") }
}

/**
 * Records the working tree of `dir` (including untracked files, excluding ignored ones) as a dangling commit under
 * `refs/opencode-discord/last-good`. deploy/run.sh restores it when a new version cannot start.
 * Uses a temporary index so the user's staged changes and branch are never touched.
 */
export async function snapshotHealthy(dir: string) {
  const root = await run(["git", "rev-parse", "--show-toplevel"], dir, 10_000)
  if (root.code !== 0) return { ok: false as const, reason: "not a git checkout" }

  const index = path.join(os.tmpdir(), `opencode-discord-index-${process.pid}`)
  const env = {
    GIT_INDEX_FILE: index,
    GIT_AUTHOR_NAME: "opencode-discord",
    GIT_AUTHOR_EMAIL: "opencode-discord@localhost",
    GIT_COMMITTER_NAME: "opencode-discord",
    GIT_COMMITTER_EMAIL: "opencode-discord@localhost",
  }
  const git = (...args: string[]) => run(["git", ...args], root.output, 30_000, env)

  const added = await git("add", "-A", "--", dir)
  const tree = added.code === 0 ? await git("write-tree") : added
  const commit = tree.code === 0 ? await git("commit-tree", tree.output, "-m", "last-good snapshot") : tree
  const updated = commit.code === 0 ? await git("update-ref", LAST_GOOD_REF, commit.output) : commit
  await Bun.file(index).delete().catch(() => undefined)
  if (updated.code !== 0) return { ok: false as const, reason: updated.output }
  return { ok: true as const, commit: commit.output }
}

function tail(output: string, max = 3500) {
  return output.length > max ? `…${output.slice(-max)}` : output
}
