"use server"

import { getCuradoriaBadgeUnreadCount, getRecommendationBadgeUnreadCount } from "@/server/queries/ai-eval-read"
import { getSettingsItemUnread } from "@/server/queries/settings-read"
import { countOpenCurationRequests } from "@/server/queries/curation-requests"
import { SETTINGS_GROUPS } from "@/app/curation/settings/sections"
import { maybeTriggerStaleRecalc } from "@/server/recalc/queue"
import { getComixStatus } from "@/lib/external/comix-gate"
import type { ComixHealthState } from "@/lib/external/comix-gate"

export interface SidebarBadgeCounts {
  /** Obras NÃO-LIDAS na fila de atributos de /curation/works ("Curadoria da Obra"). */
  curadoria: number
  /** Obras NÃO-LIDAS em Veredito IA + Interesse de /my-ai-scores, união distinta. */
  recQueue: number
  /** Soma de todas as pendências acionáveis de /curation/settings (todos os tópicos). */
  settings: number
  /**
   * Pedidos do leitor em aberto (atualizar dados, revisar avaliação, cadastrar pelo nome).
   *
   * Parcela NOVA do badge de curadoria, não um badge novo: para quem olha, "tem coisa
   * esperando decisão minha" é uma informação só. Ver migration 177.
   */
  requests: number
  /**
   * O mesmo não-lido, QUEBRADO por tópico de /curation/settings (`grupo -> contagem`).
   *
   * Sai da MESMA leitura que o total — `getSettingsItemUnread()` é uma só, e
   * agrupá-la custa zero query. Existe porque a sidebar da console mostra o badge
   * no tópico, não só no pai: sem a quebra, a console teria que refazer a leitura
   * por conta própria, e `getSettingsItemPending` puxa LINHAS (não `count: exact`)
   * — é uma das leituras mais caras do chrome. Ver o §Egress do CLAUDE.md.
   */
  settingsByGroup: Record<string, number>
  /** Há edições de nota aguardando recálculo (fila de recálculo, migration 096). */
  recalcPending: boolean
  /** Saúde observada do Comix (in-memory, ComixGate) — alerta no chrome quando degradado/fora. */
  comixHealth: ComixHealthState
}

/**
 * Totais dos badges de pendência da sidebar.
 *
 * - curadoria / recQueue: as duas metades do antigo badge único "Avaliação IA"
 *   (união distinta attr+veredito+interesse), separadas quando a página virou
 *   /curation/works (Curadoria da Obra, só-curador) + /my-ai-scores (qualquer
 *   logado). "Marcar como lido" em cada página silencia pendências sem resolvê-las.
 *   Ver `getCuradoriaBadgeUnreadCount`/`getRecommendationBadgeUnreadCount`. A
 *   sidebar oculta cada badge quando o valor é 0.
 * - settings: soma do NÃO-LIDO de todas as pendências de /curation/settings (sugestões de
 *   critérios + embeddings + sinopse + resumo + comix), via `getSettingsItemUnread`
 *   — as MESMAS contagens por-item que a página e a sub-nav usam, então sidebar →
 *   tópico → card batem. "Marcar como lido" em /curation/settings silencia sem resolver
 *   (migration 134), igual às filas de avaliação. A sidebar oculta o badge no 0.
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

  const [curadoria, recQueue, settingsUnread, recalc, requests] = await Promise.all([
    getCuradoriaBadgeUnreadCount().catch((err) => {
      console.warn(
        "[getSidebarBadgeCounts] contagem de Curadoria da Obra falhou:",
        err instanceof Error ? err.message : err,
      )
      return 0
    }),
    getRecommendationBadgeUnreadCount().catch((err) => {
      console.warn(
        "[getSidebarBadgeCounts] contagem de Fila de Recomendação falhou:",
        err instanceof Error ? err.message : err,
      )
      return 0
    }),
    getSettingsBadges(),
    recalcStatePromise,
    countOpenCurationRequests().catch((err) => {
      console.warn(
        "[getSidebarBadgeCounts] contagem de pedidos falhou:",
        err instanceof Error ? err.message : err,
      )
      return 0
    }),
  ])

  return {
    curadoria,
    recQueue,
    settings: settingsUnread.total,
    requests,
    settingsByGroup: settingsUnread.byGroup,
    recalcPending: recalc.pending,
    comixHealth,
  }
}

/**
 * Não-lido de /curation/settings, no total e por tópico, de uma leitura só.
 *
 * A contagem por-item vem de `getSettingsItemUnread` (as MESMAS da página e dos
 * badges da console, já descontando os "lidos"); o registry `SETTINGS_GROUPS` diz
 * a que tópico cada item pertence. Falha → tudo zero (nunca derruba o layout).
 */
async function getSettingsBadges(): Promise<{ total: number; byGroup: Record<string, number> }> {
  try {
    const itemUnread = await getSettingsItemUnread()
    const byGroup = Object.fromEntries(
      SETTINGS_GROUPS.map((g) => [
        g.id,
        g.sections.reduce((sum, s) => sum + (itemUnread[s.id] ?? 0), 0),
      ]),
    )
    return {
      total: Object.values(itemUnread).reduce((sum, n) => sum + n, 0),
      byGroup,
    }
  } catch (err) {
    console.error("[getSidebarBadgeCounts] contagem de settings falhou:", err)
    return { total: 0, byGroup: {} }
  }
}
