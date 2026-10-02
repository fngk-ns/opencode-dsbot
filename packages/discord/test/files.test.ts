import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { classify, resolveSendable, safeName, saveAttachments, toFilePart } from "../src/discord/files"
import { deliver, type OutFile } from "../src/discord/outbound"

let temp: string
let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "dsbot-files-"))
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/ok.ts") return new Response("export const a = 1\n")
      if (url.pathname === "/pic.png") return new Response(new Uint8Array([137, 80, 78, 71]))
      if (url.pathname === "/huge.bin") return new Response(new Uint8Array(2048))
      return new Response("nope", { status: 404 })
    },
  })
})

afterAll(async () => {
  server.stop(true)
  await rm(temp, { recursive: true, force: true })
})

describe("classify", () => {
  test("code is text even when the CDN reports a wrong mime (ts => video/mp2t)", () => {
    expect(classify("main.ts", "video/mp2t")).toBe("text")
    expect(classify("Dockerfile", null)).toBe("text")
    expect(classify("notes.md", "text/markdown; charset=utf-8")).toBe("text")
  })

  test("images, pdf and binaries", () => {
    expect(classify("a.png", "image/png")).toBe("image")
    expect(classify("a.heic", "image/heic")).toBe("binary")
    expect(classify("doc.pdf", null)).toBe("pdf")
    expect(classify("a.zip", "application/zip")).toBe("binary")
  })

  test("safeName strips paths, dots and odd characters", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd")
    expect(safeName(".hidden")).toBe("hidden")
    expect(safeName("한글 파일 (1).txt")).toBe("한글_파일_1_.txt")
    expect(safeName("...")).toBe("file")
  })
})

describe("saveAttachments", () => {
  const base = () => `http://127.0.0.1:${server.port}`

  test("downloads into the project and builds file parts for supported kinds", async () => {
    const directory = path.join(temp, "p1")
    const result = await saveAttachments({
      directory,
      messageId: "m1",
      maxBytes: 1024,
      attachments: [
        { id: "1", name: "ok.ts", url: `${base()}/ok.ts`, size: 19, content_type: "video/mp2t" },
        { id: "2", name: "pic.png", url: `${base()}/pic.png`, size: 4, content_type: "image/png" },
      ],
    })
    expect(result.skipped).toEqual([])
    expect(result.saved.map((file) => file.name)).toEqual(["ok.ts", "pic.png"])
    expect(await Bun.file(result.saved[0].path).text()).toBe("export const a = 1\n")
    expect(await Bun.file(path.join(directory, ".discord", ".gitignore")).text()).toBe("*\n")

    const part = toFilePart(result.saved[0])
    expect(part).toMatchObject({ type: "file", mime: "text/plain", filename: "ok.ts" })
    expect(part?.url.startsWith("file://")).toBe(true)
  })

  test("skips oversized, missing and failed downloads with a reason", async () => {
    const result = await saveAttachments({
      directory: path.join(temp, "p2"),
      messageId: "m2",
      maxBytes: 1024,
      attachments: [
        { id: "1", name: "big.bin", url: `${base()}/huge.bin`, size: 2048, content_type: null },
        { id: "2", name: "gone.txt", url: `${base()}/missing`, size: 5, content_type: "text/plain" },
      ],
    })
    expect(result.saved).toEqual([])
    expect(result.skipped.map((item) => item.name)).toEqual(["big.bin", "gone.txt"])
    expect(result.skipped[0].reason).toContain("larger")
    expect(result.skipped[1].reason).toContain("404")
  })

  test("a download that is bigger than advertised is deleted", async () => {
    const result = await saveAttachments({
      directory: path.join(temp, "p3"),
      messageId: "m3",
      maxBytes: 1024,
      attachments: [{ id: "1", name: "lie.bin", url: `${base()}/huge.bin`, size: 10, content_type: null }],
    })
    expect(result.saved).toEqual([])
    expect(result.skipped[0].reason).toContain("larger")
  })

  test("binary files are saved but produce no prompt part", async () => {
    const result = await saveAttachments({
      directory: path.join(temp, "p4"),
      messageId: "m4",
      maxBytes: 4096,
      attachments: [{ id: "1", name: "a.zip", url: `${base()}/huge.bin`, size: 2048, content_type: "application/zip" }],
    })
    expect(result.skipped).toEqual([])
    expect(result.saved[0]).toMatchObject({ name: "a.zip", kind: "binary", size: 2048 })
    expect(toFilePart(result.saved[0])).toBeUndefined()
  })
})

