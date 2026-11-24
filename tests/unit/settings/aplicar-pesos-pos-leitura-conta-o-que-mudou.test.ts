import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * O "Aplicar" dos pesos pós-leitura diz "N notas recalculadas". Em 24/11/2026, na 1ª aplicação real
 * depois do #647, ele disse **161** quando só **2** notas mudaram: as outras eram obras com as 7
 * categorias de gosto completas, em que a nota delas vence (o escritor descarta a destes pesos), e a
 * action contava todas as que ela PEDIU para gravar.
 *
 * E leu 1000 das 1.085 obras: o `.limit(2000)` não passa do corte do PostgREST.
 */
vi.mock("server-only", () => ({}))

const h = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  ganhasPelasCategorias: new Set<string>(),
  gravadas: [] as Array<{ id: string; score: unknown }>,
  paginou: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/supabase/paginate", () => ({
  fetchAllRows: async (_build: unknown, opts: { orderBy: unknown }) => {
    h.paginou(opts.orderBy)
    return h.linhas
  },
}))
vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => ({ ok: true }),
  getOwnerUserId: async () => "dona",
}))
vi.mock("@/server/queries/user-work-state", () => ({
  mirrorOwnerState: async (_owner: string, ids: string[], patch: { user_score: unknown }) => {
    h.gravadas.push({ id: ids[0], score: patch.user_score })
    const ganhas = ids.filter((id) => h.ganhasPelasCategorias.has(id))
    return ganhas.length > 0 ? { error: null, categoriesWon: ganhas } : { error: null }
  },
}))
vi.mock("@/server/recalc/queue", () => ({
  recalculateScoresNowResult: async () => ({ recalculated: 1085 }),
}))

const PESOS = {
  post_story_score: 1,
  post_fl_score: 1,
  post_ml_score: 1,
  post_character_development_score: 1,
  post_pacing_score: 1,
  post_art_visual_score: 1,
  post_impact_immersion_score: 1,
  post_originality_score: 1,
}
const obra = (id: string, user_score: number, nota: number) => ({
  id,
  user_score,
  post_story_score: nota,
  post_fl_score: nota,
  post_ml_score: nota,
  post_character_development_score: nota,
  post_pacing_score: nota,
  post_art_visual_score: nota,
  post_impact_immersion_score: nota,
  post_originality_score: nota,
})

beforeEach(() => {
  h.linhas = []
  h.ganhasPelasCategorias = new Set()
  h.gravadas = []
  h.paginou.mockClear()
})

describe("aplicar pesos pós-leitura", () => {
  it("conta só as notas que os pesos mudaram — não as que as categorias de gosto decidiram", async () => {
    // a: sem categorias, nota muda 6 → 8. b e c: categorias completas (9,4), a média dos pesos daria 8.
    h.linhas = [obra("a", 6, 8), obra("b", 9.4, 8), obra("c", 9.4, 8), obra("d", 8, 8)]
    h.ganhasPelasCategorias = new Set(["b", "c"])
    const { applyPostReadingWeights } = await import("@/server/actions/post-reading-weight-suggestions")
    const res = await applyPostReadingWeights(PESOS)
    expect(h.gravadas.map((g) => g.id)).toEqual(["a", "b", "c"]) // d já está em 8: nada a pedir
    expect(res.updatedManualScores).toBe(1)
  })

  it("lê o catálogo PAGINADO, com ordem total", async () => {
    const { applyPostReadingWeights, suggestPostReadingWeights } = await import(
      "@/server/actions/post-reading-weight-suggestions"
    )
    await applyPostReadingWeights(PESOS)
    await suggestPostReadingWeights(PESOS)
    expect(h.paginou).toHaveBeenCalledTimes(2)
    expect(h.paginou).toHaveBeenNthCalledWith(1, ["id"])
    expect(h.paginou).toHaveBeenNthCalledWith(2, ["id"])
  })
})
