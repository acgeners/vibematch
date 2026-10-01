import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Arte NÃO pode tocar os 11. Três frentes, cada uma com contraprova:
 * 1. interpretação (a função ÚNICA que o laço e o harness usam): Arte válida, abstida, inválida ou
 *    ausente produz exatamente as mesmas 11 notas, e nunca transforma aceita em recusa;
 * 2. o laço de produção: Arte nunca dispara retry, e a variante de produção nem lê `art`;
 * 3. a guarda do `summary`: marcação da tool é recusa de schema (fail-closed ⇒ retry), `<` legítimo não.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({
  createLoggedMessage: vi.fn(),
  anotar: vi.fn(async () => {}),
}))

vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  anotarPayloadRecusado: spies.anotar,
  getAnthropicClient: () => ({}),
}))
vi.mock("@/server/queries/ai-cache", () => ({
  recordCacheEventAsync: vi.fn(),
  readAiCache: vi.fn(async () => null),
  writeAiCache: vi.fn(),
}))
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
  PRODUCTION_VARIANT,
  evaluationToolFor,
  evaluationToolPayloadSchema,
  interpretarRespostaDaTool,
  prepareReviews,
  VARIANTE_V30,
  PROMPT_VERSION,
  requestAiEvaluation,
  summaryTemMarcaDaTool,
} from "@/lib/ai-evaluation/service"
import type { InterpretacaoDaTool } from "@/lib/ai-evaluation/service"
import { CRITERION_SLUGS } from "@/types/domain"

type Req = Parameters<typeof requestAiEvaluation>[0]

const REVIEWS = [
  "The art is absolutely gorgeous, every panel looks like a painting.",
  "Beautiful art and the colors are stunning throughout the story.",
  "Gorgeous artwork, the character designs are lovely and detailed.",
  "Plot drags in the middle but the romance is sweet.",
]

let n = 0
const pedido = (extra: Record<string, unknown> = {}): Req =>
  ({
    workId: `00000000-0000-0000-0001-${String(++n).padStart(12, "0")}`,
    title: `Obra ${n}`,
    synopsis: `Sinopse ${n}.`,
    genres: [],
    tags: [],
    sourcedReviews: REVIEWS.map((text) => ({ source: "mangaupdates", sourceTitle: `Obra ${n}`, matchScore: 0.95, text })),
    platformRatings: [],
    externalContext: ["Contexto externo de teste."],
    ...extra,
  }) as unknown as Req

const onze = () => ({
  summary: "Resumo válido, com <3 e nota < 5 em humor.",
  confidence: 0.8,
  scores: CRITERION_SLUGS.map((criterion, i) => ({ criterion, score: 4 + (i % 5), justification: "Faixa 4-6: presente." })),
})

const ARTES: Record<string, unknown> = {
  valida: {
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
  },
  abstida: {
    judging_reviews: [{ review_id: "R1", stance: "positive" }],
    quality_signal: "ABOVE_AVERAGE",
    quality_evidence: [],
    change_signal: "NO_CLEAR_SIGNAL",
    change_evidence: [],
    justification: "",
  },
  invalida: { quality_signal: 9, judging_reviews: "todas" },
  lixo: "<parameter name=\"art\">ABOVE",
}

const interpretar = (payload: unknown, variant = PRODUCTION_VARIANT, req = pedido()) =>
  interpretarRespostaDaTool(payload, req, prepareReviews(req), "claude-sonnet-5", "hash-x", variant)

const aceita = (r: InterpretacaoDaTool) => {
  if (r.tipo !== "aceita") throw new Error(`esperava aceita, veio recusada: ${String(r.erro)}`)
  return r.resposta
}
const notas = (r: InterpretacaoDaTool) =>
  aceita(r).scores.map((s) => [s.criterionSlug, s.suggestedScore, s.justification])

