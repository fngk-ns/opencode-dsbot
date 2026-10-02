const EXTENSIONS: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  python: "py",
  py: "py",
  rust: "rs",
  go: "go",
  java: "java",
  kotlin: "kt",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  cs: "cs",
  ruby: "rb",
  php: "php",
  swift: "swift",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  json: "json",
  yaml: "yaml",
  yml: "yml",
  toml: "toml",
  html: "html",
  css: "css",
  sql: "sql",
  markdown: "md",
  md: "md",
  xml: "xml",
  diff: "diff",
  dockerfile: "Dockerfile",
}

export function extensionFor(lang: string) {
  return EXTENSIONS[lang.trim().toLowerCase()] ?? "txt"
}

/** Splits text into Discord-sized messages, keeping fenced code blocks balanced across chunks. */
export function splitMessage(text: string, limit = 1900) {
  const chunks: string[] = []
  let rest = text.trim()
  let fence: string | undefined
  while (rest.length > 0) {
    const prefix = fence === undefined ? "" : "```" + fence + "\n"
    if (prefix.length + rest.length <= limit) {
      chunks.push(prefix + rest)
      break
    }
    // Reserve room for a closing fence in case the cut lands inside a code block.
    const room = limit - prefix.length - 4
    const cut = cutPoint(rest, room)
    const piece = prefix + rest.slice(0, cut)
    rest = rest.slice(cut).replace(/^\n/, "")
    fence = openFence(piece)
    chunks.push(fence === undefined ? piece : piece + "\n```")
  }
  return chunks
}

function cutPoint(text: string, room: number) {
  const newline = text.lastIndexOf("\n", room)
  if (newline > room / 2) return newline
  const space = text.lastIndexOf(" ", room)
  if (space > room / 2) return space
  return room
}

/** Returns the language of the code fence that is still open at the end of `text`, if any. */
function openFence(text: string) {
  let open: string | undefined
  for (const line of text.split("\n")) {
    if (!line.startsWith("```")) continue
    open = open === undefined ? line.slice(3).trim() : undefined
  }
  return open
}

export type ExtractedFile = { name: string; content: string }

/** Moves oversized fenced code blocks into files so long code arrives as an attachment instead of a wall of chunks. */
export function extractLongCode(text: string, maxInline = 1500) {
  const files: ExtractedFile[] = []
  const replaced = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (block, lang: string, body: string) => {
    if (body.length <= maxInline) return block
    const extension = extensionFor(lang)
    const name = extension === "Dockerfile" ? "Dockerfile" : `snippet-${files.length + 1}.${extension}`
    files.push({ name, content: body })
    return `📎 \`${name}\` (${body.split("\n").length}줄, 첨부)`
  })
  return { text: replaced, files }
}
