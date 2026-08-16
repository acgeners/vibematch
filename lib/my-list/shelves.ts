import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import {
  isDismissedPersonalStatus,
  isTerminalPersonalStatus,
  isUnreadPersonalStatus,
  personalStatusNameBySlugOrThrow,
  UNTRACKED_PERSONAL_STATUS,
} from "@/lib/constants/status-lookups"
import type { PersonalStatusInfo } from "@/lib/constants/criteria"

/**
 * As prateleiras da /my-list — a partição de "o que é seu" por estado de leitura.
 *
 * ## A regra de PERTENCIMENTO, e por que ela não pode olhar o rótulo
 *
 * 🔴 `is_default_unset` está em **"Want to Read"**, não em "Untracked": obra sem linha no
 * espelho APARENTA "Want to Read" (é o que `personalStatusNameOrDefault` faz, e é correto
 * em outros lugares). Medido em 2026-08-16 no clone local: o curador tem **988 linhas** em
 * `user_work_state` e a conta leitora tem **0**. Uma regra escrita sobre o rótulo RESOLVIDO
 * daria à conta nova uma lista com **as 988 obras, todas "Quero ler"** — cheia, plausível e
 * inteiramente falsa. É a família do [[gotcha-anonimo-vira-dono]]: o fallback existe por bom
 * motivo em outro lugar e mente aqui.
 *
 * Por isso [belongsToMyList] exige **linha explícita** e recebe o id CRU (`null` = sem linha),
 * nunca o nome já resolvido.
 *
 * ## Por que a partição é conferida no load
 *
 * Toda a semântica sai dos flags de `personal_status` (migration 155) — menos duas uniões que
 * a tabela não descreve, e que por isso são nomeadas por SLUG e ESTOURAM num rename, o padrão
 * já usado por `isDismissedPersonalStatus` e pela prateleira "Pra você hoje".
 *
 * O risco real não é o rename: é o status NOVO. Sem a conferência abaixo, um status criado no
 * Supabase não casaria com prateleira nenhuma e as obras dele **sumiriam da página em
 * silêncio** — presentes no total, ausentes de todas as prateleiras. Aqui isso vira erro no
 * import, que é a mesma escolha do `.env.analysis`: falhar alto em vez de servir dado errado.
 */
export type ShelfKey = "lendo" | "pausadas" | "terminadas" | "quero" | "descartadas" | "reler"

export interface Shelf {
  key: ShelfKey
  label: string
  /** O que a prateleira responde — vai no subtítulo da lista, não é decoração. */
  hint: string
}

export const SHELVES: readonly Shelf[] = [
  { key: "lendo", label: "Lendo", hint: "em curso, com capítulo pra continuar" },
  { key: "pausadas", label: "Pausadas", hint: "você parou no meio — sua ou da obra" },
  { key: "terminadas", label: "Terminadas", hint: "encerradas: leu até o fim ou largou" },
  { key: "quero", label: "Quero ler", hint: "marcadas pra depois, ainda não começadas" },
  { key: "descartadas", label: "Descartadas", hint: "você decidiu não ler, agora ou de vez" },
  { key: "reler", label: "Reler", hint: "já leu e voltou pra fila" },
] as const

/**
 * Uniões sem coluna que as descreva — nomeadas por slug, com falha ALTA.
 *
 * `Stalled` e `On-hold` são as duas "pausadas", mas nenhum flag as separa de Reading/Started:
 * as quatro são `tracks_progress` e não-terminais. (`hide_from_interest` é true em `Stalled` e
 * false em `On-hold`, então também não serve.) Conferido nas colunas em 2026-08-16.
 */
const PAUSED_SLUGS = ["on-hold", "stalled"] as const
const READ_AGAIN_SLUG = "read_again"

const PAUSED_NAMES = new Set(PAUSED_SLUGS.map(personalStatusNameBySlugOrThrow))
const READ_AGAIN_NAME = personalStatusNameBySlugOrThrow(READ_AGAIN_SLUG)

/** A prateleira de um status pessoal, ou `null` se ele não entra na lista (Untracked). */
export function shelfOfStatus(info: PersonalStatusInfo): ShelfKey | null {
  if (info.status === UNTRACKED_PERSONAL_STATUS) return null
  if (info.status === READ_AGAIN_NAME) return "reler"
  if (isTerminalPersonalStatus(info.id)) return "terminadas"
  if (PAUSED_NAMES.has(info.status)) return "pausadas"
  if (isDismissedPersonalStatus(info.id)) return "descartadas"
  if (isUnreadPersonalStatus(info.id)) return "quero"
  return "lendo"
}

/**
 * 🔴 Conferência no LOAD: todo status da tabela tem prateleira (ou é o Untracked).
 *
 * A ordem dos `if` acima importa e não é óbvia — `Read Again` é `tracks_progress` e cairia em
 * "lendo"; `Dropped` é terminal E tem `hide_from_interest`. Esta checagem não valida a ordem,
 * valida a COBERTURA: ninguém pode ficar de fora.
 */
const SHELF_BY_STATUS_ID = ((): ReadonlyMap<number, ShelfKey> => {
  const map = new Map<number, ShelfKey>()
  const orfaos: string[] = []
  const chaves = new Set<string>(SHELVES.map((s) => s.key))
  for (const info of Object.values(PERSONAL_STATUSES_BY_ID)) {
    const shelf = shelfOfStatus(info)
    if (shelf == null) continue
    if (!chaves.has(shelf)) {
      orfaos.push(`${info.status} → "${shelf}" (prateleira inexistente)`)
      continue
    }
    map.set(info.id, shelf)
  }
  if (orfaos.length) {
    throw new Error(
      `my-list: status sem prateleira válida: ${orfaos.join(", ")}. ` +
        `Prateleiras: ${[...chaves].join(", ")}. Ajuste SHELVES/shelfOfStatus.`,
    )
  }
  return map
})()

export function shelfOfStatusId(id: number | null | undefined): ShelfKey | null {
  return id == null ? null : (SHELF_BY_STATUS_ID.get(id) ?? null)
}

/**
 * A obra é "sua"? — tem prateleira (⇒ status explícito que não é Untracked) OU tem nota sua.
 *
 * 🔴 `personalStatusId` tem que ser o valor CRU do espelho, nunca o rótulo resolvido. Ver o 🔴
 * do topo: com o rótulo, quem não tem linha nenhuma aparece como "Want to Read" e a lista vira
 * o catálogo inteiro.
 *
 * É justamente isso que dispensa um campo `hasRow`: sem linha, `personalStatusId` é `null`,
 * `shelfOfStatusId` devolve `null` e a obra cai fora sozinha — mesmo desfecho de "Untracked",
 * que é o certo, porque nos dois casos a pessoa não disse nada.
 *
 * ⚠️ O ramo da NOTA não é enfeite: medido em 2026-08-16, **4 obras** estão em Untracked **com
 * nota pessoal**. A pessoa se pronunciou; cortá-las por status apagaria a opinião dela. Elas
 * entram em "Todas" e em prateleira nenhuma — por isso a soma das prateleiras é menor que o
 * total, e a tela diz isso em vez de esconder.
 */
export function belongsToMyList(state: {
  personalStatusId: number | null
  userScore: number | null
}): boolean {
  if (state.userScore != null) return true
  return shelfOfStatusId(state.personalStatusId) != null
}

export type ShelfCounts = Record<ShelfKey, number>

export function emptyShelfCounts(): ShelfCounts {
  return { lendo: 0, pausadas: 0, terminadas: 0, quero: 0, descartadas: 0, reler: 0 }
}