describe("1. a interpretação: Arte não muda os 11", () => {
  const req = pedido()
  const base = notas(interpretar(onze(), VARIANTE_V30, req))

  for (const [nome, art] of [...Object.entries(ARTES), ["ausente", undefined]] as Array<[string, unknown]>) {
    it(`art ${nome}: aceita, e as 11 notas são idênticas às da produção`, () => {
      const payload = art === undefined ? onze() : { ...onze(), art }
      const r = interpretar(payload, PRODUCTION_VARIANT, req)
      expect(r.tipo).toBe("aceita")
      expect(notas(r)).toEqual(base)
      expect(aceita(r).summary).toBe(onze().summary)
      expect(aceita(r).confidence).toBe(0.8)
    })
  }

  it("o status da Arte segue o que veio: rated · abstained · invalid · invalid · invalid", () => {
    const status = [ARTES.valida, ARTES.abstida, ARTES.invalida, ARTES.lixo, undefined].map(
      (art) => aceita(interpretar(art === undefined ? onze() : { ...onze(), art }, PRODUCTION_VARIANT, req)).art?.status,
    )
    expect(status).toEqual(["rated", "abstained", "invalid", "invalid", "invalid"])
  })

  it("a v30 (fora de produção) ignora `art` por completo (nem resposta.art, nem raw)", () => {
    const r = aceita(interpretar({ ...onze(), art: ARTES.valida }, VARIANTE_V30, req))
    expect(r.art).toBeUndefined()
    expect(r.promptVersion).toBe("v30")
    expect(JSON.stringify(r.rawResponse)).not.toContain("art_bruto")
  })

  it("a produção é a v32 e carimba a versão canônica", () => {
    expect(PROMPT_VERSION).toBe("v32")
    expect(aceita(interpretar({ ...onze(), art: ARTES.valida }, PRODUCTION_VARIANT, req)).promptVersion).toBe(PROMPT_VERSION)
  })

  it("a candidata carimba v32 e guarda o art normalizado e o bruto no rawResponse", () => {
    const r = aceita(interpretar({ ...onze(), art: ARTES.valida }, PRODUCTION_VARIANT, req))
    expect(r.promptVersion).toBe("v32")
    const raw = r.rawResponse as Record<string, unknown>
    expect((raw.art as { status: string }).status).toBe("rated")
    expect(raw.art_bruto).toEqual(ARTES.valida)
  })

  it("11 inválidos + Arte perfeita: RECUSADA por schema — Arte não salva os 11", () => {
    const quebrado = { ...onze(), confidence: 3, art: ARTES.valida }
    const r = interpretar(quebrado)
    expect(r.tipo).toBe("recusada")
    if (r.tipo === "recusada") expect(r.classe).toBe("schema")
  })

  it("a recuperação existente segue valendo com Arte junto (confidence vazado no summary)", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/ai-evaluation/payloads-recusados-v31.json", "utf8")) as {
      casos: Array<{ caso: string; bruto: string }>
    }
    const vazou = JSON.parse(fixture.casos.find((c) => c.caso === "confidence_vazou_no_summary")!.bruto)
    const r = interpretar({ ...vazou, art: ARTES.valida })
    expect(r.tipo).toBe("aceita")
    expect(r.recuperacao?.formas).toEqual(["confidence_leaked_into_summary"])
    expect(aceita(r).confidence).toBe(0.75)
    expect(aceita(r).art?.status).toBe("rated")
  })

  it("a tool de produção é o MESMO objeto; a candidata exige `art` só na tool", () => {
    expect(evaluationToolFor(VARIANTE_V30)).toBe(evaluationToolFor(VARIANTE_V30))
    const props = (evaluationToolFor(VARIANTE_V30).input_schema as { properties: object }).properties
    expect(Object.keys(props)).not.toContain("art")
    const cand = evaluationToolFor(PRODUCTION_VARIANT).input_schema as { properties: object; required: string[] }
    expect(Object.keys(cand.properties)).toContain("art")
    expect(cand.required).toContain("art")
    // …e o Zod dos 11 não conhece `art`: payload sem ele passa.
    expect(evaluationToolPayloadSchema.safeParse(onze()).success).toBe(true)
  })
})

