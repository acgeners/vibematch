import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

/** Ordem real das chamadas — é ela que este arquivo testa. */
const chamadas: string[] = []

const acquire = vi.fn(async () => {
  chamadas.push("acquire_reviews")
  return 12
})
const digest = vi.fn(async () => {
  chamadas.push("generate_review_digest")
  return { ok: true, status: "generated" as const }
})
const inferTags = vi.fn(async () => {
  chamadas.push("infer_tags")
  return 3
})
const trigger = vi.fn(async () => {
  chamadas.push("run_ai_evaluation")
  return { data: { evaluation: { id: "e1" }, currentScores: {}, currentEvaluation: null } }
})

vi.mock("@/lib/external/acquire-reviews", () => ({
  acquireAndPersistWorkReviews: (...a: unknown[]) => acquire(...(a as [])),
}))
vi.mock("@/server/actions/review-digest", () => ({
  generateWorkReviewDigest: (...a: unknown[]) => digest(...(a as [])),
}))
vi.mock("@/lib/tags/auto-infer", () => ({
  inferAndPersistTagsForWork: (...a: unknown[]) => inferTags(...(a as [])),
}))
vi.mock("@/server/actions/ai", () => ({
  triggerAiEvaluation: (...a: unknown[]) => trigger(...(a as [])),
}))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: vi.fn(async () => ({ ok: true })) }))

/** Prontidão devolvida a cada chamada — permite simular "mudou depois do digest". */
let prepPorChamada: Array<{ blocked: boolean; missingSources: string[]; needsTagRefresh: boolean }> = []
const loadPrep = vi.fn(async () => {
  const p = prepPorChamada.shift() ?? {
    blocked: false,
    missingSources: [],
    needsTagRefresh: false,
  }
  return { ...p, ready: !p.blocked && !p.needsTagRefresh }
})
vi.mock("@/server/queries/eval-prep", () => ({
  loadEvalPrepForWork: (...a: unknown[]) => loadPrep(...(a as [])),
}))

import { prepareAndEvaluate } from "@/server/actions/prepare-and-evaluate"

const PRONTA = { blocked: false, missingSources: [], needsTagRefresh: false }
const TAGS_VELHAS = { blocked: false, missingSources: [], needsTagRefresh: true }

beforeEach(() => {
  chamadas.length = 0
  prepPorChamada = []
  vi.clearAllMocks()
})

/**
 * O pipeline "Preparar e avaliar" só vale se rodar NA ORDEM — e a ordem não é a
 * intuitiva.
 *
 * 🔴 `inferAndPersistTagsForWork` lê `works.review_digest`/`review_summary`, **não**
 * `work_reviews`. Inferir tags antes do digest releria o texto ANTIGO e produziria as
 * mesmas tags, a 0,99¢ por obra, com a tela dizendo "preparado". E avaliar antes das
 * tags é exatamente o defeito que a feature existe pra fechar: `triggerAiEvaluation` lê
 * `work_tags` no começo, então tags inferidas depois dela não entram no prompt.
 */
describe("a ordem dos passos", () => {
  it("é fontes → reviews → digest → tags → avaliação", async () => {
    prepPorChamada = [PRONTA, TAGS_VELHAS]
    const res = await prepareAndEvaluate("w1")
    expect(res.kind).toBe("evaluated")
    expect(chamadas).toEqual([
      "acquire_reviews",
      "generate_review_digest",
      "infer_tags",
      "run_ai_evaluation",
    ])
  })

  it("🔴 reclassifica a prontidão DEPOIS do digest, não reusa a foto da tela", async () => {
    // A obra chega "em dia" (as tags eram mais novas que o digest ANTIGO) e só vira
    // trabalho porque a aquisição trouxe reviews que regeraram o digest. Decidir pela
    // 1ª leitura pularia justamente a obra que mais precisa.
    prepPorChamada = [PRONTA, TAGS_VELHAS]
    await prepareAndEvaluate("w1")
    expect(inferTags).toHaveBeenCalledTimes(1)
    expect(loadPrep).toHaveBeenCalledTimes(2)
  })

  it("não paga inferência quando o digest não mudou", async () => {
    prepPorChamada = [PRONTA, PRONTA]
    const res = await prepareAndEvaluate("w1")
    expect(inferTags).not.toHaveBeenCalled()
    expect(chamadas).toEqual(["acquire_reviews", "generate_review_digest", "run_ai_evaluation"])
    // `tagsAdded: null` distingue "não precisou" de "rodou e achou 0" — o resumo do
    // lote imprime as duas coisas, e colapsá-las esconderia inferência sem resultado.
    expect(res.kind === "evaluated" && res.prep.tagsAdded).toBe(null)
  })
})

describe("o gate de fontes", () => {
  it("🔴 para ANTES de qualquer passo — nada é buscado, nada é gasto", async () => {
    prepPorChamada = [{ blocked: true, missingSources: ["mangago"], needsTagRefresh: true }]
    const res = await prepareAndEvaluate("w1")
    expect(res).toEqual({ kind: "blocked_sources", missingSources: ["mangago"] })
    expect(chamadas).toEqual([])
    expect(trigger).not.toHaveBeenCalled()
  })

  it("`ignoreSourceGate` segue em frente (o caminho de escape do servidor)", async () => {
    prepPorChamada = [
      { blocked: true, missingSources: ["mangago"], needsTagRefresh: false },
      PRONTA,
    ]
    const res = await prepareAndEvaluate("w1", { ignoreSourceGate: true })
    expect(res.kind).toBe("evaluated")
    expect(chamadas).toContain("run_ai_evaluation")
  })
})

describe("o repasse pra avaliação", () => {
  it("propaga `proceedWithoutReviews` — senão o lote trava no gate de sem-reviews", async () => {
    prepPorChamada = [PRONTA, PRONTA]
    await prepareAndEvaluate("w1", { proceedWithoutReviews: true })
    expect(trigger).toHaveBeenCalledWith("w1", { proceedWithoutReviews: true })
  })

  it("devolve o retorno CRU do trigger — quem consome é o mesmo `toOutcome` de sempre", async () => {
    prepPorChamada = [PRONTA, PRONTA]
    const res = await prepareAndEvaluate("w1")
    expect(res.kind === "evaluated" && res.result).toEqual({
      data: { evaluation: { id: "e1" }, currentScores: {}, currentEvaluation: null },
    })
  })
})
