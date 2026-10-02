import { extractLongCode, splitMessage } from "./split"

export type OutFile = { attachment: string | Buffer; name: string }

export type Sender = {
  send(payload: { content?: string; files?: OutFile[] }): Promise<{ id: string }>
}

const MAX_FILES_PER_MESSAGE = 10
const INLINE_LIMIT = 6000

/**
 * Posts model text to Discord. Long code blocks become attachments, replies above ~6000 characters become a
 * Markdown attachment with a short preview, and everything else is split into message-sized pieces.
 */
export async function deliver(sender: Sender, text: string, files: OutFile[] = []) {
  const extracted = extractLongCode(text)
  const attachments = [
    ...files,
    ...extracted.files.map((file) => ({ attachment: Buffer.from(file.content), name: file.name })),
  ]
  let body = extracted.text.trim()
  if (body.length > INLINE_LIMIT) {
    attachments.push({ attachment: Buffer.from(body), name: "response.md" })
    body = `${body.slice(0, 1500).trimEnd()}…\n\n📎 \`response.md\` — 전체 내용은 첨부파일을 확인하세요.`
  }

  const sent: string[] = []
  const chunks = splitMessage(body)
  for (const [index, chunk] of chunks.entries()) {
    // Attachments ride on the last text chunk so the reply reads top to bottom.
    const last = index === chunks.length - 1
    const batch = last ? attachments.slice(0, MAX_FILES_PER_MESSAGE) : []
    sent.push((await sender.send({ content: chunk, files: batch.length > 0 ? batch : undefined })).id)
  }
  const remaining = chunks.length === 0 ? attachments : attachments.slice(MAX_FILES_PER_MESSAGE)
  for (let start = 0; start < remaining.length; start += MAX_FILES_PER_MESSAGE) {
    sent.push((await sender.send({ files: remaining.slice(start, start + MAX_FILES_PER_MESSAGE) })).id)
  }
  return sent
}
