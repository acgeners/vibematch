"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { AI_EVAL_REVIEW_CAPS, requestAiEvaluation } from "@/lib/ai-evaluation/service"
import {
  buildCandidateFromExternalIds,
  fetchExternalEvaluationContextForCandidate,
  fetchExternalEvaluationContextForWork,
} from "@/lib/external/index"
import { saveWorkReviews } from "@/lib/external/persist-reviews"
import type { ExternalSourceId } from "@/lib/external/types"
import { recalculateWork } from "./calculations"
import { markWorkAlignmentStale } from "@/server/queries/alignment"
import type { AiEvaluation } from "@/types/domain"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"

const OPUS_MODEL_ID = "claude-opus-4-7"
const SONNET_MODEL_ID = "claude-sonnet-4-6"
const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001"

type ReevalModel = "sonnet" | "opus" | "haiku"

function resolveModelOverride(model: ReevalModel | undefined): string | undefined {
  if (model === "opus") return OPUS_MODEL_ID
  if (model === "sonnet") return SONNET_MODEL_ID
  if (model === "haiku") return HAIKU_MODEL_ID
  return undefined
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

export async function triggerAiEvaluation(workId: string, opts: TriggerAiEvaluationOpts = {}) {
  const supabase = createAdminClient()

  const { data: work, error: workError } = await supabase
    .from("works")
    .select(`
      id, title, original_title, alternative_titles,
      work_tags(tags(name, tag_group_id)),
      work_genres(genres(name)),
      work_synopses(source, text, is_primary, position),
      work_covers(url, is_primary, position)
    `)
    .eq("id", workId)
    .single()

  if (workError || !work) return { error: "Obra não encontrada" }

  const tags = ((work as { work_tags?: Array<{ tags?: { name?: string; tag_group_id?: string | null } }> }).work_tags ?? [])
    .map((wt) => wt.tags)
    .filter((tag): tag is { name: string; tag_group_id?: string | null } => Boolean(tag?.name))
    .map((tag) => ({
      name: tag.name,
      group: tag.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[tag.tag_group_id] ?? null) : null,
    }))

  const genreNames = ((work as { work_genres?: Array<{ genres?: { name?: string } | null }> }).work_genres ?? [])
    .map((wg) => wg.genres?.name)
    .filter((name): name is string => Boolean(name))

  // Snapshot dos scores atuais — usado pelo review form para mostrar diff
  // entre nota atual e a sugestão nova da IA.
  const { data: currentScoreRows } = await supabase
    .from("category_scores")
    .select("criterion_slug, score")
    .eq("work_id", workId)
  const currentScores: Record<string, number> = Object.fromEntries(
    (currentScoreRows ?? []).map((row) => [row.criterion_slug, Number(row.score)])
  )

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
      context: { sourcedReviews, allReviews, externalContext, platformRatings, similarWorks, contentRatings },
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
    const externalMs = Date.now() - externalStart

    // Diagnóstico do motivo de "sem reviews externas". Renderizado na UI de
    // revisão para indicar a ação certa (atribuir fontes, revisar rejeições, etc.).
    const noReviewsReason: "no_external_ids" | "all_rejected" | "search_miss" | "sources_returned_empty" | null =
      (sourcedReviews?.length ?? 0) > 0
        ? null
        : hasAcceptedExternalIds
          ? "sources_returned_empty"
          : hasAnyExternalIds && rejectedSources.length === extIdsCount
            ? "all_rejected"
            : hasAnyExternalIds
              ? "search_miss"
              : "no_external_ids"

    // Persiste o pool completo (pode passar de 100 reviews), não só o subset
    // capeado que vai pro prompt — recomendação usa essa base pra escolher
    // top reviews por candidato.
    await saveWorkReviews(workId, allReviews ?? [])

    // Debug: detalha o pipeline de reviews durante a avaliação. Útil pra
    // entender por que a IA recebeu N reviews quando esperava-se mais.
    const sourceCounts: Record<string, number> = {}
    for (const r of allReviews ?? []) {
      sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1
    }
    const sentCounts: Record<string, number> = {}
    for (const r of sourcedReviews ?? []) {
      sentCounts[r.source] = (sentCounts[r.source] ?? 0) + 1
    }
    console.log(
      `[ai-eval reviews] work="${work.title}" hasAcceptedExternalIds=${hasAcceptedExternalIds} accepted=${JSON.stringify(acceptedExternalIds)} rejected=${JSON.stringify(rejectedSources)} pool=${allReviews?.length ?? 0} (${JSON.stringify(sourceCounts)}) sent=${sourcedReviews?.length ?? 0} (${JSON.stringify(sentCounts)})`
    )

    const synopses = (work as { work_synopses?: Array<{ source?: string | null; text?: string | null; is_primary?: boolean | null; position?: number | null }> }).work_synopses ?? []
    const primarySynopsisRow = synopses.find((s) => s?.is_primary) ?? null
    const synopsisIsManual = primarySynopsisRow?.source === "manual"

    const covers = (work as { work_covers?: Array<{ url?: string | null; is_primary?: boolean | null; position?: number | null }> }).work_covers ?? []
    const coverUrl = pickPrimaryCover(covers)

    // Gate pré-análise: sem reviews externas, deixa o cliente decidir se segue
    // mesmo assim antes de gastar a chamada do LLM. Ainda não inserimos a linha
    // de ai_evaluations aqui, então não fica avaliação órfã "processing".
    if ((sourcedReviews?.length ?? 0) === 0 && !opts.proceedWithoutReviews) {
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
      synopsis: pickPrimarySynopsis(synopses) ?? undefined,
      synopsisIsManual,
      genres: genreNames,
      tags,
      sourcedReviews,
      externalContext,
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
    const mergedRawResponse: Record<string, unknown> = (() => {
      const base = (response.rawResponse ?? {}) as Record<string, unknown>
      const existingCtx = (base.evaluationContext ?? {}) as Record<string, unknown>
      return {
        ...base,
        evaluationContext: {
          ...existingCtx,
          noReviewsReason,
        },
      }
    })()

    const scoresToInsert = response.scores.map((s) => ({
      ai_evaluation_id: evaluation.id,
      criterion_slug: s.criterionSlug,
      suggested_score: s.suggestedScore,
      justification: s.justification,
    }))

    await supabase.from("ai_evaluation_scores").insert(scoresToInsert)

    await supabase
      .from("ai_evaluations")
      .update({
        status: "completed",
        model_name: response.modelName,
        prompt_version: response.promptVersion,
        summary: response.summary,
        confidence: response.confidence,
        raw_response: mergedRawResponse,
        input_hash: response.inputHash,
      })
      .eq("id", evaluation.id)

    const { data: completedEvaluation, error: completedError } = await supabase
      .from("ai_evaluations")
      .select("*, ai_evaluation_scores(*)")
      .eq("id", evaluation.id)
      .single()

    if (completedError) return { error: completedError.message }

    await supabase
      .from("works")
      .update({ ai_eval_status: "review_pending" })
      .eq("id", workId)

    revalidatePath(`/titles/${workId}`)
    revalidatePath("/ai-evaluation")
    return { data: { evaluation: completedEvaluation as AiEvaluation, currentScores, reviewsUsed: response.reviewsUsed } }
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
 * Pré-aquece o cache de contexto externo (`reviewContextCache`, TTL ~5min) de
 * uma obra, sem chamar o LLM nem gravar nada. Disparado pela UI quando a obra
 * entra na fila do Avaliar (ou no hover do botão) pra que `triggerAiEvaluation`
 * encontre o contexto já pronto e pule a busca externa (o gargalo de cauda).
 * Best-effort: usa a MESMA `resolveEvaluationContext` do trigger pra bater na
 * mesma chave de cache; erros são engolidos (é só otimização).
 */
export async function prewarmEvaluationContext(workId: string): Promise<{ ok: boolean }> {
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

export async function submitAiReview(submission: AiReviewSubmission) {
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

  const { error: upsertError } = await supabase
    .from("category_scores")
    .upsert(categoryScores, { onConflict: "work_id,criterion_slug" })

  if (upsertError) return { data: null, error: upsertError.message }

  const { error: workError } = await supabase
    .from("works")
    .update({ ai_eval_status: "done" })
    .eq("id", submission.workId)

  if (workError) return { data: null, error: workError.message }

  // Aceitar uma nova avaliação IA muda as notas por critério → invalida o IA Rk
  // (alignment_score) persistido. Marca como desatualizado (re-rank é manual).
  await markWorkAlignmentStale(submission.workId)

  after(async () => {
    try {
      await recalculateWork(submission.workId)
    } catch (error) {
      console.error("[submitAiReview] Failed to recalculate scores", error)
    }
  })

  revalidatePath(`/titles/${submission.workId}`)
  revalidatePath("/ai-evaluation")
  revalidatePath("/ranking")
  return { data: null, error: null }
}

export async function skipAiEvaluation(workId: string) {
  const supabase = createAdminClient()
  await supabase
    .from("works")
    .update({ ai_eval_status: "skipped" })
    .eq("id", workId)
  revalidatePath("/ai-evaluation")
  return { data: null, error: null }
}
