"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getAttributesQueueCount } from "@/server/queries/recommendations"
import { getSettingsBadgePendingTotal } from "@/server/queries/settings-pending"
import { maybeTriggerStaleRecalc } from "@/server/actions/recalc-queue"
import { getComixStatus } from "@/lib/external/comix-gate"
import type { ComixHealthState } from "@/lib/external/comix-gate"

export interface SidebarBadgeCounts {
  /** Obras na fila de atributos de /ai-evaluation (aba "IA atributos": pending + review_pending). */
  aiEval: number
  /** Pendências do Pipeline de dados de /settings (soma). */
  settings: number
  /** Há edições de nota aguardando recálculo (fila de recálculo, migration 096). */
  recalcPending: boolean
  /** Saúde observada do Comix (in-memory, ComixGate) — alerta no chrome quando degradado/fora. */
  comixHealth: ComixHealthState
}

/**
 * Totais dos badges de pendência da sidebar.
 *
 * - aiEval: SÓ a fila de atributos (pending + review_pending) — casa com a aba
 *   "IA atributos". As filas de Veredito IA (stale) e Interesse Sinopse têm seus
 *   próprios contadores na página e NÃO entram no badge (inflavam o número,
 *   sobretudo após regen de perfil). Head-count barato; sempre TS, então o fix
 *   independe de a RPC estar atualizada/aplicada.
 * - settings: total do Pipeline de dados. Caminho rápido: RPC
 *   `get_sidebar_badge_counts` (agrega no Postgres). Fallback TS se a RPC faltar.
 *
 * Cada parcela falha silenciosa em 0 pra nunca derrubar o layout.
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

  const [aiEval, settings, recalc] = await Promise.all([
    getAttributesQueueCount().catch((err) => {
      console.warn(
        "[getSidebarBadgeCounts] contagem de atributos falhou:",
        err instanceof Error ? err.message : err,
      )
      return 0
    }),
    getSettingsBadgeTotal(supabase),
    recalcStatePromise,
  ])

  return { aiEval, settings, recalcPending: recalc.pending, comixHealth }
}

/**
 * Total de pendências do Pipeline de dados (badge "Configurações"). Caminho
 * rápido: lê `settings_total` da RPC `get_sidebar_badge_counts` (agrega no
 * Postgres, sem trafegar linhas). Fallback TS (`getSettingsBadgePendingTotal`)
 * se a RPC faltar/erro. Falha total → 0.
 */
async function getSettingsBadgeTotal(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("get_sidebar_badge_counts")
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (row && typeof row.settings_total === "number") return row.settings_total
    throw new Error("RPC get_sidebar_badge_counts retornou formato inesperado")
  } catch (rpcErr) {
    console.warn(
      "[getSidebarBadgeCounts] RPC indisponível p/ settings, usando fallback TS:",
      rpcErr instanceof Error ? rpcErr.message : rpcErr,
    )
    try {
      return await getSettingsBadgePendingTotal()
    } catch (fallbackErr) {
      console.error("[getSidebarBadgeCounts] fallback settings falhou:", fallbackErr)
      return 0
    }
  }
}
