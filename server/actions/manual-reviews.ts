"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimarySynopsis } from "@/lib/work-derived"
import { ensureAdmin } from "@/server/queries/current-user"

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
 * lê via `pickPrimarySynopsis`. Reescreve a manual que já é primária, ou cria uma
 * nova e rebaixa as demais. Texto vazio remove essa linha e deixa as externas
 * assumirem.
 *
 * Quando a primária atual NÃO é manual, cria uma linha nova em vez de reaproveitar
 * alguma outra manual da obra: desde que editar uma sinopse de fonte a converte em
 * "manual", as outras manuais são sinopses distintas que você curou — sobrescrever
 * uma delas apagaria texto que ninguém mandou apagar.
 */
export async function updatePrimarySynopsis(
  workId: string,
  rawText: string,
): Promise<{ error: string | null }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  if (!workId) return { error: "Obra inválida" }
  const supabase = createAdminClient()
  const text = (rawText ?? "").trim()

  const { data: existing, error: loadErr } = await supabase
    .from("work_synopses")
    .select("id, source, is_primary")
    .eq("work_id", workId)
  if (loadErr) return { error: loadErr.message }

  // Alvo = a linha manual que HOJE é a primária. Mirar em `source === "manual"`
  // solto escolhia uma linha arbitrária desde que o picker passou a permitir
  // várias manuais (sinopse editada vira "manual"), e o caminho de texto vazio
  // apagava TODAS elas — inclusive as que não estavam em jogo aqui.
  const rows = existing ?? []
  const primaryManual = rows.find((r) => r.is_primary && r.source === "manual")

  if (!text) {
    // Sem texto: remove só a manual primária e deixa as externas assumirem. Se a
    // primária nem é manual, não há o que apagar.
    if (!primaryManual) {
      revalidatePath(`/titles/${workId}`)
      return { error: null }
    }
    const { error } = await supabase.from("work_synopses").delete().eq("id", primaryManual.id)
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

  if (primaryManual) {
    const { error } = await supabase
      .from("work_synopses")
      .update({ text, is_primary: true, position: 0 })
      .eq("id", primaryManual.id)
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
