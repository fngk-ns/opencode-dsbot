/**
 * Client for the bot's loopback API. The bot starts the opencode server with DISCORD_BRIDGE_URL and
 * DISCORD_BRIDGE_TOKEN in its environment, so these tools only work inside a bot-managed opencode server.
 */
export async function call(route: string, body: Record<string, unknown>) {
  const url = process.env.DISCORD_BRIDGE_URL
  const token = process.env.DISCORD_BRIDGE_TOKEN
  if (!url || !token) return "error: this opencode server was not started by the Discord bot, so Discord tools are unavailable"

  const response = await fetch(`${url}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
  if (response instanceof Error) return `error: cannot reach the Discord bot (${response.message})`

  const text = await response.text()
  // Keep tool output bounded so a large member list cannot flood the model context.
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n…(truncated; narrow the query or lower limit)` : text
}
