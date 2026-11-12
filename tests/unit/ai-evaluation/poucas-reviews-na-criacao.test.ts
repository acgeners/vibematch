import { vi, describe, it, expect, beforeEach } from "vitest"

// Medido em 2026-11-12: avaliação de atributos feita com menos de 4 reviews úteis muda ~2,5× mais
// quando a obra ganha reviews (0,57 × 0,22 de mudança média; 23% × 10% de troca de faixa). Obra
// recém-lançada (21% das criadas em 60 dias) cai aqui. A criação passa a PERGUNTAR antes de pagar
// — a mesma pergunta que já existia para "nenhuma review", agora com a contagem.

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => ({ ok: true }),
  ensureSignedIn: async () => ({ ok: true }),
  ensurePermission: async () => ({ ok: true }),
}))
vi.mock("@/lib/external/comix-render-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/external/comix-render-client")>()),
  isComixRenderConfigured: () => false,
}))

const contexto = vi.fn()
vi.mock("@/lib/external/index", async (orig) => ({
  ...(await orig<typeof import("@/lib/external/index")>()),
  buildCandidateFromExternalIds: () => ({ title: "Obra" }),
  fetchExternalEvaluationContextForCandidate: (...a: unknown[]) => contexto(...a),
  fetchExternalEvaluationContextForWork: (...a: unknown[]) => contexto(...a),
}))

const modelo = vi.fn(async () => ({
  scores: [],
  summary: "s",
  confidence: 0.8,
  modelName: "m",
  promptVersion: "v",
  inputHash: "h",
}))
vi.mock("@/lib/ai-evaluation/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai-evaluation/service")>()),
  requestAiEvaluation: (...a: unknown[]) => modelo(...(a as [])),
}))

const chain = (result: unknown): Record<string, unknown> =>
  new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
      return () => chain(result)
    },
  }) as Record<string, unknown>
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => chain({ data: [], error: null }) }) }))

import { evaluateCandidateForCreate } from "@/server/actions/external"

const longa = "uma review longa o bastante para contar como útil aqui"
const curta = "curta"
const reviews = (uteis: number, curtas: number) => [
  ...Array.from({ length: uteis }, () => ({ source: "comix", sourceTitle: "Obra", matchScore: 1, text: longa })),
  ...Array.from({ length: curtas }, () => ({ source: "comix", sourceTitle: "Obra", matchScore: 1, text: curta })),
]
const comReviews = (r: unknown[]) => ({ sourcedReviews: r, allReviews: r, externalContext: [], platformRatings: [], similarWorks: [], contentRatings: [] })
const entrada = { title: "Obra", externalIds: { mangaupdates: "1" } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("criação — avaliar com poucas reviews pergunta antes de pagar", () => {
  it("🔴 1 útil de 3: pergunta, com a contagem, e NÃO chama o modelo", async () => {
    contexto.mockResolvedValue(comReviews(reviews(1, 2)))
    const r = await evaluateCandidateForCreate(entrada)
    expect(r).toMatchObject({ needsReviewConfirmation: true, fewReviews: { useful: 1, total: 3 } })
    expect(modelo).not.toHaveBeenCalled()
  })

  it("4 úteis: segue para a avaliação", async () => {
    contexto.mockResolvedValue(comReviews(reviews(4, 0)))
    const r = await evaluateCandidateForCreate(entrada)
    expect("needsReviewConfirmation" in r).toBe(false)
    expect(modelo).toHaveBeenCalledTimes(1)
  })

  it("'Avaliar mesmo assim' (proceedWithoutReviews) segue com poucas", async () => {
    contexto.mockResolvedValue(comReviews(reviews(1, 2)))
    await evaluateCandidateForCreate({ ...entrada, proceedWithoutReviews: true })
    expect(modelo).toHaveBeenCalledTimes(1)
  })

  it("nenhuma review: a pergunta de antes, sem contagem", async () => {
    contexto.mockResolvedValue(comReviews([]))
    const r = await evaluateCandidateForCreate(entrada)
    expect(r).toMatchObject({ needsReviewConfirmation: true })
    expect((r as { fewReviews?: unknown }).fewReviews).toBeUndefined()
  })
})
