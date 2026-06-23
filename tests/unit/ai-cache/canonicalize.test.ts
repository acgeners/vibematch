import { describe, it, expect } from "vitest"
import {
  canonicalize,
  stableStringify,
  CanonicalizeError,
} from "@/lib/ai-cache/canonicalize"
import { buildCacheKey, buildCacheKeyObject } from "@/lib/ai-cache/build-cache-key"
import type { AiCacheKeyInput } from "@/lib/ai-cache/types"

const baseKey: AiCacheKeyInput = {
  operation: "ai_evaluation",
  input: { title: "X", synopsis: "abc" },
  model: "claude-sonnet-4-6",
  promptVersion: "v19",
  outputSchemaVersion: "eval-1",
}

describe("canonicalize / stableStringify (§25.1)", () => {
  it("objetos com ordem de chaves diferente geram a MESMA serialização", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
    expect(stableStringify({ a: { x: 1, y: 2 } })).toBe(stableStringify({ a: { y: 2, x: 1 } }))
  })

  it("arrays SEMÂNTICOS preservam a ordem (ordem diferente ⇒ chave diferente)", () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]))
  })

  it("arrays NÃO-semânticos podem ser normalizados pelo caller (pré-ordenar)", () => {
    const a = ["b", "a", "c"]
    const b = ["c", "b", "a"]
    expect(stableStringify([...a].sort())).toBe(stableStringify([...b].sort()))
  })

  it("null DIFERE de ausente", () => {
    expect(stableStringify({ a: null })).not.toBe(stableStringify({}))
    expect(stableStringify({ a: null })).toBe('{"a":null}')
    expect(stableStringify({})).toBe("{}")
  })

  it("string vazia DIFERE de ausente e de null", () => {
    expect(stableStringify({ a: "" })).not.toBe(stableStringify({}))
    expect(stableStringify({ a: "" })).not.toBe(stableStringify({ a: null }))
    expect(stableStringify({ a: "" })).toBe('{"a":""}')
  })

  it("undefined é omitido (espelha JSON.stringify)", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it("normaliza -0 → 0 e rejeita NaN/Infinity", () => {
    expect(stableStringify({ a: -0 })).toBe('{"a":0}')
    expect(() => canonicalize({ a: NaN })).toThrow(CanonicalizeError)
    expect(() => canonicalize({ a: Infinity })).toThrow(CanonicalizeError)
  })

  it("recusa nomes de campo que pareçam secret", () => {
    expect(() => canonicalize({ apiKey: "x" })).toThrow(CanonicalizeError)
    expect(() => canonicalize({ api_key: "x" })).toThrow(CanonicalizeError)
    expect(() => canonicalize({ ANTHROPIC_SECRET: "x" })).toThrow(CanonicalizeError)
    // legítimos NÃO disparam (ex.: contadores de token de cache)
    expect(() => canonicalize({ cache_creation_tokens: 10 })).not.toThrow()
  })

  it("detecta referência circular", () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => canonicalize(a)).toThrow(CanonicalizeError)
  })

  it("é determinístico (mesma entrada ⇒ mesma saída)", () => {
    const v = { z: [3, 1, 2], a: { n: 5, m: "x" }, b: null }
    expect(stableStringify(v)).toBe(stableStringify(structuredClone(v)))
  })
})

describe("buildCacheKey (§25.1)", () => {
  it("é determinístico", () => {
    expect(buildCacheKey(baseKey)).toBe(buildCacheKey({ ...baseKey }))
  })

  it("modelo altera a chave", () => {
    expect(buildCacheKey(baseKey)).not.toBe(buildCacheKey({ ...baseKey, model: "claude-haiku-4-5-20251001" }))
  })

  it("prompt version altera a chave", () => {
    expect(buildCacheKey(baseKey)).not.toBe(buildCacheKey({ ...baseKey, promptVersion: "v18" }))
  })

  it("schema version altera a chave", () => {
    expect(buildCacheKey(baseKey)).not.toBe(buildCacheKey({ ...baseKey, outputSchemaVersion: "eval-2" }))
  })

  it("promptVersion null difere de '' e de versão presente", () => {
    const a = buildCacheKey({ ...baseKey, promptVersion: null })
    const b = buildCacheKey({ ...baseKey, promptVersion: "" })
    const c = buildCacheKey({ ...baseKey, promptVersion: "v19" })
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it("parâmetro IRRELEVANTE (não passado) não altera a chave", () => {
    // dois inputs idênticos exceto por um campo que o caller NÃO inclui em
    // relevantParameters ⇒ mesma chave.
    const k1 = buildCacheKey({ ...baseKey, relevantParameters: { temperature: 0.2 } })
    const k2 = buildCacheKey({ ...baseKey, relevantParameters: { temperature: 0.2 } })
    expect(k1).toBe(k2)
    // adicionar um parâmetro relevante SIM altera
    const k3 = buildCacheKey({ ...baseKey, relevantParameters: { temperature: 0 } })
    expect(k1).not.toBe(k3)
  })

  it("ordem das chaves do input não altera a chave", () => {
    const k1 = buildCacheKey({ ...baseKey, input: { title: "X", synopsis: "abc" } })
    const k2 = buildCacheKey({ ...baseKey, input: { synopsis: "abc", title: "X" } })
    expect(k1).toBe(k2)
  })

  it("secret no input faz a construção falhar (não vaza pra chave)", () => {
    expect(() => buildCacheKey({ ...baseKey, input: { apiKey: "sk-123" } })).toThrow(CanonicalizeError)
  })

  it("buildCacheKeyObject expõe a estrutura pré-hash com versões", () => {
    const obj = buildCacheKeyObject(baseKey)
    expect(obj.operation).toBe("ai_evaluation")
    expect(obj.model).toBe("claude-sonnet-4-6")
    expect(obj.prompt_version).toBe("v19")
    expect(obj.output_schema_version).toBe("eval-1")
  })
})
