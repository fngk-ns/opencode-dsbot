import { describe, expect, test } from "bun:test"
import { matchModels, resolveModel, type ModelInfo } from "../src/models"

function model(provider: string, id: string, name: string, released: string, status = "active"): ModelInfo {
  return { ref: `${provider}/${id}`, provider, id, name, status, released }
}

const catalog = [
  model("anthropic", "claude-sonnet-4-5-20250929", "Claude Sonnet 4.5 (dated)", "2025-09-29"),
  model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", "2025-09-29"),
  model("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", "2026-02-17"),
  model("anthropic", "claude-opus-4-6", "Claude Opus 4.6", "2026-02-05"),
  model("anthropic", "claude-3-5-sonnet-20241022", "Claude Sonnet 3.5 v2", "2024-10-22", "deprecated"),
  model("openrouter", "anthropic/claude-sonnet-4-6", "Claude Sonnet 4.6", "2026-02-17"),
  model("openai", "gpt-5", "GPT-5", "2025-08-07"),
]

const refs = (query: string) => matchModels(query, catalog).map((item) => item.ref)

describe("matchModels", () => {
  test("'claude sonnet' picks the newest Sonnet from the maker's own provider first", () => {
    expect(refs("claude sonnet")[0]).toBe("anthropic/claude-sonnet-4-6")
    expect(refs("claude sonnet")[1]).toBe("openrouter/anthropic/claude-sonnet-4-6")
  })

  test("deprecated models only show up when nothing else matches", () => {
    expect(refs("sonnet")).not.toContain("anthropic/claude-3-5-sonnet-20241022")
    expect(refs("3-5 sonnet")).toEqual(["anthropic/claude-3-5-sonnet-20241022"])
  })

  test("versions can be written with dots, dashes or spaces", () => {
    expect(refs("sonnet 4.5")[0]).toBe("anthropic/claude-sonnet-4-5")
    expect(refs("claude-sonnet-4-5")[0]).toBe("anthropic/claude-sonnet-4-5")
    expect(refs("Sonnet 4.5")).toContain("anthropic/claude-sonnet-4-5-20250929")
  })

  test("the undated alias beats the dated snapshot of the same release", () => {
    const list = refs("sonnet 4.5")
    expect(list.indexOf("anthropic/claude-sonnet-4-5")).toBeLessThan(list.indexOf("anthropic/claude-sonnet-4-5-20250929"))
  })

  test("an exact provider/model ref wins outright", () => {
    expect(refs("openrouter/anthropic/claude-sonnet-4-6")).toEqual(["openrouter/anthropic/claude-sonnet-4-6"])
  })

  test("every word must match, and empty or unknown queries match nothing", () => {
    expect(refs("claude gpt")).toEqual([])
    expect(refs("   ")).toEqual([])
    expect(refs("llama")).toEqual([])
  })

  test("matches on the display name too", () => {
    expect(refs("gpt-5")).toEqual(["openai/gpt-5"])
    expect(resolveModel("opus", catalog)?.ref).toBe("anthropic/claude-opus-4-6")
    expect(resolveModel("nothing", catalog)).toBeUndefined()
  })
})
