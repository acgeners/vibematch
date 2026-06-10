"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getAiEvaluationDefaultQueueCount } from "@/server/queries/recommendations"
import { getSettingsBadgePendingTotal } from "@/server/queries/settings-pending"

export interface SidebarBadgeCounts {
  /** Obras distintas nos filtros padrão de /ai-evaluation. */
  aiEval: number
  /** Pendências do Pipeline de dados de /settings (soma). */
  settings: number
}

/**
 * Totais dos badges de pendência da sidebar. Caminho rápido: RPC
 * `get_sidebar_badge_counts` (agrega no Postgres, devolve só 2 inteiros — sem
 * trafegar linhas). Fallback: computa em TS com as queries baratas (ex.: se a
 * migration 089 ainda não foi aplicada). Falha silenciosa em 0 pra nunca
 * derrubar o layout.
 */
export async function getSidebarBadgeCounts(): Promise<SidebarBadgeCounts> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase.rpc("get_sidebar_badge_counts")
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (row && typeof row.ai_eval_total === "number" && typeof row.settings_total === "number") {
      return { aiEval: row.ai_eval_total, settings: row.settings_total }
    }
    throw new Error("RPC get_sidebar_badge_counts retornou formato inesperado")
  } catch (rpcErr) {
    console.warn(
      "[getSidebarBadgeCounts] RPC indisponível, usando fallback TS:",
      rpcErr instanceof Error ? rpcErr.message : rpcErr,
    )
    try {
      const [aiEval, settings] = await Promise.all([
        getAiEvaluationDefaultQueueCount(),
        getSettingsBadgePendingTotal(),
      ])
      return { aiEval, settings }
    } catch (fallbackErr) {
      console.error("[getSidebarBadgeCounts] fallback falhou:", fallbackErr)
      return { aiEval: 0, settings: 0 }
    }
  }
}
