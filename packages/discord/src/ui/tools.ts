import type { ToolEntry } from "./view"

export type ToolLook = { icon: string; name: string; detail: string }

const NAMES: Record<string, { icon: string; name: string }> = {
  bash: { icon: "⌨️", name: "bash" },
  shell: { icon: "⌨️", name: "shell" },
  read: { icon: "📖", name: "read" },
  list: { icon: "📂", name: "list" },
  glob: { icon: "🔎", name: "glob" },
  grep: { icon: "🔍", name: "grep" },
  edit: { icon: "✏️", name: "edit" },
  write: { icon: "📝", name: "write" },
  apply_patch: { icon: "🩹", name: "patch" },
  webfetch: { icon: "🌐", name: "fetch" },
  websearch: { icon: "🔎", name: "search" },
  task: { icon: "🧩", name: "subagent" },
  todowrite: { icon: "☑️", name: "todo" },
  todoread: { icon: "☑️", name: "todo" },
  skill: { icon: "🎓", name: "skill" },
  lsp: { icon: "🧭", name: "lsp" },
  discord_memory: { icon: "🧠", name: "memory" },
  discord_service: { icon: "🚀", name: "service" },
  discord_project: { icon: "📦", name: "project" },
  discord_thread: { icon: "🌿", name: "thread" },
  discord_admin: { icon: "🛡️", name: "server" },
  discord_lookup: { icon: "💬", name: "discord" },
  discord_send_file: { icon: "📎", name: "send file" },
  discord_settings: { icon: "⚙️", name: "settings" },
  discord_restart: { icon: "🔄", name: "restart" },
}

/** Turns a raw tool call into the icon, name and one-line detail shown on the run card. */
export function describeTool(entry: ToolEntry, directory?: string): ToolLook {
  const known = NAMES[entry.tool] ?? { icon: "🔧", name: entry.tool }
  return { ...known, detail: detailOf(entry, directory) }
}

function detailOf(entry: ToolEntry, directory?: string) {
  const input = entry.input
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined)
  const relative = (path: string | undefined) => (path && directory && path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : path)

  switch (entry.tool) {
    case "bash":
    case "shell":
      return clip(firstLine(str("command") ?? entry.title), 72)
    case "read":
    case "list":
      return clip(relative(str("filePath") ?? str("path")) ?? entry.title, 64)
    case "edit":
    case "write": {
      const file = relative(str("filePath")) ?? entry.title
      const stat = entry.additions !== undefined || entry.deletions !== undefined ? ` +${entry.additions ?? 0} −${entry.deletions ?? 0}` : ""
      return clip(file, 56) + stat
    }
    case "glob":
    case "grep":
      return clip(str("pattern") ?? entry.title, 56)
    case "webfetch":
      return clip(hostOf(str("url")) ?? entry.title, 56)
    case "websearch":
      return clip(str("query") ?? entry.title, 56)
    case "task":
      return clip(str("description") ?? entry.title, 64)
    case "todowrite":
      return "할 일 업데이트"
    default:
      if (entry.tool.startsWith("discord_")) {
        const action = str("action")
        const what = str("title") ?? str("name") ?? str("query")
        return clip([action, what].filter(Boolean).join(" · ") || entry.title, 64)
      }
      return clip(entry.title || firstLine(Object.values(input).find((value): value is string => typeof value === "string") ?? ""), 64)
  }
}

export function elapsed(ms: number) {
  const seconds = Math.max(Math.round(ms / 1000), 0)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function compact(count: number) {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

export function firstLine(value: string) {
  return value.split("\n").find((line) => line.trim())?.trim() ?? ""
}

export function clip(value: string, max: number) {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function hostOf(url: string | undefined) {
  if (!url) return undefined
  try {
    return new URL(url).host + new URL(url).pathname.replace(/\/$/, "")
  } catch {
    return url
  }
}
