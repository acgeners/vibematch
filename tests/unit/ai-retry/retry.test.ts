import { describe, it, expect } from "vitest"
import { classifyRetry, isRetryableCategory } from "@/lib/ai-retry/classify-retry"
import { computeBackoffMs } from "@/lib/ai-retry/backoff"
import {
  SDK_DEFAULT_POLICY,
  AI_EVALUATION_POLICY,
  IMAGE_FALLBACK_MAX_ATTEMPTS,
  STRUCTURED_REPAIR_MAX_ATTEMPTS,
} from "@/lib/ai-retry/policies"
import { isImageProviderError } from "@/lib/ai-observability/classify-error"

describe("classifyRetry — retryable (§25.5)", () => {
  it("429 / 529 / 5xx / timeout / rede são retryable", () => {
    expect(classifyRetry({ status: 429 }).retryable).toBe(true)
    expect(classifyRetry({ status: 529 }).retryable).toBe(true)
    expect(classifyRetry({ status: 500 }).retryable).toBe(true)
    expect(classifyRetry({ status: 503 }).retryable).toBe(true)
    expect(classifyRetry({ message: "request timed out" }).retryable).toBe(true)
    expect(classifyRetry({ message: "ECONNRESET" }).retryable).toBe(true)
  })

  it("400 / credencial / parâmetro inválido NÃO são retryable", () => {
    expect(classifyRetry({ status: 400, message: "invalid tool input" }).retryable).toBe(false)
    expect(classifyRetry({ status: 401, message: "invalid api key" }).retryable).toBe(false)
    expect(classifyRetry({ status: 400, message: "model does not exist" }).retryable).toBe(false)
  })

  it("imagem / schema / auditoria / cancelado NÃO viram retry de rede", () => {
    expect(classifyRetry({ status: 400, message: "Unable to download the file" }).retryable).toBe(false)
    expect(classifyRetry({ stage: "structured_output", message: "zod" }).retryable).toBe(false)
    expect(classifyRetry({ stage: "audit", message: "review_usage" }).retryable).toBe(false)
    expect(classifyRetry({ message: "aborted by user" }).retryable).toBe(false)
  })

  it("a categoria volta junto com a decisão", () => {
    expect(classifyRetry({ status: 429 }).reason).toBe("provider_rate_limit")
    expect(isRetryableCategory("provider_5xx")).toBe(true)
    expect(isRetryableCategory("schema_validation_failed")).toBe(false)
  })
})

describe("computeBackoffMs (§25.5)", () => {
  const policy = { ...SDK_DEFAULT_POLICY, baseDelayMs: 100, maxDelayMs: 10_000, jitterRatio: 0.2 }
  const mid = () => 0.5 // jitter centrado → delay base

  it("cresce exponencialmente com a tentativa", () => {
    expect(computeBackoffMs(0, policy, { random: mid })).toBe(100)
    expect(computeBackoffMs(1, policy, { random: mid })).toBe(200)
    expect(computeBackoffMs(2, policy, { random: mid })).toBe(400)
    expect(computeBackoffMs(3, policy, { random: mid })).toBe(800)
  })

  it("jitter fica dentro de ±jitterRatio", () => {
    expect(computeBackoffMs(2, policy, { random: () => 0 })).toBe(320) // 400*0.8
    expect(computeBackoffMs(2, policy, { random: () => 1 })).toBe(480) // 400*1.2
  })

  it("respeita maxDelayMs (cap)", () => {
    expect(computeBackoffMs(20, policy, { random: mid })).toBe(10_000)
  })

  it("honra Retry-After quando habilitado (capado por maxDelay)", () => {
    expect(computeBackoffMs(0, policy, { random: mid, retryAfterMs: 3_000 })).toBe(3_000)
    expect(computeBackoffMs(0, policy, { random: mid, retryAfterMs: 99_000 })).toBe(10_000)
  })

  it("ignora Retry-After quando a política não honra", () => {
    const noHonor = { ...policy, honorRetryAfter: false }
    expect(computeBackoffMs(0, noHonor, { random: mid, retryAfterMs: 3_000 })).toBe(100)
  })
})

describe("políticas (§25.5 — budget / max attempts / fallbacks)", () => {
  it("documenta as tentativas totais (maxRetries + 1)", () => {
    expect(SDK_DEFAULT_POLICY.maxAttempts).toBe(7) // 6 + 1
    expect(AI_EVALUATION_POLICY.maxAttempts).toBe(9) // 8 + 1
  })

  it("fallback de imagem é UMA tentativa; reparo estrutural ≤ 2", () => {
    expect(IMAGE_FALLBACK_MAX_ATTEMPTS).toBe(1)
    expect(STRUCTURED_REPAIR_MAX_ATTEMPTS).toBe(2)
  })
})

describe("isImageProviderError — alinhamento funcional×observabilidade (§16/§25.5)", () => {
  it("'Unable to download the file' (mensagem REAL) → imagem", () => {
    expect(isImageProviderError({ status: 400, message: "Unable to download the file" })).toBe(true)
    expect(isImageProviderError({ status: null, message: "Unable to download the file. Verify URL." })).toBe(true)
  })

  it("evidência de media_type / base64 / image → imagem", () => {
    expect(isImageProviderError({ status: 400, message: "invalid base64 data" })).toBe(true)
    expect(isImageProviderError({ status: 400, message: "bad media_type" })).toBe(true)
  })

  it("400 genérico NÃO aciona fallback de imagem", () => {
    expect(isImageProviderError({ status: 400, message: "invalid tool input" })).toBe(false)
    expect(isImageProviderError({ status: 429, message: "rate limit" })).toBe(false)
  })
})
