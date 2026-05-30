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
    // Sem reviews → limpa também o resumo IA pra não ficar órfão.
    await supabase
      .from("works")
      .update({ review_summary: null, review_summary_at: null, review_summary_inputs_hash: null })
      .eq("id", workId)
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
    return
  }

  // Resumo de consenso das reviews (best-effort, hash-guarded) — espelha a
  // sinopse canônica. Falhas só logam: o resumo é otimização, não fonte de verdade.
  await persistReviewSummary(supabase, workId, reviews)
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Gera/atualiza o resumo IA das reviews da obra. Só roda quando o conjunto de
 * reviews mudou (compara sha256) ou ainda não há resumo. Best-effort.
 */
async function persistReviewSummary(
  supabase: AdminClient,
  workId: string,
  reviews: SourcedReview[],
): Promise<void> {
  try {
    const { consolidateReviews, hashReviewInputs } = await import(
      "@/lib/ai-recommendation/review-summarizer"
    )
    const inputs = reviews.map((r) => ({ text: r.text, userRating: r.userRating ?? null }))
    const hash = hashReviewInputs(inputs)

    const { data: existing } = await supabase
      .from("works")
      .select("review_summary, review_summary_inputs_hash")
      .eq("id", workId)
      .maybeSingle()
    if (existing?.review_summary != null && existing?.review_summary_inputs_hash === hash) return

    const result = await consolidateReviews(inputs, { workId })
    if (!result) return

    await supabase
      .from("works")
      .update({
        review_summary: result.summary,
        review_summary_at: new Date().toISOString(),
        review_summary_inputs_hash: hash,
      })
      .eq("id", workId)
  } catch (err) {
    console.error("[work_reviews] erro gerando resumo:", err instanceof Error ? err.message : err)
  }
}
