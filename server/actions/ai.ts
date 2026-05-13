"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requestAiEvaluation } from "@/lib/ai-evaluation/service"
import { fetchExternalEvaluationContextForWork } from "@/lib/external/index"
import { recalculateWork } from "./calculations"
import type { AiEvaluation } from "@/types/domain"

export async function triggerAiEvaluation(workId: string) {
  const supabase = createAdminClient()

  const { data: work, error: workError } = await supabase
    .from("works")
    .select(`
      id, title, original_title, alternative_titles, synopsis, genres,
      work_tags(tags(name))
    `)
    .eq("id", workId)
    .single()

  if (workError || !work) return { error: "Obra não encontrada" }

  const tagNames = ((work as { work_tags?: Array<{ tags?: { name?: string } }> }).work_tags ?? [])
    .map((wt) => wt.tags?.name)
    .filter((name): name is string => Boolean(name))

  const { data: evaluation, error: evalError } = await supabase
    .from("ai_evaluations")
    .insert({
      work_id: workId,
      status: "processing",
      prompt_version: "v8",
    })
    .select("id")
    .single()

  if (evalError) return { error: evalError.message }

  try {
    const { sourcedReviews, externalContext } = await fetchExternalEvaluationContextForWork({
      title: work.title,
      originalTitle: work.original_title,
      alternativeTitles: work.alternative_titles,
    })

    const response = await requestAiEvaluation({
      workId,
      title: work.title,
      synopsis: work.synopsis ?? undefined,
      genres: work.genres ?? [],
      tags: tagNames,
      sourcedReviews,
      externalContext,
      promptVersion: "v8",
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
    return { data: { evaluation: completedEvaluation as AiEvaluation } }
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
