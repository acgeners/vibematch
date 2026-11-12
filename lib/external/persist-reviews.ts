import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SourcedReview, ExternalSourceId } from "@/lib/external/types"
import { ensureReviewSummary, ensureReviewDigest } from "@/lib/orchestration/integrations/reviews"
import { getReviewSynthesisToggles } from "@/server/queries/current-user"
import { refreshArtSignalForWork } from "@/lib/art/refresh"
import { pgSafeText } from "@/lib/text/pg-safe-text"

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
  opts: {
    replace?: boolean
    fromFreshEval?: boolean
    skipPaidEnrichment?: boolean
    /** ACUMULATIVO: não apaga nada; insere só reviews de texto novo (união por fonte).
     *  Usado pelos re-fetches ("Buscar reviews"/"Atualizar dados") pra um fetch que
     *  traga MENOS reviews (queda transitória) nunca REMOVER as boas já salvas. */
    accumulate?: boolean
    /**
     * AGUARDA o digest (Sonnet) antes de retornar. Default `false` = fire-and-forget
     * (o save não paga a latência do Sonnet, ~20s).
     *
     * Ligue quando o CHAMADOR consome o digest logo em seguida. É o caso da criação
     * de obra: `inferAndPersistTagsForWork` lê `review_digest` pra enriquecer o
     * contexto das tags e, sem isto, SEMPRE corria antes de ele existir — caía no
     * resumo (contexto mais pobre) enquanto o digest já pago era escrito tarde
     * demais pra servir a alguém. Só use dentro de `after()`/background: numa
     * requisição isto segura a resposta pelo tempo do Sonnet.
     */
    awaitDigest?: boolean
    /**
     * Fura o gate de MATERIALIDADE do resumo/digest (que só regenera com crescimento
     * ≥ `max(2, 20%)` do pool). Existe pro caso da recuperação tardia: uma fonte que
     * falhou na 1ª passada e voltou na 2ª costuma trazer POUCAS reviews — abaixo do
     * limiar. Sem isto, o artefato pago fica congelado no recorte parcial e a chegada
     * tardia não entra nunca, que é exatamente o bug que a 2ª passada existe pra
     * fechar. A dedup por hash de conteúdo do job ainda evita LLM redundante quando o
     * conteúdo, no fim, não mudou.
     */
    forcePaidEnrichment?: boolean
  } = {},
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

  const sourcesInBatch = [...new Set(reviews.map((r) => r.source))]
  const now = new Date().toISOString()

  // 🔴 Review que a avaliação recém-feita LEU entra com a data DELA. O "+N reviews desde a
  // avaliação" da fila (`work_review_growth`, migration 220) conta as reviews criadas DEPOIS da
  // avaliação vigente — e na criação da obra (Path B) a avaliação é gravada ANTES destas reviews
  // (o save roda em `after()`). Medido em 2026-11-12: 325 reviews entraram até 2 min depois da
  // avaliação de criação, e a obra aparecia com "+43 desde a avaliação (tinha 0)" sem ter ganhado
  // nada. Sem avaliação concluída, nada muda.
  let seenByEvaluationAt: string | null = null
  if (opts.fromFreshEval) {
    const { data: ev } = await supabase
      .from("ai_evaluations")
      .select("created_at, updated_at")
      .eq("work_id", workId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
    const at = (ev as { created_at?: string | null; updated_at?: string | null } | null) ?? null
    seenByEvaluationAt = at?.updated_at ?? at?.created_at ?? null
  }
  // `pgSafeText` na FRONTEIRA de escrita: os conectores cortam a review com
  // `.slice(0, 900)`, que corta por unidade UTF-16 e pode deixar meio emoji. O
  // Postgres recusa o corpo inteiro com 400 — e como o erro abaixo só é LOGADO, o
  // delete já rodou e a obra fica sem as reviews daquelas fontes.
  const toRow = (r: SourcedReview) => ({
    work_id: workId,
    source: r.source,
    source_title: pgSafeText(r.sourceTitle ?? null),
    text: pgSafeText(r.text),
    text_length: r.textLength ?? r.text.length,
    user_rating: r.userRating ?? null,
    match_score: Math.round(r.matchScore * 100) / 100,
    fetched_at: now,
    ...(seenByEvaluationAt ? { created_at: seenByEvaluationAt } : {}),
  })

  if (opts.accumulate && !opts.replace) {
    // ACUMULATIVO: NÃO apaga nada — insere só as reviews cujo texto ainda não existe
    // (por fonte). Assim um re-fetch que traga MENOS reviews (queda transitória de uma
    // fonte) nunca REMOVE as boas já salvas — o número só cresce ou fica igual.
    //
    // A chave compara o texto como ele é GRAVADO (`toRow` → `pgSafeText`), nunca o cru: o
    // conector corta em 900 e às vezes parte um emoji, que o saneamento remove. Cru × salvo
    // nunca casaria e cada execução reinseriria a mesma review — eram 136 textos nessa
    // condição em 19/10/2026 (115 da Comix, com exatamente 899 caracteres).
    const key = (source: string, text: string) => `${source}\u0000${text.trim()}`
    const { data: existing, error: readError } = await supabase
      .from("work_reviews")
      .select("source, text")
      .eq("work_id", workId)
      .in("source", sourcesInBatch)
    // Falha na leitura NÃO é pool vazio: tratada assim, o lote inteiro seria reinserido por
    // cima do que já existe. Mesmo desfecho do ramo destrutivo quando o delete falha.
    if (readError) {
      console.error("[work_reviews] erro lendo o pool existente (accumulate) — nada inserido:", readError)
      return
    }
    const seen = new Set((existing ?? []).map((r) => key(String(r.source), String((r as { text?: string }).text ?? ""))))
    const fresh: ReturnType<typeof toRow>[] = []
    for (const review of reviews) {
      const row = toRow(review)
      const k = key(row.source, row.text)
      if (seen.has(k)) continue
      seen.add(k) // a mesma review repetida DENTRO do lote entra uma vez só
      fresh.push(row)
    }
    if (fresh.length > 0) {
      const { error: insError } = await supabase.from("work_reviews").insert(fresh)
      if (insError) {
        console.error("[work_reviews] erro inserindo reviews (accumulate):", insError)
        return
      }
    }
  } else {
    // Merge por fonte (default): apaga só as fontes presentes neste batch (re-inseridas
    // abaixo) e mantém as demais. `replace` zera o snapshot inteiro.
    const baseDelete = supabase.from("work_reviews").delete().eq("work_id", workId)
    const { error: delError } = await (opts.replace
      ? baseDelete
      : baseDelete.in("source", sourcesInBatch))
    if (delError) {
      console.error("[work_reviews] erro limpando snapshot:", delError)
      return
    }
    const { error: insError } = await supabase.from("work_reviews").insert(reviews.map(toRow))
    if (insError) {
      console.error("[work_reviews] erro inserindo reviews:", insError)
      return
    }
  }

  // Fingerprint do CONTEÚDO do pool (após o merge). Se mudou em relação ao salvo,
  // atualiza o hash e — quando a obra já tem avaliação concluída — marca a
  // avaliação IA como DESATUALIZADA (reviews entram no input da avaliação). Espelha
  // o `alignment_stale` do Veredito. `fromFreshEval` pula a flag (a obra acabou de
  // ser avaliada com estas reviews — criação via "Buscar dados"). Tolerante a
  // colunas ausentes (pré-migration 120): erro só loga.
  try {
    const { reviewsFingerprint } = await import("@/lib/reviews/fingerprint")
    const { data: pool } = await supabase
      .from("work_reviews")
      .select("text, user_rating, source")
      .eq("work_id", workId)
    const fp = reviewsFingerprint(
      (pool ?? []).map((r) => ({
        text: String((r as { text?: string }).text ?? ""),
        source: (r as { source?: string | null }).source ?? null,
        userRating: (r as { user_rating?: number | null }).user_rating ?? null,
      })),
    )
    const { data: cur, error: curErr } = await supabase
      .from("works")
      .select("reviews_hash, ai_eval_status")
      .eq("id", workId)
      .maybeSingle()
    if (!curErr && cur && (cur as { reviews_hash?: string | null }).reviews_hash !== fp) {
      const patch: Record<string, unknown> = { reviews_hash: fp }
      if (!opts.fromFreshEval && (cur as { ai_eval_status?: string }).ai_eval_status === "done") {
        patch.ai_eval_reviews_stale = true
      }
      await supabase.from("works").update(patch).eq("id", workId)
    }
  } catch (err) {
    console.error("[work_reviews] fingerprint/stale falhou (migration 120?):", err)
  }

  // Sinal de arte: o pool de reviews mudou, então as menções e o léxico mudaram junto.
  // Fica ANTES do `skipPaidEnrichment` de propósito — é extração local, não gera custo de
  // IA, e pular aqui deixaria o caminho barato com sinal permanentemente velho. Não lança
  // (o próprio helper engole e loga com prefixo `[arte-signal]`).
  await refreshArtSignalForWork(workId)

  // `skipPaidEnrichment`: persiste as reviews (exibição) mas NÃO gera resumo/digest
  // pagos. Usado quando o usuário optou por salvar a obra sem enriquecimento IA
  // (Flow B do popup de custo) — o resumo/digest podem ser gerados sob demanda depois.
  if (opts.skipPaidEnrichment) return

  // Toggles globais (user_settings, migration 127): o usuário pode desligar a
  // geração paga do Resumo e/ou do Digest em qualquer save. Uma leitura só (mesma
  // linha singleton); default `true` (preserva o comportamento histórico).
  const { summaryEnabled, digestEnabled } = await getReviewSynthesisToggles(supabase)

  // Resumo + digest: ambos leem o corpus COMPLETO da obra POR DENTRO de cada `ensure*`
  // (via gateway) — NÃO passamos `reviews`. O corpus de ambos é canônico (work_reviews
  // scraped + work_external_reviews_manual manual externa), refletindo o conjunto após o
  // merge, não só este batch. Resumo MANTÉM as notas; digest as descarta.
  //
  // Resumo (Haiku): AGUARDADO (preserva o comportamento). Job durável (dedup por hash de
  // conteúdo, status, retomada). Single-op do save = pré-autorizado (allowPaid). Não lança.
  if (summaryEnabled) {
    await ensureReviewSummary(workId, {
      supabase,
      allowPaid: true,
      force: opts.forcePaidEnrichment,
    }).catch((err) => console.error("[work_reviews] ensureReviewSummary rejeitou:", err))
  }

  // Digest (Sonnet): ASSÍNCRONO por padrão (sem await, não bloqueia o retorno).
  // Gate próprio (versão/materialidade por contagem) dentro de `ensureReviewDigest`.
  // `awaitDigest` inverte isso pra quem depende do digest logo na volta (ver o opt).
  if (digestEnabled) {
    const digest = ensureReviewDigest(workId, {
      supabase,
      allowPaid: true,
      force: opts.forcePaidEnrichment,
    }).catch((err) => console.error("[work_reviews] ensureReviewDigest rejeitou:", err))
    if (opts.awaitDigest) await digest
    else void digest
  }
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
