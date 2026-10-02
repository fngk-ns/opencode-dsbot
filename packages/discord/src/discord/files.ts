import { mkdir, realpath, rm, stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { StoredAttachment } from "../store/messages"

export type FileKind = "image" | "pdf" | "text" | "binary"

export type SavedFile = {
  name: string
  path: string
  mime: string
  size: number
  kind: FileKind
}

export type Skipped = { name: string; reason: string }

const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown rst log csv tsv json jsonc json5 yaml yml toml ini cfg conf env xml html htm css scss sass less svg " +
    "js mjs cjs jsx ts mts cts tsx py pyi rb go rs java kt kts scala c h cc cpp hpp cs swift m mm php pl lua r sql " +
    "sh bash zsh fish ps1 bat dockerfile makefile gradle tf hcl proto graphql gql vue svelte astro lock diff patch"
  ).split(" "),
)
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

export function classify(name: string, contentType: string | null): FileKind {
  const type = contentType?.split(";")[0].trim().toLowerCase() ?? ""
  const extension = path.extname(name).slice(1).toLowerCase() || path.basename(name).toLowerCase()
  if (IMAGE_TYPES.has(type)) return "image"
  if (type === "application/pdf" || extension === "pdf") return "pdf"
  if (TEXT_EXTENSIONS.has(extension) || type.startsWith("text/") || /json|xml|yaml|javascript/.test(type)) return "text"
  return "binary"
}

/** What opencode should be told the file's media type is. Text is normalised because `.ts` maps to video/mp2t elsewhere. */
export function mimeFor(kind: FileKind, contentType: string | null) {
  if (kind === "text") return "text/plain"
  return contentType?.split(";")[0].trim() || "application/octet-stream"
}

export function safeName(name: string) {
  const cleaned = path
    .basename(name)
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+/, "")
    .slice(-100)
  return cleaned || "file"
}

export function toFilePart(file: SavedFile) {
  if (file.kind === "binary") return
  return { type: "file" as const, mime: file.mime, filename: file.name, url: pathToFileURL(file.path).href }
}

/**
 * Downloads Discord attachments into `<directory>/.discord/uploads/<messageId>/` so the agent can open them by path.
 * Discord CDN downloads are not REST API calls and do not count against bot rate limits.
 */
export async function saveAttachments(input: {
  attachments: StoredAttachment[]
  directory: string
  messageId: string
  maxBytes: number
  fetchFile?: (url: string) => Promise<Response>
}) {
  const saved: SavedFile[] = []
  const skipped: Skipped[] = []
  if (input.attachments.length === 0) return { saved, skipped }

  const root = path.join(input.directory, ".discord")
  const folder = path.join(root, "uploads", input.messageId)
  await mkdir(folder, { recursive: true })
  // Keep downloaded files out of the project's git history.
  await Bun.write(path.join(root, ".gitignore"), "*\n")

  const fetchFile = input.fetchFile ?? ((url: string) => fetch(url))
  for (const attachment of input.attachments) {
    const name = safeName(attachment.name)
    if (attachment.size > input.maxBytes) {
      skipped.push({ name, reason: `larger than ${Math.round(input.maxBytes / 1024 / 1024)}MB` })
      continue
    }
    const destination = path.join(folder, name)
    const response = await fetchFile(attachment.url).catch(() => undefined)
    if (!response?.ok) {
      skipped.push({ name, reason: `download failed${response ? ` (${response.status})` : ""}` })
      continue
    }
    const bytes = await Bun.write(destination, response).catch(() => 0)
    if (bytes === 0 && attachment.size > 0) {
      skipped.push({ name, reason: "download failed" })
      continue
    }
    if (bytes > input.maxBytes) {
      await rm(destination, { force: true })
      skipped.push({ name, reason: "larger than the download limit" })
      continue
    }
    const kind = classify(name, attachment.content_type)
    saved.push({ name, path: destination, mime: mimeFor(kind, attachment.content_type), size: bytes, kind })
  }
  return { saved, skipped }
}

const BLOCKED_NAMES = [/^\.env(\..*)?$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /\.pem$/i, /^\.netrc$/i, /^bot\.sqlite(-wal|-shm)?$/i]

/**
 * Decides whether the agent may send a local file to Discord.
 * The file must live under one of the allowed roots (symlinks resolved), be a regular file within the size limit,
 * and must not look like a credential or the bot's own database.
 */
export async function resolveSendable(input: {
  requested: string
  baseDirectory: string
  roots: string[]
  maxBytes: number
}) {
  const target = path.resolve(input.baseDirectory, input.requested)
  const real = await realpath(target).catch(() => undefined)
  if (!real) return fail(`file not found: ${input.requested}`)

  const roots = await Promise.all(input.roots.map((root) => realpath(root).catch(() => path.resolve(root))))
  if (!roots.some((root) => real === root || real.startsWith(root + path.sep)))
    return fail("file is outside the allowed workspace directories")

  const name = path.basename(real)
  if (BLOCKED_NAMES.some((pattern) => pattern.test(name)) || real.includes(`${path.sep}.ssh${path.sep}`))
    return fail("refusing to send a file that looks like a credential or private data")

  const info = await stat(real)
  if (!info.isFile()) return fail("path is not a regular file")
  if (info.size > input.maxBytes)
    return fail(`file is ${Math.ceil(info.size / 1024 / 1024)}MB, larger than the ${Math.round(input.maxBytes / 1024 / 1024)}MB upload limit; split or compress it`)
  return { ok: true as const, path: real, name, size: info.size }
}

function fail(error: string) {
  return { ok: false as const, error }
}
