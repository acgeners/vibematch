import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * O laço REAL de `requestAiEvaluation`, com o provider simulado: a recuperação de payload
 * evita a 2ª chamada nos dois casos observados, e SÓ neles. Um teste só da função pura passaria
 * verde com ela desligada no laço — ou ligada ANTES do schema, mexendo em payload válido.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({
  createLoggedMessage: vi.fn(),
  // O diagnóstico do #521. Espião de propósito: sem ele no mock, o `registrarRecusa` engoliria
  // o erro dentro do próprio try e o teste passaria verde sem exercitar a integração.
  anotar: vi.fn(async () => {}),
  quebrarPosProcessamento: false,
}))

vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  anotarPayloadRecusado: spies.anotar,
  getAnthropicClient: () => ({}),
}))
vi.mock("@/lib/ai-evaluation/adult-content-apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-evaluation/adult-content-apply")>()
  return {
    ...actual,
    aplicarLimiteAdulto: (...args: Parameters<typeof actual.aplicarLimiteAdulto>) => {
      if (spies.quebrarPosProcessamento) throw new Error("pós-processamento quebrou")
      return actual.aplicarLimiteAdulto(...args)
    },
  }
})
vi.mock("@/server/queries/ai-cache", () => ({
  recordCacheEventAsync: vi.fn(),
  readAiCache: vi.fn(async () => null),
  writeAiCache: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("sem banco no teste — o cache L2 cai para a chamada")
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
}))

import { MODEL, requestAiEvaluation, SYSTEM_PROMPT } from "@/lib/ai-evaluation/service"
import type { PayloadRecusado } from "@/lib/ai/tool-payload"
import { CRITERION_SLUGS } from "@/types/domain"

type Caso = { caso: string; bruto: string }
const fixture = JSON.parse(
  readFileSync("tests/fixtures/ai-evaluation/payloads-recusados-v31.json", "utf8"),
) as { casos: Caso[] }
const bruto = (nome: string) => JSON.parse(fixture.casos.find((c) => c.caso === nome)!.bruto) as Record<string, unknown>

const valido = () => ({
  summary: "Resumo válido.",
  confidence: 0.8,
  scores: CRITERION_SLUGS.map((criterion) => ({ criterion, score: 6, justification: "Faixa 4-6: presente." })),
})

/** A resposta do provider, na forma que `createLoggedMessage` devolve (com o id da linha de log). */
const resposta = (input: unknown, apiCallId: string | null = "call-x") => ({
  apiCallId,
  message: {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input }],
  },
})

// Cada teste usa uma obra própria: o cache L1 é por input, e um hit esconderia a chamada.
// O `externalContext` existe só para o pedido não cair no teto de confiança de baixa evidência
// (0,55): sem ele, a confiança recuperada nunca chegaria ao resultado para ser conferida.
let n = 0
const pedido = (extra: Record<string, unknown> = {}) =>
  ({
    workId: `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`,
    title: `Obra de teste ${n}`,
    synopsis: `Sinopse ${n}.`,
    genres: [],
    tags: [],
    sourcedReviews: [],
    platformRatings: [],
    externalContext: ["Contexto externo de teste."],
    ...extra,
  }) as unknown as Parameters<typeof requestAiEvaluation>[0]

const vistoPeloProvider = (i: number) => {
  const params = spies.createLoggedMessage.mock.calls[i][1] as {
    model: string
    system: Array<{ text: string }>
    messages: Array<{ content: Array<{ type: string; text?: string }> }>
  }
  return {
    model: params.model,
    system: params.system[0].text,
    prompt: params.messages[0].content.find((c) => c.type === "text")!.text!,
  }
}

const anotacao = (i: number) => spies.anotar.mock.calls[i] as unknown as [string | null, PayloadRecusado]

