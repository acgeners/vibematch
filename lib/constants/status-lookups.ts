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
 * Perguntas SEMÂNTICAS sobre a PUBLICAÇÃO — "a obra ainda pode ganhar capítulo?".
 *
 * A tabela `publication_status` não tem colunas de semântica (ao contrário de `personal_status`,
 * que ganhou as dela na migration 155), então a semântica mora aqui, casada por SLUG — que é a
 * chave estável do `sync-constants`. Se um slug sumir do Supabase isto ESTOURA no import, de
 * propósito: um `Set` que silenciosamente para de casar é exatamente o bug que a 155 documenta
 * (renomear "Completed" → "Finished" quebrou 10 lugares e o TypeScript pegou 6).
 */
const PUBLICATION_BY_SLUG = new Map<string, number>(
  Object.values(PUBLICATION_STATUSES_BY_ID).map((info) => [info.slug, info.id])
)

function publicationIdsBySlugOrThrow(slugs: string[]): Set<number> {
  const ids = slugs.map((slug) => {
    const id = PUBLICATION_BY_SLUG.get(slug)
    if (id == null) {
      throw new Error(
        `publication_status: não existe status com slug "${slug}". ` +
          `Slugs válidos: ${[...PUBLICATION_BY_SLUG.keys()].join(", ")}. ` +
          `Se o slug mudou no Supabase, rode sync-constants e ajuste o chamador.`
      )
    }
    return id
  })
  return new Set(ids)
}

/** Ainda sai capítulo novo (ou pode voltar a sair): a obra NÃO acabou. */
const STILL_PUBLISHING_IDS = publicationIdsBySlugOrThrow(["ongoing", "hiatus"])

/** A história chegou ao fim previsto pelo autor. `cancelled` fica de fora: acabou, mas incompleta. */
const CONCLUDED_IDS = publicationIdsBySlugOrThrow(["completed"])

/** Parada sem data pra voltar — o pior caso pra quem quer COMEÇAR agora. */
const HIATUS_IDS = publicationIdsBySlugOrThrow(["hiatus"])

/** Acabou INCOMPLETA — nunca vai terminar. */
const CANCELLED_IDS = publicationIdsBySlugOrThrow(["cancelled"])

/** A obra ainda está saindo (Ongoing/Hiatus) — logo, ninguém leu "a obra inteira". */
export function isStillPublishingStatus(id: number | null | undefined): boolean {
  return id != null && STILL_PUBLISHING_IDS.has(id)
}

/**
 * A obra foi CANCELADA — acabou sem terminar a história.
 *
 * ⚠️ Existe para separar "cancelada" de "não sei o status": as duas caíam no mesmo
 * ramo final de `startabilityOf`, e `Unknown` era tratado como o pior caso.
 */
export function isCancelledPublicationStatus(id: number | null | undefined): boolean {
  return id != null && CANCELLED_IDS.has(id)
}

/**
 * A obra está PARADA (hiato) — subconjunto de "ainda saindo".
 *
 * Existe porque "dá pra começar agora?" não é a mesma pergunta que "acabou?": entre
 * as duas que ainda saem, a em andamento entrega capítulo e a em hiato não entrega
 * nada e não tem data. Ver `startabilityOf` em lib/calculations/mood-refine.ts.
 */
export function isHiatusPublicationStatus(id: number | null | undefined): boolean {
  return id != null && HIATUS_IDS.has(id)
}

/** A obra terminou de sair (Completed) — ler o último capítulo é ter lido tudo. */
export function isConcludedPublicationStatus(id: number | null | undefined): boolean {
  return id != null && CONCLUDED_IDS.has(id)
}

/**
 * O nome do status "a obra acabou" — hoje "Completed". Existe pro botão "a obra terminou"
 * do aviso de coerência, que precisa MANDAR um nome pra server action. Escrever a string à
 * mão ali seria o mesmo acoplamento que a migration 155 documenta, do outro lado da tabela.
 */
