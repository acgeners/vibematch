"use server"

import { getEvalBadgeUnreadCount } from "@/server/queries/ai-eval-read"
import { getSettingsItemPending } from "@/server/queries/settings-pending"
import { maybeTriggerStaleRecalc } from "@/server/actions/recalc-queue"
import { getComixStatus } from "@/lib/external/comix-gate"
import type { ComixHealthState } from "@/lib/external/comix-gate"

export interface SidebarBadgeCounts {
  /** Obras NÃO-LIDAS nas 3 primeiras abas de /ai-evaluation (atributos + Veredito IA + Interesse), união distinta. Marcar como lido silencia sem resolver. */
  aiEval: number
  /** Soma de todas as pendências acionáveis de /settings (todos os tópicos). */
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
 * - settings: soma de TODAS as pendências acionáveis de /settings (sugestões de
 *   critérios + embeddings + sinopse + resumo + comix), via `getSettingsItemPending`
 *   — as MESMAS contagens por-item que a página e a sub-nav usam, então sidebar →
 *   tópico → card batem. Antes somava só o grupo "Gerado por IA"
 *   (embeddings+sinopse+resumo), ignorando o 99+ de critérios e o comix.
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
 * Total de pendências de /settings (badge "Configurações") = soma dos itens de
 * `getSettingsItemPending` (as MESMAS contagens por-item da página/sub-nav).
 * Falha → 0 (nunca derruba o layout).
 */
async function getSettingsBadgeTotal(): Promise<number> {
  try {
    const itemPending = await getSettingsItemPending()
    return Object.values(itemPending).reduce((sum, n) => sum + n, 0)
  } catch (err) {
    console.error("[getSidebarBadgeCounts] contagem de settings falhou:", err)
    return 0
  }
}
