import { describe, it, expect } from "vitest"
import { buildWork, computeRecalc, recalcDefaultEdition, type RawWork, type RecalcEditionContext } from "@/server/actions/calculations"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import { groupEditionRows, type EditionScoreRow, type MixedEdition } from "@/lib/editions/mixed-edition"
import type { FormulaConfig, ScoreWeight } from "@/types/domain"

/**
 * TREINO pela versão LIDA (mig 216, decisão de 2026-10-12): o rótulo de uma obra mixed treina com o
 * `adult_content` da versão registrada na avaliação (`user_work_state.read_edition`). Versão
 * desconhecida (`null`, o histórico) mantém a regra de antes — o legado de `category_scores`. Nunca
 * há cópia entre versões: a versão lida sem nota fica SEM o atributo no treino.
 *
 * E a PREVISÃO: a padrão de quem recebe a nota (oculta 18+ ⇒ normal; vê ⇒ R18; R18 só nos extras ⇒
 * normal), sem fallback para a outra versão.
 */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}

const MIXED = Array.from({ length: 10 }, (_, k) => `w${String(45 + k).padStart(3, "0")}`) // 45–49 rotuladas, 50–54 não
const LEGADO = 8

function catalogo(readEdition: (id: string) => string | null = () => null): RawWork[] {
  const r = rng(23)
  return Array.from({ length: 80 }, (_, i) => {
    const id = `w${String(i).padStart(3, "0")}`
    const notas = SCORING_CRITERION_SLUGS.map((slug) => ({
      criterion_slug: slug,
      score: slug === "adult_content" && MIXED.includes(id) ? LEGADO : Math.round(r() * 20) / 2,
      source: "ai_accepted",
    }))
    const media = notas.reduce((s, n) => s + n.score, 0) / notas.length
    const rating = 6 + r() * 3
    return {
      id,
      publication_status_id: null,
      total_chapters: 40 + Math.floor(r() * 120),
      synopsis_quality: ["♥", "♥♥", "♥♥♥", "♥♥♥♥"][i % 4],
      observation_adjustment: 0,
      user_score: i < 50 ? Math.min(10, Math.max(0, 0.5 * media + 0.4 * rating + (r() - 0.5))) : null,
      read_edition: readEdition(id),
      is_archived: false,
      year: 2015 + (i % 9),
      year_end: null,
      original_title: null,
      post_story_score: null, post_fl_score: null, post_ml_score: null, post_character_development_score: null,
      post_pacing_score: null, post_art_visual_score: null, post_impact_immersion_score: null, post_originality_score: null,
      category_scores: notas,
      platform_ratings: [{ id: `p${i}`, platform: "mal", rating, vote_count: 100 + Math.floor(r() * 5000) }],
      work_tags: [],
      edition_state: MIXED.includes(id) ? "mixed" : null,
    }
  })
}

const row = (work_id: string, edition: MixedEdition, score: number | null, source: EditionScoreRow["source"]): EditionScoreRow => ({
  work_id, edition, criterion_slug: "adult_content", score, source,
  status: source === "not_rated" ? "not_rated" : "rated",
  confidence: source === "not_rated" ? null : "alta",
})

/** normal 4 / R18 9,5 em 45–48 · w049: R18 SEM nota · w050: normal SEM nota. */
const LINHAS: EditionScoreRow[] = MIXED.flatMap((id) => [
  id === "w050" ? row(id, "normal", null, "not_rated") : row(id, "normal", 4, "ai_evaluated"),
  id === "w049" ? row(id, "r18", null, "not_rated") : row(id, "r18", 9.5, "ai_evaluated"),
])

const ctx = (hideAdult: boolean, extras: string[] = []): RecalcEditionContext => ({
  hideAdult, r18ExtrasWorkIds: new Set(extras), rowsByWork: groupEditionRows(LINHAS),
})
const montar = (readEdition: (id: string) => string | null, c: RecalcEditionContext | null = ctx(false)) =>
  new Map(catalogo(readEdition).map((raw) => [raw.id, buildWork(raw, {} as Parameters<typeof buildWork>[1], c ?? undefined)]))

