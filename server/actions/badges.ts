"use server"

import { getEvalBadgeUnreadCount } from "@/server/queries/ai-eval-read"
import { getSettingsBadgePendingTotal } from "@/server/queries/settings-pending"
import { maybeTriggerStaleRecalc } from "@/server/actions/recalc-queue"
import { getComixStatus } from "@/lib/external/comix-gate"
import type { ComixHealthState } from "@/lib/external/comix-gate"

export interface SidebarBadgeCounts {
  /** Obras NÃO-LIDAS nas 3 primeiras abas de /ai-evaluation (atributos + Veredito IA + Interesse), união distinta. Marcar como lido silencia sem resolver. */
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
 * - aiEval: união DISTINTA das obras NÃO-LIDAS nas 3 primeiras abas (atributos +
 *   Veredito IA "stale" + Interesse "não previsto"). "Marcar como lido" em
 *   /ai-evaluation silencia pendências sem resolvê-las, então o antigo problema
 *   de inflar o badge (regen de perfil) é neutralizado pelo próprio usuário. Ver
 *   `getEvalBadgeUnreadCount`. A sidebar oculta o badge quando isto é 0.
 * - settings: total do Pipeline de dados, via TS (`getSettingsBadgePendingTotal`).
 *   Usava a RPC `get_sidebar_badge_counts`, mas ela conta `canonical_synopsis`
 *   só por NULL e NÃO aplica o gate de "consolidável" (≥40 chars) — contava obras
 *   que o consolidador sempre pula → badge da sidebar divergia dos cards da
 *   página (preso). O caminho TS reusa as MESMAS contagens da página.
 *
 * Cada parcela falha silenciosa em 0 pra nunca derrubar o layout.
 */
export async function getSidebarBadgeCounts(): Promise<SidebarBadgeCounts> {
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
    getEvalBadgeUnreadCount().catch((err) => {
      console.warn(
        "[getSidebarBadgeCounts] contagem de não-lidas falhou:",
        err instanceof Error ? err.message : err,
      )
      return 0
    }),
    getSettingsBadgeTotal(),
    recalcStatePromise,
  ])

  return { aiEval, settings, recalcPending: recalc.pending, comixHealth }
}

/**
 * Total de pendências do Pipeline de dados (badge "Configurações"), via TS —
 * `getSettingsBadgePendingTotal` reusa `countPendingCanonicalSynopses` (mesmo
 * gate de "consolidável" da página), então o badge bate com a soma dos cards.
 * Falha → 0 (nunca derruba o layout). A RPC `get_sidebar_badge_counts` ficou
 * órfã (não aplica o gate); pode ser removida num cleanup futuro.
 */
async function getSettingsBadgeTotal(): Promise<number> {
  try {
    return await getSettingsBadgePendingTotal()
  } catch (err) {
    console.error("[getSidebarBadgeCounts] contagem de settings falhou:", err)
    return 0
  }
}
