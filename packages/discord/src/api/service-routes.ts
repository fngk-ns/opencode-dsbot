import path from "node:path"
import { z } from "zod"
import type { ServiceManager } from "../services/manager"
import { reply, type ApiContext } from "./shared"

const body = z.object({
  session_id: z.string(),
  action: z.enum(["deploy", "list", "get", "start", "stop", "restart", "remove", "logs", "set_port", "ports"]),
  name: z.string().optional(),
  command: z.string().optional(),
  directory: z.string().optional(),
  port: z.number().int().optional(),
  no_port: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  autorestart: z.boolean().optional(),
  lines: z.number().optional(),
})

export type ServiceDeps = {
  services: ServiceManager
  isOwner(userId: string | null): boolean
  roots(context: ApiContext): string[]
  /**
   * When set, deploying or removing waits for a button press instead of running at once. The agent reads text from
   * channels, so a planted instruction must not be able to start a process just because an owner spoke last.
   */
  confirmServices?(context: ApiContext, description: string, run: () => Promise<string>): Promise<string>
  /** Called after a successful deploy so the thread gets a deployment card with the address. */
  announceService?(context: ApiContext, deployed: { name: string; url: string | null; local_url: string | null; port: number | null; status: string; ready: boolean; description: string | null; project: string | null }): Promise<void>
}

const READ_ONLY = new Set(["list", "get", "logs", "ports"])

/** Deploying opens a port on a public host and runs commands unattended, so everything that changes a service is owner-only. */
export async function serviceRoute(deps: ServiceDeps, context: ApiContext, raw: unknown) {
  const parsed = body.safeParse(raw)
  if (!parsed.success) return reply(400, { ok: false, error: parsed.error.message })
  const input = parsed.data

  if (!READ_ONLY.has(input.action) && !deps.isOwner(context.speakerId))
    return reply(200, { ok: false, error: "only an owner can deploy or change services" })

  if (input.action === "list") return reply(200, { ok: true, services: await deps.services.list() })
  if (input.action === "ports") return reply(200, { ok: true, ...deps.services.ledger() })

  // A project's service is named after the project, so redeploying keeps the same service and the same port.
  const name = input.name ?? context.project ?? undefined
  if (!name) return reply(200, { ok: false, error: "name is required" })

  if (input.action === "deploy") {
    if (!input.command) return reply(200, { ok: false, error: "command is required, for example \"bun run start\" (it receives the port in $PORT)" })
    // Deployments run from trunk (what has been merged), not from a thread's unfinished branch.
    const directory = path.resolve(context.trunk ?? context.directory, input.directory ?? ".")
    if (!deps.roots(context).some((root) => directory === root || directory.startsWith(root + path.sep)))
      return reply(200, { ok: false, error: "directory must be inside the project or workspace" })
    const deploy = () =>
      deps.services.deploy({
        name,
        command: input.command!,
        directory,
        port: input.no_port ? null : (input.port ?? "auto"),
        env: input.env,
        description: input.description,
        autorestart: input.autorestart,
        owner_thread: context.channelId,
        project: context.project,
        created_by: context.speakerId,
      })
    const announce = async (result: Awaited<ReturnType<typeof deploy>>) => {
      if (result.ok) await deps.announceService?.(context, { name, url: result.url, local_url: result.local_url, port: result.port, status: result.status, ready: result.ready, description: result.description, project: result.project })
      return result
    }
    if (!deps.confirmServices) return reply(200, await announce(await deploy()))
    const id = await deps.confirmServices(context, `서비스 배포 \`${name}\` — \`${input.command}\` (${directory})`, async () => {
      const result = await announce(await deploy())
      return result.ok ? `✅ \`${name}\` 배포${result.ready ? "" : " (아직 포트가 열리지 않았습니다)"}: ${result.url ?? result.local_url ?? "포트 없음"}` : `❌ 배포 실패: ${result.error}`
    })
    return reply(200, { ok: true, pending: true, confirm_id: id, message: "소유자가 확인 버튼을 눌러야 배포됩니다. 다시 요청하지 말고 사용자에게 알려 주세요." })
  }
  if (input.action === "get") {
    const found = (await deps.services.list()).find((service) => service.name === name)
    return reply(200, found ? { ok: true, ...found } : { ok: false, error: `unknown service: ${name}` })
  }
  if (input.action === "logs") return reply(200, { ok: true, logs: await deps.services.logs(name, input.lines) })
  if (input.action === "start") return reply(200, await deps.services.start(name))
  if (input.action === "stop") return reply(200, await deps.services.stop(name))
  if (input.action === "restart") return reply(200, await deps.services.restart(name))
  if (input.action === "remove") {
    if (!deps.confirmServices) return reply(200, await deps.services.remove(name))
    const id = await deps.confirmServices(context, `서비스 삭제 \`${name}\` (중지하고 포트를 반환)`, async () => {
      const result = await deps.services.remove(name)
      return result.ok ? `🗑️ \`${name}\` 을(를) 삭제했습니다 (포트 ${result.freed_port ?? "-"} 반환).` : `❌ ${result.error}`
    })
    return reply(200, { ok: true, pending: true, confirm_id: id, message: "소유자가 확인 버튼을 눌러야 삭제됩니다." })
  }
  return reply(200, await deps.services.setPort(name, input.port ?? "auto"))
}
