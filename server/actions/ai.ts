"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { AI_EVAL_REVIEW_CAPS, requestAiEvaluation } from "@/lib/ai-evaluation/service"
import {
  buildCandidateFromExternalIds,
  fetchExternalEvaluationContextForCandidate,
  fetchExternalEvaluationContextForWork,
  selectReviewsForEvaluation,
} from "@/lib/external/index"
import { saveWorkReviews, loadWorkReviewsAsSourced } from "@/lib/external/persist-reviews"
import { mergeFreshWithPersistedReviews } from "@/lib/external/review-merge"
import type { ExternalSourceId, SourcedReview } from "@/lib/external/types"
import { readManualExternalReviewsForDisplay } from "@/server/queries/external-manual-reviews"
import { markRecalcPending } from "@/server/recalc/queue"
import { ensureComixHid } from "./comix-hid"
import { resolveMangagoForEvalContext } from "@/lib/external/mangago-eval-context"
import { boolEnv } from "@/lib/external/mangago-band"
import { markWorkAlignmentStale } from "@/server/queries/alignment"
import type { AiEvaluation } from "@/types/domain"
import { pickPrimaryCover, splitSynopsesForEvaluation } from "@/lib/work-derived"
import { isSameSynopsis } from "@/lib/synopsis-text"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { SONNET_MODEL } from "@/lib/ai/models"
import { pgSafeDeep, pgSafeText } from "@/lib/text/pg-safe-text"
import { ensureAdmin } from "@/server/queries/current-user"

const OPUS_MODEL_ID = "claude-opus-4-7"
const SONNET_MODEL_ID = SONNET_MODEL
const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001"

type ReevalModel = "sonnet" | "opus" | "haiku"

function resolveModelOverride(model: ReevalModel | undefined): string | undefined {
  if (model === "opus") return OPUS_MODEL_ID
  if (model === "sonnet") return SONNET_MODEL_ID
  if (model === "haiku") return HAIKU_MODEL_ID
  return undefined
}

/** External IDs vêm como string de `work_external_ids`; o resolver da Comix quer
 *  AniList/MAL como inteiro positivo. Converte, ou `undefined` se inválido. */
