import type { SettingsAccent } from "@/lib/settings-accent"
import { ATTR_DECISION_FILTERS } from "@/lib/ai-evaluation/attr-eval-filters"

/**
 * As filas que compõem o badge do gatilho de Curadoria — numa lista só.
 *
 * ## Por que isto existe
 *
 * O badge somava `curadoria + requests` em `curation-menu.tsx`, e a Visão geral
 * decidia o que mostrar com dois `if` independentes em `buildDecisions`. As duas
 * listas saíram de sincronia: os Pedidos entraram no badge e **nunca** entraram na
 * página. O resultado era um "3" no botão que podia ser 3 pedidos de leitor, com a
 * página que deveria explicá-lo sem mencionar nenhum — alarme sem destino, sem erro
 * e sem log.
 *
 * Guardar isso com teste registraria o esquecimento; a lista compartilhada tira o
 * lugar onde ele acontece. É o mesmo movimento que a Visão geral já fazia com o
 * `SETTINGS_GROUPS` pras pendências de `/curation/settings`.
 *
 * 🔴 **Ao criar uma fila nova, ela entra AQUI — não no somatório do badge nem na
 * página.** Quem consome itera; ninguém enumera.
 *
 * ## Escopo
 *
 * Só o que soma no badge do gatilho. As pendências de `/curation/settings` NÃO entram: elas
 * têm badge próprio, vêm do `SETTINGS_GROUPS` e são pendência de configuração, não
 * fila de decisão sobre obra.
 *
 * ⚠️ Duplicação que sobra, de propósito: a sidebar da console
 * (`components/curation/console-nav.tsx`) mapeia contagem por `href` na sua própria
 * `ENTRIES`, que inclui destinos sem fila (`/curation/settings`). Unificá-la exigiria forçar
 * esses destinos no formato de "fila de decisão", que eles não são. O risco residual
 * é um `href` daqui divergir do de lá e o badge da sidebar sumir calado.
 */

export type DecisionQueueKey = "curadoria" | "requests"

export interface DecisionQueue {
  /** Chave da contagem — casa com os campos de `SidebarBadgeCounts`. */
  key: DecisionQueueKey
  /** A página da fila — é por ela que a sidebar acende o item ativo. */
  href: string
  /**
   * Onde o NÚMERO se explica: a lista recortada exatamente no que ele conta. É o destino
   * do clique quando há pendência.
   *
   * 🔴 Existe porque `href` abre a aba no filtro PADRÃO, que é outra pergunta: em
   * `/curation/works` o padrão inclui a reavaliação por reviews novas (~490 obras), e
   * o badge conta só decisão esperando (1, em 2026-10-09). Clicar num "1" e cair numa
   * lista de 492 faz o número parecer errado — foi assim que ele foi reportado.
   */
  focusHref: string
  /** O que o número conta, em pt-BR — "1 decisão esperando", "3 pedidos em aberto". */
  unit: { one: string; other: string }
  /** Título da linha na Visão geral. */
  title: string
  description: string
  accent: SettingsAccent
}

/**
 * ⚠️ O `title` aqui é a AÇÃO ("Avaliar atributos"), enquanto a nav chama o mesmo
 * destino de "Curadoria da Obra". A divergência é anterior a este arquivo e foi
 * mantida — uma linha de decisão diz o que fazer, um item de menu diz onde é. Se um
 * dia convergir, converge aqui.
 */
export const DECISION_QUEUES: readonly DecisionQueue[] = [
  {
    key: "curadoria",
    href: "/curation/works",
    // Deriva do mesmo recorte que a query do badge usa — ver `ATTR_DECISION_FILTERS`.
    focusHref: `/curation/works?filter=${ATTR_DECISION_FILTERS.join(",")}`,
    // "decisão", e não "revisão": o recorte inclui obra NUNCA avaliada, que pede uma
    // avaliação (paga), não uma revisão.
    unit: { one: "decisão esperando", other: "decisões esperando" },
    title: "Avaliar atributos",
    description: "obras sem os 9 critérios de IA, ou com avaliação aguardando revisão",
    accent: "violet",
  },
  {
    key: "requests",
    href: "/curation/requests",
    // A página já abre nos pedidos em aberto, que é o que o número conta.
    focusHref: "/curation/requests",
    unit: { one: "pedido em aberto", other: "pedidos em aberto" },
    title: "Pedidos",
    description: "atualização, revisão ou cadastro que um leitor pediu e ninguém resolveu",
    accent: "amber",
  },
] as const

/** O número com a unidade: "1 decisão esperando". */
export function decisionHint(queue: DecisionQueue, count: number): string {
  return `${count} ${count === 1 ? queue.unit.one : queue.unit.other}`
}

/** Quantas decisões esperam — o número do badge. */
export function totalPendingDecisions(counts: Record<DecisionQueueKey, number>): number {
  return DECISION_QUEUES.reduce((sum, q) => sum + (counts[q.key] ?? 0), 0)
}

/**
 * As contagens indexadas por ROTA, para quem mostra badge em item de navegação.
 *
 * A sidebar da console montava esse mapa à mão, com os `href` redigitados. Um `href`
 * daqui mudando (ou um typo lá) fazia o badge da sidebar simplesmente sumir: chave que
 * não casa devolve `undefined`, `?? 0` transforma em zero, e zero não desenha nada. Sem
 * erro, sem log — a pendência fica invisível justamente na tela feita pra mostrá-la.
 */
export function decisionCountsByHref(
  counts: Record<DecisionQueueKey, number>,
): Record<string, number> {
  return Object.fromEntries(DECISION_QUEUES.map((q) => [q.href, counts[q.key] ?? 0]))
}

/**
 * Para cada fila COM pendência, o destino do clique e o texto que explica o número —
 * indexado pela rota da fila, como `decisionCountsByHref`.
 *
 * Fila zerada fica de fora: sem número não há o que explicar, e o item volta a ser só
 * um destino (`href`, com a dica fixa dele).
 */
export function decisionFocusByHref(
  counts: Record<DecisionQueueKey, number>,
): Record<string, { href: string; hint: string }> {
  const out: Record<string, { href: string; hint: string }> = {}
  for (const q of DECISION_QUEUES) {
    const count = counts[q.key] ?? 0
    if (count > 0) out[q.href] = { href: q.focusHref, hint: decisionHint(q, count) }
  }
  return out
}
