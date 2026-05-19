"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requestAiEvaluation } from "@/lib/ai-evaluation/service"
import {
  buildCandidateFromExternalIds,
  fetchExternalEvaluationContextForCandidate,
  fetchExternalEvaluationContextForWork,
} from "@/lib/external/index"
import type { ExternalSourceId } from "@/lib/external/types"
import { recalculateWork } from "./calculations"
import type { AiEvaluation } from "@/types/domain"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"

export async function triggerAiEvaluation(workId: string) {
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

  const { data: evaluation, error: evalError } = await supabase
    .from("ai_evaluations")
    .insert({
      work_id: workId,
      status: "processing",
    })
    .select("id")
    .single()

  if (evalError) return { error: evalError.message }

  try {
    // Fontes que o user explicitamente rejeitou via "Revalidar fontes" não
    // entram na busca por reviews (evita reviews de matches errados).
    const { data: extIds } = await supabase
      .from("work_external_ids")
      .select("source, external_id, is_rejected")
      .eq("work_id", workId)
    const rejectedSources = (extIds ?? [])
      .filter((row) => row.is_rejected === true)
      .map((row) => row.source as string)
    const acceptedExternalIds = Object.fromEntries(
      (extIds ?? [])
        .filter((row) => row.is_rejected !== true && row.external_id)
        .map((row) => [row.source, String(row.external_id)])
    ) as Partial<Record<ExternalSourceId, string>>

    const hasAcceptedExternalIds = Object.keys(acceptedExternalIds).length > 0
    const { sourcedReviews, externalContext } = hasAcceptedExternalIds
      ? await fetchExternalEvaluationContextForCandidate(
          buildCandidateFromExternalIds({
            title: work.title,
            originalTitle: work.original_title,
            alternativeTitles: work.alternative_titles,
          }, acceptedExternalIds),
          { rejectedSources, perSource: 6, total: 20 }
        )
      : await fetchExternalEvaluationContextForWork({
          title: work.title,
          originalTitle: work.original_title,
          alternativeTitles: work.alternative_titles,
          rejectedSources,
        })

    const synopses = (work as { work_synopses?: Array<{ source?: string | null; text?: string | null; is_primary?: boolean | null; position?: number | null }> }).work_synopses ?? []
    const primarySynopsisRow = synopses.find((s) => s?.is_primary) ?? null
    const synopsisIsManual = primarySynopsisRow?.source === "manual"

    const covers = (work as { work_covers?: Array<{ url?: string | null; is_primary?: boolean | null; position?: number | null }> }).work_covers ?? []
    const coverUrl = pickPrimaryCover(covers)

    const response = await requestAiEvaluation({
      workId,
      title: work.title,
      synopsis: pickPrimarySynopsis(synopses) ?? undefined,
      synopsisIsManual,
      genres: genreNames,
      tags,
      sourcedReviews,
      externalContext,
      coverUrl,
    })

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
        raw_response: response.rawResponse as Record<string, unknown>,
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
      .update({ ai_eval_status: "pending" })
      .eq("id", workId)

    revalidatePath(`/titles/${workId}`)
    revalidatePath("/ai-evaluation")
    return { data: { evaluation: completedEvaluation as AiEvaluation, currentScores, reviewsUsed: response.reviewsUsed } }
  } catch (err) {
    await supabase
      .from("ai_evaluations")
      .update({ status: "failed" })
      .eq("id", evaluation.id)
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
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

  await recalculateWork(submission.workId)

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
