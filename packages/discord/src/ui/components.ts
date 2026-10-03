import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIFileComponent,
  type APISeparatorComponent,
  type APITextDisplayComponent,
} from "discord.js"

// Components V2 messages carry no `content` or embeds: everything, including plain text, is a component.
export type Child = APITextDisplayComponent | APISeparatorComponent | APIActionRowComponent<APIButtonComponent> | APIFileComponent

export const color = {
  running: 0x5865f2,
  done: 0x2ecc71,
  failed: 0xe74c3c,
  stopped: 0x95a5a6,
  info: 0x3498db,
  warn: 0xf1c40f,
}

// Discord's limits for one Components V2 message.
export const MAX_COMPONENTS = 40
export const MAX_TEXT = 4000

export function text(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content }
}

export function divider(large = false): APISeparatorComponent {
  return { type: ComponentType.Separator, divider: true, spacing: large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small }
}

export function actions(...buttons: APIButtonComponent[]): APIActionRowComponent<APIButtonComponent> {
  return { type: ComponentType.ActionRow, components: buttons.slice(0, 5) }
}

export function button(input: { id: string; label: string; style?: "primary" | "secondary" | "success" | "danger"; emoji?: string; disabled?: boolean }): APIButtonComponent {
  const styles = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger } as const
  return {
    type: ComponentType.Button,
    style: styles[input.style ?? "secondary"],
    custom_id: input.id,
    label: input.label,
    emoji: input.emoji ? { name: input.emoji } : undefined,
    disabled: input.disabled,
  }
}

export function linkButton(input: { url: string; label: string; emoji?: string }): APIButtonComponent {
  return { type: ComponentType.Button, style: ButtonStyle.Link, url: input.url, label: input.label, emoji: input.emoji ? { name: input.emoji } : undefined }
}

export function file(name: string): APIFileComponent {
  return { type: ComponentType.File, file: { url: `attachment://${name}` } }
}

export function box(children: Child[], accent: number): APIContainerComponent {
  return { type: ComponentType.Container, accent_color: accent, components: children }
}

/** A sendable payload. `files` are the attachments the `file()` components point at. */
export function message(components: APIContainerComponent[], files?: Array<{ attachment: string | Buffer; name: string }>) {
  return { components: fit(components), flags: MessageFlags.IsComponentsV2 as const, files, allowedMentions: { parse: [] as never[] } }
}

export function countComponents(components: APIContainerComponent[]) {
  return components.reduce((sum, item) => sum + 1 + item.components.reduce((inner, child) => inner + 1 + (child.type === ComponentType.ActionRow ? child.components.length : 0), 0), 0)
}

export function textLength(components: APIContainerComponent[]) {
  return components.reduce((sum, item) => sum + item.components.reduce((inner, child) => inner + (child.type === ComponentType.TextDisplay ? child.content.length : 0), 0), 0)
}

/**
 * Keeps a message inside Discord's limits so a long tool list or answer can never make the whole message fail to send.
 * Text is shortened from the end of the last text blocks first; separators are dropped when there are too many components.
 */
export function fit(components: APIContainerComponent[]): APIContainerComponent[] {
  const result = components.map((item) => ({ ...item, components: [...item.components] }))
  let guard = 200
  while (countComponents(result) > MAX_COMPONENTS && guard-- > 0) {
    const last = result[result.length - 1]
    const index = last.components.findLastIndex((child) => child.type === ComponentType.Separator)
    if (index === -1) break
    last.components.splice(index, 1)
  }
  let overflow = textLength(result) - MAX_TEXT
  for (const item of [...result].reverse()) {
    for (let index = item.components.length - 1; index >= 0 && overflow > 0; index--) {
      const child = item.components[index]
      if (child.type !== ComponentType.TextDisplay) continue
      const keep = Math.max(child.content.length - overflow - 1, 0)
      overflow -= child.content.length - keep
      item.components[index] = text(keep > 0 ? `${child.content.slice(0, keep)}…` : "…")
    }
  }
  return result
}
