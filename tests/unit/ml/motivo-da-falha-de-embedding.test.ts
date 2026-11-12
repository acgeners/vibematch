import { describe, it, expect, afterEach, vi } from "vitest"
import {
  classifyEmbeddingError,
  describeEmbeddingFailure,
  isAccountWideFailure,
  summarizeEmbeddingFailures,
} from "@/lib/ml/embedding-failure"
import { embedTexts, OpenAIEmbeddingsError } from "@/lib/ml/embeddings"

/**
 * O motivo de uma falha de embedding tem que chegar classificado — e os corpos de
 * erro aqui são os MEDIDOS contra a API em 2026-11-11, não os supostos.
 *
 * 🔴 O que se supunha era `code: "insufficient_quota"`. O que a OpenAI devolve para
 * conta sem crédito é `type: "insufficient_quota"` com `code:
 * "credit_balance_exhausted"`. Uma regra escrita pelo formato suposto não pegaria o
 * caso real — e o aviso voltaria a ser genérico justo no caso que o motivou.
 */

const SEM_CREDITO_MEDIDO = {
  message:
    "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
  type: "insufficient_quota",
  param: null,
  code: "credit_balance_exhausted",
}

const CHAVE_INVALIDA_MEDIDA = {
  message: "Incorrect API key provided: sk-chave**************este.",
  type: "invalid_request_error",
  code: "invalid_api_key",
  param: null,
}

const LIMITE_DE_RITMO = {
  message: "Rate limit reached for text-embedding-3-small.",
  type: "requests",
  code: "rate_limit_exceeded",
  param: null,
}

function erroDaOpenAI(status: number, corpo: { message: string; type: string; code: string }) {
  return new OpenAIEmbeddingsError(`OpenAI embeddings falhou (${status}): ${corpo.message}`, {
    status,
    type: corpo.type,
    code: corpo.code,
  })
}

describe("classifica o motivo da falha", () => {
  it("conta sem crédito, no formato MEDIDO (type insufficient_quota, code credit_balance_exhausted)", () => {
    expect(classifyEmbeddingError(erroDaOpenAI(429, SEM_CREDITO_MEDIDO)).kind).toBe("sem_credito")
  })

  it("conta sem crédito, no formato antigo (code insufficient_quota)", () => {
    const antigo = new OpenAIEmbeddingsError("quota", {
      status: 429,
      type: null,
      code: "insufficient_quota",
    })
    expect(classifyEmbeddingError(antigo).kind).toBe("sem_credito")
  })

  it("chave recusada, no formato medido (401 invalid_api_key)", () => {
    expect(classifyEmbeddingError(erroDaOpenAI(401, CHAVE_INVALIDA_MEDIDA)).kind).toBe(
      "chave_recusada",
    )
  })

  it("429 que NÃO é crédito é limite de ritmo", () => {
    expect(classifyEmbeddingError(erroDaOpenAI(429, LIMITE_DE_RITMO)).kind).toBe("limite_de_ritmo")
  })

  it("queda de rede (o TypeError do fetch do Node)", () => {
    expect(classifyEmbeddingError(new TypeError("fetch failed")).kind).toBe("rede")
  })

  it("erro desconhecido devolve o texto original — nunca um genérico", () => {
    const f = classifyEmbeddingError(new Error("Vetor com dimensão inesperada: 3072"))
    expect(f.kind).toBe("desconhecido")
    expect(describeEmbeddingFailure(f)).toBe("Vetor com dimensão inesperada: 3072")
  })

  it("só os motivos da CONTA encerram o lote", () => {
    expect(isAccountWideFailure("sem_credito")).toBe(true)
    expect(isAccountWideFailure("chave_recusada")).toBe(true)
    expect(isAccountWideFailure("chave_ausente")).toBe(true)
    // Ritmo e rede podem passar no próximo lote; parar ali perderia obras à toa.
    expect(isAccountWideFailure("limite_de_ritmo")).toBe(false)
    expect(isAccountWideFailure("rede")).toBe(false)
    expect(isAccountWideFailure("gravacao")).toBe(false)
  })
})

describe("descreve em português", () => {
  it("falta de crédito nomeia a OpenAI e diz que é outra conta que não a da Anthropic", () => {
    // Foi exatamente essa a confusão: o saldo conferido foi o da Anthropic.
    const texto = describeEmbeddingFailure({ kind: "sem_credito", detail: "" })
    expect(texto).toContain("OpenAI")
    expect(texto).toContain("sem crédito")
    expect(texto).toContain("Anthropic")
  })

  it("com vários motivos, cada um diz quantas obras levou", () => {
    const texto = summarizeEmbeddingFailures([
      { kind: "limite_de_ritmo", detail: "x", works: 100 },
      { kind: "gravacao", detail: "timeout", works: 1 },
    ])
    expect(texto).toContain("100 obras: a OpenAI limitou")
    expect(texto).toContain("1 obra: a gravação no banco falhou: timeout")
  })
})

describe("o cliente da OpenAI não repete o que não passa sozinho", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function respostaDeErro(status: number, corpo: object) {
    return vi.fn(async () => new Response(JSON.stringify({ error: corpo }), { status }))
  }

  it("sem crédito: UMA chamada, e o erro sai classificável", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-teste")
    const fetchMock = respostaDeErro(429, SEM_CREDITO_MEDIDO)
    vi.stubGlobal("fetch", fetchMock)

    const erro = await embedTexts(["obra"]).catch((e: unknown) => e)

    expect(fetchMock, "falta de crédito foi tratada como passageira e repetida").toHaveBeenCalledTimes(1)
    expect(classifyEmbeddingError(erro).kind).toBe("sem_credito")
  })

  it("limite de ritmo: continua repetindo (o 429 de ritmo É passageiro)", async () => {
    vi.useFakeTimers()
    vi.stubEnv("OPENAI_API_KEY", "sk-teste")
    const fetchMock = respostaDeErro(429, LIMITE_DE_RITMO)
    vi.stubGlobal("fetch", fetchMock)

    const promessa = embedTexts(["obra"]).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)
    const erro = await promessa

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(classifyEmbeddingError(erro).kind).toBe("limite_de_ritmo")
  })

  it("chave ausente: nem chega a chamar a API", async () => {
    vi.stubEnv("OPENAI_API_KEY", "")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const erro = await embedTexts(["obra"]).catch((e: unknown) => e)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(classifyEmbeddingError(erro).kind).toBe("chave_ausente")
  })
})
