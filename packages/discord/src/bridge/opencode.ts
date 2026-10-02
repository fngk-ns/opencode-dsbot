import { createOpencodeClient, type GlobalEvent, type OpencodeClient } from "@opencode-ai/sdk/v2/client"

export type Event = GlobalEvent["payload"]

import type { ModelInfo } from "../models"

export type OpencodeServer = Awaited<ReturnType<typeof startOpencode>>

/**
 * Starts `opencode serve` as a child process on a random loopback port, protected by a random password.
 * One server handles every project; the project is chosen per request through the `directory` query.
 */
export async function startOpencode(input: {
  cmd: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs?: number
}) {
  const password = crypto.randomUUID()
  const proc = Bun.spawn([...input.cmd, "serve", "--hostname=127.0.0.1", "--port=0"], {
    cwd: input.cwd,
    env: { ...process.env, ...input.env, OPENCODE_SERVER_PASSWORD: password },
    stdout: "pipe",
    stderr: "pipe",
  })

  const tail: string[] = []
  const found = Promise.withResolvers<string>()
  const onLine = (line: string) => {
    if (!line.trim()) return
    console.log(`[opencode] ${line}`)
    tail.push(line)
    if (tail.length > 20) tail.shift()
    const match = line.match(/opencode server listening on (https?:\/\/\S+)/)
    if (match) found.resolve(match[1])
  }
  const drained = Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine)])
  // Report the exit only after the pipes are drained, otherwise the reason it died is still unread.
  void Promise.all([proc.exited, drained]).then(([code]) =>
    found.reject(new Error(`opencode exited with code ${code}\n${tail.join("\n")}`)),
  )

  const timer = setTimeout(
    () => found.reject(new Error(`opencode did not start within ${(input.timeoutMs ?? 60_000) / 1000}s\n${tail.join("\n")}`)),
    input.timeoutMs ?? 60_000,
  )
  const url = await found.promise.finally(() => clearTimeout(timer)).catch((error: unknown) => {
    proc.kill()
    throw error
  })

  const client = createOpencodeClient({
    baseUrl: url,
    headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
  })
  return {
    url,
    client,
    exited: proc.exited,
    stop() {
      proc.kill()
    },
  }
}

async function pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    lines.forEach(onLine)
  }
}

/** Follows the server-wide event stream for as long as `signal` is live, reconnecting when it drops. */
export async function followEvents(client: OpencodeClient, onEvent: (event: Event) => void, signal: AbortSignal) {
  while (!signal.aborted) {
    const stream = await client.global.event({ signal }).catch((error: unknown) => {
      console.warn("[opencode] event stream failed to open:", error instanceof Error ? error.message : error)
      return undefined
    })
    if (stream) {
      await (async () => {
        for await (const item of stream.stream) onEvent(item.payload)
      })().catch((error: unknown) => {
        if (!signal.aborted) console.warn("[opencode] event stream error:", error instanceof Error ? error.message : error)
      })
    }
    if (!signal.aborted) await Bun.sleep(1_000)
  }
}

/** Narrow interface the run manager depends on, so it can be exercised without a real server. */
export type Engine = {
  promptAsync(input: {
    sessionId: string
    directory: string
    parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; mime: string; filename?: string; url: string }
    >
    system?: string
    model?: { providerID: string; modelID: string }
    agent?: string
  }): Promise<void>
  abort(sessionId: string, directory: string): Promise<void>
  status(directory: string): Promise<Record<string, { type: string }>>
  respondPermission(sessionId: string, permissionId: string, response: "once" | "always" | "reject", directory: string): Promise<void>
  createSession(directory: string, title: string): Promise<string>
  /** Models of the providers that have credentials configured. */
  models(directory: string): Promise<ModelInfo[]>
}

/**
 * Questions and plan-mode prompts need an interactive terminal. In Discord nobody could answer them and the session
 * would hang, so they are denied for every session the bot creates (same rule the `opencode run` CLI applies).
 */
const NON_INTERACTIVE_RULES = ["question", "plan_enter", "plan_exit"].map((permission) => ({
  permission,
  action: "deny" as const,
  pattern: "*",
}))

export function createEngine(client: OpencodeClient): Engine {
  return {
    async promptAsync(input) {
      const result = await client.session.promptAsync({
        sessionID: input.sessionId,
        directory: input.directory,
        parts: input.parts,
        system: input.system,
        model: input.model,
        agent: input.agent,
      })
      if (result.error) throw new Error(`prompt failed: ${JSON.stringify(result.error)}`)
    },
    async abort(sessionId, directory) {
      await client.session.abort({ sessionID: sessionId, directory })
    },
    async status(directory) {
      const result = await client.session.status({ directory })
      return result.data ?? {}
    },
    async respondPermission(_sessionId, permissionId, response, directory) {
      await client.permission.reply({ requestID: permissionId, directory, reply: response })
    },
    async models(directory) {
      const result = await client.provider.list({ directory })
      if (!result.data) return []
      const connected = new Set(result.data.connected)
      return result.data.all
        .filter((provider) => connected.has(provider.id))
        .flatMap((provider) =>
          Object.values(provider.models).map((model) => ({
            ref: `${provider.id}/${model.id}`,
            provider: provider.id,
            id: model.id,
            name: model.name,
            family: model.family,
            status: model.status,
            released: model.release_date,
          })),
        )
    },
    async createSession(directory, title) {
      const result = await client.session.create({ directory, title, permission: NON_INTERACTIVE_RULES })
      if (result.error || !result.data) throw new Error(`failed to create session: ${JSON.stringify(result.error)}`)
      return result.data.id
    },
  }
}
