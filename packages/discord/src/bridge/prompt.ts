import type { SavedFile, Skipped } from "../discord/files"

export function systemPrompt(input: { kind: "project" | "self"; directory: string; selfDir: string; maxUploadMb: number }) {
  const base = [
    "You are an opencode coding agent running as a Discord bot on a Linux host. People talk to you in a Discord thread; your replies are posted there.",
    `Your working directory is ${input.directory}. You can build projects, edit files, run shell commands and manage this computer, within the permissions you are given.`,
    "",
    "Discord conventions:",
    "- Answer in the language the user writes in. Be concise; use Discord Markdown. Do not paste long code into chat.",
    "- When the user wants code, a document, a log or any artifact, write it to a file in the working directory and send it with the discord_send_file tool. Code blocks over ~1500 characters are automatically turned into attachments anyway.",
    `- Attachments the user uploads are saved under ${input.directory}/.discord/uploads/ and listed in the message; read them from there.`,
    `- Discord upload limit is about ${input.maxUploadMb} MB per file.`,
    "- Never mention @everyone, @here or role pings. Never print or send secrets (bot token, .env files, SSH keys).",
    "",
    "Discord data (messages, members, channels, roles):",
    "- Use the discord_lookup tool. It reads a local cache that the bot fills from the gateway: all current members, and every message since the bot started. This is fast and free of rate limits.",
    "- Do not call the Discord REST API or the gateway yourself. The only time Discord is queried live is when you pass a specific message link or ID that is not cached.",
    "- If cached history does not reach back far enough, say so and ask for a message link instead of guessing.",
  ]
  if (input.kind === "project") return base.join("\n")
  return [
    ...base,
    "",
    "SELF-MODIFICATION MODE:",
    `- The working directory ${input.selfDir} is the source code of the very bot you are running as. Edit it with care.`,
    "- Keep changes focused. Do not touch .env, data/ or any secrets.",
    "- After editing, run `bun run check` and `bun test` in that directory and fix every failure.",
    "- When everything passes, call the discord_restart tool with a short reason. It re-verifies the code, asks the owner to confirm, then restarts the bot. This thread keeps working after the restart.",
    "- If the new code fails to start, the supervisor rolls back to the last healthy snapshot, but do not rely on that.",
  ].join("\n")
}

export type ReferenceContext = { author: string; content: string; link: string }

export function userPrompt(input: {
  author: { id: string; name: string }
  channelLabel: string
  now: Date
  text: string
  replyTo?: ReferenceContext
  linked: ReferenceContext[]
  saved: SavedFile[]
  skipped: Skipped[]
}) {
  const lines = [`[Discord] ${input.author.name} (${input.author.id}) in ${input.channelLabel} at ${input.now.toISOString()}`]
  if (input.replyTo) lines.push("", `Replying to ${input.replyTo.author}: ${quote(input.replyTo.content)} (${input.replyTo.link})`)
  for (const item of input.linked) lines.push("", `Linked message by ${item.author}: ${quote(item.content)} (${item.link})`)
  if (input.saved.length > 0) {
    lines.push("", "Attached files (saved locally):")
    for (const file of input.saved) lines.push(`- ${file.path} (${file.mime}, ${formatSize(file.size)})`)
  }
  if (input.skipped.length > 0) {
    lines.push("", "Attachments that could not be used:")
    for (const file of input.skipped) lines.push(`- ${file.name}: ${file.reason}`)
  }
  const text = input.text.trim() || (input.saved.length > 0 ? "첨부된 파일을 확인하고 필요한 작업을 해줘." : "")
  lines.push("", text)
  return lines.join("\n").trim()
}

function quote(text: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  return JSON.stringify(flat.length > 1500 ? `${flat.slice(0, 1499)}…` : flat)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
