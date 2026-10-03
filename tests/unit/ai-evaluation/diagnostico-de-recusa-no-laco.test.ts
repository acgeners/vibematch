import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * O laço REAL de `requestAiEvaluation`, com o provider simulado: o diagnóstico é gravado em
 * TODA resposta recusada (e só nelas), na linha de `ai_api_calls` da própria tentativa, e não
 * muda nem a decisão nem quantas tentativas acontecem.
 *
 * Um teste só de `descreverPayloadRecusado` passaria verde com a anotação desligada no laço, ou
 * pendurada no ramo errado — foi exatamente assim que 7 das 9 recusas da v31 ficaram sem causa.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({
  createLoggedMessage: vi.fn(),
  anotar: vi.fn(async () => {}),
  quebrarPosProcessamento: false,
}))

vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {}, exigirVersaoCanonica: async () => {} }))
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
    throw new Error("sem banco no teste — o cache L2 cai para a chamada")
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
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

import { requestAiEvaluation } from "@/lib/ai-evaluation/service"
import type { PayloadRecusado } from "@/lib/ai/tool-payload"
import { CRITERION_SLUGS } from "@/types/domain"

type Caso = { caso: string; bruto: string }
const fixture = JSON.parse(
  readFileSync("tests/fixtures/ai-evaluation/payloads-recusados-v31.json", "utf8"),
) as { casos: Caso[] }
const real = (nome: string) => JSON.parse(fixture.casos.find((c) => c.caso === nome)!.bruto) as Record<string, unknown>

/**
 * Variante IRRECUPERÁVEL de um payload real. Desde a recuperação de payload
 * (`tool-payload-recovery.ts`) os dois reais são salvos SEM retentativa — isso é guardado em
 * `recuperacao-sem-retentativa.test.ts`. O caminho que ESTE arquivo guarda (recusa ⇒ diagnóstico
 * ⇒ retry) precisa de uma resposta que continue recusada: a mutação é mínima e só tira o payload
 * do conjunto que a recuperação aceita (confidence fora de [0, 1]; uma aspa ímpar).
 */
const irrecuperavel = (nome: string) => {
  const p = real(nome)
  if (nome === "confidence_vazou_no_summary") p.summary = (p.summary as string).replace(/0\.75$/, "1.5")
  else p.scores = (p.scores as string).replace('"healing"', '"healing')
  return p
}

const valido = () => ({
  summary: "Resumo válido.",
  confidence: 0.8,
  scores: CRITERION_SLUGS.map((criterion) => ({ criterion, score: 6, justification: "Faixa 4-6: presente." })),
})

/** A resposta do provider na forma de `createLoggedMessage`, com o id da linha de log. */
const comTool = (input: unknown, apiCallId: string | null) => ({
  apiCallId,
  message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input }] },
})
const semTool = (apiCallId: string) => ({
  apiCallId,
  message: {
    stop_reason: "max_tokens",
    content: [
      { type: "thinking", thinking: "x".repeat(50_000), signature: "s".repeat(5_000) },
      { type: "text", text: "Vou avaliar a obra…" },
    ],
  },
})

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
    ...extra,
  }) as unknown as Parameters<typeof requestAiEvaluation>[0]

const metaDaChamada = (i: number) =>
  spies.createLoggedMessage.mock.calls[i][2] as { attempt: number; logicalRequestId: string }
const anotacao = (i: number) => spies.anotar.mock.calls[i] as unknown as [string | null, PayloadRecusado]

beforeEach(() => {
  spies.createLoggedMessage.mockReset()
  spies.anotar.mockReset()
  spies.anotar.mockImplementation(async () => {})
  spies.quebrarPosProcessamento = false
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("A · recusa gera diagnóstico, na linha da PRÓPRIA tentativa", () => {
  it("caso 1 (vazamento, irrecuperável): anota a 1ª linha como `schema`, e a 2ª tentativa válida vale", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(comTool(irrecuperavel("confidence_vazou_no_summary"), "call-A0"))
      .mockResolvedValueOnce(comTool(valido(), "call-A1"))
    const r = await requestAiEvaluation(pedido())

    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(spies.anotar).toHaveBeenCalledTimes(1)
    const [id, d] = anotacao(0)
    expect(id).toBe("call-A0")
    expect(d).toMatchObject({ versao: 1, classe: "schema", truncado: false })
    expect(d.motivo).toMatch(/confidence/)
    expect(d.bruto).toContain('<parameter name=\\"confidence\\">')
    expect(r.summary).toBe("Resumo válido.")
  })

  it("caso real 2 (JSON interno quebrado): o motivo e a posição do erro ficam guardados", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(comTool(real("scores_com_aspas_cruas"), "call-B0"))
      .mockResolvedValueOnce(comTool(valido(), "call-B1"))
    await requestAiEvaluation(pedido())
    const [id, d] = anotacao(0)
    expect(id).toBe("call-B0")
    expect(d.classe).toBe("schema")
    expect(d.json_invalido?.scores).toMatch(/position 1154/)
  })

  it("sem tool (max_tokens): classe `sem_tool`, guarda o TEXTO e só o tipo dos outros blocos", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(semTool("call-C0"))
      .mockResolvedValueOnce(comTool(valido(), "call-C1"))
    await requestAiEvaluation(pedido())
    const [id, d] = anotacao(0)
    expect(id).toBe("call-C0")
    expect(d).toMatchObject({ classe: "sem_tool", motivo: expect.stringMatching(/limite de tokens/) })
    expect(JSON.parse(d.bruto)).toEqual([{ type: "thinking" }, { type: "text", text: "Vou avaliar a obra…" }])
    expect(d.bruto.length).toBeLessThan(200) // os 55 mil caracteres do bloco opaco NÃO entram
  })

  it("pós-processamento que lança: classe `pos_processamento`", async () => {
    spies.quebrarPosProcessamento = true
    spies.createLoggedMessage.mockResolvedValue(comTool(valido(), "call-D"))
    // `erotica` cria um piso, e só com piso/teto o pós-processamento passa pelo limite adulto.
    await expect(requestAiEvaluation(pedido({ contentRatings: ["erotica"] }))).rejects.toThrow(/pós-processamento quebrou/)
    expect(spies.anotar).toHaveBeenCalledTimes(2)
    expect(anotacao(0)[1]).toMatchObject({ classe: "pos_processamento", motivo: "pós-processamento quebrou" })
  })
})

