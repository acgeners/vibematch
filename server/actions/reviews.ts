"use server"

import { after } from "next/server"
import { revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin } from "@/server/queries/current-user"
import { startUpdateJob, finishUpdateJob } from "@/lib/background/update-jobs"
import { getWorkTagReviewCounts } from "@/server/queries/work-card-meta"
import type { ReviewBatchWorkResult } from "@/lib/reviews/catalog-review-batch"

/**
 * Busca APENAS as reviews externas de uma obra (das fontes já vinculadas) e as
 * persiste — SEM passar pelo fluxo de "Atualizar dados" (busca de fontes, seleção de
 * sinopse/capa, conflitos). Roda em background (`after()`, ~35s por causa do Mangago)
 * e registra um job pra o `UpdateProgressWatcher` mostrar o progresso. A persistência
 * é incremental (por fonte), então uma interrupção no meio não perde tudo.
 */
export async function refetchWorkReviews(workId: string): Promise<{ ok: boolean }> {
  // Scraping das fontes + persistência em work_reviews (e o digest Sonnet que
  // pendura nele) → gasta rede/LLM e escreve no catálogo. Admin.
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false }
  if (!workId) return { ok: false }
  startUpdateJob(workId)
  after(async () => {
    let reviewsAdded: number | undefined
    try {
      const sb = createAdminClient()
      const count = async (): Promise<number> =>
        (await sb
          .from("work_reviews")
          .select("id", { count: "exact", head: true })
          .eq("work_id", workId)).count ?? 0
      const before = await count()
      const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
      await acquireAndPersistWorkReviews(workId)
      reviewsAdded = Math.max(0, (await count()) - before)
    } finally {
      finishUpdateJob(workId, { reviewsAdded })
    }
  })
  return { ok: true }
}

/**
 * Um passo do lote "Reviews do catálogo" (`/curation/settings?g=fontes`): para cada obra, em
 * sequência, busca de novo as reviews pelas fontes vinculadas e diz quantas ÚTEIS entraram.
 * Custo de IA ZERO (`refreshWorkReviewsLean`).
 *
 * `gained` é o 💬 depois menos o 💬 antes — a MESMA régua do card (`getWorkTagReviewCounts`),
 * para o resumo do lote e o "+N" da fila falarem a mesma língua.
 *
 * 🔴 `reviews_checked_at` só é gravado quando NENHUMA fonte falhou. A obra com fonte em falha
 * continua "nunca buscada" (ou com a data antiga) e volta para o começo da próxima rodada; gravar
 * a data mesmo assim a mandaria para o fim da fila com a busca pela metade, sem nada acusar.
 *
 * Devolve `[]` quando o gate recusa — quem chama trata isso como erro, senão o indicador
 * anunciaria "pronto" para uma busca que não aconteceu.
 */
export async function refreshReviewsForWorks(workIds: string[]): Promise<ReviewBatchWorkResult[]> {
  const gate = await ensureAdmin()
  if (!gate.ok) return []
  const ids = (workIds ?? []).filter(Boolean)
  if (ids.length === 0) return []

  const { refreshWorkReviewsLean } = await import("@/lib/external/acquire-reviews")
  const sb = createAdminClient()
  const usefulCount = async (id: string) => (await getWorkTagReviewCounts([id])).get(id)?.reviewCount ?? 0

  const out: ReviewBatchWorkResult[] = []
  for (const workId of ids) {
    const before = await usefulCount(workId)
    const r = await refreshWorkReviewsLean(workId)
    const gained = Math.max(0, (await usefulCount(workId)) - before)
    let error = r.error
    let checked = false
    if (!error && r.failedSources.length === 0) {
      const { error: upErr } = await sb
        .from("works")
        .update({ reviews_checked_at: new Date().toISOString() })
        .eq("id", workId)
      if (upErr) error = `reviews_checked_at: ${upErr.message}`
      else checked = true
    }
    out.push({ workId, attempted: r.attempted, gained, failedSources: r.failedSources, checked, error })
  }
  // A fila "Reviews novas" e o contador da aba leem o que esta busca mudou. Não só quando o 💬
  // subiu: review curta (<40) não conta no 💬 e mesmo assim muda o hash e acende a marca.
  if (out.some((r) => r.attempted)) revalidateTag("ai-eval-tab-counts", "max")
  return out
}
