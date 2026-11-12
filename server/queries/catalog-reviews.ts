import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"

/**
 * O universo do lote "Reviews do catálogo" (`CatalogReviewsPanel`, `/curation/settings?g=fontes`):
 * TODAS as obras ativas, e não só as em andamento como o lote de capítulos.
 *
 * Medido na recoleta do MangaUpdates de 06/11 (4,5 meses sem coletar, 1.062 obras): concluídas
 * ganharam 1,59 review nova por obra e em andamento 1,30 — e as de 2024+ ganharam MENOS (0,74)
 * que as até 2020 (4,08). Review acompanha leitor, não lançamento de capítulo; recortar pelo status
 * de publicação deixaria de fora a metade que mais ganha.
 */

/** A partir de quantos dias uma busca de reviews conta como antiga no painel. */
export const CATALOG_REVIEWS_STALE_DAYS = 30

/**
 * Segundos por obra, para a estimativa do painel. ⚠️ ESTIMATIVA do backfill (o Mangago leva ~37 s
 * por obra, uma requisição por review); a busca do lote pula a hidratação das fontes e deve ficar
 * abaixo disto. Remedir na primeira execução real e trocar aqui.
 */
export const REVIEW_SECONDS_PER_WORK = 37

export interface CatalogReviewsTarget {
  id: string
  title: string
  /** Última busca completa de reviews (`works.reviews_checked_at`); `null` = nunca. */
  checkedAt: string | null
}

export interface CatalogReviewsOverview {
  targets: CatalogReviewsTarget[]
  neverChecked: number
  /** Buscadas há mais de `CATALOG_REVIEWS_STALE_DAYS` dias. */
  checkedLongAgo: number
}

/** O lote e os números do painel, contados sobre a MESMA lista que o botão percorre. */
export async function getCatalogReviewsOverview(): Promise<CatalogReviewsOverview> {
  const targets = await listCatalogReviewsTargets()
  const cutoff = Date.now() - CATALOG_REVIEWS_STALE_DAYS * 86_400_000
  return {
    targets,
    neverChecked: targets.filter((t) => t.checkedAt == null).length,
    checkedLongAgo: targets.filter((t) => t.checkedAt != null && new Date(t.checkedAt).getTime() < cutoff).length,
  }
}

/**
 * As obras ativas, das buscadas há mais tempo para as mais recentes (as nunca buscadas primeiro).
 * É isso que deixa parar no meio: a próxima rodada recomeça de onde esta parou.
 */
export async function listCatalogReviewsTargets(): Promise<CatalogReviewsTarget[]> {
  const supabase = createAdminClient()
  const rows = await fetchAllRows<{ id: string; title: string; reviews_checked_at: string | null }>(
    () => supabase.from("works").select("id, title, reviews_checked_at").eq("is_archived", false),
    { orderBy: ["id"], label: "listCatalogReviewsTargets" },
  )
  return rows
    .map((r) => ({ id: r.id, title: r.title, checkedAt: r.reviews_checked_at }))
    .sort((a, b) => {
      if (a.checkedAt === b.checkedAt) return a.title.localeCompare(b.title)
      if (a.checkedAt == null) return -1
      if (b.checkedAt == null) return 1
      return a.checkedAt < b.checkedAt ? -1 : 1
    })
}
