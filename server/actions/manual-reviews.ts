"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimarySynopsis } from "@/lib/work-derived"

/**
 * Carrega a sinopse primária editável da avaliação IA (a que a IA lê via
 * `pickPrimarySynopsis`). Usado pelo diálogo "Avaliar" pra semear o campo de sinopse.
 * NÃO lê mais reviews: o canal de review manual virou EXTERNO
 * (`work_external_reviews_manual`), gerido pelo editor próprio (B2.2N).
 */
export async function getEvaluationInputs(workId: string): Promise<{ synopsis: string }> {
  if (!workId) return { synopsis: "" }
  const supabase = createAdminClient()
  const { data: synRows } = await supabase
    .from("work_synopses")
    .select("text, is_primary, position")
    .eq("work_id", workId)
  return { synopsis: pickPrimarySynopsis(synRows ?? []) ?? "" }
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
