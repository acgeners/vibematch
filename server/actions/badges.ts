"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getAiEvaluationDefaultQueueCount } from "@/server/queries/recommendations"
import { getSettingsBadgePendingTotal } from "@/server/queries/settings-pending"
import { maybeTriggerStaleRecalc } from "@/server/actions/recalc-queue"
import { getComixStatus } from "@/lib/external/comix-gate"
import type { ComixHealthState } from "@/lib/external/comix-gate"

export interface SidebarBadgeCounts {
  /** Obras distintas nos filtros padrão de /ai-evaluation. */
  aiEval: number
  /** Pendências do Pipeline de dados de /settings (soma). */
  settings: number
  /** Há edições de nota aguardando recálculo (fila de recálculo, migration 096). */
  recalcPending: boolean
  /** Saúde observada do Comix (in-memory, ComixGate) — alerta no chrome quando degradado/fora. */
  comixHealth: ComixHealthState
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
  // Saúde do Comix: leitura in-memory do gate (mesmo processo) — sem round-trip
  // e independe da migration 098 estar aplicada.
  const comixHealth = getComixStatus().state
  // Estado da fila de recálculo + disparo lazy do auto-recalc (≥1h sem edições).
  // Roda em paralelo com a contagem; falha vira "não pendente". A carga de página
  // (que dispara este action na sidebar) é o gatilho do recálculo automático.
  const recalcStatePromise = maybeTriggerStaleRecalc().catch(() => ({
    pending: false,
    lastEditAt: null,
  }))
  try {
    const { data, error } = await supabase.rpc("get_sidebar_badge_counts")
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (row && typeof row.ai_eval_total === "number" && typeof row.settings_total === "number") {
      const recalc = await recalcStatePromise
      return { aiEval: row.ai_eval_total, settings: row.settings_total, recalcPending: recalc.pending, comixHealth }
    }
    throw new Error("RPC get_sidebar_badge_counts retornou formato inesperado")
  } catch (rpcErr) {
    console.warn(
      "[getSidebarBadgeCounts] RPC indisponível, usando fallback TS:",
      rpcErr instanceof Error ? rpcErr.message : rpcErr,
    )
    try {
      const [aiEval, settings, recalc] = await Promise.all([
        getAiEvaluationDefaultQueueCount(),
        getSettingsBadgePendingTotal(),
        recalcStatePromise,
      ])
      return { aiEval, settings, recalcPending: recalc.pending, comixHealth }
    } catch (fallbackErr) {
      console.error("[getSidebarBadgeCounts] fallback falhou:", fallbackErr)
      return { aiEval: 0, settings: 0, recalcPending: false, comixHealth }
    }
  }
}
