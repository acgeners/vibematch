import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * O laço REAL de `requestAiEvaluation`, com o provider e o banco simulados:
 *
 * - resposta com menos de 11 critérios é recusada SEM 2ª chamada (decisão de 2026-10-23: a repetição
 *   seria uma chamada paga automática para completar critérios), e o que veio fica no diagnóstico;
 * - a recusa não vira cache: pedir de novo vai ao provider;
 * - o cache L2 (avaliação gravada) não remonta como completa uma linha sem os 11 — antes ela voltava
 *   com nota 5 e "Não avaliado." no que faltasse.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({
  createLoggedMessage: vi.fn(),
  anotar: vi.fn(async () => {}),
  /** O que a busca do cache L2 devolve; `null` = sem linha. */
  linhaDoCache: null as Record<string, unknown> | null,
}))

vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {}, exigirVersaoCanonica: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  anotarPayloadRecusado: spies.anotar,
  getAnthropicClient: () => ({}),
}))
vi.mock("@/server/queries/ai-cache", () => ({ recordCacheEventAsync: vi.fn(), readAiCache: vi.fn(async () => null), writeAiCache: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q: Record<string, unknown> = {}
    for (const m of ["from", "select", "eq", "order", "limit"]) q[m] = () => q
    q.maybeSingle = async () => ({ data: spies.linhaDoCache, error: null })
    return q
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
}))

import { requestAiEvaluation } from "@/lib/ai-evaluation/service"
import type { PayloadRecusado } from "@/lib/ai/tool-payload"
import { JUSTIFICATIVA_DE_PREENCHIMENTO } from "@/lib/ai-evaluation/criteria-completeness"
import { CRITERION_SLUGS } from "@/types/domain"

const registro = (criterion: string, i = 0) => ({ criterion, score: 3 + (i % 6), justification: `Faixa 4-6: sintético de ${criterion}.` })
const onze = () => CRITERION_SLUGS.map((c, i) => registro(c, i))
const valido = () => ({ summary: "Resumo válido.", confidence: 0.8, scores: onze() })
/** A forma de Charming (24/10): 1 dos 11, com resumo e confiança. Conteúdo sintético. */
const charming = () => ({ summary: "Resumo enviado.", confidence: 0.6, scores: [registro("romance", 4)] })

const resposta = (input: unknown, apiCallId = "call-x") => ({
  apiCallId,
  message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input }] },
})

let n = 0
const pedido = () =>
  ({
    workId: `00000000-0000-0000-0004-${String(++n).padStart(12, "0")}`,
    title: `Obra de teste ${n}`,
    synopsis: `Sinopse ${n}.`,
    genres: [],
    tags: [],
    sourcedReviews: [],
    platformRatings: [],
    externalContext: ["Contexto externo de teste."],
  }) as unknown as Parameters<typeof requestAiEvaluation>[0]

const anotacao = (i: number) => spies.anotar.mock.calls[i] as unknown as [string | null, PayloadRecusado]

