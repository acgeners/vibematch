import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A resposta INCOMPLETA preserva o que trouxe num bloco estruturado (`payload_recusado.parcial`), separado
 * do `bruto` de diagnóstico, que segue cortado em 16 mil code points. Medido na verificação de 24/10: sem o
 * bloco, uma resposta de 17.870 code points ficava com só 8 dos 10 textos recebidos inteiros.
 *
 * Duas metades: o laço de produção (o que chega à anotação) e a gravação real de `anotarPayloadRecusado`
 * com o banco simulado (sanitização para o Postgres e preservação da metadata que já existe).
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({
  createLoggedMessage: vi.fn(),
  anotar: vi.fn(async () => {}),
  /** O `update` que a gravação real mandaria ao banco. */
  gravado: null as Record<string, unknown> | null,
}))

vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {}, exigirVersaoCanonica: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/anthropic-client")>()
  return { ...real, createLoggedMessage: spies.createLoggedMessage, anotarPayloadRecusado: spies.anotar, getAnthropicClient: () => ({}) }
})
vi.mock("@/server/queries/ai-cache", () => ({ recordCacheEventAsync: vi.fn(), readAiCache: vi.fn(async () => null), writeAiCache: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q: Record<string, unknown> = {}
    q.from = () => q
    q.select = () => q
    q.eq = () => q
    q.single = async () => ({ data: { metadata: { attempt: 0, logical_request_id: "lr-1" } }, error: null })
    q.update = (body: Record<string, unknown>) => {
      spies.gravado = body
      return { eq: async () => ({ error: null }) }
    }
    q.maybeSingle = async () => ({ data: null, error: null })
    return q
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
}))

import { parcialParaDiagnostico, requestAiEvaluation } from "@/lib/ai-evaluation/service"
import type { ParcialDaResposta } from "@/lib/ai-evaluation/service"
import { conferirCriterios, JUSTIFICATIVA_DE_PREENCHIMENTO } from "@/lib/ai-evaluation/criteria-completeness"
import { PAYLOAD_RECUSADO_MAX_CODE_POINTS } from "@/lib/ai/tool-payload"
import type { PayloadRecusado } from "@/lib/ai/tool-payload"
import { CRITERION_SLUGS } from "@/types/domain"

const REVIEWS = [
  "The art is absolutely gorgeous, every panel looks like a painting.",
  "Beautiful art and the colors are stunning throughout the story.",
  "Gorgeous artwork, the character designs are lovely and detailed.",
  "Plot drags in the middle but the romance is sweet.",
]
const ARTE_VALIDA = {
  judging_reviews: [
    { review_id: "R1", stance: "positive" },
    { review_id: "R2", stance: "positive" },
    { review_id: "R3", stance: "positive" },
  ],
  quality_signal: "ABOVE_AVERAGE",
  quality_evidence: [{ review_id: "R1", excerpt: "every panel looks like a painting" }],
  change_signal: "NO_CLEAR_SIGNAL",
  change_direction: null,
  change_evidence: [],
  justification: "Elogio consistente.",
}

let n = 0
const pedido = (comReviews = false) =>
  ({
    workId: `00000000-0000-0000-0005-${String(++n).padStart(12, "0")}`,
    title: `Obra ${n}`,
    synopsis: `Sinopse ${n}.`,
    genres: [],
    tags: [],
    sourcedReviews: comReviews ? REVIEWS.map((text) => ({ source: "mangaupdates", sourceTitle: `Obra ${n}`, matchScore: 0.95, text })) : [],
    platformRatings: [],
    externalContext: ["Contexto externo de teste."],
  }) as unknown as Parameters<typeof requestAiEvaluation>[0]

const resposta = (input: unknown) => ({
  apiCallId: "call-p",
  message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input }] },
})
/** 10 dos 11, cada justificativa com `tam` caracteres e marcas de início e fim. Conteúdo sintético. */
const dez = (tam: number) => ({
  summary: "Resumo enviado.",
  confidence: 0.6,
  scores: CRITERION_SLUGS.slice(0, 10).map((c, i) => ({
    criterion: c,
    score: 5 + (i % 4) + 0.5,
    justification: `[ini-${c}] ${"texto ".repeat(Math.floor(tam / 6))}[fim-${c}]`,
  })),
})

const anotado = () => (spies.anotar.mock.calls.at(-1) as unknown as [string | null, PayloadRecusado])[1]
async function recusar(input: unknown, comReviews = false) {
  spies.createLoggedMessage.mockReset()
  spies.createLoggedMessage.mockResolvedValue(resposta(input))
  await expect(requestAiEvaluation(pedido(comReviews))).rejects.toThrow(/Resposta da IA incompleta/)
  expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1) // sem 2ª chamada paga
  return anotado()
}

