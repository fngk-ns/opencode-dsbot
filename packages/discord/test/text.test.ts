import { describe, expect, test } from "bun:test"
import { findMessageLinks, parseMessageRef } from "../src/discord/links"
import { extensionFor, extractLongCode, splitMessage } from "../src/discord/split"
import { parseDirectives } from "../src/directives"
import { loadConfig, parseModel } from "../src/config"

describe("parseMessageRef", () => {
  test("parses guild links, ptb/canary links and bare IDs", () => {
    expect(parseMessageRef("https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333")).toEqual({
      guildId: "111111111111111111",
      channelId: "222222222222222222",
      messageId: "333333333333333333",
    })
    expect(parseMessageRef("https://ptb.discord.com/channels/@me/222222222222222222/333333333333333333")).toEqual({
      guildId: undefined,
      channelId: "222222222222222222",
      messageId: "333333333333333333",
    })
    expect(parseMessageRef("  333333333333333333 ")).toEqual({ messageId: "333333333333333333" })
  })

  test("rejects text that is not exactly a reference", () => {
    expect(parseMessageRef("hello")).toBeUndefined()
    expect(parseMessageRef("see https://discord.com/channels/1/2/3")).toBeUndefined()
    expect(parseMessageRef("12345")).toBeUndefined()
  })

  test("findMessageLinks finds every link inside prose", () => {
    const text =
      "a https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333 b https://discord.com/channels/111111111111111111/222222222222222222/444444444444444444"
    expect(findMessageLinks(text).map((link) => link.ref.messageId)).toEqual(["333333333333333333", "444444444444444444"])
  })
})

describe("splitMessage", () => {
  test("keeps short text in one chunk and drops empty text", () => {
    expect(splitMessage("hello")).toEqual(["hello"])
    expect(splitMessage("   ")).toEqual([])
  })

  test("every chunk fits the limit and no text is lost", () => {
    const text = Array.from({ length: 400 }, (_, index) => `line ${index} with some words`).join("\n")
    const chunks = splitMessage(text, 500)
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true)
    expect(chunks.join("\n").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "))
  })

  test("closes and reopens code fences across chunks", () => {
    const code = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index}`).join("\n")
    const chunks = splitMessage("intro\n```ts\n" + code + "\n```\noutro", 600)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(600)
      expect((chunk.match(/^```/gm) ?? []).length % 2).toBe(0)
    }
    expect(chunks[1].startsWith("```ts\n")).toBe(true)
  })

  test("splits a single very long word without looping forever", () => {
    const chunks = splitMessage("x".repeat(5000), 1000)
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true)
    expect(chunks.join("").length).toBe(5000)
  })
})

describe("extractLongCode", () => {
  test("moves only oversized blocks into files with a matching extension", () => {
    const long = "a\n".repeat(900)
    const result = extractLongCode(`small\n\`\`\`py\nprint(1)\n\`\`\`\nbig\n\`\`\`python\n${long}\`\`\``, 1500)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].name).toBe("snippet-1.py")
    expect(result.text).toContain("print(1)")
    expect(result.text).toContain("`snippet-1.py`")
    expect(result.text).not.toContain(long)
  })

  test("extensionFor falls back to txt", () => {
    expect(extensionFor("TypeScript")).toBe("ts")
    expect(extensionFor("brainfuck")).toBe("txt")
    expect(extensionFor("")).toBe("txt")
  })
})

describe("parseDirectives", () => {
  test("reads stacked directives and leaves the prompt", () => {
    expect(parseDirectives("/new /project blog 랜딩페이지 만들어줘")).toEqual({
      directives: [{ kind: "new" }, { kind: "project", name: "blog" }],
      rest: "랜딩페이지 만들어줘",
    })
  })

  test("supports model/agent arguments and bare commands", () => {
    expect(parseDirectives("/model anthropic/claude-sonnet-4 /self fix the logger").directives).toEqual([
      { kind: "model", model: "anthropic/claude-sonnet-4" },
      { kind: "self" },
    ])
    expect(parseDirectives("/stop").directives).toEqual([{ kind: "stop" }])
  })

  test("unknown slash text stays in the prompt", () => {
    expect(parseDirectives("/compact now")).toEqual({ directives: [], rest: "/compact now" })
    expect(parseDirectives("/project")).toEqual({ directives: [], rest: "/project" })
    expect(parseDirectives("just text /new")).toEqual({ directives: [], rest: "just text /new" })
  })
})

describe("loadConfig", () => {
  const base = { DISCORD_TOKEN: "t", DISCORD_OWNER_IDS: "1, 2" }

  test("requires a token and at least one owner", () => {
    expect(() => loadConfig({})).toThrow("DISCORD_TOKEN")
    expect(() => loadConfig({ DISCORD_TOKEN: "t" })).toThrow("DISCORD_OWNER_IDS")
  })

  test("owners are always allowed users and defaults are conservative", () => {
    const config = loadConfig({ ...base, DISCORD_USER_IDS: "3" })
    expect([...config.userIds].sort()).toEqual(["1", "2", "3"])
    expect(config.permissionMode).toBe("ask")
    expect(config.restartMode).toBe("confirm")
    expect(config.maxUploadBytes).toBe(10 * 1024 * 1024)
  })

  test("rejects unknown modes and parses the model", () => {
    expect(() => loadConfig({ ...base, PERMISSION_MODE: "yolo" })).toThrow("PERMISSION_MODE")
    expect(parseModel("anthropic/claude/x")).toEqual({ providerID: "anthropic", modelID: "claude/x" })
    expect(parseModel("nope")).toBeUndefined()
    expect(loadConfig({ ...base, OPENCODE_CMD: "bun run x" }).opencodeCmd).toEqual(["bun", "run", "x"])
  })
})