beforeEach(() => {
  spies.createLoggedMessage.mockReset()
  spies.anotar.mockReset()
  spies.anotar.mockImplementation(async () => {})
  spies.linhaDoCache = null
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("3. resposta incompleta: recusada, sem repetição, com o recebido no diagnóstico", () => {
  it("1 de 11: uma chamada só, erro dizendo o que faltou, nada salvo", async () => {
    spies.createLoggedMessage.mockResolvedValue(resposta(charming(), "call-C"))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow(
      /Resposta da IA incompleta: veio 1 de 11 critérios válidos; ausentes: .* Nenhuma avaliação foi salva\./,
    )
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
  })

  it("o diagnóstico guarda o ORIGINAL e a conferência dos critérios", async () => {
    const original = charming()
    spies.createLoggedMessage.mockResolvedValue(resposta(original, "call-C"))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow()
    expect(spies.anotar).toHaveBeenCalledTimes(1)
    const [id, d] = anotacao(0)
    expect(id).toBe("call-C")
    expect(d.classe).toBe("incompleta")
    expect(JSON.parse(d.bruto)).toEqual(original)
    expect(d.parcial!.criterios).toMatchObject({ completa: false, recebidos: ["romance"], duplicados: [], desconhecidos: [], invalidos: [] })
    expect(d.parcial!.criterios.ausentes).toEqual(CRITERION_SLUGS.filter((c) => c !== "romance"))
    expect(d.bruto).not.toContain(JUSTIFICATIVA_DE_PREENCHIMENTO)
  })

  it("10 de 11: mesma proteção", async () => {
    spies.createLoggedMessage.mockResolvedValue(resposta({ ...valido(), scores: onze().slice(0, 10) }))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow(/incompleta: veio 10 de 11/)
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
  })

  it("a recusa não vira cache: o mesmo pedido de novo vai ao provider", async () => {
    const req = pedido()
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(charming())).mockResolvedValueOnce(resposta(valido()))
    await expect(requestAiEvaluation(req)).rejects.toThrow(/incompleta/)
    const r = await requestAiEvaluation(req)
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(r.scores).toHaveLength(CRITERION_SLUGS.length)
  })

  it("incompleta na 2ª tentativa (depois de uma recusa de schema): para ali, com a causa da incompletude", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta({ summary: "s", scores: onze() })) // sem confidence: schema
      .mockResolvedValueOnce(resposta(charming()))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow(/incompleta/)
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(anotacao(0)[1].classe).toBe("schema")
    expect(anotacao(1)[1].classe).toBe("incompleta")
  })

  it("não regressão: recusa de SCHEMA continua pagando a repetição de sempre", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta({ summary: "s", scores: onze() }))
      .mockResolvedValueOnce(resposta(valido()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(r.confidence).toBe(0.8)
  })

  it("resposta completa: uma chamada, sem diagnóstico", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(valido()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(spies.anotar).not.toHaveBeenCalled()
    expect(r.scores.map((s) => s.justification)).not.toContain(JUSTIFICATIVA_DE_PREENCHIMENTO)
  })
})

describe("2/8. o cache L2 não remonta uma avaliação incompleta como completa", () => {
  const linha = (rows: Array<Record<string, unknown>>) => ({
    model_name: "claude-sonnet-5",
    prompt_version: "v32",
    summary: "Resumo gravado.",
    confidence: "0.7",
    raw_response: {},
    ai_evaluation_scores: rows,
  })
  // `numeric` do PostgREST chega como string.
  const linhasDe = (regs: Array<{ criterion: string; score: number; justification: string }>) =>
    regs.map((r) => ({ criterion_slug: r.criterion, suggested_score: String(r.score), justification: r.justification }))

  it("linha com os 11 válidos: cache hit, sem provider", async () => {
    spies.linhaDoCache = linha(linhasDe(onze()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).not.toHaveBeenCalled()
    expect(r.fromCache).toBe("db")
    expect(r.scores.map((s) => [s.criterionSlug, s.suggestedScore])).toEqual(onze().map((s) => [s.criterion, s.score]))
  })

  it.each([
    ["só 10 critérios", () => linhasDe(onze().slice(0, 10))],
    ["o preenchimento antigo (5 + 'Não avaliado.')", () => linhasDe(onze().map((s, i) => (i === 2 ? { ...s, score: 5, justification: JUSTIFICATIVA_DE_PREENCHIMENTO } : s)))],
    ["nota nula", () => linhasDe(onze()).map((r, i) => (i === 0 ? { ...r, suggested_score: null } : r))],
    ["critério repetido", () => [...linhasDe(onze().slice(0, 10)), { ...linhasDe(onze())[0] }]],
  ])("%s: o cache é ignorado e o pedido vai ao provider", async (_nome, rows) => {
    spies.linhaDoCache = linha(rows())
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(valido()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.fromCache).toBeUndefined()
    expect(r.scores.map((s) => s.justification)).not.toContain(JUSTIFICATIVA_DE_PREENCHIMENTO)
  })
})