const resposta = (input: unknown) => ({
  apiCallId: "call-art",
  message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input }] },
})

beforeEach(() => {
  spies.createLoggedMessage.mockReset()
  spies.anotar.mockReset()
  spies.anotar.mockImplementation(async () => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("2. o laço de produção (v32): Arte nunca dispara retry nem derruba os 11", () => {
  const ESPERADO: Record<string, string> = { valida: "rated", abstida: "abstained", invalida: "invalid", lixo: "invalid" }
  for (const [nome, art] of Object.entries(ARTES)) {
    it(`payload válido + art ${nome}: UMA chamada, nenhum diagnóstico de recusa, Arte ${ESPERADO[nome]}`, async () => {
      spies.createLoggedMessage.mockResolvedValueOnce(resposta({ ...onze(), art }))
      const r = await requestAiEvaluation(pedido())
      expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
      expect(spies.anotar).not.toHaveBeenCalled()
      expect(r.art?.status).toBe(ESPERADO[nome])
      expect(r.scores).toHaveLength(CRITERION_SLUGS.length)
    })
  }

  it("payload válido SEM `art`: UMA chamada, os 11 aceitos, Arte `invalid`", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(onze()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.art?.status).toBe("invalid")
    expect(r.scores).toHaveLength(CRITERION_SLUGS.length)
  })

  it("a produção manda a tool COM `art` obrigatório", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(onze()))
    await requestAiEvaluation(pedido())
    const params = spies.createLoggedMessage.mock.calls[0][1] as { tools: Array<{ input_schema: { properties: object; required: string[] } }> }
    expect(Object.keys(params.tools[0].input_schema.properties)).toContain("art")
    expect(params.tools[0].input_schema.required).toContain("art")
  })

  it("11 quebrados + Arte perfeita: retenta por causa dos 11, e a 2ª resposta válida vale", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta({ ...onze(), confidence: 3, art: ARTES.valida }))
      .mockResolvedValueOnce(resposta({ ...onze(), art: ARTES.valida }))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(r.confidence).toBe(0.8)
  })
})

describe("3. a guarda do summary", () => {
  const sujos = [
    'Resumo.</parameter>\n<parameter name="confidence">0.75',
    'Resumo bom.\n<parameter name="art">ABOVE',
    "Resumo bom.</summary>",
    "Resumo</invoke>",
    "Resumo <invoke name=\"submit_evaluation\">",
    "Resumo com antml:parameter dentro",
    "Resumo </ parameter >",
  ]
  for (const s of sujos) {
    it(`recusa: ${JSON.stringify(s).slice(0, 50)}`, () => {
      expect(summaryTemMarcaDaTool(s)).toBe(true)
      expect(evaluationToolPayloadSchema.safeParse({ ...onze(), summary: s }).success).toBe(false)
    })
  }

  const limpos = [
    "Romance <3 com nota < 5 em humor.",
    "Tensão > drama, e a > b na maior parte do tempo.",
    "Usa <b>negrito</b>, <i>itálico</i> e <br> na sinopse original.",
    "A sinopse cita a tag <parameter> da API sem querer.",
    "O resumo (summary) e a confiança (confidence) são campos.",
    "<summary é uma palavra> e <art nouveau> também.",
  ]
  for (const s of limpos) {
    it(`passa: ${JSON.stringify(s).slice(0, 50)}`, () => {
      expect(summaryTemMarcaDaTool(s)).toBe(false)
      expect(evaluationToolPayloadSchema.safeParse({ ...onze(), summary: s }).success).toBe(true)
    })
  }

  it("no laço: summary sujo COM confidence válido retenta (fail-closed) e registra o diagnóstico", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta({ ...onze(), summary: 'Resumo.</summary>\n<parameter name="art">x' }))
      .mockResolvedValueOnce(resposta(onze()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(spies.anotar).toHaveBeenCalledTimes(1)
    expect((spies.anotar.mock.calls[0] as unknown as [string, { classe: string }])[1].classe).toBe("schema")
    expect(r.summary).toBe(onze().summary)
  })
})
