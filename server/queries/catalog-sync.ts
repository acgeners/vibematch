import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"

/**
 * Status em que capítulos e status ainda mudam — o universo do lote do catálogo
 * (`CatalogSyncPanel`, `/curation/settings?g=fontes`). Decidido em 2026-11-09.
 *
 * Completed e Cancelled ficam de FORA: a regra de status nunca tira uma obra deles
 * (`decidePublicationStatus`), e um capítulo traduzido a mais numa obra concluída que
 * ninguém acompanha não muda nada. Quem está lendo uma concluída tem a checagem da `/reading`.
 *
 * Medido no mesmo dia (1.077 obras ativas): eram 388 obras nestes status, das quais 343 fora da
 * `/reading` nunca tinham passado pela checagem de capítulos, e numa amostra de 57 delas o
 * MangaUpdates discordava do status gravado em 15 (10 já concluídas no original).
 */
export const CATALOG_SYNC_STATUSES = ["Ongoing", "Hiatus", "Unknown"] as const

export interface CatalogSyncTarget {
  id: string
  title: string
  /** Última checagem de capítulos (`works.chapters_checked_at`); `null` = nunca. */
  checkedAt: string | null
}

/** A partir de quantos dias uma checagem conta como antiga no painel. */
export const CATALOG_SYNC_STALE_DAYS = 7

export interface CatalogSyncOverview {
  targets: CatalogSyncTarget[]
  neverChecked: number
  /** Checadas há mais de `CATALOG_SYNC_STALE_DAYS` dias. */
  checkedLongAgo: number
}

/** O lote e os dois números do painel, contados sobre a MESMA lista que o botão percorre. */
export async function getCatalogSyncOverview(): Promise<CatalogSyncOverview> {
  const targets = await listCatalogSyncTargets()
  const cutoff = Date.now() - CATALOG_SYNC_STALE_DAYS * 86_400_000
  return {
    targets,
    neverChecked: targets.filter((t) => t.checkedAt == null).length,
    checkedLongAgo: targets.filter((t) => t.checkedAt != null && new Date(t.checkedAt).getTime() < cutoff).length,
  }
}

/**
 * As obras ativas do lote, das checadas há mais tempo para as mais recentes (as nunca
 * checadas primeiro). Assim um lote interrompido recomeça de onde parou na próxima vez.
 */
export async function listCatalogSyncTargets(): Promise<CatalogSyncTarget[]> {
  const ids = CATALOG_SYNC_STATUSES.map((s) => getPublicationStatusIdByName(s)).filter(
    (id): id is number => id != null,
  )
  if (ids.length !== CATALOG_SYNC_STATUSES.length) {
    // Status renomeado no banco: falhar alto em vez de varrer um universo menor calado.
    throw new Error(`listCatalogSyncTargets: status sem id (${CATALOG_SYNC_STATUSES.join(", ")})`)
  }
  const supabase = createAdminClient()
  const rows = await fetchAllRows<{ id: string; title: string; chapters_checked_at: string | null }>(
    () =>
      supabase
        .from("works")
        .select("id, title, chapters_checked_at")
        .eq("is_archived", false)
        // Obra sem status nenhum também é "não sabemos" — entra junto com Unknown.
        .or(`publication_status_id.in.(${ids.join(",")}),publication_status_id.is.null`),
    { orderBy: ["id"], label: "listCatalogSyncTargets" },
  )
  return rows
    .map((r) => ({ id: r.id, title: r.title, checkedAt: r.chapters_checked_at }))
    .sort((a, b) => {
      if (a.checkedAt === b.checkedAt) return a.title.localeCompare(b.title)
      if (a.checkedAt == null) return -1
      if (b.checkedAt == null) return 1
      return a.checkedAt < b.checkedAt ? -1 : 1
    })
}
