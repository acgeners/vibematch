import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SourcedReview } from "@/lib/external/types"

/**
 * Salva snapshot de reviews externas pra uma obra. Estratégia: snapshot
 * atômico — delete tudo de work_id e re-insere as novas. Mantém o DB
 * sincronizado com o último fetch sem reviews órfãs de buscas antigas.
 *
 * Falhas são silenciosas (apenas logam). Persistir reviews é otimização,
 * não fonte de verdade.
 */
export async function saveWorkReviews(
  workId: string,
  reviews: SourcedReview[],
): Promise<void> {
  if (!workId) return
  const supabase = createAdminClient()

  if (reviews.length === 0) {
    await supabase.from("work_reviews").delete().eq("work_id", workId)
    return
  }

  const { error: delError } = await supabase
    .from("work_reviews")
    .delete()
    .eq("work_id", workId)
  if (delError) {
    console.error("[work_reviews] erro deletando snapshot anterior:", delError)
    return
  }

  const now = new Date().toISOString()
  const rows = reviews.map((r) => ({
    work_id: workId,
    source: r.source,
    source_title: r.sourceTitle ?? null,
    text: r.text,
    text_length: r.textLength ?? r.text.length,
    user_rating: r.userRating ?? null,
    match_score: Math.round(r.matchScore * 100) / 100,
    fetched_at: now,
  }))

  const { error: insError } = await supabase.from("work_reviews").insert(rows)
  if (insError) {
    console.error("[work_reviews] erro inserindo reviews:", insError)
  }
}