describe("o `bruto` é o que o MODELO mandou, não o que a coerção produziu", () => {
  it("scores duplo-encodado (a coerção desembrulha) + confidence ausente: o bruto guarda a STRING", async () => {
    const { confidence: _fora, ...semConfidence } = valido()
    void _fora
    const enviado = { ...semConfidence, scores: JSON.stringify(valido().scores) }
    spies.createLoggedMessage
      .mockResolvedValueOnce(comTool(enviado, "call-K0"))
      .mockResolvedValueOnce(comTool(valido(), "call-K1"))
    await requestAiEvaluation(pedido())
    const [, d] = anotacao(0)
    expect(d.campos.scores).toBe("string")
    expect(JSON.parse(d.bruto)).toEqual(enviado)
  })
})

describe("B · resposta válida não gera diagnóstico", () => {
  it("uma chamada, nenhuma anotação", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce(comTool(valido(), "call-E0"))
    await requestAiEvaluation(pedido())
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(spies.anotar).not.toHaveBeenCalled()
  })
})

describe("C · as tentativas continuam correlacionáveis", () => {
  it("as duas chamadas dividem o logical_request_id, com attempt 0 e 1, e cada recusa aponta a SUA linha", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(comTool(irrecuperavel("confidence_vazou_no_summary"), "call-F0"))
      .mockResolvedValueOnce(comTool(irrecuperavel("scores_com_aspas_cruas"), "call-F1"))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow()

    expect([metaDaChamada(0).attempt, metaDaChamada(1).attempt]).toEqual([0, 1])
    expect(metaDaChamada(0).logicalRequestId).toBeTruthy()
    expect(metaDaChamada(1).logicalRequestId).toBe(metaDaChamada(0).logicalRequestId)
    expect([anotacao(0)[0], anotacao(1)[0]]).toEqual(["call-F0", "call-F1"])
  })

  it("sem id de log (o insert falhou): a anotação recebe null e o laço segue igual", async () => {
    spies.createLoggedMessage
      .mockResolvedValueOnce(comTool(irrecuperavel("confidence_vazou_no_summary"), null))
      .mockResolvedValueOnce(comTool(valido(), "call-G1"))
    await requestAiEvaluation(pedido())
    expect(anotacao(0)[0]).toBeNull()
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
  })
})

describe("G · erro de provider NÃO vira payload recusado", () => {
  it("createLoggedMessage lança (rede/limite): propaga, uma chamada, zero anotação", async () => {
    spies.createLoggedMessage.mockRejectedValueOnce(Object.assign(new Error("rate_limit_error"), { status: 429 }))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow(/rate_limit_error/)
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
    expect(spies.anotar).not.toHaveBeenCalled()
  })
})

describe("H/I · o diagnóstico não muda a decisão nem o número de tentativas", () => {
  it("as duas recusadas: falha com a MESMA mensagem de antes, em 2 chamadas", async () => {
    spies.createLoggedMessage.mockResolvedValue(comTool(irrecuperavel("scores_com_aspas_cruas"), "call-H"))
    await expect(requestAiEvaluation(pedido())).rejects.toThrow(
      /^Erro ao interpretar resposta da IA: Payload da tool não atende ao schema: scores: .* Nenhuma avaliação foi salva\.$/,
    )
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
    expect(spies.anotar).toHaveBeenCalledTimes(2)
  })

  it("anotação que FALHA não troca o resultado nem as tentativas", async () => {
    // O `anotarPayloadRecusado` real já é fail-soft; o que se trava aqui é o laço não depender
    // disso — descrever E gravar vivem num `try` próprio no ponto de chamada.
    spies.anotar.mockImplementation(async () => {
      throw new Error("banco fora")
    })
    spies.createLoggedMessage
      .mockResolvedValueOnce(comTool(irrecuperavel("confidence_vazou_no_summary"), "call-I0"))
      .mockResolvedValueOnce(comTool(valido(), "call-I1"))
    const r = await requestAiEvaluation(pedido())
    expect(r.summary).toBe("Resumo válido.")
    expect(spies.createLoggedMessage).toHaveBeenCalledTimes(2)
  })
})
