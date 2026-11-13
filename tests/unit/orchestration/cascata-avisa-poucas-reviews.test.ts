/**
 * "Gerar tudo" com poucas reviews úteis. A cascata avalia os 9 atributos E ACEITA as notas sem
 * revisão, e Interesse/Veredito/embedding saem em cima delas. Medido em 2026-11-12: abaixo de 4
 * reviews úteis a avaliação muda ~2,5× mais quando a obra ganha reviews. A fase grátis passa a
 * dizer isso na confirmação de custo — a mesma régua da criação (`eval-evidence.ts`).
 *
 * Comportamental: a fase grátis é INVOCADA e o retorno, conferido.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: vi.fn(async () => {}), recalculateScoresNow: vi.fn() }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: vi.fn(async () => ({ ok: true })) }))

// Qualquer leitura devolve "a obra tem hid da Comix"; o update do estado da cascata é no-op.
const chain = (): Record<string, unknown> =>
  new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") {
        return (res: (v: unknown) => void) =>
          Promise.resolve({ data: [{ external_id: "hid", is_rejected: false }], error: null }).then(res)
      }
      if (prop === "maybeSingle") return async () => ({ data: { external_id: "hid", is_rejected: false }, error: null })
      return () => chain()
    },
  }) as Record<string, unknown>
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => chain() }) }))

vi.mock("@/server/comix/resolver", () => ({
  ensureComixReady: vi.fn(async () => ({ ok: true })),
  resolveComixDataResilient: vi.fn(async () => {}),
}))
vi.mock("@/lib/external/comick-health", () => ({ ensureComicKReady: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/external/acquire-reviews", () => ({ acquireAndPersistWorkReviews: vi.fn(async () => {}) }))

let total = 0
let useful = 0
vi.mock("@/server/queries/work-reviews", () => ({ countWorkReviews: vi.fn(async () => total) }))
vi.mock("@/server/queries/work-card-meta", () => ({
  getWorkTagReviewCounts: vi.fn(async (ids: string[]) => new Map([[ids[0], { tagCount: 0, reviewCount: useful }]])),
}))

const { generateAllWorkData } = await import("@/server/actions/generate-all")

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Gerar tudo — a confirmação avisa quando há poucas reviews úteis", () => {
  it("🔴 1 útil de 3: a confirmação traz a contagem", async () => {
    total = 3
    useful = 1
    const r = await generateAllWorkData("obra-1")
    expect(r).toMatchObject({ status: "needs_authorization", reason: "cost", fewReviews: { useful: 1, total: 3 } })
  })

  it("4 úteis: a confirmação de custo de sempre, sem aviso", async () => {
    total = 6
    useful = 4
    const r = await generateAllWorkData("obra-1")
    expect(r).toMatchObject({ status: "needs_authorization", reason: "cost" })
    expect((r as { fewReviews?: unknown }).fewReviews).toBeUndefined()
  })

  it("nenhuma review: segue o aviso de antes (sem reviews), não o de poucas", async () => {
    total = 0
    useful = 0
    const r = await generateAllWorkData("obra-1")
    expect(r).toMatchObject({ status: "needs_authorization", reason: "no_reviews" })
    expect((r as { fewReviews?: unknown }).fewReviews).toBeUndefined()
  })
})
