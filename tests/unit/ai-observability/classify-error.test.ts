import { describe, it, expect } from "vitest"
import { classifyAiError, parseLeadingHttpStatus } from "@/lib/ai-observability/classify-error"

describe("parseLeadingHttpStatus", () => {
  it("extrai o status do início da mensagem do SDK", () => {
    expect(parseLeadingHttpStatus('400 {"type":"error"}')).toBe(400)
    expect(parseLeadingHttpStatus("429 too many requests")).toBe(429)
  })
  it("não captura números do corpo (só o início)", () => {
    expect(parseLeadingHttpStatus('erro com code 500 no meio')).toBeNull()
  })
  it("null/vazio → null", () => {
    expect(parseLeadingHttpStatus(null)).toBeNull()
    expect(parseLeadingHttpStatus("")).toBeNull()
  })
})

describe("classifyAiError", () => {
  it("400 + imagem → provider_image_invalid_request (caso histórico real)", () => {
    expect(
      classifyAiError({
        message:
          '400 {"type":"error","error":{"message":"messages.0.content.0.image.source.url: Unable to download image"}}',
      }),
    ).toBe("provider_image_invalid_request")
  })

  it('400 "Unable to download the file" (mensagem REAL da Anthropic, sem a palavra "image")', () => {
    // Os 160 erros históricos têm exatamente esta mensagem — a palavra "image"
    // NÃO aparece; a evidência é "download" (plano §14).
    expect(
      classifyAiError({
        message:
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"Unable to download the file. Please verify the URL and try again."}}',
      }),
    ).toBe("provider_image_invalid_request")
  })

  it("400 sem menção a imagem → provider_invalid_request (NÃO vira imagem)", () => {
    expect(classifyAiError({ status: 400, message: "invalid request body" })).toBe(
      "provider_invalid_request",
    )
  })

  it("timeout de imagem é classificado por estágio, não como imagem-do-provider", () => {
    // O timeout local de imagem é AiImageStatus, não erro do provider — aqui só
    // garantimos que um timeout puro não vira provider_image_invalid_request.
    expect(classifyAiError({ message: "image fetch timed out" })).toBe("provider_timeout")
  })

  it("429 / rate limit", () => {
    expect(classifyAiError({ status: 429 })).toBe("provider_rate_limit")
    expect(classifyAiError({ message: "429 rate limit exceeded" })).toBe("provider_rate_limit")
  })

  it("529 overloaded", () => {
    expect(classifyAiError({ status: 529 })).toBe("provider_overloaded")
    expect(classifyAiError({ message: "529 Overloaded" })).toBe("provider_overloaded")
  })

  it("5xx genérico", () => {
    expect(classifyAiError({ status: 503, message: "service unavailable" })).toBe("provider_5xx")
  })

  it("timeout geral", () => {
    expect(classifyAiError({ message: "Request timed out" })).toBe("provider_timeout")
  })

  it("erro de rede", () => {
    expect(classifyAiError({ message: "fetch failed: ECONNRESET" })).toBe("provider_network")
  })

  it("structured output inválido por max_tokens", () => {
    expect(classifyAiError({ stopReason: "max_tokens", message: "" })).toBe(
      "structured_output_invalid",
    )
  })

  it("estágio structured_output + texto de schema → schema_validation_failed", () => {
    expect(
      classifyAiError({
        stage: "structured_output",
        message: "Payload da tool não atende ao schema: x",
      }),
    ).toBe("schema_validation_failed")
  })

  it("estágio audit → audit_rejected", () => {
    expect(classifyAiError({ stage: "audit", message: "qualquer" })).toBe("audit_rejected")
  })

  it("cancelado", () => {
    expect(classifyAiError({ message: "The operation was aborted" })).toBe("cancelled")
  })

  it("mensagem vazia → unknown", () => {
    expect(classifyAiError({ message: "" })).toBe("unknown")
    expect(classifyAiError({})).toBe("unknown")
  })

  it("mensagem desconhecida não-vazia → internal_error", () => {
    expect(classifyAiError({ message: "algo estranho aconteceu" })).toBe("internal_error")
  })
})
