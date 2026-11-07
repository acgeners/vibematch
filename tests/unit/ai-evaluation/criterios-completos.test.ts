import { describe, expect, it, vi } from "vitest"

/**
 * A resposta da IA só é avaliação quando traz os 11 critérios — cada um uma vez, nenhum desconhecido,
 * nota e justificativa válidas. Até 2026-10-23 a montagem completava o que faltava com nota 5 e
 * "Não avaliado." em silêncio. Observado no piloto v32 × v3.1 (24/10): o modelo mandou 1 dos 11.
 *
 * Os payloads aqui são SINTÉTICOS (a forma dos incidentes, nunca o conteúdo lacrado do piloto).
 */

vi.mock("server-only", () => ({}))
vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {}, exigirVersaoCanonica: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: vi.fn(),
  anotarPayloadRecusado: vi.fn(async () => {}),
  getAnthropicClient: () => ({}),
}))
vi.mock("@/server/queries/ai-cache", () => ({ recordCacheEventAsync: vi.fn(), readAiCache: vi.fn(async () => null), writeAiCache: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("sem banco no teste")
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
}))

import {
  conferirCriterios,
  descreverConferencia,
  JUSTIFICATIVA_DE_PREENCHIMENTO,
} from "@/lib/ai-evaluation/criteria-completeness"
import { interpretarRespostaDaTool, prepareReviews, PRODUCTION_VARIANT, VARIANTE_V30, requestAiEvaluation } from "@/lib/ai-evaluation/service"
import type { InterpretacaoDaTool } from "@/lib/ai-evaluation/service"
import { CRITERION_SLUGS } from "@/types/domain"

type Req = Parameters<typeof requestAiEvaluation>[0]
type Registro = { criterion: string; score: number; justification: string }

const REVIEWS = [
  "The art is absolutely gorgeous, every panel looks like a painting.",
  "Beautiful art and the colors are stunning throughout the story.",
  "Gorgeous artwork, the character designs are lovely and detailed.",
  "Plot drags in the middle but the romance is sweet.",
]

let n = 0
const pedido = (extra: Record<string, unknown> = {}): Req =>
  ({
    workId: `00000000-0000-0000-0002-${String(++n).padStart(12, "0")}`,
    title: `Obra ${n}`,
    synopsis: `Sinopse ${n}.`,
    genres: [],
    tags: [],
    sourcedReviews: REVIEWS.map((text) => ({ source: "mangaupdates", sourceTitle: `Obra ${n}`, matchScore: 0.95, text })),
    platformRatings: [],
    externalContext: ["Contexto externo de teste."],
    ...extra,
  }) as unknown as Req

const registro = (criterion: string, i = 0): Registro => ({
  criterion,
  score: 3 + (i % 6),
  justification: `Faixa 4-6: justificativa sintética de ${criterion}.`,
})
const onze = (): Registro[] => CRITERION_SLUGS.map((c, i) => registro(c, i))
const payload = (scores: unknown, extra: Record<string, unknown> = {}) => ({
  summary: "Resumo sintético da obra.",
  confidence: 0.7,
  scores,
  ...extra,
})

const interpretar = (p: unknown, variant = VARIANTE_V30, req = pedido()) =>
  interpretarRespostaDaTool(p, req, prepareReviews(req), "claude-sonnet-5", "hash-x", variant)

const recusada = (r: InterpretacaoDaTool) => {
  if (r.tipo !== "recusada") throw new Error("esperava recusada, veio aceita")
  return r
}
const aceita = (r: InterpretacaoDaTool) => {
  if (r.tipo !== "aceita") throw new Error(`esperava aceita, veio recusada (${r.classe}): ${String(r.erro)}`)
  return r.resposta
}

const ROMANCE = "romance"
const semRomance = CRITERION_SLUGS.filter((c) => c !== ROMANCE)

