"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  recalculateAll,
  recalculateAllInBackground as recalcAllInBackgroundShared,
} from "@/server/actions/calculations"

// Janela de debounce do recálculo automático: só dispara sozinho depois de 1h
// SEM novas edições de nota. Uma avaliação IA de atributos já leva >60s, então
// uma janela curta dispararia no meio de uma sessão de avaliação em lote — a
// 1h espera o usuário terminar o batch inteiro.
const RECALC_DEBOUNCE_MS = 60 * 60 * 1000

export interface RecalcPendingState {
  pending: boolean
  /** Timestamp da última edição (a janela de 1h conta daqui). */
  lastEditAt: string | null
}

/**
 * Marca a base como "recálculo pendente" em vez de rodar recalculateAll na hora.
 * Usado pelos saves incidentais (edição de obra/status, pós-leitura, importação,
 * previsão de sinopse, aceite de avaliação IA). É um UPDATE barato — a Nota
 * Prevista só recalcula quando o usuário clica "Recalcular agora" ou passada 1h
 * sem novas edições.
 *
 * Fallback: se a RPC/colunas ainda não existem (migration 096 não aplicada) ou o
 * UPDATE falha, cai pro recálculo em background (comportamento antigo) pra nada
 * quebrar — o deferimento passa a valer só depois da migration.
 */
export async function markRecalcPending(context: string): Promise<void> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase.rpc("touch_recalc_pending")
    if (error) throw error
  } catch (err) {
    console.warn(
      `[markRecalcPending:${context}] não foi possível marcar pendente, recalculando em background:`,
      err instanceof Error ? err.message : err,
    )
    void recalcAllInBackgroundShared(context)
  }
}

/** Lê o estado de recálculo pendente (sem efeito colateral). */
export async function getRecalcPendingState(): Promise<RecalcPendingState> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from("formula_config")
      .select("recalc_pending, recalc_last_edit_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    const row = data as { recalc_pending: boolean | null; recalc_last_edit_at: string | null } | null
    return { pending: row?.recalc_pending === true, lastEditAt: row?.recalc_last_edit_at ?? null }
  } catch {
    // Pré-migration (colunas ausentes) → nunca pendente, nenhum banner.
    return { pending: false, lastEditAt: null }
  }
}

/**
 * Disparo lazy do recálculo automático: se há recálculo pendente E a última
 * edição foi há ≥1h, roda recalculateAll em background (coalescido pelo guard de
 * calculations.ts). Chamado na carga de página (via getSidebarBadgeCounts), então
 * só recompõe quando o usuário volta a usar o app — nunca gasta compute à toa.
 * Retorna o estado pendente pra a UI reaproveitar a mesma leitura.
 */
export async function maybeTriggerStaleRecalc(): Promise<RecalcPendingState> {
  const state = await getRecalcPendingState()
  if (state.pending && state.lastEditAt) {
    const age = Date.now() - new Date(state.lastEditAt).getTime()
    if (age >= RECALC_DEBOUNCE_MS) {
      void recalcAllInBackgroundShared("stale-auto")
    }
  }
  return state
}

/**
 * "Recalcular agora" — roda o recálculo completo na hora (bloqueante) e limpa o
 * flag pendente (recalculateAll zera ao persistir o formula_config). Usado pelo
 * banner do /ranking e pelo botão da sidebar. recalculateAll já revalida
 * /ranking, /titles, /settings e / por dentro.
 */
export async function triggerRecalcNow(): Promise<{ recalculated: number }> {
  const result = await recalculateAll()
  revalidatePath("/ranking")
  return { recalculated: result.recalculated }
}
