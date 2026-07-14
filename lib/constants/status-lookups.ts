import {
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
  PUBLICATION_STATUS_LABELS,
  PERSONAL_STATUS_LABELS,
} from "./criteria"
import { FULLY_READ_PERSONAL_STATUSES, DEFAULT_PERSONAL_STATUS } from "./criteria"
import type { PersonalStatusInfo } from "./criteria"
import type { PersonalStatus } from "@/types/domain"

const PUBLICATION_BY_NAME = new Map<string, number>(
  Object.values(PUBLICATION_STATUSES_BY_ID).map((info) => [info.status, info.id])
)

const PERSONAL_BY_NAME = new Map<string, number>(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info.id])
)

export function getPublicationStatusIdByName(
  name: string | null | undefined
): number | null {
  if (!name) return null
  const canonical = PUBLICATION_STATUS_LABELS[name] ?? name
  return PUBLICATION_BY_NAME.get(canonical) ?? null
}

export function getPersonalStatusIdByName(
  name: string | null | undefined
): number | null {
  if (!name) return null
  const canonical = PERSONAL_STATUS_LABELS[name] ?? name
  return PERSONAL_BY_NAME.get(canonical) ?? null
}

export function getPublicationStatusNameById(
  id: number | null | undefined
): string | null {
  if (id == null) return null
  return PUBLICATION_STATUSES_BY_ID[id]?.status ?? null
}

export function getPersonalStatusNameById(
  id: number | null | undefined
): string | null {
  if (id == null) return null
  return PERSONAL_STATUSES_BY_ID[id]?.status ?? null
}

/**
 * Perguntas SEMÂNTICAS sobre um status pessoal — aceitam o id ou o nome.
 *
 * 🔴 Use estas funções. NUNCA escreva o nome de um status à mão (`=== "Finished"`,
 * `new Set(["Finished", "Dropped"])`). O nome mora no Supabase e já mudou uma vez: quando
 * "Completed" virou "Finished", 10 lugares do código quebraram e o TypeScript só pegou 6 — os
 * outros eram strings soltas dentro de Set/array, que param de casar EM SILÊNCIO. As 74 obras
 * terminadas deixariam de pedir as 8 notas pós-leitura e de sumir do ranking, sem um erro sequer.
 *
 * A semântica vive na tabela (migration 155) e o `sync-constants` a gera. Com isto, renomear um
 * status é operação de banco: roda o sync e o código nem fica sabendo.
 */
function infoOf(
  status: number | string | null | undefined
): PersonalStatusInfo | null {
  if (status == null) return null
  if (typeof status === "number") return PERSONAL_STATUSES_BY_ID[status] ?? null
  const id = getPersonalStatusIdByName(status)
  return id == null ? null : (PERSONAL_STATUSES_BY_ID[id] ?? null)
}

/** A leitura encerrou (concluiu ou desistiu)? */
export function isTerminalPersonalStatus(status: number | string | null | undefined): boolean {
  return infoOf(status)?.isTerminal ?? false
}

/** Leu até o fim? */
export function isFullyReadPersonalStatus(status: number | string | null | undefined): boolean {
  return infoOf(status)?.isFullyRead ?? false
}

/** Faz sentido ter capítulo lido neste status? */
export function tracksProgressPersonalStatus(status: number | string | null | undefined): boolean {
  return infoOf(status)?.tracksProgress ?? false
}

/** Sai da fila de Interesse (não precisa de estimativa)? */
export function isInterestHiddenPersonalStatus(status: number | string | null | undefined): boolean {
  return infoOf(status)?.hideFromInterest ?? false
}

/** "Estou acompanhando" (KPI da home, widget de progresso)? */
export function isFollowingPersonalStatus(status: number | string | null | undefined): boolean {
  return infoOf(status)?.isFollowing ?? false
}

/** "Ainda não comecei"? */
export function isUnreadPersonalStatus(status: number | string | null | undefined): boolean {
  return infoOf(status)?.isUnread ?? false
}

/**
 * O nome do status quando o usuário NÃO tem linha no espelho.
 *
 * Substitui o `?? "Want to Read"` que estava repetido em 8 lugares. Não é o mesmo que "Untracked",
 * que é escolha EXPLÍCITA do usuário (667 obras) — os dois coexistiam sem nome no código, e por
 * isso pareciam contradição (o Zod tinha default "Untracked", a exibição caía em "Want to Read").
 */
export function personalStatusNameOrDefault(id: number | null | undefined): string {
  return getPersonalStatusNameById(id) ?? DEFAULT_PERSONAL_STATUS
}

const PERSONAL_BY_SLUG = new Map<string, PersonalStatusInfo>(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.slug, info]),
)

/**
 * O nome de UM status específico, buscado pelo slug — e ESTOURA se o slug não existir.
 *
 * Existe pros poucos lugares onde o código legitimamente precisa nomear um status: a página
 * /leitura tem uma seção "Lendo" e outra "Em hiato". Não há conceito a abstrair ali — a seção É
 * daquele status.
 *
 * O ganho não é evitar o acoplamento (ele é inevitável aqui); é trocar uma falha SILENCIOSA por
 * uma falha ALTA. Com `=== "Reading"` escrito à mão, renomear o status faz a seção simplesmente
 * vir vazia — sem erro, sem log, e ninguém percebe. Com isto, o build/render quebra na cara.
 */
export function personalStatusNameBySlugOrThrow(slug: string): string {
  const info = PERSONAL_BY_SLUG.get(slug)
  if (!info) {
    throw new Error(
      `personal_status: não existe status com slug "${slug}". ` +
        `Slugs válidos: ${[...PERSONAL_BY_SLUG.keys()].join(", ")}. ` +
        `Se o slug mudou no Supabase, rode sync-constants e ajuste o chamador.`,
    )
  }
  return info.status
}

/**
 * "Está no catálogo, sem status de leitura ativo" — escolha EXPLÍCITA do usuário (667 obras).
 *
 * Não confundir com [DEFAULT_PERSONAL_STATUS], que é o que a obra APARENTA quando não há linha
 * nenhuma no espelho. A diferença não tinha nome, e por isso o código parecia se contradizer: o
 * Zod tinha `default("Untracked")` enquanto a exibição caía em `?? "Want to Read"`.
 */
export const UNTRACKED_PERSONAL_STATUS = personalStatusNameBySlugOrThrow("untracked") as PersonalStatus

/**
 * O status canônico que significa "leu tudo" — hoje "Finished", ontem "Completed".
 *
 * Existe pros mapas de import (`lib/import/external-list/parsers.ts`), que traduzem o vocabulário
 * de CADA fonte ("read" no JSON do MAL, "completed" no XML) para o NOSSO nome. O lado esquerdo é
 * da fonte e fica escrito à mão; o direito é nosso e tem que vir do banco.
 *
 * Se um dia a tabela tiver zero ou mais de um status marcado `is_fully_read`, isto estoura no
 * import — de propósito. É melhor que traduzir em silêncio para um status que não existe.
 */
export const FULLY_READ_STATUS = ((): PersonalStatus => {
  const [only, ...rest] = FULLY_READ_PERSONAL_STATUSES
  if (!only || rest.length) {
    throw new Error(
      `personal_status precisa de EXATAMENTE um status com is_fully_read; achei: ` +
        `[${FULLY_READ_PERSONAL_STATUSES.join(", ")}]. Ajuste a tabela e rode sync-constants.`,
    )
  }
  return only as PersonalStatus
})()
