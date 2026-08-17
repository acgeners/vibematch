/**
 * O TOM dos botões de um segmentado de FILTRO — dono único.
 *
 * 🔴 Nasceu de um defeito visível todos os dias e que ninguém tinha nomeado: no card
 * "Conteúdo exibido" do painel de filtros, as duas primeiras trilhas acendiam a opção ativa em
 * ROSA — inclusive "Não" (não esconde nada) e "Tudo" (não filtra arte) —, enquanto a trilha do
 * 18+, logo abaixo, acendia "Tudo" em `primary`. Com nenhum filtro ligado o card mostrava
 * **três pílulas acesas**, duas delas na cor que o resto do app usa para negativo.
 *
 * A causa não foi uma decisão de cor: eram **dois componentes com duas convenções**. O rosa
 * entrou em 03/07/2026 junto com "Esconder tags evitadas", onde ele significava a stance de
 * **tag evitada** (a mesma cor do perfil de gosto e do comparador). Em 14/08 o filtro de arte
 * REUSOU aquele componente e herdou uma cor que fala de tags — o nome do componente virou a
 * cor dele. Daí o dono único: a cor deixa de viajar de carona no reuso.
 *
 * A régua, decidida em 17/08/2026 (escolha da Ana):
 *
 * | papel | quando | cor |
 * |---|---|---|
 * | `selected` | é a posição atual e ela **não tira nada** da lista ("Não", "Tudo") | `primary` |
 * | `cutting`  | esta opção **remove obras** da lista ("Fortes", "Top 20%"…) | rosa |
 * | `adult`    | conteúdo 18+ — fato sobre a **OBRA**, não sobre o filtro | vermelho |
 *
 * ⚠️ `cutting` e `adult` são cores parecidas e isso é de propósito: as duas dizem "esta opção
 * está cortando". O que as separa é `adult` seguir o vermelho de CONTEÚDO da régua de
 * `lib/ui/status-tone.ts` (o mesmo do 🔞), que é sobre a obra e não sobre o estado do filtro.
 *
 * ⚠️ Quem decide o papel **não escreve um booleano à mão**: nos dois segmentados de filtro ele
 * sai do VALOR que o botão grava na URL (`null` ⇒ limpa o parâmetro ⇒ `selected`). Um flag
 * digitado por call site é como o "Não" ficaria vermelho de novo no próximo botão adicionado.
 */

/** A base compartilhada — altura, espaçamento e tipografia dos três segmentados. */
export const FILTER_SEGMENT_BASE =
  "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors"

export type FilterSegmentRole = "selected" | "cutting" | "adult"

const ACTIVE_TONE: Record<FilterSegmentRole, string> = {
  selected: "bg-primary/15 text-primary",
  cutting: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  adult: "bg-red-500/15 text-red-600 dark:text-red-300",
}

/** Inativo não tem fundo: o segmentado inteiro já mora dentro de uma caixa com borda. */
const IDLE_TONE = "text-muted-foreground hover:text-foreground"

export function filterSegmentClass(active: boolean, role: FilterSegmentRole): string {
  return `${FILTER_SEGMENT_BASE} ${active ? ACTIVE_TONE[role] : IDLE_TONE}`
}

/**
 * O papel de um botão a partir do valor que ele grava na URL.
 *
 * `null` é o "não filtra" de todo segmentado deste painel — é ele que LIMPA o parâmetro. Por
 * isso a régua é derivada daqui e não de um booleano por call site.
 */
export function filterSegmentRole(urlValue: string | null | undefined): FilterSegmentRole {
  return urlValue == null ? "selected" : "cutting"
}
