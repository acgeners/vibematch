import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SourcedReview, ExternalSourceId } from "@/lib/external/types"
import type { ReviewSummaryInput } from "@/lib/ai-recommendation/review-summarizer"

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

  // Resumo de consenso: precisa refletir o conjunto COMPLETO persistido (merge),
  // não só este batch — senão o resumo ignoraria fontes preservadas. Re-lê todas
  // as reviews da obra antes de consolidar.
  const { data: persisted, error: readError } = await supabase
    .from("work_reviews")
    .select("text, user_rating")
    .eq("work_id", workId)
  if (readError) {
    console.error("[work_reviews] erro relendo conjunto p/ resumo:", readError)
    return
  }
  const summaryInputs: ReviewSummaryInput[] = (persisted ?? [])
    .map((r) => ({ text: String(r.text ?? ""), userRating: r.user_rating ?? null }))
    .filter((r) => r.text.trim().length > 0)
  await persistReviewSummary(supabase, workId, summaryInputs)
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

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Gera/atualiza o resumo IA das reviews da obra. Best-effort. Gate de
 * MATERIALIDADE (Item C, Passe 1): re-resumir custa Haiku, então só roda quando
 *   - não há resumo (cold), OU
 *   - o conjunto mudou (sha256) E o crescimento é material (ver
 *     `isMaterialReviewChange`) — +1 review numa obra com dezenas é desperdício.
 * Edição pura (mesmo count, texto diferente) NÃO dispara — fica pro botão manual.
 *
 * Os inputs são ordenados por texto antes do hash pra que a ordem não-determinística
 * do SELECT não dispare re-gerações desnecessárias do resumo (que custam LLM).
 */
async function persistReviewSummary(
  supabase: AdminClient,
  workId: string,
  inputs: ReviewSummaryInput[],
): Promise<void> {
  if (inputs.length === 0) return
  try {
    const {
      consolidateReviews,
      hashReviewInputs,
      packReviewSummaryMeta,
      parseReviewSummaryMeta,
      isMaterialReviewChange,
    } = await import("@/lib/ai-recommendation/review-summarizer")
    const ordered = [...inputs].sort((a, b) => a.text.localeCompare(b.text))
    const hash = hashReviewInputs(ordered)
    const nowN = ordered.length

    const { data: existing } = await supabase
      .from("works")
      .select("review_summary, review_summary_inputs_hash")
      .eq("id", workId)
      .maybeSingle()

    if (existing?.review_summary != null) {
      const { hash: prevHash, n: prevN } = parseReviewSummaryMeta(
        existing.review_summary_inputs_hash as string | null,
      )
      // Conjunto idêntico → nunca roda. Mudou mas imaterial → também não.
      if (prevHash === hash) return
      if (!isMaterialReviewChange(prevN, nowN)) return
    }

    const result = await consolidateReviews(ordered, { workId })
    if (!result) return

    await supabase
      .from("works")
      .update({
        review_summary: result.summary,
        review_summary_at: new Date().toISOString(),
        review_summary_inputs_hash: packReviewSummaryMeta(hash, nowN),
      })
      .eq("id", workId)
  } catch (err) {
    console.error("[work_reviews] erro gerando resumo:", err instanceof Error ? err.message : err)
  }
}
