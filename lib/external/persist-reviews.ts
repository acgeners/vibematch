import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SourcedReview, ExternalSourceId } from "@/lib/external/types"
import { ensureReviewSummary, ensureReviewDigest } from "@/lib/orchestration/integrations/reviews"

/**
 * Salva snapshot de reviews externas de uma obra — estratégia NÃO-DESTRUTIVA
 * (merge por fonte). Substitui apenas as reviews das fontes presentes em
 * `reviews`; fontes AUSENTES nesta rodada são preservadas. Assim uma queda
 * transitória de uma fonte (ex.: Comix/FlareSolverr retorna 0 reviews por causa
 * do Cloudflare) NÃO apaga o que já foi colhido antes — o vazio fica restrito à
 * primeira busca da obra. Conjunto totalmente vazio = no-op (preserva o snapshot).
 *
 * Passe `replace: true` pra forçar a limpeza total (ex.: a obra foi reapontada
 * pra outro título e as reviews antigas tornaram-se inválidas).
 *
 * Falhas são silenciosas (apenas logam). Persistir reviews é otimização, não
 * fonte de verdade.
 */
export async function saveWorkReviews(
  workId: string,
  reviews: SourcedReview[],
  opts: { replace?: boolean } = {},
): Promise<void> {
  if (!workId) return
  const supabase = createAdminClient()

  // Conjunto vazio. Sem `replace`: no-op — preserva o snapshot anterior (caso
  // comum de "todas as fontes falharam nesta rodada"). Com `replace`: limpa tudo
  // + o resumo (reapontamento real da obra).
  if (reviews.length === 0) {
    if (!opts.replace) return
    await supabase.from("work_reviews").delete().eq("work_id", workId)
    await supabase
      .from("works")
      .update({ review_summary: null, review_summary_at: null, review_summary_inputs_hash: null })
      .eq("id", workId)
    return
  }

  // Merge por fonte: apaga só as fontes presentes neste batch (re-inseridas
  // abaixo) e mantém as demais. `replace` zera o snapshot inteiro.
  const sourcesInBatch = [...new Set(reviews.map((r) => r.source))]
  const baseDelete = supabase.from("work_reviews").delete().eq("work_id", workId)
  const { error: delError } = await (opts.replace
    ? baseDelete
    : baseDelete.in("source", sourcesInBatch))
  if (delError) {
    console.error("[work_reviews] erro limpando snapshot:", delError)
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

  // Resumo + digest: ambos leem o corpus COMPLETO da obra POR DENTRO de cada `ensure*`
  // (via gateway) — NÃO passamos `reviews`. O corpus de ambos é canônico (work_reviews
  // scraped + work_external_reviews_manual manual externa), refletindo o conjunto após o
  // merge, não só este batch. Resumo MANTÉM as notas; digest as descarta.
  //
  // Resumo (Haiku): AGUARDADO (preserva o comportamento). Job durável (dedup por hash de
  // conteúdo, status, retomada). Single-op do save = pré-autorizado (allowPaid). Não lança.
  await ensureReviewSummary(workId, { supabase, allowPaid: true }).catch(
    (err) => console.error("[work_reviews] ensureReviewSummary rejeitou:", err),
  )

  // Digest (Sonnet): ASSÍNCRONO (sem await, não bloqueia o retorno). Gate próprio
  // (versão/materialidade por contagem) dentro de `ensureReviewDigest`.
  void ensureReviewDigest(workId, { supabase, allowPaid: true }).catch((err) =>
    console.error("[work_reviews] ensureReviewDigest rejeitou:", err),
  )
}

/**
 * Lê o pool persistido em `work_reviews` e o devolve como `SourcedReview[]` —
 * o formato que a avaliação consome. Usado como FALLBACK de robustez: quando a
 * busca fresca de reviews volta vazia (ex.: queda transitória do Cloudflare no
 * Comix), a avaliação usa o que já foi colhido antes em vez de avaliar sem
 * nenhuma review. Não inclui reviews manuais (tratadas à parte no fluxo).
 *
 * Ordena por fonte → match_score desc → rating desc (determinístico) pra que o
 * `selectReviewsForEvaluation`/`input_hash` resultante seja estável entre
 * avaliações que caiam neste fallback.
 */
export async function loadWorkReviewsAsSourced(workId: string): Promise<SourcedReview[]> {
  if (!workId) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_reviews")
    .select("source, source_title, text, text_length, user_rating, match_score")
    .eq("work_id", workId)
    .order("source", { ascending: true })
    .order("match_score", { ascending: false })
    .order("user_rating", { ascending: false, nullsFirst: false })
  if (error) {
    console.error("[work_reviews] erro lendo pool persistido:", error)
    return []
  }
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>
    const text = String(r.text ?? "")
    return {
      source: r.source as ExternalSourceId,
      sourceTitle: (r.source_title as string | null) ?? "",
      matchScore: Number(r.match_score ?? 0),
      text,
      userRating: r.user_rating != null ? Number(r.user_rating) : undefined,
      textLength: r.text_length != null ? Number(r.text_length) : text.length,
    }
  })
}
