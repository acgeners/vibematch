import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Listagem para a INTERFACE de reviews externas adicionadas manualmente (Plano 3 B2.2M §5).
 * Lê SOMENTE `public.work_external_reviews_manual` — NUNCA `work_manual_reviews` (opinião
 * pessoal). Não combina as duas. Ordem determinística (created_at, id) para exibição estável.
 */

export interface ExternalManualReviewDisplayRow {
  id: string
  source: string
  text: string
  created_at: string
}

export async function readManualExternalReviewsForDisplay(
  workId: string,
): Promise<ExternalManualReviewDisplayRow[]> {
  if (!workId) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_external_reviews_manual")
    .select("id, source, text, created_at")
    .eq("work_id", workId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })

  if (error) {
    console.error("[external-manual-reviews] erro lendo reviews externas manuais:", error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    source: String(r.source),
    text: String(r.text),
    created_at: String(r.created_at),
  }))
}