describe("conferirCriterios — a régua única", () => {
  it("os 11, cada um uma vez, válidos: completa", () => {
    const c = conferirCriterios(onze(), CRITERION_SLUGS)
    expect(c).toEqual({ completa: true, recebidos: [...CRITERION_SLUGS], ausentes: [], duplicados: [], desconhecidos: [], invalidos: [] })
  })

  it("1 de 11 (a forma de Charming): incompleta, com o recebido e os 10 ausentes", () => {
    const c = conferirCriterios([registro(ROMANCE)], CRITERION_SLUGS)
    expect(c.completa).toBe(false)
    expect(c.recebidos).toEqual([ROMANCE])
    expect(c.ausentes).toEqual(semRomance)
  })

  it("10 de 11: incompleta", () => {
    const c = conferirCriterios(onze().slice(0, 10), CRITERION_SLUGS)
    expect(c.completa).toBe(false)
    expect(c.ausentes).toEqual([CRITERION_SLUGS[10]])
    expect(c.recebidos).toHaveLength(10)
  })

  it("critério repetido: nenhuma das cópias conta como recebida", () => {
    const scores = [...onze().slice(0, 10), registro(CRITERION_SLUGS[0], 4)]
    const c = conferirCriterios(scores, CRITERION_SLUGS)
    expect(c.completa).toBe(false)
    expect(c.duplicados).toEqual([CRITERION_SLUGS[0]])
    expect(c.recebidos).not.toContain(CRITERION_SLUGS[0])
    expect(c.ausentes).toEqual([CRITERION_SLUGS[10]])
  })

  it("critério desconhecido (o legado fantasy_nobility no lugar de fantasy): incompleta", () => {
    const scores = onze().map((s) => (s.criterion === "fantasy" ? { ...s, criterion: "fantasy_nobility" } : s))
    const c = conferirCriterios(scores, CRITERION_SLUGS)
    expect(c.completa).toBe(false)
    expect(c.desconhecidos).toEqual(["fantasy_nobility"])
    expect(c.ausentes).toEqual(["fantasy"])
  })

  it("os 11 e um critério a mais: não completa", () => {
    const c = conferirCriterios([...onze(), registro("inventado")], CRITERION_SLUGS)
    expect(c.completa).toBe(false)
    expect(c.desconhecidos).toEqual(["inventado"])
    expect(c.recebidos).toHaveLength(11)
  })

  it.each([
    ["justificativa vazia", { justification: "" }],
    ["justificativa só com espaço", { justification: "   " }],
    ["o texto de preenchimento antigo", { justification: JUSTIFICATIVA_DE_PREENCHIMENTO }],
    ["nota ausente", { score: null }],
    ["nota como texto", { score: "7" }],
    ["nota fora de 0–10", { score: 11 }],
    ["nota NaN", { score: Number.NaN }],
  ])("%s: o critério é inválido", (_nome, troca) => {
    const scores = onze().map((s, i) => (i === 3 ? { ...s, ...troca } : s))
    const c = conferirCriterios(scores, CRITERION_SLUGS)
    expect(c.completa).toBe(false)
    expect(c.invalidos).toEqual([CRITERION_SLUGS[3]])
  })

  it("registro sem critério, e scores que nem é lista", () => {
    expect(conferirCriterios([...onze(), { score: 5 }], CRITERION_SLUGS).desconhecidos).toEqual(["(registro sem critério)"])
    const texto = conferirCriterios("[]", CRITERION_SLUGS)
    expect(texto.completa).toBe(false)
    expect(texto.ausentes).toEqual([...CRITERION_SLUGS])
  })

  it("a descrição cita só os grupos que existem", () => {
    const c = conferirCriterios([registro(ROMANCE)], CRITERION_SLUGS)
    const d = descreverConferencia(c, CRITERION_SLUGS.length)
    expect(d).toMatch(/^veio 1 de 11 critérios válidos; ausentes: /)
    expect(d).not.toMatch(/repetidos|desconhecidos|inválida/)
  })
})

