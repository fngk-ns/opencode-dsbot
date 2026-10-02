export type MessageRef = {
  guildId?: string
  channelId?: string
  messageId: string
}

const LINK = /https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(@me|\d{15,25})\/(\d{15,25})\/(\d{15,25})/g
const BARE_ID = /^\d{15,25}$/

/** Accepts a message link or a bare message ID. */
export function parseMessageRef(input: string): MessageRef | undefined {
  const value = input.trim()
  if (BARE_ID.test(value)) return { messageId: value }
  const link = findMessageLinks(value)[0]
  if (!link || link.index !== 0) return
  return link.ref
}

export function findMessageLinks(text: string) {
  return [...text.matchAll(LINK)].map((match) => ({
    index: match.index,
    url: match[0],
    ref: {
      guildId: match[1] === "@me" ? undefined : match[1],
      channelId: match[2],
      messageId: match[3],
    } satisfies MessageRef,
  }))
}
