import type { Db } from "../store/db"

export type ProjectRecord = {
  name: string
  title: string | null
  description: string | null
  /** The trunk checkout. Nobody edits it directly; threads work on branches and merge into it. */
  directory: string
  aliases: string[]
  summary: string | null
  last_thread: string | null
  created_by: string | null
  created_at: number
  updated_at: number
}

type Row = Omit<ProjectRecord, "aliases"> & { aliases: string }

export type ProjectMatch = { project: ProjectRecord; score: number }

/** Every project the bot has built, so "the blog I made last time" can be found from any thread, in any channel. */
export class ProjectStore {
  constructor(private readonly db: Db) {}

  get(name: string) {
    const row = this.db.query("SELECT * FROM projects WHERE name = $name").get({ $name: name }) as Row | null
    return row ? decode(row) : undefined
  }

  list() {
    return (this.db.query("SELECT * FROM projects ORDER BY updated_at DESC").all() as Row[]).map(decode)
  }

  create(input: { name: string; title?: string | null; description?: string | null; directory: string; aliases?: string[]; created_by?: string | null; last_thread?: string | null }) {
    const now = Date.now()
    this.db
      .query(
        `INSERT INTO projects (name, title, description, directory, aliases, last_thread, created_by, created_at, updated_at)
         VALUES ($name, $title, $description, $directory, $aliases, $last_thread, $created_by, $now, $now)`,
      )
      .run({
        $name: input.name,
        $title: input.title ?? null,
        $description: input.description ?? null,
        $directory: input.directory,
        $aliases: JSON.stringify(input.aliases ?? []),
        $last_thread: input.last_thread ?? null,
        $created_by: input.created_by ?? null,
        $now: now,
      })
    return this.get(input.name)!
  }

  update(name: string, patch: { title?: string; description?: string; aliases?: string[]; summary?: string; last_thread?: string }) {
    this.db
      .query(
        `UPDATE projects SET
           title = COALESCE($title, title), description = COALESCE($description, description),
           aliases = COALESCE($aliases, aliases), summary = COALESCE($summary, summary),
           last_thread = COALESCE($last_thread, last_thread), updated_at = $now
         WHERE name = $name`,
      )
      .run({
        $name: name,
        $title: patch.title ?? null,
        $description: patch.description ?? null,
        $aliases: patch.aliases ? JSON.stringify(patch.aliases) : null,
        $summary: patch.summary ?? null,
        $last_thread: patch.last_thread ?? null,
        $now: Date.now(),
      })
    return this.get(name)
  }

  /**
   * Ranks projects against free text such as "저번에 만든 블로그 사이트에 댓글 기능". Korean attaches particles to words,
   * so a project keyword counts when it appears anywhere inside the text rather than as a separate token.
   */
  find(query: string): ProjectMatch[] {
    const text = normalize(query)
    if (!text) return []
    const words = text.split(" ").filter((word) => word.length >= 2)
    return this.list()
      .map((project) => ({ project, score: score(project, text, words) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
  }

  /**
   * The one project a request clearly refers to, or nothing when it is unclear or ambiguous. Clear means its name or an
   * alias appears in the text, or at least two words of its title do; and no other project comes close.
   */
  match(query: string) {
    const [best, next] = this.find(query)
    if (!best || best.score < STRONG) return
    return next && next.score * 2 > best.score ? undefined : best.project
  }
}

const NAMED = 10
const STRONG = 8

function score(project: ProjectRecord, text: string, words: string[]) {
  let total = 0
  const keywords = [project.name, ...project.aliases].map(normalize).filter((keyword) => keyword.length >= 2)
  for (const keyword of keywords) if (text.includes(keyword)) total += NAMED
  const titleWords = normalize(project.title ?? "").split(" ").filter((word) => word.length >= 2)
  for (const word of titleWords) if (text.includes(word)) total += 4
  const description = normalize(project.description ?? "")
  for (const word of words) if (word.length >= 3 && description.includes(word)) total += 1
  return total
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function decode(row: Row): ProjectRecord {
  return { ...row, aliases: JSON.parse(row.aliases) as string[] }
}