export const CONCLUDED_PUBLICATION_STATUS = ((): string => {
  const [id] = [...CONCLUDED_IDS]
  const name = id != null ? getPublicationStatusNameById(id) : null
  if (!name) {
    throw new Error("publication_status: sem status 'completed' — rode sync-constants.")
  }
  return name
})()

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
/**
 * A pessoa DESCARTOU esta obra — decidiu não ler (agora ou de vez).
 *
 * 🔴 Nomeado por SLUG porque NÃO existe flag que descreva esta união. Medido nas
 * colunas de `personal_status`: "Not Now" e "Not Interested" têm **todas** as flags
 * `false` — logo, a única forma de reconhecê-las seria por AUSÊNCIA de sinal, que é
 * a régua mais frágil possível (qualquer status novo com as flags em branco entraria
 * junto). É a mesma situação de "Read Again" na prateleira "Pra você hoje": sem
 * coluna que descreva o conceito, o slug é o acoplamento honesto — e este estoura
 * num rename, em vez de parar de casar em silêncio.
 *
 * ⚠️ `Dropped` NÃO está aqui: ele é `isTerminal` e já tem régua própria. Somá-lo
 * criaria dois caminhos para o mesmo fato.
 */
const DISMISSED_IDS = new Set<number>(
  ["not_now", "not_interested"].map((slug) => {
    const info = PERSONAL_BY_SLUG.get(slug)
    if (!info) {
      throw new Error(
        `personal_status: não existe status com slug "${slug}". ` +
          `Slugs válidos: ${[...PERSONAL_BY_SLUG.keys()].join(", ")}. ` +
          `Se o slug mudou no Supabase, rode sync-constants e ajuste o chamador.`,
      )
    }
    return info.id
  }),
)

/** Decidiu não ler — "Not Now" ou "Not Interested". Ver DISMISSED_IDS. */
export function isDismissedPersonalStatus(status: number | null | undefined): boolean {
  return status != null && DISMISSED_IDS.has(status)
}

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
 * Status "estou lendo agora" (slug `reading`). Usado pra promover automaticamente uma obra
 * que sai de "Want to Read" quando os capítulos lidos passam de 0 — "não comecei" com progresso
 * é um estado contraditório. Estoura se o slug sumir do Supabase (mesma falha-alta de
 * [personalStatusNameBySlugOrThrow]), em vez de virar um `=== "Reading"` que quebra em silêncio.
 */
export function readingPersonalStatusName(): string {
  return personalStatusNameBySlugOrThrow("reading")
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
 * "Dá pra pegar pra ler agora" — o conjunto da prateleira "Pra você hoje" da home.
 *
 * É a união de duas coisas que a tabela descreve separadamente: as NÃO-COMEÇADAS (`is_unread` →
 * Want to Read e Untracked) mais **Read Again**, que já foi lida mas voltou pra fila por escolha
 * explícita do usuário. Fica de fora tudo que está em curso (Reading/Started/Stalled/On-hold/
 * Hiatus), encerrado (Finished/Dropped) ou recusado (Not Now/Not Interested).
 *
 * ⚠️ Não existe coluna em `personal_status` que descreva essa união, então "Read Again" é
 * nomeado aqui — pelo SLUG, via [personalStatusNameBySlugOrThrow], que ESTOURA se o slug sumir
 * do Supabase. Um `=== "Read Again"` escrito à mão faria a prateleira perder o status EM
 * SILÊNCIO num rename, que é exatamente o bug que a migration 155 documenta. Se essa união
 * virar conceito de produto em mais de um lugar, ela merece coluna própria na tabela.
 */
const READ_AGAIN_STATUS = personalStatusNameBySlugOrThrow("read_again")

export function isPickablePersonalStatus(status: number | string | null | undefined): boolean {
  if (isUnreadPersonalStatus(status)) return true
  return infoOf(status)?.status === READ_AGAIN_STATUS
}

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
