import { parseMessageRef } from "../discord/links"
import type { MessageStore, SearchInput, StoredMessage } from "../store/messages"
import type { Directory, MemberInfo } from "./directory"

export type Remote = (channelId: string, messageId: string) => Promise<StoredMessage | undefined>

export type Failure = { ok: false; error: string }

/** Sliding-window guard around the only REST reads this bot performs. */
export class RestBudget {
  private readonly hits: number[] = []

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  take() {
    const cutoff = this.now() - 60_000
    while (this.hits.length > 0 && this.hits[0] <= cutoff) this.hits.shift()
    if (this.hits.length >= this.perMinute) return false
    this.hits.push(this.now())
    return true
  }
}

/**
 * Single entry point for every data question the agent can ask about Discord.
 * Messages and members come from the local cache. The only REST call is `remote`, used when the caller names
 * a specific message by ID or link and that message was never seen by the gateway.
 */
export function createLookup(input: {
  messages: MessageStore
  directory: Directory
  remote: Remote
  restLookupsPerMinute: number
  now?: () => number
}) {
  const now = input.now ?? Date.now
  const budget = new RestBudget(input.restLookupsPerMinute, now)
  const inflight = new Map<string, Promise<StoredMessage | undefined>>()
  const missing = new Map<string, number>()

  async function message(args: { ref: string; channel_id?: string }) {
    const ref = parseMessageRef(args.ref)
    if (!ref) return fail("ref must be a Discord message link or a message ID")

    const cached = input.messages.get(ref.messageId)
    if (cached) return { ok: true as const, source: "cache" as const, message: present(cached) }

    const channelId = ref.channelId ?? args.channel_id
    if (!channelId) return fail("message is not cached; give a message link, or a channel_id together with the ID")

    if ((missing.get(ref.messageId) ?? 0) > now()) return fail("message was not found recently (cached negative result)")

    // Concurrent asks for the same message share one request and cost one unit of budget.
    const shared = inflight.get(ref.messageId)
    if (!shared && !budget.take()) return fail("REST lookup budget exhausted; retry in a minute or use cached search")
    const pending = shared ?? input.remote(channelId, ref.messageId)
    inflight.set(ref.messageId, pending)
    const fetched = await pending.catch(() => undefined).finally(() => inflight.delete(ref.messageId))
    if (!fetched) {
      missing.set(ref.messageId, now() + 60_000)
      return fail("message could not be fetched (deleted, or no access)")
    }
    input.messages.save(fetched)
    return { ok: true as const, source: "api" as const, message: present(fetched) }
  }

  function messages(args: { channel_id: string; limit?: number; before?: string }) {
    const found = input.messages.recent(args.channel_id, { limit: args.limit, before: args.before })
    return {
      ok: true as const,
      source: "cache" as const,
      cached_since: iso(input.messages.coverage(args.channel_id).oldest),
      note: "Only messages seen since the bot started are available. Older history needs an explicit message link.",
      messages: found.map(present).reverse(),
    }
  }

  function search(args: SearchInput) {
    return {
      ok: true as const,
      source: "cache" as const,
      cached_since: iso(input.messages.coverage(args.channel_id).oldest),
      messages: input.messages.search(args).map(present),
    }
  }

  function member(args: { guild_id: string; ref: string }) {
    const members = input.directory.members(args.guild_id)
    if (!members) return fail("unknown guild_id")
    const found = rankMembers(members, args.ref, 1)[0]
    if (!found) return fail("no cached member matches")
    return { ok: true as const, source: "cache" as const, member: found }
  }

  function memberList(args: { guild_id: string; query?: string; role_id?: string; limit?: number; offset?: number }) {
    const members = input.directory.members(args.guild_id)
    if (!members) return fail("unknown guild_id")
    const scoped = args.role_id ? members.filter((item) => item.roles.includes(args.role_id!)) : members
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100)
    const matches = args.query ? rankMembers(scoped, args.query, scoped.length) : scoped
    const offset = Math.max(args.offset ?? 0, 0)
    return {
      ok: true as const,
      source: "cache" as const,
      total: matches.length,
      members: matches.slice(offset, offset + limit),
    }
  }

  function channels(args: { guild_id: string; query?: string }) {
    const found = input.directory.channels(args.guild_id)
    if (!found) return fail("unknown guild_id")
    const query = args.query?.toLowerCase()
    return {
      ok: true as const,
      source: "cache" as const,
      channels: query ? found.filter((item) => item.name.toLowerCase().includes(query)) : found,
    }
  }

  function roles(args: { guild_id: string }) {
    const found = input.directory.roles(args.guild_id)
    if (!found) return fail("unknown guild_id")
    return { ok: true as const, source: "cache" as const, roles: found.sort((a, b) => b.position - a.position) }
  }

  function guilds() {
    return { ok: true as const, source: "cache" as const, guilds: input.directory.guilds() }
  }

  return { message, messages, search, member, memberList, channels, roles, guilds }
}

/** Exact id/mention first, then exact name, prefix, substring. Case-insensitive. */
export function rankMembers(members: MemberInfo[], query: string, limit: number) {
  const needle = query.trim().replace(/^<@!?(\d+)>$/, "$1").replace(/^@/, "").toLowerCase()
  if (!needle) return []
  return members
    .map((item) => ({ item, score: score(item, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.display_name.localeCompare(b.item.display_name))
    .slice(0, limit)
    .map((entry) => entry.item)
}

function score(member: MemberInfo, needle: string) {
  if (member.id === needle) return 100
  const names = [member.username, member.display_name, member.global_name, member.nickname]
    .filter((name): name is string => !!name)
    .map((name) => name.toLowerCase())
  if (names.some((name) => name === needle)) return 80
  if (names.some((name) => name.startsWith(needle))) return 60
  if (names.some((name) => name.includes(needle))) return 40
  return 0
}

function present(message: StoredMessage) {
  return {
    id: message.id,
    link: `https://discord.com/channels/${message.guild_id ?? "@me"}/${message.channel_id}/${message.id}`,
    guild_id: message.guild_id,
    channel_id: message.channel_id,
    author: { id: message.author_id, name: message.author_name, bot: message.author_bot },
    content: message.content,
    attachments: message.attachments.map((item) => ({ name: item.name, size: item.size, url: item.url })),
    reply_to: message.reference_id,
    created_at: iso(message.created_at),
    edited_at: iso(message.edited_at),
    deleted_at: iso(message.deleted_at),
  }
}

function iso(value: number | null) {
  return value === null ? null : new Date(value).toISOString()
}

function fail(error: string): Failure {
  return { ok: false, error }
}
