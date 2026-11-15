"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin } from "@/server/queries/current-user"
import { recomputeAdultAuto } from "@/lib/tags/adult-classify"
import { parseAgeRating } from "@/lib/age-rating/age-rating"

/**
 * Resolve um conflito da fila "Conflitos de classificação": a curadoria define a faixa (14/16/18) ou
 * decide deixar SEM classificação (`faixa = null`). Em qualquer dos dois o conflito sai da fila.
 *
 * Faixa 18 na linha `obra` liga o gate 18+ (`official_rating`); trocar para 14/16 ou null desliga o
 * que ESTA régua tinha ligado — por isso o gate é recalculado aqui, pelo mesmo dono do formulário.
 */
export async function resolveAgeRatingConflict(
  workId: string,
  versao: string,
  faixaRaw: number | null,
): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  if (versao !== "obra" && versao !== "normal") return { error: "versão inválida" }
  const faixa = faixaRaw == null ? null : parseAgeRating(faixaRaw)
  if (faixaRaw != null && faixa == null) return { error: "faixa inválida (use 14, 16 ou 18)" }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_age_rating")
    .update({ faixa, conflito: null, decidido_por: "curadoria", atualizado_em: new Date().toISOString() })
    .eq("work_id", workId)
    .eq("versao", versao)
    .select("work_id")
  if (error) return { error: error.message }
  if (!data?.length) return { error: "linha de classificação não encontrada" }

  if (versao === "obra") await recomputeAdultAuto(supabase, workId)
  revalidatePath(`/catalog/${workId}`)
  revalidatePath("/curation/settings")
  return {}
}
