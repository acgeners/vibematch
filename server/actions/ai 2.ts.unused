"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requestAiEvaluation } from "@/lib/ai-evaluation/service"
import { recalculateWork } from "./calculations"
import type { AiEvaluation } from "@/types/domain"

export async function triggerAiEvaluation(workId: string) {
  const supabase = await createClient()

  // Buscar título + contexto para a IA
  const { data: work, error: workError } = await supabase
    .from("works")
    .select(`
      id, title, synopsis, genres,
      work_tags(tags(name))
    `)
    .eq("id", workId)
    .single()

  if (workError || !work) return { error: "Obra não encontrada" }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tagNames = ((work as any).work_tags ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((wt: any) => wt.tags?.name as string)
    .filter(Boolean)

  // Criar registro da avaliação
  const { data: evaluation, error: evalError } = await supabase
    .from("ai_evaluations")
    .insert({
      work_id: workId,
      status: "processing",
      prompt_version: "v3",
    })
    .select("id")
    .single()

  if (evalError) return { error: evalError.message }

  try {
    const response = await requestAiEvaluation({
      workId,
      title: work.title,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      synopsis: (work as any).synopsis ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      genres: (work as any).genres ?? [],
      tags: tagNames,
      promptVersion: "v3",
    })

    // Salvar scores sugeridos
    const scoresToInsert = response.scores.map((s) => ({
      ai_evaluation_id: evaluation.id,
      criterion_slug: s.criterionSlug,
      suggested_score: s.suggestedScore,
      justification: s.justification,
    }))

    await supabase.from("ai_evaluation_scores").insert(scoresToInsert)

    // Marcar avaliação como concluída
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

    // Mantém como pending até o usuário revisar e aprovar as notas.
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
  const supabase = await createClient()

  if (submission.scores.length === 0) {
    return { data: null, error: "Nenhuma nota para salvar" }
  }

  // Atualizar cada score na avaliação
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

  // Upsert em category_scores com os valores aceitos
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

  // Marcar obra como avaliada
  const { error: workError } = await supabase
    .from("works")
    .update({ ai_eval_status: "done" })
    .eq("id", submission.workId)

  if (workError) return { data: null, error: workError.message }

  // Recalcular
  await recalculateWork(submission.workId)

  revalidatePath(`/titles/${submission.workId}`)
  revalidatePath("/ai-evaluation")
  revalidatePath("/ranking")
  return { data: null, error: null }
}

export async function skipAiEvaluation(workId: string) {
  const supabase = await createClient()
  await supabase
    .from("works")
    .update({ ai_eval_status: "skipped" })
    .eq("id", workId)
  revalidatePath("/ai-evaluation")
  return { data: null, error: null }
}
