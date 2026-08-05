/**
 * UNIDADE dos limiares dos 9 atributos no /ranking: PONTOS (0–10) ou σ
 * (desvios-padrão contra a média daquele atributo no catálogo).
 *
 * Existe porque um limiar em pontos NÃO quer dizer a mesma coisa em dois
 * atributos com distribuições diferentes. Medido em 2026-08-05 sobre 973 obras:
 *
 *   romance   média 7,43  σ 1,16   → "≥ 7" devolve 536 obras (55% do catálogo)
 *   humor     média 4,70  σ 1,97   → "≥ 7" devolve  34 obras (3,5%)
 *
 * O mesmo "7" é "praticamente todo mundo" num caso e "a cauda" no outro — é
 * essa armadilha que faz os mood presets Romance e Denso pegarem metade do
 * acervo enquanto Comédia pega 3,5% (ver lib/constants/mood-presets.ts).
 *
 * Em σ, "≥ +1" quer dizer a mesma coisa nos nove: acima do normal DAQUELE
 * atributo. A tradução pra pontos acontece em app/ranking/page.tsx — a query
 * (`getRanking`) só conhece pontos.
 */
export type CriterionUnit = "points" | "sd"

/** slug → média e desvio-padrão do atributo no catálogo. */
export type CriterionMoments = Record<string, { mean: number; sd: number }>

export const SD_MIN = -2.5
export const SD_MAX = 3
export const SD_STEP = 0.25
export const SD_PRESETS = [0.5, 1, 1.5, 2]

export function fmtSigma(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(parseFloat(v.toFixed(2)))}σ`
}

export function readCriterionUnit(searchParams: Pick<URLSearchParams, "get">): CriterionUnit {
  return searchParams.get("crit_unit") === "sd" ? "sd" : "points"
}

/** σ → pontos: `mean + z × sd`, limitado à escala 0–10. `null` se σ = 0. */
export function sigmaToScore(z: number, m: { mean: number; sd: number } | undefined): number | null {
  if (!m || !(m.sd > 0)) return null
  return Math.min(10, Math.max(0, m.mean + z * m.sd))
}

/** pontos → σ. `null` quando o atributo é constante no catálogo (σ = 0). */
export function scoreToSigma(score: number, m: { mean: number; sd: number } | undefined): number | null {
  if (!m || !(m.sd > 0)) return null
  return (score - m.mean) / m.sd
}

/** Passo REAL da escala de notas: as avaliações saem em meios-pontos. */
export const SCORE_GRID = 0.5

/**
 * Encaixa um limiar convertido de σ na grade de 0,5 em que as notas realmente
 * existem — piso no mínimo, teto no máximo.
 *
 * 🔴 Sem isto o limiar fica fracionário e o controle MENTE. Medido: o preset
 * `≥ +0,5σ` em romance dá 8,01 pontos; o pill em Pontos renderiza sem casas
 * decimais e mostra "≥ 8", mas o filtro aplicado exclui as **421 obras que têm
 * romance exatamente 8,0**. Um limiar entre dois valores possíveis não recorta
 * nada a mais que o valor abaixo dele — só desalinha o que a tela promete do
 * que a query faz.
 *
 * Direcional pelo mesmo motivo de sempre: arredondar pode ALARGAR o recorte,
 * nunca apertá-lo em silêncio.
 */
export function snapToScoreGrid(points: number, bound: "min" | "max"): number {
  const snapped =
    bound === "min"
      ? Math.floor(points / SCORE_GRID) * SCORE_GRID
      : Math.ceil(points / SCORE_GRID) * SCORE_GRID
  return Math.min(10, Math.max(0, parseFloat(snapped.toFixed(2))))
}

export interface MoodThresholds {
  criterionMin?: Partial<Record<string, number>>
  criterionMax?: Partial<Record<string, number>>
  criterionMinSd?: Partial<Record<string, number>>
  criterionMaxSd?: Partial<Record<string, number>>
}

/**
 * Limiares EFETIVOS de um mood preset, em pontos: σ quando dá pra converter,
 * pontos quando não dá.
 *
 * O fallback é POR ATRIBUTO, não por preset. Se "Denso" define drama e
 * protagonista em σ e só drama tiver momentos, aplicar σ no drama e descartar o
 * protagonista alargaria o preset em silêncio — some um dos dois limiares e o
 * botão passa a devolver mais obras do que promete. Cada atributo cai no seu
 * próprio valor em pontos.
 *
 * ⚠️ `0` é limiar VÁLIDO em σ (= a média do catálogo; é o `couple_dynamics` do
 * preset Romance). Toda checagem aqui é `!= null`, nunca truthiness — um
 * `if (z)` engoliria exatamente esse caso e afrouxaria o preset sem erro.
 */
export function resolveMoodThresholds(
  preset: MoodThresholds,
  moments: CriterionMoments | null | undefined,
): { min: Partial<Record<string, number>>; max: Partial<Record<string, number>> } {
  const resolve = (
    sd: Partial<Record<string, number>> | undefined,
    points: Partial<Record<string, number>> | undefined,
  ) => {
    const out: Partial<Record<string, number>> = {}
    for (const [slug, value] of Object.entries(points ?? {})) {
      if (value != null) out[slug] = value
    }
    for (const [slug, z] of Object.entries(sd ?? {})) {
      if (z == null) continue
      const converted = sigmaToScore(z, moments?.[slug])
      if (converted != null) out[slug] = converted
      // Sem momentos pro slug, o valor em pontos que já veio acima permanece.
    }
    return out
  }
  return {
    min: resolve(preset.criterionMinSd, preset.criterionMin),
    max: resolve(preset.criterionMaxSd, preset.criterionMax),
  }
}
