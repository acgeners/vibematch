import { describe, it, expect, vi, beforeEach } from "vitest"

// O que este arquivo prende é uma ORDEM, não um valor — e ordem é o tipo de coisa que a
// suíte deixa passar calada. O digest (Sonnet) sai de `saveWorkReviews` como
// fire-and-forget por padrão, pra não pendurar ~20s na resposta. Mas na CRIAÇÃO de obra
// quem roda logo depois é a inferência de tags, que LÊ `review_digest`: sem o
// `awaitDigest`, ela sempre corria antes de o digest existir e caía no resumo — pagava-se
// o Sonnet e o resultado chegava tarde demais pra servir a alguém.
//
// Reverter o `await` não quebra tipo, não quebra lint e não muda nenhum valor gravado.
// Só quebra aqui.

const ensureReviewSummary = vi.fn(async () => ({ status: "succeeded" }))
let digestDone = false
const ensureReviewDigest = vi.fn(async () => {
  await new Promise<void>((r) => setTimeout(r, 30))
  digestDone = true
  return { status: "succeeded" }
})

vi.mock("@/lib/orchestration/integrations/reviews", () => ({
  ensureReviewSummary: (...args: unknown[]) => ensureReviewSummary(...(args as [])),
  ensureReviewDigest: (...args: unknown[]) => ensureReviewDigest(...(args as [])),
}))

vi.mock("@/server/queries/current-user", () => ({
  getReviewSynthesisToggles: async () => ({ summaryEnabled: true, digestEnabled: true }),
}))

// Cliente encadeável: qualquer método devolve o próprio proxy e o `await` no fim resolve
// o resultado da tabela. Cobre delete().eq().in(), insert(), select().eq().maybeSingle()
// e update().eq() sem precisar espelhar o PostgREST inteiro.
const chain = (result: unknown): Record<string, unknown> =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
        }
        return () => chain(result)
      },
    },
  ) as Record<string, unknown>

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      chain(
        table === "works"
          ? { data: { reviews_hash: null, ai_eval_status: "pending" }, error: null }
          : { data: [], error: null },
      ),
  }),
}))

import { saveWorkReviews } from "@/lib/external/persist-reviews"
import type { SourcedReview } from "@/lib/external/types"

const reviews: SourcedReview[] = [
  {
    source: "anilist",
    sourceTitle: "T",
    matchScore: 0.9,
    text: "review com texto suficientemente longo pra passar de qualquer piso de tamanho",
    textLength: 76,
  },
]

beforeEach(() => {
  digestDone = false
  vi.clearAllMocks()
})

describe("saveWorkReviews — quando o digest é aguardado", () => {
  it("default: NÃO espera o digest (o save não paga a latência do Sonnet)", async () => {
    await saveWorkReviews("w1", reviews)
    expect(ensureReviewDigest).toHaveBeenCalledTimes(1) // disparado…
    expect(digestDone).toBe(false) // …mas não aguardado
    await new Promise<void>((r) => setTimeout(r, 50)) // drena o job solto
    expect(digestDone).toBe(true)
  })

  it("awaitDigest: só retorna DEPOIS do digest — é o que a inferência de tags consome", async () => {
    await saveWorkReviews("w1", reviews, { awaitDigest: true })
    expect(digestDone).toBe(true)
  })

  it("o resumo continua aguardado nos dois modos", async () => {
    await saveWorkReviews("w1", reviews)
    expect(ensureReviewSummary).toHaveBeenCalledTimes(1)
    await saveWorkReviews("w1", reviews, { awaitDigest: true })
    expect(ensureReviewSummary).toHaveBeenCalledTimes(2)
  })

  it("skipPaidEnrichment vence awaitDigest — nada pago roda", async () => {
    await saveWorkReviews("w1", reviews, { awaitDigest: true, skipPaidEnrichment: true })
    expect(ensureReviewSummary).not.toHaveBeenCalled()
    expect(ensureReviewDigest).not.toHaveBeenCalled()
  })
})