beforeEach(() => {
  spies.createLoggedMessage.mockReset()
  spies.anotar.mockReset()
  spies.anotar.mockImplementation(async () => {})
  spies.gravado = null
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("o parcial estruturado, separado do diagnóstico abreviado", () => {
  it("resposta parcial pequena: preservação exata, e o bruto também inteiro", async () => {
    const original = dez(400)
    const d = await recusar(original)
    expect(d.truncado).toBe(false)
    expect(JSON.parse(d.bruto)).toEqual(original)
    expect(d.parcial).toEqual({
      versao: 1,
      criterios: conferirCriterios(original.scores, CRITERION_SLUGS),
      scores: original.scores,
      summary: original.summary,
      confidence: original.confidence,
      alterado_pela_sanitizacao: false,
    })
    expect(d.parcial!.criterios.ausentes).toEqual([CRITERION_SLUGS[10]])
  })

  it("acima de 16 mil: o bruto é cortado, e os 10 recebidos seguem inteiros no parcial", async () => {
    const original = dez(1700)
    const d = await recusar(original)
    expect(d.truncado).toBe(true)
    expect(d.tamanho).toBeGreaterThan(PAYLOAD_RECUSADO_MAX_CODE_POINTS)
    expect(() => JSON.parse(d.bruto)).toThrow()
    expect(original.scores.filter((s) => d.bruto.includes(s.justification)).length).toBeLessThan(10)
    // O que importa: nada se perdeu no bloco estruturado, que não passa pelo corte.
    expect(d.parcial!.scores).toEqual(original.scores)
    expect(JSON.stringify(d.parcial).length).toBeGreaterThan(PAYLOAD_RECUSADO_MAX_CODE_POINTS)
    expect(d.parcial!.summary).toBe(original.summary)
    expect(d.parcial!.confidence).toBe(original.confidence)
  })

  it("nada é inventado: sem 'Não avaliado.', sem o critério ausente, sem nota fora do que veio", async () => {
    const d = await recusar({ summary: "s", confidence: 0.5, scores: [{ criterion: "romance", score: 8, justification: "Faixa 7-8: core." }] })
    expect(d.parcial!.scores).toEqual([{ criterion: "romance", score: 8, justification: "Faixa 7-8: core." }])
    expect(JSON.stringify(d.parcial)).not.toContain(JUSTIFICATIVA_DE_PREENCHIMENTO)
    expect(d.parcial!.criterios.ausentes).toHaveLength(CRITERION_SLUGS.length - 1)
  })

  it("Arte válida entra no parcial; inválida fica só no bruto", async () => {
    const comArte = await recusar({ ...dez(100), art: ARTE_VALIDA }, true)
    expect(comArte.parcial!.art).toMatchObject({ status: expect.stringMatching(/^(rated|abstained)$/) })
    const semArte = await recusar({ ...dez(100), art: { quality_signal: 9 } }, true)
    expect(semArte.parcial).not.toHaveProperty("art")
    expect(semArte.bruto).toContain("quality_signal")
  })

  it("resposta completa válida: comportamento inalterado (aceita, uma chamada, sem anotação)", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta({ ...dez(100), scores: [...dez(100).scores, { criterion: CRITERION_SLUGS[10], score: 6, justification: "Faixa 4-6: ok." }] }))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(spies.anotar).not.toHaveBeenCalled()
    expect(r.scores).toHaveLength(CRITERION_SLUGS.length)
  })
})

describe("a gravação: sanitização para o Postgres, sem tocar na nuvem", () => {
  const SURROGATE_SOLTO = "\uD83D"
  const parcialCom = (texto: string): ParcialDaResposta => {
    const scores = [{ criterion: "romance", score: 7, justification: texto }]
    return { criterios: conferirCriterios(scores, CRITERION_SLUGS), scores, summary: "Resumo 💜.", confidence: 0.6 }
  }

  it("parcialParaDiagnostico marca quando a sanitização vai mudar algum texto", () => {
    expect(parcialParaDiagnostico(parcialCom("texto limpo 💜")).alterado_pela_sanitizacao).toBe(false)
    expect(parcialParaDiagnostico(parcialCom(`quebrado ${SURROGATE_SOLTO} aqui`)).alterado_pela_sanitizacao).toBe(true)
    expect(parcialParaDiagnostico(parcialCom("com NUL \u0000 aqui")).alterado_pela_sanitizacao).toBe(true)
  })

  it("anotarPayloadRecusado (real) grava o parcial sanitizado, sem corte, preservando a metadata existente", async () => {
    const { anotarPayloadRecusado } = await vi.importActual<typeof import("@/lib/ai/anthropic-client")>("@/lib/ai/anthropic-client")
    const longo = `${"x".repeat(20_000)} 💜 ${SURROGATE_SOLTO} fim`
    const detalhe = { classe: "incompleta", bruto: "…", parcial: parcialParaDiagnostico(parcialCom(longo)) }
    await anotarPayloadRecusado("call-p", detalhe)

    const meta = spies.gravado!.metadata as Record<string, unknown>
    expect(meta).toMatchObject({ attempt: 0, logical_request_id: "lr-1" })
    const p = (meta.payload_recusado as PayloadRecusado).parcial!
    const texto = p.scores[0].justification
    expect(texto).toBe(`${"x".repeat(20_000)} 💜  fim`) // só o surrogate solto sai; o emoji inteiro fica
    expect(texto.length).toBeGreaterThan(PAYLOAD_RECUSADO_MAX_CODE_POINTS)
    expect(p.alterado_pela_sanitizacao).toBe(true)
    expect(() => JSON.parse(JSON.stringify(meta))).not.toThrow()
  })
})
