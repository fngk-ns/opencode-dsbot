import type { SendableChannels } from "discord.js"
import { type Client } from "discord.js"
import type { Surface } from "../bridge/runs"
import { answerMessages, confirmCard, noticeCard, permissionCard, serviceCard } from "../ui/cards"
import { message } from "../ui/components"
import { renderRunCard } from "../ui/run-card"
import type { RunView } from "../ui/view"
import { deliver, type OutFile } from "./outbound"

type CardPayload = ReturnType<typeof message>

/** The Discord side of the bot: plain notices, and the Components V2 cards (run progress, answers, approvals, deployments). */
export class DiscordSurface implements Surface {
  constructor(private readonly client: Client) {}

  /** Cache first. A live fetch only happens for a channel that was never cached, such as a long-archived thread. */
  async channel(id: string): Promise<SendableChannels> {
    const channel = this.client.channels.cache.get(id) ?? (await this.client.channels.fetch(id))
    if (!channel?.isSendable()) throw new Error(`channel ${id} cannot be written to`)
    return channel
  }

  /** Plain text, split into message-sized pieces. Used for short notices and command replies. */
  async send(channelId: string, text: string, files: OutFile[] = []) {
    const channel = await this.channel(channelId)
    await deliver({ send: (payload) => channel.send(payload) }, text, files)
  }

  async sendCard(channelId: string, payload: CardPayload) {
    const channel = await this.channel(channelId)
    return (await channel.send(payload)).id
  }

  /** The run card: created on the first call, edited in place afterwards. */
  async showRun(channelId: string, view: RunView, messageId?: string) {
    const payload = message([renderRunCard(view)])
    if (!messageId) return this.sendCard(channelId, payload)
    const channel = await this.channel(channelId)
    // Editing by ID works without the message being cached. The flag must be repeated on every edit.
    if ("messages" in channel) await channel.messages.edit(messageId, { components: payload.components, flags: payload.flags })
    return messageId
  }

  async sendAnswer(channelId: string, text: string) {
    for (const payload of answerMessages(text)) await this.sendCard(channelId, payload)
  }

  typing(channelId: string) {
    const channel = this.client.channels.cache.get(channelId)
    if (channel?.isSendable()) void channel.sendTyping().catch(() => undefined)
  }

  async askPermission(channelId: string, permission: { sessionId: string; id: string; tool: string; detail: string }) {
    await this.sendCard(channelId, permissionCard({ tool: permission.tool, detail: permission.detail, sessionId: permission.sessionId, permissionId: permission.id }))
  }

  async askAdminConfirm(channelId: string, confirmId: string, description: string) {
    await this.sendCard(
      channelId,
      confirmCard({ title: "⚠️ 확인이 필요합니다", description, yesId: `admin:yes:${confirmId}`, noId: `admin:no:${confirmId}`, note: "되돌리기 어려운 작업입니다. 요청한 사람 또는 소유자가 5분 안에 눌러 주세요." }),
    )
  }

  async askRestart(channelId: string, reason: string) {
    await this.sendCard(
      channelId,
      confirmCard({ title: "🔄 재시작 요청", description: reason, yesId: "restart:yes", noId: "restart:no", yesLabel: "재시작", note: "검증(check/test)을 통과했습니다. 소유자가 승인하면 봇이 재시작됩니다." }),
    )
  }

  async showService(channelId: string, input: Parameters<typeof serviceCard>[0]) {
    await this.sendCard(channelId, serviceCard(input))
  }

  async notice(channelId: string, title: string, body = "", accent?: number) {
    await this.sendCard(channelId, noticeCard(title, body, accent))
  }
}