beforeEach(() => {
  spies.createLoggedMessage.mockReset()
  spies.anotar.mockReset()
  spies.anotar.mockImplementation(async () => {})
  spies.quebrarPosProcessamento = false
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("os dois payloads reais passam SEM retentativa", () => {
  it("caso 1 — confidence vazado: uma chamada, summary limpo, confidence 0,75", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(bruto("confidence_vazou_no_summary")))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.confidence).toBe(0.75)
    expect(r.summary).not.toContain("<parameter")
    expect(r.summary).toMatch(/"dark romance"\.$/)
    expect(r.scores.map((s) => s.criterionSlug)).toEqual([...CRITERION_SLUGS])
  })

  it("caso 2 — aspas cruas: uma chamada e as 11 notas do payload, com as aspas no texto", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(bruto("scores_com_aspas_cruas")))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.scores).toHaveLength(CRITERION_SLUGS.length)
    expect(r.scores.every((s) => s.justification !== "Não avaliado.")).toBe(true)
    expect(r.scores.some((s) => s.justification.includes('"healing"'))).toBe(true)
  })

  it("a recuperação não muda prompt, sistema nem modelo da chamada", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(bruto("confidence_vazou_no_summary")))
    await requestAiEvaluation(pedido())
    const visto = vistoPeloProvider(0)
    expect(visto.model).toBe(MODEL)
    expect(visto.system).toBe(SYSTEM_PROMPT)
    expect(visto.prompt).not.toContain("A tentativa anterior retornou um payload inválido")
  })
})

describe("o que continua inválido continua pagando a retentativa", () => {
  it("vazamento com confidence fora do intervalo: retenta, e a 2ª resposta válida vale", async () => {
    const quebrado = bruto("confidence_vazou_no_summary")
    quebrado.summary = (quebrado.summary as string).replace(/0\.75$/, "1.5")
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta(quebrado))
      .mockResolvedValueOnce(resposta(valido()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(vistoPeloProvider(1).prompt).toContain("A tentativa anterior retornou um payload inválido")
    expect(r.confidence).toBe(0.8)
  })

  it("recuperar NÃO dispensa o schema: vazamento recuperável + nota fora de 0–10 ainda retenta", async () => {
    const meioQuebrado = bruto("confidence_vazou_no_summary")
    meioQuebrado.scores = (meioQuebrado.scores as Array<{ criterion: string; score: number }>).map((s, i) =>
      i === 0 ? { ...s, score: 15 } : s,
    )
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta(meioQuebrado))
      .mockResolvedValueOnce(resposta(valido()))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(r.scores.every((s) => s.suggestedScore <= 10)).toBe(true)
    expect(r.summary).toBe("Resumo válido.")
  })

  it("as duas tentativas irrecuperáveis: falha com a causa do schema, sem salvar nada", async () => {
    const quebrado = bruto("scores_com_aspas_cruas")
    quebrado.scores = (quebrado.scores as string).replace('"healing"', '"healing')
    spies.createLoggedMessage.mockResolvedValue(resposta(quebrado))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow(/Payload da tool não atende ao schema: scores/)
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
  })
})

describe("não regressão no que vem depois do parser", () => {
  it("payload válido: uma chamada, notas e justificativas idênticas às enviadas", async () => {
    const v = valido()
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(v))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.summary).toBe(v.summary)
    expect(r.confidence).toBe(v.confidence)
    expect(r.scores.map((s) => [s.criterionSlug, s.suggestedScore, s.justification])).toEqual(
      v.scores.map((s) => [s.criterion, s.score, s.justification]),
    )
  })

  it("o piso de adult_content continua valendo sobre o payload RECUPERADO", async () => {
    const recuperavel = bruto("confidence_vazou_no_summary")
    recuperavel.scores = (recuperavel.scores as Array<{ criterion: string; score: number }>).map((s) =>
      s.criterion === "adult_content" ? { ...s, score: 3 } : s,
    )
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(recuperavel))
    const r = await requestAiEvaluation(pedido({ contentRatings: ["erotica"] }))
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.scores.find((s) => s.criterionSlug === "adult_content")!.suggestedScore).toBe(7)
  })
})