function toPositiveInt(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** Confiança + justificativas da avaliação que respalda as notas ATUAIS da obra.
 *  Usado pelo review form pra exibir, ao lado da sugestão nova, a confiança e a
 *  justificativa que geraram cada nota atual. Null quando nenhuma nota atual veio
 *  de IA (todas manuais/importadas → sem `ai_evaluation_id`).
 *  O tipo público espelha `CurrentEvaluationMeta` do review form (não exportamos
 *  daqui: é um módulo "use server", que só pode exportar async functions).
 *
 *  `modelName`/`promptVersion` NÃO são cosméticos: sem eles a tela põe "Atual 93%"
 *  ao lado de "Sugerido 75%" sem poder dizer que os dois números vieram de modelos
 *  diferentes, com tetos diferentes (0,95 vs 0,88) — e é essa justaposição que faz
 *  concluir "piorou" quando só a régua mudou. Ver `lib/ai-evaluation/confidence-ruler.ts`. */
interface CurrentEvaluationMeta {
  confidence: number | null
  modelName: string | null
  promptVersion: string | null
  evaluatedAt: string | null
  justifications: Record<string, string>
}

async function loadCurrentEvaluationMeta(
  supabase: ReturnType<typeof createAdminClient>,
  currentScoreRows: Array<{ criterion_slug: string; ai_evaluation_id: string | null }>,
): Promise<CurrentEvaluationMeta | null> {
  // IDs das avaliações que respaldam as notas atuais (uma nota manual/importada
  // tem ai_evaluation_id null). Tipicamente todas as 9 apontam pra mesma.
  const evalIds = [...new Set(currentScoreRows.map((r) => r.ai_evaluation_id).filter((id): id is string => !!id))]
  if (evalIds.length === 0) return null

  const { data: evals } = await supabase
    .from("ai_evaluations")
    .select(
      "id, confidence, created_at, model_name, prompt_version, ai_evaluation_scores(criterion_slug, justification)",
    )
    .in("id", evalIds)
  if (!evals || evals.length === 0) return null

  const evalById = new Map(evals.map((e) => [e.id as string, e]))

  // Justificativa por critério, buscada na avaliação que respalda AQUELA nota
  // (robusto ao caso raro de critérios de avaliações diferentes).
  const justifications: Record<string, string> = {}
  for (const row of currentScoreRows) {
    if (!row.ai_evaluation_id) continue
    const ev = evalById.get(row.ai_evaluation_id)
    const scores = (ev?.ai_evaluation_scores ?? []) as Array<{ criterion_slug: string; justification: string | null }>
    const match = scores.find((s) => s.criterion_slug === row.criterion_slug)
    if (match?.justification) justifications[row.criterion_slug] = match.justification
  }

  // Uma confiança só pro badge "Atual": a da avaliação mais recente que respalda
  // as notas (ordena por created_at desc). A procedência sai da MESMA linha — se
  // viesse de outra, o rótulo diria um modelo e o número seria de outro.
  const mostRecent = [...evals].sort(
    (a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
  )[0]
  const confidence = mostRecent?.confidence == null ? null : Number(mostRecent.confidence)

  if (confidence == null && Object.keys(justifications).length === 0) return null
  return {
    confidence,
    modelName: (mostRecent?.model_name as string | null) ?? null,
    promptVersion: (mostRecent?.prompt_version as string | null) ?? null,
    evaluatedAt: (mostRecent?.created_at as string | null) ?? null,
    justifications,
  }
}

/**
 * Resolve o contexto externo (reviews/sinopses/similares/ratings) de uma obra,
 * escolhendo entre o caminho por IDs confirmados (candidate) e o fallback por
 * busca de título (work). Fontes rejeitadas pelo user via "Revalidar fontes"
 * são filtradas. Compartilhado entre `triggerAiEvaluation` e
 * `prewarmEvaluationContext` para garantir que ambos batam na MESMA chave do
 * `reviewContextCache` (mesma leitura de `work_external_ids` → mesma key).
 */
async function resolveEvaluationContext(
  supabase: ReturnType<typeof createAdminClient>,
  identity: {
    workId: string
    title: string
    originalTitle?: string | null
    alternativeTitles?: string[] | null
  },
) {
  const { data: extIds } = await supabase
    .from("work_external_ids")
    .select("source, external_id, is_rejected")
    .eq("work_id", identity.workId)
  const rejectedSources = (extIds ?? [])
    .filter((row) => row.is_rejected === true)
    .map((row) => row.source as string)
  const acceptedExternalIds = Object.fromEntries(
    (extIds ?? [])
      .filter((row) => row.is_rejected !== true && row.external_id)
      .map((row) => [row.source, String(row.external_id)]),
  ) as Partial<Record<ExternalSourceId, string>>
  const hasAnyExternalIds = (extIds ?? []).length > 0

  // Descoberta do hid da Comix (Peça 3): obra sem comix aceito mas com cross-ID →
  // resolve via sidecar e persiste (idempotente; reusa o persistido depois).
  // Injeta em `acceptedExternalIds` pra o caminho candidate já hidratar/coletar
  // reviews da Comix nesta execução. Fail-soft: nunca bloqueia a avaliação.
  const resolvedComixHid = await ensureComixHid({
    supabase,
    workId: identity.workId,
    title: identity.title,
    alreadyKnownHid: acceptedExternalIds.comix ?? null,
    comixRejected: rejectedSources.includes("comix"),
    crossIds: {
      anilistId: toPositiveInt(acceptedExternalIds.anilist),
      malId: toPositiveInt(acceptedExternalIds.myanimelist),
      mangaUpdatesId: acceptedExternalIds.mangaupdates,
    },
  })
  if (resolvedComixHid) acceptedExternalIds.comix = resolvedComixHid

  // Descoberta do slug do Mangago (E10B.4) — MESMO ponto do Comix, atrás da flag
  // MANGAGO_RESOLVE_ENABLED, fail-soft. Injeta `acceptedExternalIds.mangago` só em
  // resultado seguro (auto/year_confirmed/already/manual) → o candidate path hidrata
  // metadados/reviews nesta execução. Sequencial (Comix intacto); flag off = no-op.
  await resolveMangagoForEvalContext({
    supabase,
    workId: identity.workId,
    identity: { title: identity.title },
    acceptedExternalIds,
    rejectedSources,
    enabled: boolEnv(process.env.MANGAGO_RESOLVE_ENABLED, false),
  })

  const hasAcceptedExternalIds = Object.keys(acceptedExternalIds).length > 0

  const context = hasAcceptedExternalIds
    ? await fetchExternalEvaluationContextForCandidate(
        buildCandidateFromExternalIds(
          {
            title: identity.title,
            originalTitle: identity.originalTitle,
            alternativeTitles: identity.alternativeTitles,
          },
          acceptedExternalIds,
        ),
        { rejectedSources, ...AI_EVAL_REVIEW_CAPS },
      )
    : await fetchExternalEvaluationContextForWork({
        title: identity.title,
        originalTitle: identity.originalTitle,
        alternativeTitles: identity.alternativeTitles,
        rejectedSources,
      })

  return {
    context,
    acceptedExternalIds,
    rejectedSources,
    hasAnyExternalIds,
    hasAcceptedExternalIds,
    extIdsCount: (extIds ?? []).length,
  }
}

interface TriggerAiEvaluationOpts {
  /** Override do modelo Claude. Default usa o MODEL configurado no service. */
  model?: ReevalModel
  /**
   * Quando true, segue com a avaliação mesmo sem reviews externas. Sem isso, o
   * gate pré-análise retorna `needsReviewConfirmation` antes de chamar o LLM
   * para o cliente confirmar.
   */
  proceedWithoutReviews?: boolean
}

function toAdultScoreTier(v: string | null | undefined): "label" | "explicit" | null {
  return v === "label" || v === "explicit" ? v : null
}

export async function triggerAiEvaluation(workId: string, opts: TriggerAiEvaluationOpts = {}) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()

  const { data: work, error: workError } = await supabase
    .from("works")
    .select(`
      id, title, original_title, alternative_titles,
      work_tags(tags(name, tag_group_id, adult_score_tier)),
      work_genres(genres(name)),
      work_synopses(source, text, is_primary, position),
      work_covers(url, is_primary, position)
    `)
    .eq("id", workId)
    .single()

  if (workError || !work) return { error: "Obra não encontrada" }

  const tags = (
    (
      work as {
        work_tags?: Array<{
          tags?: { name?: string; tag_group_id?: string | null; adult_score_tier?: string | null }
        }>
      }
    ).work_tags ?? []
  )
    .map((wt) => wt.tags)
    .filter(
      (tag): tag is { name: string; tag_group_id?: string | null; adult_score_tier?: string | null } =>
        Boolean(tag?.name)
    )
    .map((tag) => ({
      name: tag.name,
      group: tag.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[tag.tag_group_id] ?? null) : null,
      adultScoreTier: toAdultScoreTier(tag.adult_score_tier),
    }))

  const genreNames = ((work as { work_genres?: Array<{ genres?: { name?: string } | null }> }).work_genres ?? [])
    .map((wg) => wg.genres?.name)
    .filter((name): name is string => Boolean(name))

  // Snapshot dos scores atuais — usado pelo review form para mostrar diff
  // entre nota atual e a sugestão nova da IA. `ai_evaluation_id` liga cada nota
  // à avaliação que a gerou → dá pra buscar confiança + justificativa "atuais".
  const { data: currentScoreRows } = await supabase
    .from("category_scores")
    .select("criterion_slug, score, ai_evaluation_id")
    .eq("work_id", workId)
  const currentScores: Record<string, number> = Object.fromEntries(
    (currentScoreRows ?? []).map((row) => [row.criterion_slug, Number(row.score)])
  )
  // Confiança + justificativas da avaliação que respalda as notas ATUAIS (a
  // anterior). Null quando as notas não vieram de IA (manual/import) ou a obra
  // nunca foi avaliada — nesse caso a coluna "Atual" não mostra esses extras.
  const currentEvaluation = await loadCurrentEvaluationMeta(supabase, currentScoreRows ?? [])

  // Setado após o insert (que agora ocorre depois do gate). Usado pelo catch
  // pra marcar a avaliação como failed — se o erro acontecer antes do insert
  // (ex.: busca de contexto externo), não há linha pra atualizar.
  let evaluationId: string | null = null

  try {
    // Busca de contexto externo (reviews/sinopses/similares/ratings). O helper
    // escolhe o caminho (candidate vs. work) e filtra fontes rejeitadas. Timing
    // separado pra diagnosticar o gargalo (busca externa vs. chamada do LLM).
    const externalStart = Date.now()
    const {
      context,
      acceptedExternalIds,
      rejectedSources,
      hasAnyExternalIds,
      hasAcceptedExternalIds,
      extIdsCount,
    } = await resolveEvaluationContext(supabase, {
      workId,
      title: work.title,
      originalTitle: work.original_title,
      alternativeTitles: work.alternative_titles,
    })
    const { externalContext, platformRatings, similarWorks, contentRatings } = context
    const freshPool = context.allReviews ?? []

    // Mesclagem de robustez (sucede o fallback binário F0.3b): a busca fresca
    // depende do sidecar/FlareSolverr pras fontes atrás de Cloudflare — quando a
    // fila satura (503 busy) ou o CF bloqueia, elas devolvem 0 e o prompt sairia
    // com 1–2 reviews mesmo com dezenas já colhidas em work_reviews. O fallback
    // antigo só disparava com ZERO frescas ("1 fresca" vencia "77 persistidas").
    // Agora o prompt seleciona da UNIÃO fresco+persistido (dedup por fonte+texto,
    // rejeitadas fora). Sem recuperação, `sourcedReviews` fica byte-idêntico ao
    // fresco — preserva o input_hash do cache no caso normal.
    const persisted = await loadWorkReviewsAsSourced(workId)
    const { merged: promptPool, recovered } = mergeFreshWithPersistedReviews(
      freshPool,
      persisted,
      rejectedSources,
    )
    const sourcedReviews =
      recovered > 0
        ? selectReviewsForEvaluation(promptPool, AI_EVAL_REVIEW_CAPS)
        : context.sourcedReviews
    if (recovered > 0) {
      console.log(
        `[ai-eval reviews] busca fresca trouxe ${freshPool.length} → recuperadas ${recovered} do pool persistido (prompt seleciona de ${promptPool.length})`,
      )
    }
    const externalMs = Date.now() - externalStart

    // Reviews EXTERNAS adicionadas à mão (work_external_reviews_manual) — fallback para
    // quando a busca automática acha poucas/nenhuma. São tratadas como evidência DIRETA:
    // sempre entram no prompt (prepend → recebem R1…), nunca passam pelo cap/sampler das
    // scrapadas. SEM nota pessoal (não é opinião da usuária). A fonte é REAL (anilist,
    // mangaupdates…) e válida em ExternalSourceId; `isManual` marca a origem manual.
    const manualExternal = await readManualExternalReviewsForDisplay(workId)
    const manualSourced: SourcedReview[] = manualExternal.map((m) => ({
      source: m.source as ExternalSourceId,
      sourceTitle: work.title,
      matchScore: 1,
      text: m.text,
      userRating: undefined,
      textLength: m.text.length,
      isManual: true,
    }))
    const effectiveSourcedReviews: SourcedReview[] = [...manualSourced, ...(sourcedReviews ?? [])]

    // Diagnóstico do motivo de "sem reviews externas". Renderizado na UI de
    // revisão para indicar a ação certa (atribuir fontes, revisar rejeições, etc.).
    // Reviews manuais contam como reviews: se houver alguma, o motivo é null.
    const noReviewsReason: "no_external_ids" | "all_rejected" | "search_miss" | "sources_returned_empty" | null =
      (effectiveSourcedReviews.length) > 0
        ? null
        : hasAcceptedExternalIds
          ? "sources_returned_empty"
          : hasAnyExternalIds && rejectedSources.length === extIdsCount
            ? "all_rejected"
            : hasAnyExternalIds
              ? "search_miss"
              : "no_external_ids"

    // Persiste o pool FRESCO completo (pode passar de 100 reviews), não só o
    // subset capeado que vai pro prompt — recomendação usa essa base pra escolher
    // top reviews por candidato. Só o fresco: o promptPool inclui reviews que JÁ
    // estão em work_reviews (re-gravar seria delete+insert idêntico), e o merge
    // por fonte do saveWorkReviews preserva as fontes ausentes desta rodada.
    // Pool fresco vazio = no-op interno do saveWorkReviews.
    await saveWorkReviews(workId, freshPool)

    // Debug: detalha o pipeline de reviews durante a avaliação. Útil pra
    // entender por que a IA recebeu N reviews quando esperava-se mais.
    const sourceCounts: Record<string, number> = {}
    for (const r of promptPool) {
      sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1
    }
    const sentCounts: Record<string, number> = {}
    for (const r of sourcedReviews ?? []) {
      sentCounts[r.source] = (sentCounts[r.source] ?? 0) + 1
    }
    console.log(
      `[ai-eval reviews] work="${work.title}" hasAcceptedExternalIds=${hasAcceptedExternalIds} accepted=${JSON.stringify(acceptedExternalIds)} rejected=${JSON.stringify(rejectedSources)} poolFresh=${freshPool.length} recovered=${recovered} pool=${promptPool.length} (${JSON.stringify(sourceCounts)}) manual=${manualSourced.length} sent=${effectiveSourcedReviews.length} (${JSON.stringify(sentCounts)})`
    )

    const synopses = (work as { work_synopses?: Array<{ source?: string | null; text?: string | null; is_primary?: boolean | null; position?: number | null }> }).work_synopses ?? []
    // TODAS as sinopses persistidas entram no prompt: a primária como referência
    // principal e as demais como blocos [S1]…[Sn] (manuais = autoridade alta).
    const { primary: primarySynopsis, primaryIsManual: synopsisIsManual, additional: additionalSynopses } =
      splitSynopsesForEvaluation(synopses)
    // Bloco [C] fresco que é a MESMA sinopse já persistida vira ruído (e custo)
    // duplicado no prompt. O filtro só roda quando há adicionais: sem elas o input
    // fica byte-idêntico ao anterior e preserva o input_hash do cache de avaliação.
    const persistedSynopsisTexts = [primarySynopsis, ...additionalSynopses.map((s) => s.text)]
    const effectiveExternalContext = additionalSynopses.length
      ? externalContext.filter((block) => !persistedSynopsisTexts.some((text) => isSameSynopsis(text, block)))
      : externalContext

    const covers = (work as { work_covers?: Array<{ url?: string | null; is_primary?: boolean | null; position?: number | null }> }).work_covers ?? []
    const coverUrl = pickPrimaryCover(covers)

    // Gate pré-análise: sem NENHUMA review (externa ou manual), deixa o cliente
    // decidir se segue mesmo assim antes de gastar a chamada do LLM. Ainda não
    // inserimos a linha de ai_evaluations aqui, então não fica avaliação órfã
    // "processing". Reviews manuais saltam o gate (o usuário já optou por seguir).
    if (effectiveSourcedReviews.length === 0 && !opts.proceedWithoutReviews) {
      return {
        needsReviewConfirmation: true as const,
        noReviewsReason,
        workTitle: work.title,
      }
    }

    const { data: evaluation, error: evalError } = await supabase
      .from("ai_evaluations")
      .insert({
        work_id: workId,
        status: "processing",
      })
      .select("id")
      .single()
    if (evalError) return { error: evalError.message }
    evaluationId = evaluation.id

    const claudeStart = Date.now()
    const response = await requestAiEvaluation({
      workId,
      title: work.title,
      synopsis: primarySynopsis ?? undefined,
      synopsisIsManual,
      additionalSynopses,
      genres: genreNames,
      tags,
      sourcedReviews: effectiveSourcedReviews,
      externalContext: effectiveExternalContext,
      platformRatings,
      similarWorks,
      contentRatings,
      coverUrl,
      model: resolveModelOverride(opts.model),
    })
    const claudeMs = Date.now() - claudeStart
    console.log(
      `[ai-eval timing] work="${work.title}" path=${hasAcceptedExternalIds ? "candidate" : "work"} externalMs=${externalMs} claudeMs=${claudeMs} totalMs=${externalMs + claudeMs} fromCache=${response.fromCache ?? "no"}`
    )

    // Injeta noReviewsReason no evaluationContext do raw_response. O service
    // monta o evaluationContext mas não tem visibilidade do estado de
    // work_external_ids — esse diagnóstico só faz sentido aqui.
    // `pgSafeDeep`: o raw_response embute o texto CRU das reviews externas, e uma
    // review cortada no meio de um emoji (`.slice(0, 900)` dos conectores) deixa
    // meio par surrogate que o PostgREST recusa — o jsonb inteiro volta 400.
    const mergedRawResponse: Record<string, unknown> = pgSafeDeep((() => {
      const base = (response.rawResponse ?? {}) as Record<string, unknown>
      const existingCtx = (base.evaluationContext ?? {}) as Record<string, unknown>
      return {
        ...base,
        evaluationContext: {
          ...existingCtx,
          noReviewsReason,
          // Quantas reviews do prompt vieram do pool persistido (work_reviews) em
          // vez da busca fresca — diagnóstico de degradação das fontes CF-gated.
          reviewsRecoveredFromPersisted: recovered,
        },
      }
    })())

    const scoresToInsert = response.scores.map((s) => ({
      ai_evaluation_id: evaluation.id,
      criterion_slug: s.criterionSlug,
      suggested_score: s.suggestedScore,
      justification: pgSafeText(s.justification),
    }))

    const { error: scoresError } = await supabase.from("ai_evaluation_scores").insert(scoresToInsert)
    if (scoresError) throw new Error(`falha ao gravar as notas da avaliação: ${scoresError.message}`)

    // 🔴 Estes dois `await` não checavam erro, e o preço foi medido em 2026-08-18:
    // o PATCH voltou **400** (surrogate solto vindo de uma review), o código seguiu
    // em frente, e a obra ficou com uma avaliação MEIO GRAVADA — `status:
    // processing`, sem summary, sem confidence, sem model_name, sem raw_response —
    // que o select abaixo leu e devolveu ao cliente como se estivesse pronta. O
    // popup de revisão abriu com o topo em branco e as 9 notas presentes: erro que
    // produz resultado, sem erro nenhum na tela.
    const completedPatch = {
      status: "completed" as const,
      model_name: response.modelName,
      prompt_version: response.promptVersion,
      summary: pgSafeText(response.summary ?? null),
      confidence: response.confidence,
      input_hash: response.inputHash,
    }
    const { error: completeError } = await supabase
      .from("ai_evaluations")
      .update({ ...completedPatch, raw_response: mergedRawResponse })
      .eq("id", evaluation.id)
    if (completeError) {
      // 2ª tentativa SEM o `raw_response`: ele é o único campo que carrega texto
      // externo em bruto, e é diagnóstico. Descartá-lo custa o painel "Dados usados
      // na avaliação"; abortar aqui jogaria fora a chamada PAGA que já foi feita.
      console.error(
        `[ai-eval] update da avaliação falhou (${completeError.message}) — regravando sem raw_response`,
      )
      const { error: retryError } = await supabase
        .from("ai_evaluations")
        .update(completedPatch)
        .eq("id", evaluation.id)
      if (retryError) throw new Error(`falha ao concluir a avaliação: ${retryError.message}`)
    }

    const { data: completedEvaluation, error: completedError } = await supabase
      .from("ai_evaluations")
      .select("*, ai_evaluation_scores(*)")
      .eq("id", evaluation.id)
      .single()

    if (completedError) return { error: completedError.message }

    const { error: workStatusError } = await supabase
      .from("works")
      // avaliação fresca ⇒ não está mais desatualizada por reviews (migration 120)
      .update({ ai_eval_status: "review_pending", ai_eval_reviews_stale: false })
      .eq("id", workId)
    // Não aborta: a avaliação está gravada e revisável. Mas sem log a obra sumiria
    // da fila de revisão sem nada acusar.
    if (workStatusError) {
      console.error(`[ai-eval] não deu pra marcar review_pending: ${workStatusError.message}`)
    }

    revalidatePath(`/catalog/${workId}`)
    revalidatePath("/curation/works")
    revalidateTag("ai-eval-tab-counts", "max")
    return { data: { evaluation: completedEvaluation as AiEvaluation, currentScores, currentEvaluation, reviewsUsed: response.reviewsUsed } }
  } catch (err) {
    if (evaluationId) {
      await supabase
        .from("ai_evaluations")
        .update({ status: "failed" })
        .eq("id", evaluationId)
    }
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * Carrega a avaliação que já está esperando revisão. **Só leitura: não chama o
 * LLM, não grava nada, não custa nada.**
 *
 * 🔴 Isto faltava, e a ausência quebrava o ciclo no meio. `review_pending`
 * significa "a IA já rodou, falta você conferir" — mas a única porta pro modal de
 * revisão era `triggerAiEvaluation`, ou seja, **pagar outra avaliação pra ver a
 * que já estava pronta**. O próprio app prometia o contrário: ao terminar uma
 * avaliação, o toast oferece "Revisar" apontando pra `/curation/works`
 * (`components/titles/ai-evaluation-button.tsx`), e a página não sabia revisar.
 *
 * Devolve a MESMA forma que o caminho pago (`{ evaluation, currentScores,
 * currentEvaluation }`), porque quem consome é o mesmo `AiEvaluationReviewForm` —
 * montar um segundo formato aqui faria as duas telas divergirem na primeira
 * mudança do formulário.
 *
 * ⚠️ `currentEvaluation` é a avaliação que respalda as notas **atuais** (a
 * anterior), não esta. É ela que dá a coluna "Atual" do diff. Numa obra já
 * revisada as duas coincidem e o diff fica vazio — por isso quem chama mostra o
 * botão só quando a obra está de fato em `review_pending`.
 */
export async function loadAiEvaluationForReview(workId: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()

  const { data: evaluation, error } = await supabase
    .from("ai_evaluations")
    .select("*, ai_evaluation_scores(*)")
    .eq("work_id", workId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!evaluation) return { error: "Esta obra não tem avaliação concluída para revisar." }

  const { data: currentScoreRows } = await supabase
    .from("category_scores")
    .select("criterion_slug, score, ai_evaluation_id")
    .eq("work_id", workId)

  const currentScores: Record<string, number> = Object.fromEntries(
    (currentScoreRows ?? []).map((row) => [row.criterion_slug, Number(row.score)]),
  )
  const currentEvaluation = await loadCurrentEvaluationMeta(supabase, currentScoreRows ?? [])

  return { data: { evaluation: evaluation as AiEvaluation, currentScores, currentEvaluation } }
}

/**
 * Pré-aquece o cache de contexto externo (`reviewContextCache`, TTL ~5min) de
 * uma obra, sem chamar o LLM nem gravar nada. Disparado pela UI quando a obra
 * entra na fila do Avaliar (ou no hover do botão) pra que `triggerAiEvaluation`
 * encontre o contexto já pronto e pule a busca externa (o gargalo de cauda).
 * Best-effort: usa a MESMA `resolveEvaluationContext` do trigger pra bater na
 * mesma chave de cache; erros são engolidos (é só otimização).
 */
export async function prewarmEvaluationContext(workId: string): Promise<{ ok: boolean }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false }
  try {
    const supabase = createAdminClient()
    const { data: work, error } = await supabase
      .from("works")
      .select("id, title, original_title, alternative_titles")
      .eq("id", workId)
      .single()
    if (error || !work) return { ok: false }

    const start = Date.now()
    await resolveEvaluationContext(supabase, {
      workId,
      title: work.title,
      originalTitle: work.original_title,
      alternativeTitles: work.alternative_titles,
    })
    console.log(`[ai-eval prewarm] work="${work.title}" ms=${Date.now() - start}`)
    return { ok: true }
  } catch (err) {
    console.warn("[ai-eval prewarm] falhou (ignorado):", err instanceof Error ? err.message : err)
    return { ok: false }
  }
}

