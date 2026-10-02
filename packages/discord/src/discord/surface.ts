import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, type SendableChannels } from "discord.js"
import type { Surface } from "../bridge/runs"
import { deliver, type OutFile } from "./outbound"

/** The Discord side of the run manager: posting text, files, progress edits and approval buttons. */
export class DiscordSurface implements Surface {
  constructor(private readonly client: Client) {}

  /** Cache first. A live fetch only happens for a channel that was never cached, such as a long-archived thread. */
  async channel(id: string): Promise<SendableChannels> {
    const channel = this.client.channels.cache.get(id) ?? (await this.client.channels.fetch(id))
    if (!channel?.isSendable()) throw new Error(`channel ${id} cannot be written to`)
    return channel
  }

  async send(channelId: string, text: string, files: OutFile[] = []) {
    const channel = await this.channel(channelId)
    await deliver({ send: (payload) => channel.send(payload) }, text, files)
  }

  async createProgress(channelId: string, text: string) {
    const channel = await this.channel(channelId)
    return (await channel.send({ content: text })).id
  }

  async editProgress(channelId: string, messageId: string, text: string) {
    const channel = await this.channel(channelId)
    // Editing by ID works without the message being cached.
    if ("messages" in channel) await channel.messages.edit(messageId, { content: text })
  }

  typing(channelId: string) {
    const channel = this.client.channels.cache.get(channelId)
    if (channel?.isSendable()) void channel.sendTyping().catch(() => undefined)
  }

  async askPermission(channelId: string, permission: { sessionId: string; id: string; title: string; detail: string }) {
    const channel = await this.channel(channelId)
    const id = (response: string) => `perm:${response}:${permission.sessionId}:${permission.id}`
    await channel.send({
      content: `🔐 **권한 요청** — ${permission.title}\n\`${permission.detail || "n/a"}\``.slice(0, 1900),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(id("once")).setLabel("한 번 허용").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(id("always")).setLabel("항상 허용").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(id("reject")).setLabel("거부").setStyle(ButtonStyle.Danger),
        ),
      ],
    })
  }

  async askRestart(channelId: string, reason: string) {
    const channel = await this.channel(channelId)
    await channel.send({
      content: `🔄 **재시작 요청** — ${reason}\n검증(check/test)을 통과했습니다. 소유자가 승인하면 봇이 재시작됩니다.`.slice(0, 1900),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("restart:yes").setLabel("재시작").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("restart:no").setLabel("취소").setStyle(ButtonStyle.Secondary),
        ),
      ],
    })
  }
}