describe("interpretarRespostaDaTool — a resposta incompleta não vira avaliação", () => {
  it("1. resposta completa e válida passa SEM alteração", () => {
    const p = payload(onze())
    const antes = structuredClone(p)
    const r = interpretar(p)
    const resp = aceita(r)
    expect(r.recuperacao).toBeNull()
    expect(resp.scores.map((s) => [s.criterionSlug, s.suggestedScore, s.justification])).toEqual(
      onze().map((s) => [s.criterion, s.score, s.justification]),
    )
    expect(resp.summary).toBe(p.summary)
    expect(p).toEqual(antes)
  })

  it("3. 1 de 11 (Charming): recusada como incompleta, preservando o recebido, sem 'Não avaliado.'", () => {
    const enviado = registro(ROMANCE, 4)
    const r = recusada(interpretar(payload([enviado], { summary: "Resumo enviado.", confidence: 0.62 })))
    expect(r.classe).toBe("incompleta")
    expect(String(r.erro)).toMatch(/incompleta: veio 1 de 11 critérios válidos; ausentes: /)
    expect(r.parcial!.scores).toEqual([enviado])
    expect(r.parcial!.criterios.ausentes).toEqual(semRomance)
    expect(r.parcial!.summary).toBe("Resumo enviado.")
    expect(r.parcial!.confidence).toBe(0.62)
    expect(JSON.stringify(r)).not.toContain(JUSTIFICATIVA_DE_PREENCHIMENTO)
  })

  it("4. 10 de 11: mesma proteção", () => {
    const r = recusada(interpretar(payload(onze().slice(0, 10))))
    expect(r.classe).toBe("incompleta")
    expect(r.parcial!.scores).toHaveLength(10)
    expect(r.parcial!.criterios.ausentes).toEqual([CRITERION_SLUGS[10]])
  })

  it("o parcial guarda a nota COMO VEIO (nada de clamp nem pós-processamento)", () => {
    const adulto = { criterion: "adult_content", score: 1, justification: "Faixa 0-3: sem conteúdo adulto." }
    const req = pedido({ contentRatings: ["erotica"] })
    const r = recusada(interpretar(payload([adulto]), VARIANTE_V30, req))
    expect(r.parcial!.scores).toEqual([adulto])
  })

  it("5a. critério repetido: recusada, e nenhuma das cópias entra no parcial", () => {
    const scores = [...onze(), registro(ROMANCE, 2)]
    const r = recusada(interpretar(payload(scores)))
    expect(r.classe).toBe("incompleta")
    expect(r.parcial!.criterios.duplicados).toEqual([ROMANCE])
    expect(r.parcial!.scores.map((s) => s.criterion)).toEqual(semRomance)
  })

  it("5b. critério desconhecido: recusada", () => {
    const scores = onze().map((s) => (s.criterion === "fantasy" ? { ...s, criterion: "fantasy_nobility" } : s))
    const r = recusada(interpretar(payload(scores)))
    expect(r.classe).toBe("incompleta")
    expect(r.parcial!.criterios.desconhecidos).toEqual(["fantasy_nobility"])
  })

  it("justificativa vazia: recusada (no backup de 19/10: 0 em 24.056 notas)", () => {
    const scores = onze().map((s, i) => (i === 0 ? { ...s, justification: "" } : s))
    const r = recusada(interpretar(payload(scores)))
    expect(r.classe).toBe("incompleta")
    expect(r.parcial!.criterios.invalidos).toEqual([CRITERION_SLUGS[0]])
  })

  it("a regra 2 (antiga, sem a trava dos 11) recupera o formato, e a MESMA régua barra o incompleto", () => {
    // scores como texto com aspas cruas, só 10 registros — antes isto entrava com o 11º inventado.
    const dez = onze().slice(0, 10).map((s, i) => (i === 2 ? { ...s, justification: 'tags de "Slow Burn" e "Fluff".' } : s))
    const texto = `[${dez.map((s) => `{"criterion":"${s.criterion}","score":${s.score},"justification":"${s.justification}"}`).join(",")}]`
    expect(() => JSON.parse(texto)).toThrow()
    const r = recusada(interpretar(payload(texto)))
    expect(r.classe).toBe("incompleta")
    expect(r.recuperacao?.formas).toEqual(["scores_unescaped_quotes"])
    expect(r.parcial!.scores).toEqual(dez)
  })
})

describe("8. Arte e os 11 continuam independentes", () => {
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

  it("11 incompletos + Arte válida: recusada, e a Arte fica no parcial, normalizada igual à da aceita", () => {
    const req = pedido()
    const daAceita = aceita(interpretar(payload(onze(), { art: ARTE_VALIDA }), PRODUCTION_VARIANT, req)).art
    const r = recusada(interpretar(payload([registro(ROMANCE)], { art: ARTE_VALIDA }), PRODUCTION_VARIANT, req))
    expect(r.classe).toBe("incompleta")
    expect(r.parcial!.art).toEqual(daAceita)
    expect(r.parcial!.art!.status).not.toBe("invalid")
  })

  it("11 completos + Arte inválida: aceita, com a Arte marcada inválida", () => {
    const r = aceita(interpretar(payload(onze(), { art: { quality_signal: 9 } }), PRODUCTION_VARIANT))
    expect(r.scores).toHaveLength(CRITERION_SLUGS.length)
    expect(r.art?.status).toBe("invalid")
  })

  it("na variante sem Arte, o parcial não inventa uma", () => {
    const r = recusada(interpretar(payload([registro(ROMANCE)]), VARIANTE_V30))
    expect(r.parcial).not.toHaveProperty("art")
  })
})