export interface AiReviewSubmission {
  evaluationId: string
  workId: string
  scores: Array<{
    criterionSlug: string
    acceptedScore: number
    wasEdited: boolean
  }>
}

/**
 * Marca como `superseded` as sugestões de calibração cujas notas uma avaliação nova está
 * prestes a sobrescrever, e devolve os critérios afetados.
 *
 * Não exportada de propósito: em arquivo `"use server"` todo export vira endpoint HTTP, e
 * isto é detalhe interno de `submitAiReview`.
 */
async function markCalibrationOverwritten(workId: string, slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("category_scores")
    .select("criterion_slug")
    .eq("work_id", workId)
    .eq("source", "ai_calibrated")
    .in("criterion_slug", slugs)
  if (error) {
    console.error("[calibration] erro checando notas calibradas antes de sobrescrever:", error.message)
    return []
  }
  const affected = (data ?? []).map((r) => r.criterion_slug as string)
  if (affected.length === 0) return []

  // `superseded` e não `reverted`: ninguém desfez a decisão da curadora — um julgamento
  // mais fresco tomou o lugar dela. É o mesmo sentido que o status já tem quando um run
  // novo substitui a pendente anterior.
  const { error: updError } = await supabase
    .from("score_calibration_suggestions")
    .update({ status: "superseded", reviewed_at: new Date().toISOString() })
    .eq("work_id", workId)
    .in("criterion_slug", affected)
    .in("status", ["auto_applied", "accepted", "edited"])
  if (updError) {
    console.error("[calibration] erro marcando sugestão sobrescrita:", updError.message)
  }
  return affected
}