describe("integração com o diagnóstico do #521: salvar NÃO apaga a evidência", () => {
  it("caso real 1: o ORIGINAL é diagnosticado (uma vez), com as formas recuperadas — e não há 2ª chamada", async () => {
    const original = bruto("confidence_vazou_no_summary")
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(original, "call-R1"))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.confidence).toBe(0.75)

    expect(spies.anotar).toHaveBeenCalledTimes(1)
    const [id, d] = anotacao(0)
    expect(id).toBe("call-R1")
    expect(d).toMatchObject({ classe: "schema", recuperado: ["confidence_leaked_into_summary"], truncado: false })
    expect(d.motivo).toMatch(/confidence/)
    // O bruto é a resposta ORIGINAL, com o vazamento — não a versão limpa que foi aceita.
    expect(JSON.parse(d.bruto)).toEqual(original)
    expect(d.bruto).toContain('<parameter name=\\"confidence\\">0.75')
  })

  it("caso real 2: idem, com o JSON interno quebrado registrado", async () => {
    const original = bruto("scores_com_aspas_cruas")
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(original, "call-R2"))
    await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(spies.anotar).toHaveBeenCalledTimes(1)
    const [, d] = anotacao(0)
    expect(d).toMatchObject({ classe: "schema", recuperado: ["scores_unescaped_quotes"] })
    expect(d.json_invalido?.scores).toMatch(/position 1154/)
    expect(JSON.parse(d.bruto)).toEqual(original)
  })

  it("payload válido: sem recuperação e sem diagnóstico", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(valido()))
    await requestAiEvaluation(pedido())
    expect(spies.anotar).not.toHaveBeenCalled()
  })

  it("não recuperável: diagnosticado SEM `recuperado`, e a retentativa acontece", async () => {
    const quebrado = bruto("confidence_vazou_no_summary")
    quebrado.summary = (quebrado.summary as string).replace(/0\.75$/, "1.5")
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta(quebrado, "call-N0"))
      .mockResolvedValueOnce(resposta(valido(), "call-N1"))
    await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(spies.anotar).toHaveBeenCalledTimes(1)
    const [id, d] = anotacao(0)
    expect(id).toBe("call-N0")
    expect(d.classe).toBe("schema")
    expect(d.recuperado).toBeUndefined()
  })

  it("diagnóstico que FALHA não impede a recuperação nem muda o resultado", async () => {
    spies.anotar.mockImplementation(async () => {
      throw new Error("banco fora")
    })
    spies.createLoggedMessage.mockResolvedValueOnce(resposta(bruto("confidence_vazou_no_summary")))
    const r = await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(r.confidence).toBe(0.75)
  })

  it("erro de provider: nem recuperação nem diagnóstico", async () => {
    spies.createLoggedMessage.mockRejectedValueOnce(Object.assign(new Error("rate_limit_error"), { status: 429 }))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow(/rate_limit_error/)
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(spies.anotar).not.toHaveBeenCalled()
  })

  it("recuperado mas o pós-processamento falha: UMA gravação na tentativa (classe final), depois o retry", async () => {
    spies.quebrarPosProcessamento = true
    spies.createLoggedMessage
      .mockResolvedValueOnce(resposta(bruto("confidence_vazou_no_summary"), "call-P0"))
      .mockResolvedValueOnce(resposta(valido(), "call-P1"))
    // `erotica` cria um piso — só com piso/teto o pós-processamento passa pelo limite adulto.
    await expect(requestAiEvaluation(pedido({ contentRatings: ["erotica"] }))).rejects.toThrow(/pós-processamento quebrou/)
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    const daPrimeira = spies.anotar.mock.calls.filter((c) => (c as unknown[])[0] === "call-P0")
    expect(daPrimeira).toHaveLength(1)
    expect((daPrimeira[0] as unknown as [string, PayloadRecusado])[1]).toMatchObject({
      classe: "pos_processamento",
      recuperado: ["confidence_leaked_into_summary"],
    })
  })

  it("a tool enviada ao provider é a mesma: 1 tool, 11 critérios no enum, 2 tentativas no máximo", async () => {
    const quebrado = bruto("scores_com_aspas_cruas")
    quebrado.scores = (quebrado.scores as string).replace('"healing"', '"healing')
    spies.createLoggedMessage.mockResolvedValue(resposta(quebrado))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow()
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    const params = spies.createLoggedMessage.mock.calls[0][1] as {
      tools: Array<{ name: string; input_schema: { properties: { scores: { items: { properties: { criterion: { enum: string[] } } } } } } }>
    }
    expect(params.tools.map((t) => t.name)).toEqual(["submit_evaluation"])
    expect(params.tools[0].input_schema.properties.scores.items.properties.criterion.enum).toEqual([...CRITERION_SLUGS])
    expect(CRITERION_SLUGS).toHaveLength(11)
  })
})
