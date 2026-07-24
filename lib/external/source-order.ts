import type { ExternalSourceId } from "./types"

// ============================================================================
// Ordem canônica das fontes externas — UMA lista, dois usos
// ============================================================================
// GERADA por `npm run sync-constants` a partir da coluna `order` da tabela `source`
// no Supabase (a mesma que já gera o `ExternalSourceId`). Para reordenar, mude o
// `order` no banco e rode o sync — NÃO edite a lista à mão.
//
// ⚠️ Esta ordem governa DUAS coisas de uma vez:
//   1. a EXIBIÇÃO das fontes no diálogo de seleção;
//   2. a PRIORIDADE das reviews no prompt da IA (`REVIEW_SOURCE_PRIORITY` em index.ts
//      é DERIVADA desta lista — o round-robin as consome nesta ordem).
// Foi decisão consciente de manter UMA fonte de verdade: ordene o `order` no Supabase
// pensando na prioridade das reviews e a exibição segue. Reordenar por pura estética
// também mexe no que a IA lê — é o preço de não manter duas listas.
//
// Contexto: antes havia duas listas de ordenação e a do diálogo tinha ESQUECIDO o
// `mangago`. Como a ordenação usa `indexOf`, a fonte ausente virava **−1** e ia pro
// TOPO. A trava de compilação abaixo garante que a lista gerada cubra TODAS as fontes.

/** GERADO — não editar entre os marcadores (ver cabeçalho). */
// <generated:external-source-order>
export const EXTERNAL_SOURCE_ORDER = [
  "mangaupdates",
  "myanimelist",
  "anilist",
  "animeplanet",
  "comick",
  "mangadex",
  "kitsu",
  "comix",
  "mangago",
  "outros",
] as const satisfies readonly ExternalSourceId[]
// </generated:external-source-order>

// Trava de compilação: se a lista gerada (ou seja, a tabela `source` do DB) não cobrir
// algum `ExternalSourceId`, ISTO quebra o build — em vez de a fonte faltante voltar a
// cair no −1 do `indexOf` e se ordenar errado em silêncio, como o mangago fazia.
type SourcesMissingFromOrder = Exclude<ExternalSourceId, (typeof EXTERNAL_SOURCE_ORDER)[number]>
const _everySourceIsOrdered: [SourcesMissingFromOrder] extends [never] ? true : never = true
void _everySourceIsOrdered

/**
 * Fontes que aparecem no diálogo de seleção, sempre nesta ordem e sempre TODAS
 * (uma fonte sem resultado mostra o próprio estado em vez de desaparecer — sem isso
 * a lista muda de tamanho a cada busca e "falhou" fica igual a "não tem a obra").
 * `outros` fica fora: é catch-all, não tem busca nem id próprio.
 */
export const SELECTABLE_EXTERNAL_SOURCES: readonly ExternalSourceId[] =
  EXTERNAL_SOURCE_ORDER.filter((source) => source !== "outros")

/**
 * Posição da fonte na ordem de exibição. Fonte desconhecida vai pro FIM (não pro
 * começo, que é o que o `indexOf` cru fazia com o seu −1).
 */
export function sourceOrderIndex(source: ExternalSourceId | string): number {
  const index = (EXTERNAL_SOURCE_ORDER as readonly string[]).indexOf(source)
  return index === -1 ? EXTERNAL_SOURCE_ORDER.length : index
}

/** Comparador pronto pra `.sort()` — ordena qualquer coisa que tenha `source`. */
export function bySourceOrder<T extends { source: ExternalSourceId }>(a: T, b: T): number {
  return sourceOrderIndex(a.source) - sourceOrderIndex(b.source)
}
