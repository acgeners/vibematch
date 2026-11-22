import { describe, it, expect } from "vitest"
import { computeTasteUserScore, TASTE_LABEL_KEYS, TASTE_SCORE_KEYS } from "@/server/queries/pilot-taste"
import type { TasteScoreKey } from "@/server/queries/pilot-taste"
import { effectiveRating, formatRating, labelCriteria, tasteLabelState } from "@/lib/ratings/effective-rating"
import { ratingPatchFrom } from "@/lib/ratings/status-form-patch"
import type { WorkStatusValues } from "@/lib/validations/work.schema"

/** Os critérios como `getTasteCriteria` os devolve: o "Final" é o único com `allowsNa`. */
const criteria = TASTE_SCORE_KEYS.map((key) => ({ key, allowsNa: key === "like_ending_score", isOverall: false }))

const all = (value: number) =>
  Object.fromEntries(TASTE_SCORE_KEYS.map((k) => [k, value])) as Record<TasteScoreKey, number | null>

describe("qual nota vale (a régua da tela, a mesma do servidor)", () => {
  it("as categorias da conta são as mesmas de TASTE_LABEL_KEYS (o Final fica fora)", () => {
    expect(labelCriteria(criteria).sort()).toEqual([...TASTE_LABEL_KEYS].sort())
  })

  it("com as 7, a média da tela é a mesma de computeTasteUserScore", () => {
    const scores = { ...all(8), like_female_lead_score: 10, like_pacing_score: 6.5, like_ending_score: 2 }
    const state = tasteLabelState(criteria, scores)
    expect(state.complete).toBe(true)
    expect(state.average).toBe(computeTasteUserScore(scores))
  })

  it("faltando uma, é prévia: não completa e o servidor não grava", () => {
    const scores = { ...all(8), like_art_score: null }
    const state = tasteLabelState(criteria, scores)
    expect(state).toMatchObject({ filled: 6, needed: 7, complete: false })
    expect(computeTasteUserScore(scores)).toBeNull()
  })

  it("as 7 completas vencem a nota direta, e a direta fica desligada", () => {
    const taste = tasteLabelState(criteria, all(10))
    expect(effectiveRating({ taste, legacyPresent: false, score: 7 })).toEqual({
      value: 10,
      source: "categories",
      directAllowed: false,
    })
  })

  it("a avaliação antiga por critérios também vence a direta", () => {
    const taste = tasteLabelState(criteria, {})
    expect(effectiveRating({ taste, legacyPresent: true, score: 8.6 })).toEqual({
      value: 8.6,
      source: "legacy",
      directAllowed: false,
    })
  })

  it("sem as duas, vale a direta (e sem nota nenhuma, não há fonte)", () => {
    const partial = tasteLabelState(criteria, { like_art_score: 10 })
    expect(effectiveRating({ taste: partial, legacyPresent: false, score: 7 })).toEqual({
      value: 7,
      source: "direct",
      directAllowed: true,
    })
    expect(effectiveRating({ taste: partial, legacyPresent: false, score: null }).source).toBeNull()
  })

  it("formata inteiro sem casa e decimal com vírgula", () => {
    expect(formatRating(7)).toBe("7")
    expect(formatRating(9.4)).toBe("9,4")
  })
})

describe("o 'Salvar' do formulário de status não apaga uma nota dada depois", () => {
  const base = {
    post_story_score: null,
    post_fl_score: null,
    post_ml_score: null,
    post_character_development_score: null,
    post_pacing_score: null,
    post_art_visual_score: null,
    post_impact_immersion_score: null,
    post_originality_score: null,
  }

  it("sem as notas craft, a nota pessoal fica FORA do patch (o upsert parcial a preserva)", () => {
    const patch = ratingPatchFrom({ ...base, user_score: null } as unknown as WorkStatusValues)
    expect("user_score" in patch).toBe(false)
  })

  it("com notas craft, a nota que o formulário calcula delas vai junto", () => {
    const patch = ratingPatchFrom({ ...base, post_story_score: 8, user_score: 8.2 } as unknown as WorkStatusValues)
    expect(patch.user_score).toBe(8.2)
    expect(patch.post_story_score).toBe(8)
  })
})
