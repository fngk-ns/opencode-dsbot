import { describe, expect, test } from "bun:test"
import { systemPrompt, userPrompt } from "../src/bridge/prompt"
import { stripMention } from "../src/router"

describe("stripMention", () => {
  test("removes both mention syntaxes anywhere in the text", () => {
    expect(stripMention("<@123> build a site", "123")).toBe("build a site")
    expect(stripMention("hey <@!123> build <@123> it", "123")).toBe("hey  build  it")
    expect(stripMention("<@999> keep other mentions", "123")).toBe("<@999> keep other mentions")
  })
})

describe("systemPrompt", () => {
  const input = { directory: "/work/blog", selfDir: "/opt/bot", maxUploadMb: 10 }

  test("project sessions describe tools and the cache-only rule, but not self-modification", () => {
    const text = systemPrompt({ kind: "project", ...input })
    expect(text).toContain("/work/blog")
    expect(text).toContain("discord_lookup")
    expect(text).toContain("discord_send_file")
    expect(text).toContain("Do not call the Discord REST API")
    expect(text).not.toContain("SELF-MODIFICATION")
    expect(text).not.toContain("discord_restart")
  })

  test("self sessions add the verify-then-restart workflow", () => {
    const text = systemPrompt({ kind: "self", ...input })
    expect(text).toContain("SELF-MODIFICATION MODE")
    expect(text).toContain("bun run check")
    expect(text).toContain("discord_restart")
  })
})

describe("userPrompt", () => {
  const base = {
    author: { id: "1", name: "alice" },
    channelLabel: "Guild / #dev (thread 5)",
    now: new Date("2026-10-02T00:00:00Z"),
    text: "fix it",
    linked: [],
    saved: [],
    skipped: [],
  }

  test("has a header with the author and place, then the text", () => {
    const text = userPrompt(base)
    expect(text.split("\n")[0]).toBe("[Discord] alice (1) in Guild / #dev (thread 5) at 2026-10-02T00:00:00.000Z")
    expect(text.endsWith("fix it")).toBe(true)
  })

  test("includes reply context, linked messages, saved files and skipped files", () => {
    const text = userPrompt({
      ...base,
      replyTo: { author: "bob", content: "it\ncrashes", link: "https://discord.com/channels/1/2/3" },
      linked: [{ author: "carol", content: "see log", link: "https://discord.com/channels/1/2/4" }],
      saved: [{ name: "a.log", path: "/work/blog/.discord/uploads/9/a.log", mime: "text/plain", size: 2048, kind: "text" }],
      skipped: [{ name: "big.zip", reason: "larger than 25MB" }],
    })
    expect(text).toContain('Replying to bob: "it crashes"')
    expect(text).toContain("Linked message by carol")
    expect(text).toContain("- /work/blog/.discord/uploads/9/a.log (text/plain, 2.0KB)")
    expect(text).toContain("- big.zip: larger than 25MB")
  })

  test("an attachment-only message gets a default request", () => {
    const text = userPrompt({
      ...base,
      text: "  ",
      saved: [{ name: "a.png", path: "/x/a.png", mime: "image/png", size: 10, kind: "image" }],
    })
    expect(text.endsWith("첨부된 파일을 확인하고 필요한 작업을 해줘.")).toBe(true)
  })
})
