import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Deploy and manage long-running services on this host. The bot remembers which service owns which port, keeps services running when the bot restarts, restarts them if they crash, and reports their public URL.

- deploy: name (lowercase-dashes), command, optional directory (default: the project), port (omit for an automatic port that stays the same on every redeploy), env, description. The command must listen on $PORT (and 0.0.0.0), for example "bun run start" or "cd dist && python3 -m http.server $PORT". Build the project first, then deploy. The result says whether the port is actually listening and includes the log tail: if ready is false, read the logs and fix it.
- list / get / ports: what runs where; ports shows the port ledger and how many are free.
- start / stop / restart / remove (remove frees the port) / set_port / logs (lines).

Changing services is owner-only. The bot's own credentials are never passed to a service; give it only the env it needs. Never invent ports: let the bot choose, or ask for a specific one.`,
  args: {
    action: tool.schema.enum(["deploy", "list", "get", "start", "stop", "restart", "remove", "logs", "set_port", "ports"]).describe("What to do"),
    name: tool.schema.string().optional().describe("Service name"),
    command: tool.schema.string().optional().describe("Shell command that starts the server; it receives PORT in the environment"),
    directory: tool.schema.string().optional().describe("Working directory, relative to the project (default: the project)"),
    port: tool.schema.number().optional().describe("A specific port; omit to keep the current one or pick a free one"),
    no_port: tool.schema.boolean().optional().describe("Background worker without a port"),
    env: tool.schema.record(tool.schema.string(), tool.schema.string()).optional().describe("Extra environment variables"),
    description: tool.schema.string().optional().describe("What this service is, shown in the port list"),
    autorestart: tool.schema.boolean().optional().describe("Restart automatically if it exits (default true)"),
    lines: tool.schema.number().optional().describe("logs: number of lines (default 50)"),
  },
  async execute(args, context) {
    return call("/services", { session_id: context.sessionID, ...args })
  },
})
