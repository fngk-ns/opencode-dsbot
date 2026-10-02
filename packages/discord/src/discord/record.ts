import type { Message, PartialMessage } from "discord.js"
import type { StoredAttachment, StoredMessage } from "../store/messages"

type Source = Message | PartialMessage

/** Converts a gateway message into the row kept in the message cache. */
export function toStored(message: Message): StoredMessage {
  return {
    id: message.id,
    channel_id: message.channelId,
    guild_id: message.guildId,
    author_id: message.author.id,
    author_name: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    author_bot: message.author.bot,
    content: bodyOf(message),
    attachments: attachmentsOf(message),
    reference_id: message.reference?.messageId ?? null,
    created_at: message.createdTimestamp,
    edited_at: message.editedTimestamp,
    deleted_at: null,
  }
}

/** Only fields the gateway actually sent. A partial update must not blank out cached content. */
export function editPatch(message: Source) {
  return {
    content: message.content === null ? undefined : bodyOf(message),
    attachments: message.attachments ? attachmentsOf(message) : undefined,
    edited_at: message.editedTimestamp ?? Date.now(),
  }
}

export function attachmentsOf(message: Source): StoredAttachment[] {
  return [...message.attachments.values()].map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    url: attachment.url,
    size: attachment.size,
    content_type: attachment.contentType,
  }))
}

/** Message text plus any embed text, because bots and link previews often carry the useful part in embeds. */
function bodyOf(message: Source) {
  const embeds = message.embeds
    .map((embed) => [embed.title, embed.description].filter(Boolean).join(" — "))
    .filter(Boolean)
    .map((text) => `[embed] ${text}`)
  return [message.content ?? "", ...embeds].filter(Boolean).join("\n")
}