export async function submitAiReview(submission: AiReviewSubmission) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { data: null, error: gate.error }
  const supabase = createAdminClient()

  if (submission.scores.length === 0) {
    return { data: null, error: "Nenhuma nota para salvar" }
  }

  for (const s of submission.scores) {
    const { error } = await supabase
      .from("ai_evaluation_scores")
      .update({
        accepted_score: s.acceptedScore,
        was_accepted: true,
        was_edited: s.wasEdited,
      })
      .eq("ai_evaluation_id", submission.evaluationId)
      .eq("criterion_slug", s.criterionSlug)

    if (error) return { data: null, error: error.message }
  }

  const categoryScores = submission.scores.map((s) => ({
    work_id: submission.workId,
    criterion_slug: s.criterionSlug,
    score: s.acceptedScore,
    source: s.wasEdited ? ("ai_edited" as const) : ("ai_accepted" as const),
    ai_evaluation_id: submission.evaluationId,
  }))

  // 🔴 Este upsert APAGA calibração, e por muito tempo apagou calado: medido em 2026-08-16,
  // 44 notas que a auditoria tinha aplicado já haviam voltado a `ai_accepted` por uma
  // reavaliação posterior — a curadoria some e a linha de histórico segue dizendo
  // "aplicada". Sobrescrever está CERTO (a avaliação nova é evidência mais fresca, e ela
  // acabou de passar pelo formulário de revisão); o que não pode é o silêncio.
  const overwrittenSlugs = await markCalibrationOverwritten(
    submission.workId,
    submission.scores.map((s) => s.criterionSlug),
  )

  const { error: upsertError } = await supabase
    .from("category_scores")
    .upsert(categoryScores, { onConflict: "work_id,criterion_slug" })

  if (upsertError) return { data: null, error: upsertError.message }
  if (overwrittenSlugs.length > 0) {
    console.log(
      `[calibration] avaliação nova sobrescreveu ${overwrittenSlugs.length} nota(s) calibrada(s) ` +
        `na obra ${submission.workId}: ${overwrittenSlugs.join(", ")}`,
    )
  }

  const { error: workError } = await supabase
    .from("works")
    // scores aceitos ⇒ avaliação em dia com as reviews atuais (migration 120)
    .update({ ai_eval_status: "done", ai_eval_reviews_stale: false })
    .eq("id", submission.workId)

  if (workError) return { data: null, error: workError.message }

  // Aceitar uma nova avaliação IA muda as notas por critério → invalida o IA Rk
  // (alignment_score) persistido. Marca como desatualizado (re-rank é manual).
  await markWorkAlignmentStale(submission.workId)

  // Aceitar a avaliação muda as notas por critério (features do Ridge global) →
  // marca recálculo pendente em vez de recalcular na hora. Coerente com avaliar
  // vários títulos em sequência: a Nota Prevista entra no batch e atualiza no
  // "Recalcular agora" ou no auto-recalc (≥1h sem novas edições).
  await markRecalcPending("submitAiReview")

  revalidatePath(`/catalog/${submission.workId}`)
  revalidatePath("/curation/works")
  revalidatePath("/ranking")
  revalidateTag("ai-eval-tab-counts", "max")
  return { data: null, error: null }
}

export async function skipAiEvaluation(workId: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { data: null, error: gate.error }
  const supabase = createAdminClient()
  await supabase
    .from("works")
    .update({ ai_eval_status: "skipped" })
    .eq("id", workId)
  revalidatePath("/curation/works")
  revalidateTag("ai-eval-tab-counts", "max")
  return { data: null, error: null }
}
