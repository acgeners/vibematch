"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimarySynopsis } from "@/lib/work-derived"
import type { ManualReview } from "@/types/domain"

/**
 * Carrega as entradas editáveis da avaliação IA de uma obra: a sinopse primária
 * (a que a IA lê via `pickPrimarySynopsis`) e as reviews manuais. Usado pelo
 * editor inline do diálogo "Avaliar" pra semear os campos sob demanda.
 */
export async function getEvaluationInputs(
  workId: string,
): Promise<{ synopsis: string; reviews: ManualReview[] }> {
  if (!workId) return { synopsis: "", reviews: [] }
  const supabase = createAdminClient()

  const [{ data: synRows }, { data: revRows }] = await Promise.all([
    supabase
      .from("work_synopses")
      .select("text, is_primary, position")
      .eq("work_id", workId),
    supabase
      .from("work_manual_reviews")
      .select("id, text, user_rating, note, position")
      .eq("work_id", workId)
      .order("position", { ascending: true }),
  ])

  return {
    synopsis: pickPrimarySynopsis(synRows ?? []) ?? "",
    reviews: (revRows ?? []).map((row) => ({
      id: row.id,
      text: row.text,
      user_rating: row.user_rating != null ? Number(row.user_rating) : null,
      note: row.note ?? null,
      position: Number(row.position ?? 0),
    })),
  }
}

export interface ManualReviewInput {
  text: string
  /** Nota 0-10 opcional atribuída pelo usuário. */
  userRating?: number | null
  /** Contexto opcional — não vai pro prompt. */
  note?: string | null
}

function clampRating(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10))
}

/**
 * Substitui o conjunto de reviews manuais de uma obra (snapshot: delete + insert).
 * Reviews vazias são descartadas. Diferente de `work_reviews`, este conjunto é
 * controlado só pelo usuário e sobrevive a buscas/avaliações externas.
 */
export async function saveManualReviews(
  workId: string,
  reviews: ManualReviewInput[],
): Promise<{ data: ManualReview[] | null; error: string | null }> {
  if (!workId) return { data: null, error: "Obra inválida" }
  const supabase = createAdminClient()

  const cleaned = (reviews ?? [])
    .map((r) => ({ text: (r.text ?? "").trim(), userRating: clampRating(r.userRating), note: (r.note ?? "").trim() || null }))
    .filter((r) => r.text.length > 0)

  const { error: delError } = await supabase
    .from("work_manual_reviews")
    .delete()
    .eq("work_id", workId)
  if (delError) return { data: null, error: delError.message }

  if (cleaned.length === 0) {
    revalidatePath(`/titles/${workId}`)
    return { data: [], error: null }
  }

  const rows = cleaned.map((r, position) => ({
    work_id: workId,
    text: r.text,
    user_rating: r.userRating,
    note: r.note,
    position,
  }))

  const { data, error } = await supabase
    .from("work_manual_reviews")
    .insert(rows)
    .select("id, text, user_rating, note, position")
  if (error) return { data: null, error: error.message }

  revalidatePath(`/titles/${workId}`)
  return {
    data: (data ?? []).map((row) => ({
      id: row.id,
      text: row.text,
      user_rating: row.user_rating != null ? Number(row.user_rating) : null,
      note: row.note ?? null,
      position: Number(row.position ?? 0),
    })),
    error: null,
  }
}

/**
 * Define o texto da sinopse PRIMÁRIA (manual) de uma obra — a que a avaliação IA
 * lê via `pickPrimarySynopsis`. Promove a linha `source='manual'` a primary
 * (criando-a se não existir) e rebaixa as demais. Texto vazio remove a linha
 * manual e deixa as sinopses externas assumirem.
 */
export async function updatePrimarySynopsis(
  workId: string,
  rawText: string,
): Promise<{ error: string | null }> {
  if (!workId) return { error: "Obra inválida" }
  const supabase = createAdminClient()
  const text = (rawText ?? "").trim()

  const { data: existing, error: loadErr } = await supabase
    .from("work_synopses")
    .select("id, source")
    .eq("work_id", workId)
  if (loadErr) return { error: loadErr.message }

  if (!text) {
    const { error } = await supabase
      .from("work_synopses")
      .delete()
      .eq("work_id", workId)
      .eq("source", "manual")
    if (error) return { error: error.message }
    revalidatePath(`/titles/${workId}`)
    return { error: null }
  }

  // Rebaixa todas as outras: garante exatamente um primary depois do upsert.
  const { error: demoteErr } = await supabase
    .from("work_synopses")
    .update({ is_primary: false })
    .eq("work_id", workId)
  if (demoteErr) return { error: demoteErr.message }

  const manualRow = (existing ?? []).find((r) => r.source === "manual")
  if (manualRow) {
    const { error } = await supabase
      .from("work_synopses")
      .update({ text, is_primary: true, position: 0 })
      .eq("id", manualRow.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from("work_synopses")
      .insert({ work_id: workId, source: "manual", text, is_primary: true, position: 0 })
    if (error) return { error: error.message }
  }

  revalidatePath(`/titles/${workId}`)
  return { error: null }
}