describe("o rótulo treina com a versão LIDA", () => {
  it("R18 conhecida ⇒ o adult_content da R18 (vendo a normal ou a R18 por padrão)", () => {
    for (const hide of [false, true]) {
      const w = montar((id) => (id === "w045" ? "r18" : null), ctx(hide)).get("w045")!
      expect(w.trainingEdition).toBe("r18")
      expect(w.trainCategoryScores.adult_content).toBe(9.5)
    }
  })
  it("Normal conhecida ⇒ o adult_content da normal", () => {
    const w = montar((id) => (id === "w045" ? "normal" : null)).get("w045")!
    expect(w.trainingEdition).toBe("normal")
    expect(w.trainCategoryScores.adult_content).toBe(4)
    expect(w.trainCategoryScoresCalibrated.adult_content).toBe(4)
  })
  it("desconhecida (null, o histórico) ⇒ a regra de antes: o legado, a MESMA referência", () => {
    const w = montar(() => null).get("w045")!
    expect(w.trainingEdition).toBeNull()
    expect(w.trainCategoryScores).toBe(w.categoryScores)
    expect(w.trainCategoryScores.adult_content).toBe(LEGADO)
  })
  it("sem cópia entre versões: R18 lida sem nota fica SEM o atributo (não herda a normal nem o legado)", () => {
    const w = montar((id) => (id === "w049" ? "r18" : null)).get("w049")!
    expect(w.trainingEdition).toBe("r18")
    expect(w.trainCategoryScores).not.toHaveProperty("adult_content")
    expect(w.trainCategoryScoresCalibrated).not.toHaveProperty("adult_content")
    // As outras notas seguem iguais.
    expect(w.trainCategoryScores.romance).toBe(w.categoryScores.romance)
  })
  it("Normal lida sem nota também fica sem o atributo", () => {
    // w050 não é rotulada no catálogo base; damos um rótulo só a ela.
    const raws = catalogo((id) => (id === "w050" ? "normal" : null)).map((r) => (r.id === "w050" ? { ...r, user_score: 7 } : r))
    const w = buildWork(raws.find((r) => r.id === "w050")!, {} as Parameters<typeof buildWork>[1], ctx(false))
    expect(w.trainCategoryScores).not.toHaveProperty("adult_content")
  })
  it("versão sem rótulo não treina nada (sem user_score ⇒ sem versão de treino)", () => {
    const w = montar((id) => (id === "w052" ? "r18" : null)).get("w052")!
    expect(w.userScore).toBeNull()
    expect(w.trainingEdition).toBeNull()
  })
  it("obra que deixou de ser mixed ignora a versão guardada (legado)", () => {
    const w = montar((id) => (id === "w010" ? "r18" : null)).get("w010")!
    expect(w.trainingEdition).toBeNull()
    expect(w.trainCategoryScores).toBe(w.categoryScores)
  })
  it("sem contexto de edição (recálculo sem tabelas de edição) o treino é o de sempre", () => {
    const w = montar((id) => (id === "w045" ? "r18" : null), null).get("w045")!
    expect(w.trainingEdition).toBeNull()
    expect(w.trainCategoryScores).toBe(w.categoryScores)
  })
})

const pesos: ScoreWeight[] = SCORING_CRITERION_SLUGS.map((slug, i) => ({
  id: slug, slug, name: slug, weight: 10 + i, threshold: null, display_order: i, is_active: true,
}))
const config = { score_weights_auto: false, formula_version: "teste", gpt_mean: null, cv_mae_expected_stage1: null, expected_ridge_coefficients: null } as unknown as FormulaConfig
const rodar = (readEdition: (id: string) => string | null, c: RecalcEditionContext = ctx(false)) => {
  const works = catalogo(readEdition).map((raw) => buildWork(raw, {} as Parameters<typeof buildWork>[1], c))
  const res = computeRecalc({ works, weights: pesos, config, tasteProfile: null, declaredTagPrefs: [], includeQuality: false, aiQualityByWork: new Map(), fast: true })
  return new Map(res.rows.map((r) => [r.work_id, r]))
}

describe("o modelo inteiro sente a versão lida", () => {
  it("rótulos mixed com versão conhecida movem o modelo (as notas de obras NÃO-mixed mudam)", () => {
    const sem = rodar(() => null)
    const com = rodar((id) => (["w045", "w046", "w047", "w048"].includes(id) ? "r18" : null))
    const naoMixed = [...sem.keys()].filter((id) => !MIXED.includes(id))
    expect(naoMixed.some((id) => sem.get(id)!.expected_score !== com.get(id)!.expected_score)).toBe(true)
  })
  it("tudo desconhecido ⇒ o mesmo modelo de antes da 216 (nenhuma nota muda)", () => {
    const a = rodar(() => null)
    const b = rodar(() => null)
    for (const [id, r] of a) expect(b.get(id)!.expected_score).toBe(r.expected_score)
  })
})

describe("Nota Prevista: a padrão de quem recebe, sem fallback", () => {
  it("vê 18+ ⇒ a R18; R18 not_rated ⇒ sem Nota Prevista nem Chance (não herda a normal)", () => {
    const r = rodar(() => null, ctx(false))
    expect(r.get("w049")!.expected_edition).toBe("r18")
    expect(r.get("w049")!.expected_score).toBeNull()
    expect(r.get("w049")!.chance_score).toBeNull()
    expect(r.get("w049")!.expected_by_edition!.normal.expected_score).not.toBeNull()
  })
  it("oculta 18+ ⇒ a normal", () => {
    const r = rodar(() => null, ctx(true))
    expect(r.get("w049")!.expected_edition).toBe("normal")
    expect(r.get("w049")!.expected_score).not.toBeNull()
  })
  it("R18 só nos extras ⇒ a normal mesmo vendo 18+", () => {
    expect(recalcDefaultEdition(ctx(false, ["w049"]), "w049")).toBe("normal")
    expect(recalcDefaultEdition(ctx(false, ["w049"]), "w045")).toBe("r18")
    const r = rodar(() => null, ctx(false, ["w049"]))
    expect(r.get("w049")!.expected_edition).toBe("normal")
    expect(r.get("w049")!.expected_score).not.toBeNull()
  })
})
