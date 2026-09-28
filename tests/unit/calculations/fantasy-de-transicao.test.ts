import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import {
  resolveTransitionalFantasy,
  applyTransitionalFantasy,
  FANTASY_LEGACY_SLUG,
  FANTASY_SCORING_SLOT,
} from "@/lib/calculations/fantasy-scoring-transition"
import { buildWork, type RawWork } from "@/server/actions/calculations"
import { SCORING_CRITERION_SLUGS, NON_SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * FANTASY DE TRANSIÇÃO — o slot `fantasy` do cálculo lê o legado `fantasy_nobility` quando ele
 * existe e o `fantasy` real só como fallback. Motivo e medição em
 * lib/calculations/fantasy-scoring-transition.ts.
 *
 * Os casos A–D são a regra; os seguintes provam o que ela NÃO pode fazer: tocar no dado
 * semântico da obra, aplicar ao legado o bias do construto novo, ou se espalhar pelo código.
 */

type Row = { criterion_slug: string; score: number | string | null; source: string }

function raw(rows: Row[]): RawWork {
  return {
    id: "w1",
    publication_status_id: null,
    total_chapters: null,
    synopsis_quality: null,
    observation_adjustment: 0,
    user_score: null,
    is_archived: false,
    year: null,
    year_end: null,
    original_title: null,
    post_story_score: null,
    post_fl_score: null,
    post_ml_score: null,
    post_character_development_score: null,
    post_pacing_score: null,
    post_art_visual_score: null,
    post_impact_immersion_score: null,
    post_originality_score: null,
    category_scores: rows,
    platform_ratings: [],
    work_tags: [],
  }
}

const SEM_BIAS = {} as Parameters<typeof buildWork>[1]

describe("a regra (função pura)", () => {
  it("A · real 3 e legado 8 ⇒ o cálculo usa 8", () => {
    expect(
      resolveTransitionalFantasy([
        { criterion_slug: "fantasy", score: 3 },
        { criterion_slug: "fantasy_nobility", score: 8 },
      ]),
    ).toEqual({ value: 8, source: "fantasy_nobility_legacy" })
  })

  it("B · sem legado, real 6 ⇒ o cálculo usa 6", () => {
    expect(resolveTransitionalFantasy([{ criterion_slug: "fantasy", score: 6 }])).toEqual({
      value: 6,
      source: "fantasy_real_fallback",
    })
  })

  it("C · só legado ⇒ o cálculo usa o legado", () => {
    expect(resolveTransitionalFantasy([{ criterion_slug: "fantasy_nobility", score: 7 }])).toEqual({
      value: 7,
      source: "fantasy_nobility_legacy",
    })
  })

  it("D · nenhum dos dois ⇒ AUSENTE, sem default", () => {
    expect(resolveTransitionalFantasy([{ criterion_slug: "romance", score: 5 }])).toEqual({ value: null, source: "absent" })
    // legado com nota NULA não conta como legado — cai no real, e sem real fica ausente
    expect(resolveTransitionalFantasy([{ criterion_slug: "fantasy_nobility", score: null }])).toEqual({ value: null, source: "absent" })
    expect(
      resolveTransitionalFantasy([
        { criterion_slug: "fantasy_nobility", score: null },
        { criterion_slug: "fantasy", score: 4 },
      ]),
    ).toEqual({ value: 4, source: "fantasy_real_fallback" })
  })

  it("numeric do PostgREST chega como string — e continua número", () => {
    expect(resolveTransitionalFantasy([{ criterion_slug: "fantasy_nobility", score: "8.5" }])).toEqual({
      value: 8.5,
      source: "fantasy_nobility_legacy",
    })
  })

  it("aplicar a escolha 'absent' ou 'fallback' não mexe nos mapas", () => {
    const maps = { raw: { fantasy: 6 }, calibrated: { fantasy: 5.5 } }
    applyTransitionalFantasy(maps, { value: 6, source: "fantasy_real_fallback" })
    applyTransitionalFantasy(maps, { value: null, source: "absent" })
    expect(maps).toEqual({ raw: { fantasy: 6 }, calibrated: { fantasy: 5.5 } })
  })
})

describe("no buildWork — os mapas que o cálculo lê", () => {
  it("A · o slot fantasy dos DOIS mapas recebe o legado, e o diagnóstico diz de onde veio", () => {
    const w = buildWork(
      raw([
        { criterion_slug: "fantasy", score: 3, source: "ai_accepted" },
        { criterion_slug: "fantasy_nobility", score: 8, source: "ai_accepted" },
      ]),
      SEM_BIAS,
    )
    expect(w.categoryScores.fantasy).toBe(8)
    expect(w.categoryScoresCalibrated.fantasy).toBe(8)
    expect(w.fantasyScoringSource).toBe("fantasy_nobility_legacy")
  })

  it("B · sem legado, o slot fica com o fantasy real", () => {
    const w = buildWork(raw([{ criterion_slug: "fantasy", score: 6, source: "ai_accepted" }]), SEM_BIAS)
    expect(w.categoryScores.fantasy).toBe(6)
    expect(w.categoryScoresCalibrated.fantasy).toBe(6)
    expect(w.fantasyScoringSource).toBe("fantasy_real_fallback")
  })

  it("C · só legado ⇒ o slot existe com o legado (a guarda de completude o enxerga)", () => {
    const w = buildWork(raw([{ criterion_slug: "fantasy_nobility", score: 7, source: "ai_accepted" }]), SEM_BIAS)
    expect(w.categoryScores.fantasy).toBe(7)
    expect(w.categoryScoresCalibrated.fantasy).toBe(7)
  })

  it("D · nenhum dos dois ⇒ o slot NÃO existe em nenhum mapa (a guarda segue vendo ausência)", () => {
    const w = buildWork(raw([{ criterion_slug: "romance", score: 5, source: "ai_accepted" }]), SEM_BIAS)
    expect("fantasy" in w.categoryScores).toBe(false)
    expect("fantasy" in w.categoryScoresCalibrated).toBe(false)
    expect(w.fantasyScoringSource).toBe("absent")
  })

  it("o legado entra CRU; o bias de fantasy (aprendido no construto novo) só vale no fallback real", () => {
    const bias = { fantasy: 0.5 } as unknown as Parameters<typeof buildWork>[1]
    const comLegado = buildWork(
      raw([
        { criterion_slug: "fantasy", score: 3, source: "ai_accepted" },
        { criterion_slug: "fantasy_nobility", score: 8, source: "ai_accepted" },
      ]),
      bias,
    )
    expect(comLegado.categoryScoresCalibrated.fantasy).toBe(8)
    const soReal = buildWork(raw([{ criterion_slug: "fantasy", score: 6, source: "ai_accepted" }]), bias)
    expect(soReal.categoryScoresCalibrated.fantasy).toBe(5.5)
  })

  it("F · as linhas de category_scores NÃO são tocadas — o fantasy real segue 3, com a origem dele", () => {
    const linhas: Row[] = [
      { criterion_slug: "fantasy", score: 3, source: "ai_accepted" },
      { criterion_slug: "fantasy_nobility", score: 8, source: "ai_accepted" },
    ]
    const antes = JSON.stringify(linhas)
    buildWork(raw(linhas), SEM_BIAS)
    expect(JSON.stringify(linhas)).toBe(antes)
  })
})

describe("contratos que a transição NÃO pode mover", () => {
  it("E · o producer segue nos 11, com fantasy e SEM fantasy_nobility", () => {
    expect(CRITERION_SLUGS).toHaveLength(11)
    expect(CRITERION_SLUGS).toContain("fantasy")
    expect(CRITERION_SLUGS as readonly string[]).not.toContain(FANTASY_LEGACY_SLUG)
  })

  it("G · setting_era e angst continuam fora do cálculo", () => {
    expect(NON_SCORING_CRITERION_SLUGS).toEqual(expect.arrayContaining(["setting_era", "angst"]))
    expect(SCORING_CRITERION_SLUGS as readonly string[]).not.toContain("setting_era")
    expect(SCORING_CRITERION_SLUGS as readonly string[]).not.toContain("angst")
  })

  it("H · o vetor segue com 9 slots, e o slot da transição é o `fantasy` (o slug não muda)", () => {
    expect(SCORING_CRITERION_SLUGS).toHaveLength(9)
    expect(SCORING_CRITERION_SLUGS).toContain(FANTASY_SCORING_SLOT)
    expect(SCORING_CRITERION_SLUGS as readonly string[]).not.toContain(FANTASY_LEGACY_SLUG)
  })
})

describe("arquitetura: a regra mora num lugar só", () => {
  const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("buildWork aplica a transição DEPOIS de montar o mapa calibrado", () => {
    const src = semComentarios(readFileSync("server/actions/calculations.ts", "utf8"))
    const corpo = src.slice(src.indexOf("export function buildWork"))
    const calibrado = corpo.indexOf("applyBiasToCategoryScores(")
    const transicao = corpo.indexOf("applyTransitionalFantasy(")
    expect(calibrado).toBeGreaterThan(-1)
    expect(transicao).toBeGreaterThan(calibrado)
  })

  it("nenhum outro arquivo de cálculo lê o slug legado (a escolha não se espalha em ternários)", () => {
    const arquivos = execSync("git ls-files lib/calculations server/actions/calculations.ts server/recalc", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("fantasy-scoring-transition.ts"))
    const leem = arquivos.filter((f) => /["'`]fantasy_nobility["'`]/.test(semComentarios(readFileSync(f, "utf8"))))
    expect(leem).toEqual([])
    expect(arquivos.length).toBeGreaterThan(5) // a varredura enxerga arquivos de verdade
  })

  it("o módulo da transição é puro: não importa cliente de banco nem grava nada", () => {
    const src = readFileSync("lib/calculations/fantasy-scoring-transition.ts", "utf8")
    expect(src).not.toMatch(/supabase|createAdminClient|\.upsert\(|\.insert\(|\.update\(/)
  })
})
