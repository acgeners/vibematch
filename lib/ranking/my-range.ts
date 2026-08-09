/**
 * "Dentro do meu range" — traduz as FAIXAS IDEAIS do perfil de gosto
 * (`taste_profile.profile.criterion_preferences`) nos limiares por atributo que
 * a query string do /ranking já carrega (`min_<slug>` / `max_<slug>`, em pontos).
 *
 * Por que preencher a URL em vez de criar um parâmetro próprio: a MESMA query
 * string é lida por `getRanking`, pelos presets salvos (`ranking_filter_presets`
 * guarda a query CRUA), pelo /favorites e pelo `parseFiltersFromSearchParams` do
 * diálogo de recomendação. Um `?my_range=1` seria ignorado em silêncio por todos
 * eles — a lista mostraria 180 obras e a recomendação sairia de 423, sem erro.
 * Preenchendo os limiares, todo mundo continua entendendo sem saber que este
 * controle existe. De brinde: depois de aplicar, os nove pills mostram os
 * valores e dá pra afrouxar UM (o Casal sozinho corta 54% do catálogo).
 *
 * A FOLGA (±1) não é número escolhido a esmo: é a mesma distância que
 * `pickCriterionTierByRange` usa pra pintar a célula de amarelo. Então
 * "com folga" = "nenhum atributo pior que amarelo" — filtro e cor dizem a mesma
 * coisa. Medido em 2026-08-08 (423 obras passando pelos filtros padrão da
 * página): exata → 34, ±1 → 180. E no top 40 que a página de fato mostra:
 * exata troca 26 obras, ±1 troca 6, ±2,5 troca ZERO — por isso são só dois
 * degraus, e não três.
 */

import { snapToScoreGrid } from "./criterion-unit"

export interface IdealRange {
  ideal_min: number
  ideal_max: number
  weight: number
}

/** Degraus do controle, do mais frouxo pro mais estrito (a ordem da UI). */
export const MY_RANGE_STEPS: ReadonlyArray<{ tolerance: number; label: string; hint: string }> = [
  {
    tolerance: 1,
    label: "Com folga",
    hint: "Faixa ideal ± 1 ponto — nenhum atributo pior que “amarelo” na cor Minha faixa.",
  },
  {
    tolerance: 0,
    label: "Exata",
    hint: "Só obras com os nove atributos dentro da faixa ideal do seu perfil.",
  },
]

/**
 * Espelha `RANGE_NEUTRAL_WEIGHT` do score-badge: peso abaixo disso é atributo
 * sobre o qual o perfil não opina, e a cor o pinta de CINZA. Filtrar por ele
 * seria a cor dizendo "não tenho opinião" enquanto a query exclui obras por
 * causa dele.
 */
const NEUTRAL_WEIGHT = 0.05

/** Atributos que o range de fato governa: os que o perfil tem E sobre os quais opina. */
export function ownedSlugs(ranges: Record<string, IdealRange>): string[] {
  return Object.entries(ranges)
    .filter(([, r]) => r && r.weight >= NEUTRAL_WEIGHT)
    .map(([slug]) => slug)
    .sort()
}

/**
 * Limiares de UM atributo, já na grade de 0,5 em que as notas existem.
 *
 * `null` quando o limiar não recorta nada (piso ≤ 0 / teto ≥ 10): escrever
 * `max_romance=10` seria um filtro que não filtra, ocupando uma vaga em
 * "Filtros ativos" e sujando o preset salvo. O arredondamento é DIRECIONAL
 * (piso pra baixo, teto pra cima) — alarga, nunca aperta em silêncio.
 */
export function myRangeBounds(
  range: IdealRange,
  tolerance: number,
): { min: number | null; max: number | null } {
  const lo = snapToScoreGrid(range.ideal_min - tolerance, "min")
  const hi = snapToScoreGrid(range.ideal_max + tolerance, "max")
  return {
    min: lo > 0 ? lo : null,
    max: hi < 10 ? hi : null,
  }
}

/**
 * Patch de query string pro degrau escolhido. `tolerance = null` desliga —
 * e limpa SÓ os atributos que o range governa, nunca um `min_humor` que a
 * pessoa tenha posto à mão num atributo fora do perfil.
 */
export function myRangeParams(
  ranges: Record<string, IdealRange>,
  tolerance: number | null,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  for (const slug of ownedSlugs(ranges)) {
    if (tolerance == null) {
      patch[`min_${slug}`] = null
      patch[`max_${slug}`] = null
      continue
    }
    const { min, max } = myRangeBounds(ranges[slug], tolerance)
    patch[`min_${slug}`] = min != null ? String(min) : null
    patch[`max_${slug}`] = max != null ? String(max) : null
  }
  return patch
}

export type MyRangeState = number | "custom" | null

/**
 * Qual degrau a URL está exprimindo hoje.
 *
 * Três estados, e o terceiro importa: `null` = nenhum limiar nos atributos do
 * range (o "Desligado" fica marcado); um número = casa exatamente com aquele
 * degrau; `"custom"` = há limiares, mas não são os de nenhum degrau — foi
 * afrouxado à mão. Aí NENHUM botão fica marcado, senão o controle afirmaria um
 * recorte que já não é o da tela.
 */
export function readMyRangeState(
  searchParams: Pick<URLSearchParams, "get">,
  ranges: Record<string, IdealRange>,
): MyRangeState {
  const slugs = ownedSlugs(ranges)
  if (slugs.length === 0) return null

  const hasAny = slugs.some(
    (s) => searchParams.get(`min_${s}`) != null || searchParams.get(`max_${s}`) != null,
  )
  if (!hasAny) return null

  for (const { tolerance } of MY_RANGE_STEPS) {
    const patch = myRangeParams(ranges, tolerance)
    // Comparação NUMÉRICA, não de string: "7" e "7.0" são o mesmo limiar, e
    // comparar texto deixaria apagado o botão que a pessoa acabou de clicar
    // (foi assim que os presets em σ apagaram sozinhos — ver `presetActive`).
    const matches = Object.entries(patch).every(([key, value]) => {
      const raw = searchParams.get(key)
      if (value == null) return raw == null || raw === ""
      if (raw == null || raw === "") return false
      return Number(raw) === Number(value)
    })
    if (matches) return tolerance
  }
  return "custom"
}
