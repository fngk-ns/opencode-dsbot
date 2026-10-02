export type ModelInfo = {
  /** `provider/model`, the form opencode and the `/model` command use. */
  ref: string
  provider: string
  id: string
  name: string
  family?: string
  status: string
  released: string
}

// When the same model is offered by several providers, the maker's own provider wins.
const VENDOR_FIRST = ["anthropic", "openai", "google"]

/**
 * Finds the models a person means by loose words such as "claude sonnet" or "sonnet 4.5".
 * Every word must appear in the model's id or display name. Results are best first: active before deprecated,
 * newest release first, then the vendor's own provider, then the shortest id (the undated alias).
 */
export function matchModels(query: string, models: ModelInfo[]) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const exact = models.filter((model) => model.ref.toLowerCase() === needle)
  if (exact.length > 0) return exact

  const words = needle.split(/\s+/).map(normalize).filter(Boolean)
  const matches = models.filter((model) => {
    const haystack = `${normalize(model.ref)} ${normalize(model.name)}`
    return words.every((word) => haystack.includes(word))
  })
  const usable = matches.filter((model) => model.status === "active" || model.status === "beta")
  return (usable.length > 0 ? usable : matches).sort(compare)
}

/** `/model` accepts an exact `provider/model` or loose words; returns the model to use, if one can be found. */
export function resolveModel(value: string, models: ModelInfo[]) {
  return matchModels(value, models)[0]
}

function compare(a: ModelInfo, b: ModelInfo) {
  if (a.released !== b.released) return a.released < b.released ? 1 : -1
  const rank = (model: ModelInfo) => {
    const index = VENDOR_FIRST.indexOf(model.provider)
    return index === -1 ? VENDOR_FIRST.length : index
  }
  return rank(a) - rank(b) || a.ref.length - b.ref.length || a.ref.localeCompare(b.ref)
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s._:/]+/g, "-").replace(/^-+|-+$/g, "")
}
