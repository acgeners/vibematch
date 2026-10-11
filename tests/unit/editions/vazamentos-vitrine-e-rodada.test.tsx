import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

/**
 * Dois vazamentos da versão R18 na versão NORMAL de obras `mixed` (fase 2), pelos caminhos que não
 * passavam pelo resolvedor de edição:
 *   1. a vitrine da home pública (`getSpotlightWork`) montava a nota por critério de `category_scores`
 *      — a nota MISTURADA (≥ 9 em 82 das 140) — e só pulava `is_adult`, que é falso em obra mixed;
 *   2. a rodada de recomendação (`getRecommendationRun`) recarregava as obras sem as flags de edição:
 *      tags da R18 (e adultas de edição desconhecida) e texto do ranker citando sexo explícito iam
 *      para os cards.
 * O banco é falso; a régua (`adultContentFor`, `tagsForEdition`, `mentionsExplicitSexualContent`) é a real.
 */
vi.mock("server-only", () => ({}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

/** Query builder falso: todo método encadeia; `await` e `maybeSingle` devolvem o dado da tabela. */
function fakeClient(porTabela: Record<string, unknown>) {
  return {
    from(t: string) {
      const data = porTabela[t] ?? []
      const chain: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_alvo, p) {
            if (p === "then") return (ok: (v: unknown) => void) => ok({ data, error: null })
            if (p === "maybeSingle") return async () => ({ data, error: null })
            return () => chain
          },
        },
      )
      return chain
    },
  }
}

const settings = { hideAdult: false, preference: null as "normal" | "r18" | null }
let banco: Record<string, unknown> = {}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeClient(banco) }))
vi.mock("@/server/queries/current-user", () => ({
  getSessionUserId: async () => "u1",
  getCurrentUserId: async () => "u1",
  getHideAdultContent: async () => settings.hideAdult,
  getPreferredMixedEdition: async () => settings.preference,
}))
vi.mock("@/lib/calculations/attribute-bias", async (orig) => ({ ...(await orig<object>()), getBiasMap: async () => ({}) }))

const CRITERIOS = ["romance", "couple_dynamics", "fantasy", "setting_era", "action_adventure", "adult_content", "protagonist", "humor", "drama", "tragedy", "angst"]
const notas = (adulto: number) => CRITERIOS.map((s) => ({ criterion_slug: s, score: s === "adult_content" ? adulto : 6 }))
const linhaVitrine = (id: string, avg: number, adulto: number, edition_state: string | null) => ({
  platform_avg: avg,
  total_votes: 5000,
  works: {
    id, title: id, is_adult: false, edition_state, publication_status_id: 1, total_chapters: 50,
    work_covers: [{ url: `https://x/${id}.jpg`, is_primary: true, position: 0 }],
    category_scores: notas(adulto),
  },
})
const ed = (work_id: string, edition: string, score: number | null, source: string) => ({
  work_id, edition, criterion_slug: "adult_content", score, source,
  status: source === "not_rated" ? "not_rated" : source === "inferred_base" ? "provisional" : "rated", confidence: null,
})

describe("vitrine pública — a obra mixed mostra a nota DA EDIÇÃO de quem olha (visitante ⇒ normal)", () => {
  beforeEach(() => { vi.resetModules(); settings.hideAdult = false; settings.preference = null })

  it("mixed no topo com nota AVALIADA da normal: aparece com ela — nunca o 9,5 misturado", async () => {
    banco = {
      calculated_scores: [linhaVitrine("mixed", 8.9, 9.5, "mixed"), linhaVitrine("single", 8.5, 2, null)],
      work_edition_scores: [ed("mixed", "normal", 6, "reused_existing"), ed("mixed", "r18", 9.5, "reused_existing")],
    }
    const { getSpotlightWork } = await import("@/server/queries/public-showcase")
    const w = await getSpotlightWork()
    expect(w?.id).toBe("mixed")
    expect(w?.scores.find((s) => s.slug === "adult_content")?.score).toBe(6)
  })

  it("mixed cuja normal só tem o baseline 5,0 (não é leitura) fica de fora — a vitrine diz 'leitura da IA'", async () => {
    banco = {
      calculated_scores: [linhaVitrine("mixed", 8.9, 9.5, "mixed"), linhaVitrine("single", 8.5, 2, null)],
      work_edition_scores: [ed("mixed", "normal", 5, "inferred_base"), ed("mixed", "r18", 9.5, "reused_existing")],
    }
    const { getSpotlightWork } = await import("@/server/queries/public-showcase")
    expect((await getSpotlightWork())?.id).toBe("single")
  })

  it("mixed SEM nota na normal: não tem os critérios completos e não é escolhida (nada de fallback para a R18)", async () => {
    banco = {
      calculated_scores: [linhaVitrine("mixed", 8.9, 9.5, "mixed"), linhaVitrine("single", 8.5, 2, null)],
      work_edition_scores: [ed("mixed", "normal", null, "not_rated"), ed("mixed", "r18", 9.5, "reused_existing")],
    }
    const { getSpotlightWork } = await import("@/server/queries/public-showcase")
    const w = await getSpotlightWork()
    expect(w?.id).toBe("single")
    expect(w?.scores.find((s) => s.slug === "adult_content")?.score).toBe(2)
  })

  it("obra NÃO-mixed segue a nota de sempre", async () => {
    banco = { calculated_scores: [linhaVitrine("single", 8.5, 7.5, "single")], work_edition_scores: [] }
    const { getSpotlightWork } = await import("@/server/queries/public-showcase")
    expect((await getSpotlightWork())?.scores.find((s) => s.slug === "adult_content")?.score).toBe(7.5)
  })
})

