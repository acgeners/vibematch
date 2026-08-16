import "server-only"
import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import type { CriterionMoments } from "@/lib/ranking/criterion-unit"

/**
 * MÉDIA e DESVIO-PADRÃO de cada um dos 9 atributos de IA no catálogo.
 *
 * Existe pra alimentar a unidade **σ** do filtro de notas por critério do
 * /ranking: um limiar em PONTOS não significa a mesma coisa em dois atributos
 * cujas distribuições são diferentes. Medido em 2026-08-05 sobre 973 obras:
 *
 *   romance          média 7,43  σ 1,16   → "≥ 7" pega 55% do catálogo
 *   humor            média 4,70  σ 1,97   → "≥ 7" pega 3,5%
 *   adult_content    média 5,29  σ 2,81
 *   protagonist      média 7,21  σ 0,89
 *
 * O mesmo número 7 é "praticamente todo mundo" num caso e "a cauda" no outro.
 * Em σ o limiar passa a querer dizer a mesma coisa nos nove: "quanto acima do
 * normal DESTE atributo".
 *
 * ⚠️ É estatística do CATÁLOGO, e portanto muda quando o catálogo cresce. Medido:
 * recalculando os momentos só com as 500 obras mais antigas, 7,4% das obras
 * mudariam de atributo dominante. Um filtro salvo em σ deriva junto — é o preço
 * de ser relativo, e é justamente por isso que a UI mostra a conversão em pontos
 * ao lado (o usuário vê o alvo absoluto que ele está pedindo hoje).
 *
 * Histórico: este arquivo é o que sobrou de `work-signature.ts`, que calculava a
 * "Assinatura" (argmax do z-score) usada por um filtro de /catalog. O filtro saiu
 * em 2026-08-05 — o argmax decidia por margem < 0,25σ em 47% do catálogo e o
 * rótulo não aparecia em obra nenhuma. Os momentos, que eram o miolo honesto
 * dele, seguem vivos aqui.
 */

export type { CriterionMoments }

interface ScoreRow {
  criterion_slug: string
  score: number | null
}

const CRITERION_SLUG_SET = new Set<string>(CRITERION_SLUGS)

export function isCriterionSlug(slug: string): slug is CriterionSlug {
  return CRITERION_SLUG_SET.has(slug)
}

export const getCriterionMoments = unstable_cache(
  async (): Promise<CriterionMoments> => {
    const supabase = createAdminClient()

    // ⚠️ PAGINA. `category_scores` tem ~8,7k linhas (9 por obra): um `.select()`
    // cru pararia em 1000 e a média/σ sairiam de ~111 obras — um erro que PRODUZ
    // resultado, sem erro nem log, e que aqui sairia como faixa de filtro errada.
    const rows = await fetchAllRows<ScoreRow>(
      (from, to) => supabase.from("category_scores").select("criterion_slug, score").range(from, to),
      "getCriterionMoments",
    )

    const bySlug = new Map<string, number[]>()
    for (const row of rows) {
      if (row.score == null || !isCriterionSlug(row.criterion_slug)) continue
      const list = bySlug.get(row.criterion_slug) ?? []
      list.push(row.score)
      bySlug.set(row.criterion_slug, list)
    }

    const moments: CriterionMoments = {}
    for (const [slug, values] of bySlug) {
      const n = values.length
      if (!n) continue
      const mean = values.reduce((a, b) => a + b, 0) / n
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
      moments[slug] = { mean, sd }
    }
    return moments
  },
  ["criterion-moments-v1"],
  // Invalidada pela mesma tag que as mutações de obra já disparam; o revalidate
  // cobre o recálculo em massa, que não passa por lá.
  { revalidate: 600, tags: ["works-slug-index"] },
)

/**
 * Momentos pra UI de filtro. NÃO PODE LANÇAR: é decoração de um controle que
 * funciona sem ela (sem momentos, o filtro fica só em pontos). O /ranking chama
 * dentro de um Promise.all — um throw aqui derrubaria a PÁGINA INTEIRA por causa
 * de um seletor de unidade. Foi assim que a contagem de assinatura derrubou o
 * catálogo em dev com um "JWT issued at future".
 */
export async function getCriterionMomentsSafe(): Promise<CriterionMoments | null> {
  try {
    const moments = await getCriterionMoments()
    return Object.keys(moments).length ? moments : null
  } catch (error) {
    console.error("[criterion-moments] momentos indisponíveis:", error)
    return null
  }
}