describe("resolveSendable", () => {
  test("allows files inside a root, relative to the session directory", async () => {
    const root = path.join(temp, "send")
    await mkdir(root, { recursive: true })
    await Bun.write(path.join(root, "out.txt"), "hello")
    const result = await resolveSendable({ requested: "out.txt", baseDirectory: root, roots: [root], maxBytes: 100 })
    expect(result).toMatchObject({ ok: true, name: "out.txt", size: 5 })
  })

  test("rejects traversal, symlink escapes and secret-looking names", async () => {
    const root = path.join(temp, "guard")
    const outside = path.join(temp, "outside.txt")
    await mkdir(root, { recursive: true })
    await Bun.write(outside, "secret")
    await Bun.write(path.join(root, ".env"), "TOKEN=1")
    await symlink(outside, path.join(root, "link.txt"))

    const run = (requested: string) => resolveSendable({ requested, baseDirectory: root, roots: [root], maxBytes: 100 })
    expect(await run("../outside.txt")).toMatchObject({ ok: false })
    expect(await run("link.txt")).toMatchObject({ ok: false })
    expect(await run(".env")).toMatchObject({ ok: false })
    expect(await run("missing.txt")).toMatchObject({ ok: false })
    expect(await run(".")).toMatchObject({ ok: false })
  })

  test("enforces the upload size limit", async () => {
    const root = path.join(temp, "size")
    await mkdir(root, { recursive: true })
    await Bun.write(path.join(root, "big.txt"), "x".repeat(50))
    const result = await resolveSendable({ requested: "big.txt", baseDirectory: root, roots: [root], maxBytes: 10 })
    expect(result).toMatchObject({ ok: false })
  })
})

describe("deliver", () => {
  function recorder() {
    const sent: { content?: string; files?: OutFile[] }[] = []
    return { sent, sender: { send: async (payload: { content?: string; files?: OutFile[] }) => (sent.push(payload), { id: String(sent.length) }) } }
  }

  test("short text is one message", async () => {
    const { sender, sent } = recorder()
    await deliver(sender, "hi")
    expect(sent).toEqual([{ content: "hi", files: undefined }])
  })

  test("long code blocks become attachments on the final chunk", async () => {
    const { sender, sent } = recorder()
    const code = "line\n".repeat(600)
    await deliver(sender, `here you go\n\`\`\`ts\n${code}\`\`\`\ndone`)
    expect(sent).toHaveLength(1)
    expect(sent[0].content).toContain("snippet-1.ts")
    expect(sent[0].files?.[0].name).toBe("snippet-1.ts")
    expect(sent[0].files?.[0].attachment.toString()).toBe(code)
  })

  test("very long prose is attached as response.md with a preview", async () => {
    const { sender, sent } = recorder()
    await deliver(sender, "word ".repeat(2000))
    const last = sent[sent.length - 1]
    expect(last.files?.[0].name).toBe("response.md")
    expect(sent.every((item) => (item.content?.length ?? 0) <= 2000)).toBe(true)
  })

  test("more than ten files spill into extra messages and files alone still send", async () => {
    const { sender, sent } = recorder()
    const files = Array.from({ length: 12 }, (_, index) => ({ attachment: Buffer.from("x"), name: `f${index}.txt` }))
    await deliver(sender, "", files)
    expect(sent.map((item) => item.files?.length)).toEqual([10, 2])
  })
})