describe("rodada de recomendação — cards da versão normal", () => {
  beforeEach(() => { vi.resetModules(); settings.hideAdult = false; settings.preference = null })

  const tag = (id: string, name: string) => ({ tag_id: id, tags: { name, tag_group_id: null } })
  const obra = (id: string, edition_state: string | null) => ({
    id, title: id, is_adult: false, edition_state, canonical_synopsis: "s", review_summary: null,
    user_work_state: [], category_scores: notas(9), calculated_scores: null, work_synopses: [], work_covers: [],
    work_tags: [tag("t-r19", "R19"), tag("t-adult", "Adult"), tag("t-cunni", "Cunnilingus"), tag("t-disp", "R19 disponível"), tag("t-rom", "Romance")],
  })
  const FLAGS = [
    { id: "t-r19", adult_indicator: true, adult_indicator_strong: true, adult_score_tier: "label", marks_r19_edition: false },
    { id: "t-adult", adult_indicator: true, adult_indicator_strong: false, adult_score_tier: "label", marks_r19_edition: false },
    { id: "t-cunni", adult_indicator: true, adult_indicator_strong: true, adult_score_tier: "explicit", marks_r19_edition: false },
    { id: "t-disp", adult_indicator: false, adult_indicator_strong: false, adult_score_tier: null, marks_r19_edition: true },
    { id: "t-rom", adult_indicator: false, adult_indicator_strong: false, adult_score_tier: null, marks_r19_edition: false },
  ]
  const run = {
    id: "r1", slug: "r1", mode: "free", user_id: "u1", created_at: "2026-10-01",
    results: [
      { work_id: "mixed", alignment_score: 90, justification: "Combina romance com conteúdo sexual explícito recorrente.", top_match_factors: ["Romance amado", "smut frequente"], risks: ["cenas de sexo explícitas"] },
      { work_id: "single", alignment_score: 80, justification: "Obra com conteúdo sexual explícito.", top_match_factors: [], risks: [] },
    ],
  }
  const montar = () => {
    banco = { recommendation_runs: run, works: [obra("mixed", "mixed"), obra("single", "single")], tags: FLAGS }
  }

  it("na NORMAL a mixed perde as tags da R18 e as de edição desconhecida; ficam 'R19 disponível' e as sem sinal", async () => {
    montar()
    const { getRecommendationRun } = await import("@/server/queries/recommendations")
    const r = await getRecommendationRun("r1")
    const mixed = r!.ranked.find((x) => x.work_id === "mixed")!
    expect(mixed.work!.tags.map((t) => t.name).sort()).toEqual(["R19 disponível", "Romance"])
    expect(mixed.justificationHiddenForEdition).toBe(true)
    expect(mixed.justification).toBe("")
    expect(mixed.top_match_factors).toEqual(["Romance amado"])
    expect(mixed.risks).toEqual([])
  })

  it("obra NÃO-mixed não muda (tags e textos intactos)", async () => {
    montar()
    const { getRecommendationRun } = await import("@/server/queries/recommendations")
    const single = (await getRecommendationRun("r1"))!.ranked.find((x) => x.work_id === "single")!
    expect(single.work!.tags).toHaveLength(5)
    expect(single.justificationHiddenForEdition).toBe(false)
    expect(single.justification).toMatch(/explícito/)
  })

  it("quem prefere a R18 vê a mixed inteira (a versão R18 é inclusiva)", async () => {
    settings.preference = "r18"
    montar()
    const { getRecommendationRun } = await import("@/server/queries/recommendations")
    const mixed = (await getRecommendationRun("r1"))!.ranked.find((x) => x.work_id === "mixed")!
    expect(mixed.work!.tags).toHaveLength(5)
    expect(mixed.justificationHiddenForEdition).toBe(false)
  })

  it("ocultar 18+ força a normal mesmo com preferência R18", async () => {
    settings.preference = "r18"
    settings.hideAdult = true
    montar()
    const { getRecommendationRun } = await import("@/server/queries/recommendations")
    const mixed = (await getRecommendationRun("r1"))!.ranked.find((x) => x.work_id === "mixed")!
    expect(mixed.work!.tags.map((t) => t.name)).not.toContain("Cunnilingus")
    expect(mixed.justificationHiddenForEdition).toBe(true)
  })
})

describe("card da rodada — diz que a justificativa saiu, em vez de mostrá-la", () => {
  afterEach(cleanup)
  const ranked = (hidden: boolean) => ({
    work_id: "m", alignment_score: 90, justification: hidden ? "" : "Texto do ranker.", top_match_factors: [], risks: [],
    justificationHiddenForEdition: hidden, coverUrls: [],
    work: { id: "m", title: "Obra", isAdult: false, tags: [{ name: "Romance", group: null }] } as never,
  })
  it("com a justificativa oculta, o card mostra o aviso da edição", async () => {
    const { RankedWorkFeaturedCard, JUSTIFICATIVA_DA_R18 } = await import("@/components/titles/recommendations/ranked-work-featured-card")
    render(<RankedWorkFeaturedCard rank={2} ranked={ranked(true)} />)
    expect(screen.getByText(JUSTIFICATIVA_DA_R18)).toBeTruthy()
  })
  it("sem ocultação, o card mostra a justificativa", async () => {
    const { RankedWorkFeaturedCard } = await import("@/components/titles/recommendations/ranked-work-featured-card")
    render(<RankedWorkFeaturedCard rank={2} ranked={ranked(false)} />)
    expect(screen.getByText("Texto do ranker.")).toBeTruthy()
  })
})
