import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SourcedReview, ExternalSourceId } from "@/lib/external/types"
import type { ReviewSummaryInput, ReviewDigestInput } from "@/lib/ai-recommendation/review-summarizer"

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

  // Resumo + digest: ambos precisam refletir o conjunto COMPLETO persistido
  // (merge), não só este batch — senão ignorariam fontes preservadas. Re-lê todas
  // as reviews da obra (com `source`, que o digest estratifica) antes de consolidar.
  const { data: persisted, error: readError } = await supabase
    .from("work_reviews")
    .select("text, user_rating, source")
    .eq("work_id", workId)
  if (readError) {
    console.error("[work_reviews] erro relendo conjunto p/ resumo:", readError)
    return
  }
  const summaryInputs: ReviewSummaryInput[] = (persisted ?? [])
    .map((r) => ({ text: String(r.text ?? ""), userRating: r.user_rating ?? null }))
    .filter((r) => r.text.trim().length > 0)
  await persistReviewSummary(supabase, workId, summaryInputs)

  // Digest estruturado (Sonnet, Item C Passe 2) no eval-time: fire-and-forget,
  // SEM await — não taxa a latência da avaliação (~60s, ponto de dor conhecido).
  // Gate próprio (cold/versão/materialidade) dentro de `persistReviewDigest`. A
  // promise solta sobrevive no host long-running (dev/Fly); o .catch é só rede de
  // segurança (a função já é best-effort/silenciosa). Se um dia for serverless,
  // migrar p/ after()/fila.
  const digestInputs: ReviewDigestInput[] = (persisted ?? [])
    .map((r) => ({
      text: String(r.text ?? ""),
      source: String(r.source ?? "desconhecida"),
      userRating: r.user_rating ?? null,
    }))
    .filter((r) => r.text.trim().length > 0)
  void persistReviewDigest(supabase, workId, digestInputs).catch((err) =>
    console.error("[work_reviews] digest fire-and-forget rejeitou:", err),
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

/**
 * Gera/atualiza o DIGEST estruturado (Sonnet 4.6, Item C Passe 2) das reviews da
 * obra no eval-time. Best-effort, disparado SEM await por `saveWorkReviews`
 * (background). Gate — mesma disciplina do batch (`consolidatePendingReviewDigests`)
 * somada à materialidade do Passe 1:
 *   - cold (obra sem digest), OU
 *   - versão antiga (`review_digest_version` != atual — regenera no bump), OU
 *   - crescimento material do conjunto (`isMaterialReviewChange` sobre `review_digest_n`).
 * Senão (digest fresco + sem crescimento material) → no-op, zero custo Sonnet. Assim
 * "Completo" digere 1×; on-going renova ao crescer; edição pura (mesmo count) NÃO
 * dispara — fica pro batch/botão manual.
 *
 * Tolerante: sem a migration 103 (colunas ausentes) o select/update falha → catch
 * silencioso, sem quebrar o save de reviews.
 */
async function persistReviewDigest(
  supabase: AdminClient,
  workId: string,
  inputs: ReviewDigestInput[],
): Promise<void> {
  const nowN = inputs.filter((i) => i.text.trim().length > 0).length
  if (nowN === 0) return
  try {
    const { consolidateReviewsDigestDetailed, REVIEW_DIGEST_VERSION, isMaterialReviewChange } =
      await import("@/lib/ai-recommendation/review-summarizer")

    const { data: existing } = await supabase
      .from("works")
      .select("review_digest, review_digest_n, review_digest_version")
      .eq("id", workId)
      .maybeSingle()
    const row = existing as {
      review_digest: unknown
      review_digest_n: number | null
      review_digest_version: string | null
    } | null

    // Digest fresco (presente E versão atual): só renova se cresceu o bastante.
    const fresh = row?.review_digest != null && row.review_digest_version === REVIEW_DIGEST_VERSION
    if (fresh && !isMaterialReviewChange(row?.review_digest_n ?? null, nowN)) return

    const status = await consolidateReviewsDigestDetailed(inputs, { workId })
    if (status.kind !== "ok") return

    await supabase
      .from("works")
      .update({
        review_digest: status.result.digest,
        review_digest_at: new Date().toISOString(),
        review_digest_n: nowN,
        review_digest_version: REVIEW_DIGEST_VERSION,
      })
      .eq("id", workId)
  } catch (err) {
    console.error("[work_reviews] erro gerando digest:", err instanceof Error ? err.message : err)
  }
}
