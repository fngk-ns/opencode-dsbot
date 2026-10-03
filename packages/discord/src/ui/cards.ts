import { splitMessage, extractLongCode } from "../discord/split"
import { actions, box, button, color, divider, file, linkButton, message, text, type Child } from "./components"

const ANSWER_CHUNK = 3500

/**
 * A final answer. Long code blocks become attachments (shown as file components), and text beyond one message's budget
 * continues in follow-up cards, so nothing is cut off.
 */
export function answerMessages(answer: string) {
  const extracted = extractLongCode(answer)
  const files = extracted.files.map((item) => ({ attachment: Buffer.from(item.content), name: item.name }))
  const chunks = splitMessage(extracted.text, ANSWER_CHUNK)
  if (chunks.length === 0 && files.length === 0) return []

  return (chunks.length === 0 ? [""] : chunks).map((chunk, index, all) => {
    const last = index === all.length - 1
    const children: Child[] = chunk ? [text(chunk)] : []
    if (last) for (const item of files.slice(0, 10)) children.push(file(item.name))
    return message([box(children, color.info)], last && files.length > 0 ? files.slice(0, 10) : undefined)
  })
}

export function permissionCard(input: { tool: string; detail: string; sessionId: string; permissionId: string }) {
  const id = (response: string) => `perm:${response}:${input.sessionId}:${input.permissionId}`
  return message([
    box(
      [
        text(`### 🔐 권한 요청\n**${input.tool}** ${input.detail ? `\`${input.detail.replace(/`/g, "'").slice(0, 300)}\`` : ""}`),
        divider(),
        actions(
          button({ id: id("once"), label: "한 번 허용", style: "success", emoji: "✅" }),
          button({ id: id("always"), label: "항상 허용", style: "primary", emoji: "♾️" }),
          button({ id: id("reject"), label: "거부", style: "danger", emoji: "🚫" }),
        ),
      ],
      color.warn,
    ),
  ])
}

export function confirmCard(input: { title: string; description: string; yesId: string; noId: string; yesLabel?: string; note?: string }) {
  return message([
    box(
      [
        text(`### ${input.title}\n${input.description.slice(0, 1500)}${input.note ? `\n-# ${input.note}` : ""}`),
        divider(),
        actions(button({ id: input.yesId, label: input.yesLabel ?? "실행", style: "danger" }), button({ id: input.noId, label: "취소", style: "secondary" })),
      ],
      color.warn,
    ),
  ])
}

export function serviceCard(input: { name: string; url: string | null; localUrl: string | null; port: number | null; status: string; ready: boolean; description?: string | null; project?: string | null }) {
  const lines = [
    `### 🚀 배포 ${input.ready ? "완료" : "중"} — ${input.name}`,
    input.url ? `🔗 **${input.url}**` : input.localUrl ? `🔗 ${input.localUrl} *(공인 주소를 알 수 없어요 — \`PUBLIC_HOST\` 설정)*` : "",
    `-# ${[input.port === null ? "포트 없음" : `포트 ${input.port}`, input.status, input.project && `📦 ${input.project}`].filter(Boolean).join(" · ")}`,
    input.description ?? "",
    input.ready ? "" : "⚠️ 아직 포트가 열리지 않았어요. 로그를 확인하세요.",
  ].filter(Boolean)
  const buttons = [
    ...(input.url ? [linkButton({ url: input.url, label: "열기", emoji: "🔗" })] : []),
    button({ id: `svc:logs:${input.name}`, label: "로그", emoji: "📜" }),
    button({ id: `svc:restart:${input.name}`, label: "재시작", emoji: "🔄" }),
  ]
  return message([box([text(lines.join("\n")), divider(), actions(...buttons)], input.ready ? color.done : color.warn)])
}

export function projectCard(input: { name: string; title?: string | null; branch?: string | null; directory: string; created: boolean; summary?: string | null }) {
  return message([
    box(
      [
        text(`### 📦 ${input.created ? "새 프로젝트" : "프로젝트"} — ${input.title || input.name}`),
        text(
          [`-# ${input.name}${input.branch ? ` · 🌿 ${input.branch}` : ""}`, `\`${input.directory}\``, input.summary ? `지난 작업: ${input.summary.slice(0, 400)}` : ""].filter(Boolean).join("\n"),
        ),
      ],
      color.info,
    ),
  ])
}

export function noticeCard(title: string, body: string, accent: number = color.info) {
  return message([box([text(`### ${title}${body ? `\n${body}` : ""}`)], accent)])
}
