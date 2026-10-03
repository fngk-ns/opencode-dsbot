import type { APIContainerComponent } from "discord.js"
import { actions, box, button, color, divider, text, type Child } from "./components"
import { clip, compact, describeTool, elapsed } from "./tools"
import type { RunView, ToolEntry, ToolStatus } from "./view"

const VISIBLE_TOOLS = 6
const VISIBLE_TODOS = 7
const VISIBLE_FILES = 5

const STATE = {
  running: { icon: "⏳", label: "작업 중", accent: color.running },
  done: { icon: "✅", label: "완료", accent: color.done },
  failed: { icon: "❌", label: "실패", accent: color.failed },
  stopped: { icon: "⏹️", label: "중단됨", accent: color.stopped },
  moved: { icon: "📦", label: "프로젝트로 이동", accent: color.info },
} as const

const STATUS_ICON: Record<ToolStatus, string> = { pending: "⏳", running: "⏳", completed: "✅", error: "❌" }

/**
 * The live card for one run: a header with what is working, a todo checklist, the latest tool activity, what changed,
 * and a stop button while it is running. When the run ends it collapses into a summary.
 */
export function renderRunCard(view: RunView, now = Date.now()): APIContainerComponent {
  const state = STATE[view.state]
  const running = view.state === "running"
  const duration = elapsed((view.endedAt ?? now) - view.startedAt)
  const meta = [view.model && `🤖 ${view.model}`, view.branch && `🌿 ${view.branch}`, view.project && `📦 ${view.project}`, `⏱ ${duration}`].filter(Boolean).join(" · ")

  const body: Child[] = [text(`### ${state.icon} ${state.label}\n-# ${meta}`)]
  const sections = [todoBlock(view), running ? activityBlock(view) : summaryBlock(view), narrationBlock(view), changesBlock(view), notesBlock(view)].filter((section): section is string => !!section)
  for (const section of sections) body.push(divider(), text(section))

  const footer = [view.tokens && `${compact(view.tokens.input + view.tokens.output + view.tokens.cache)} tokens`, view.cost ? `$${view.cost.toFixed(3)}` : undefined].filter(Boolean).join(" · ")
  if (footer) body.push(text(`-# ${footer}`))
  if (running) body.push(actions(button({ id: `run:stop:${view.sessionId}`, label: "중단", style: "danger", emoji: "⏹️" })))
  return box(body, state.accent)
}

function activityBlock(view: RunView) {
  if (view.tools.length === 0) return view.retry ? undefined : "-# 생각하는 중…"
  const shown = view.tools.slice(-VISIBLE_TOOLS)
  const hidden = view.tools.length - shown.length
  const lines = shown.map((entry) => toolLine(entry, view.directory))
  const failed = view.tools.at(-1)?.status === "error" ? view.tools.at(-1) : undefined
  return [hidden > 0 ? `-# … 앞선 ${hidden}개 생략` : "", ...lines, failed?.tail ? `\`\`\`\n${clip(failed.tail, 280)}\n\`\`\`` : ""].filter(Boolean).join("\n")
}

function toolLine(entry: ToolEntry, directory?: string) {
  const look = describeTool(entry, directory)
  const detail = look.detail ? ` \`${look.detail.replace(/`/g, "'")}\`` : ""
  const took = entry.started !== undefined && entry.ended !== undefined ? ` · ${elapsed(entry.ended - entry.started)}` : ""
  const exit = entry.exit && entry.exit !== 0 ? ` · exit ${entry.exit}` : ""
  return `${STATUS_ICON[entry.status]} ${look.icon} **${look.name}**${detail}${took}${exit}`
}

/** Once a run is over, the tool-by-tool list is replaced with counts so the thread stays readable. */
function summaryBlock(view: RunView) {
  if (view.tools.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const entry of view.tools) counts.set(entry.tool, (counts.get(entry.tool) ?? 0) + 1)
  const parts = [...counts].map(([tool, count]) => {
    const look = describeTool({ callID: "", tool, status: "completed", title: "", input: {} })
    return `${look.icon} ${look.name} ×${count}`
  })
  const failed = view.tools.filter((entry) => entry.status === "error").length
  return `${parts.join(" · ")}${failed ? ` · ❌ ${failed}회 실패` : ""}`
}

function todoBlock(view: RunView) {
  if (view.todos.length === 0) return undefined
  const done = view.todos.filter((todo) => todo.status === "completed").length
  const active = view.todos.findIndex((todo) => todo.status === "in_progress")
  // Keep the active item in view when the list is longer than the card shows.
  const start = Math.min(Math.max(active - 2, 0), Math.max(view.todos.length - VISIBLE_TODOS, 0))
  const icons = { completed: "✅", in_progress: "🔄", pending: "⬜", cancelled: "🚫" }
  const lines = view.todos.slice(start, start + VISIBLE_TODOS).map((todo) => `${icons[todo.status]} ${clip(todo.content, 80)}`)
  return [`**할 일** ${done}/${view.todos.length}`, ...lines].join("\n")
}

function narrationBlock(view: RunView) {
  const last = view.narration.at(-1)
  return view.state === "running" && last ? `💬 *${clip(last, 160)}*` : undefined
}

function changesBlock(view: RunView) {
  const files = new Map<string, { additions: number; deletions: number }>()
  for (const entry of view.tools) {
    if (entry.status !== "completed" || !entry.file) continue
    const known = files.get(entry.file) ?? { additions: 0, deletions: 0 }
    files.set(entry.file, { additions: known.additions + (entry.additions ?? 0), deletions: known.deletions + (entry.deletions ?? 0) })
  }
  if (files.size === 0) return undefined
  const additions = [...files.values()].reduce((sum, item) => sum + item.additions, 0)
  const deletions = [...files.values()].reduce((sum, item) => sum + item.deletions, 0)
  const shown = [...files].slice(-VISIBLE_FILES).map(([file, stat]) => `• \`${clip(relative(file, view.directory), 60)}\`${stat.additions || stat.deletions ? ` +${stat.additions} −${stat.deletions}` : ""}`)
  const hidden = files.size - shown.length
  return [`**변경** ${files.size}개 파일 · +${additions} −${deletions}`, ...shown, hidden > 0 ? `-# … 외 ${hidden}개` : ""].filter(Boolean).join("\n")
}

function notesBlock(view: RunView) {
  return [view.steered > 0 ? `📨 추가 지시 ${view.steered}건을 바로 전달했어요` : "", view.retry ? `⏳ ${view.retry}` : "", view.failure ? `⚠️ ${clip(view.failure, 300)}` : ""].filter(Boolean).join("\n") || undefined
}

function relative(file: string, directory?: string) {
  return directory && file.startsWith(`${directory}/`) ? file.slice(directory.length + 1) : file
}
