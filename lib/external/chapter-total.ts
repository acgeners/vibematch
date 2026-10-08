import { CHAPTER_SOURCE_IDS } from "@/lib/external/chapter-sources/types"
import type { ExternalSourceId } from "@/lib/external/types"
import {
  getPublicationStatusIdByName,
  isCancelledPublicationStatus,
  isConcludedPublicationStatus,
} from "@/lib/constants/status-lookups"

/**
 * Dono da régua de `works.total_chapters` quando o valor vem das fontes externas.
 *
 * 🔴 Duas rotas gravam esse campo, e até 2026-10-08 cada uma tinha a sua régua:
 *
 * | rota | régua antiga |
 * |---|---|
 * | `/reading` (checagem de capítulos) | o MAIOR entre Comix e Mangago (`getLatestChapter`) |
 * | "Atualizar dados" (página da obra) | o PRIMEIRO na ordem das fontes, com o MangaUpdates na frente |
 *
 * O MangaUpdates fica atrás em obra ainda saindo — medido em 12 obras em andamento, ele
 * ficou abaixo do Comix/Mangago em 7. Então "Atualizar dados" não subia o total (ex.:
 * banco 62, MU 62, Comix 69, Mangago 70 ⇒ continuava 62) e, quando a `/reading` já o
 * tinha subido, propunha BAIXÁ-LO de volta (Dokkaebi: banco 16, MU 13, Comix 31 ⇒ 13).
 *
 * ⚠️ Mas a régua da `/reading` NÃO serve para obra concluída: medido em 15, o MU acerta e
 * o resto erra pros dois lados — scan incompleta (Stained Scarlet: MU 94, Comix 56,
 * Mangago 35) e número corrompido na fonte (Comix 815 numa obra de 81). Por isso a régua
 * depende do status, e obra terminada segue no MU-primeiro de antes.
 */

/** Fontes AUTORIZADAS sobre obra ainda saindo — as mesmas do `getLatestChapter`. */
const AUTHORITY: ReadonlySet<ExternalSourceId> = new Set<ExternalSourceId>(CHAPTER_SOURCE_IDS)

/**
 * Número de capítulo → contagem inteira. `ceil` porque um capítulo decimal (29.1, 63.5) é
 * um capítulo a mais, e é o mesmo arredondamento que a `/reading` sempre usou ao gravar.
 * Zero e negativo não são contagem (o Kitsu devolve 0 em obra sem dado): viram `undefined`.
 */
export function toChapterCount(n: number | null | undefined): number | undefined {
  return n != null && Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined
}

export interface TotalChaptersPick {
  value: number | undefined
  /**
   * `true` quando o valor saiu da régua sem ambiguidade (obra ainda saindo + alguma fonte
   * autorizada respondeu). É o que a `/reading` aplica sozinha, sem humano — então a
   * divergência entre fontes, aqui, não é conflito para decidir.
   */
  decidedByRule: boolean
}

function isTerminalPublicationStatus(name: string | null | undefined): boolean {
  const id = getPublicationStatusIdByName(name)
  return isConcludedPublicationStatus(id) || isCancelledPublicationStatus(id)
}

/**
 * Escolhe o total de capítulos entre os valores das fontes aceitas.
 *
 * - **Concluída / cancelada:** o primeiro valor na ordem recebida (MangaUpdates na frente),
 *   que é o comportamento de antes. A contagem oficial já não muda, e é o MU quem a tem.
 * - **Ainda saindo** (em andamento, hiato, desconhecido): o MAIOR entre as fontes
 *   autorizadas (`CHAPTER_SOURCE_IDS`), exatamente o que a `/reading` grava. Sem nenhuma
 *   delas, o maior entre as demais — quem tem o capítulo mais alto é o mais atualizado.
 *
 * `results` tem que vir na ordem de prioridade do merge: é ela que decide a obra terminada.
 */
export function pickTotalChapters(
  results: ReadonlyArray<{ source: ExternalSourceId; chapters?: number | null }>,
  publicationStatus: string | null | undefined,
): TotalChaptersPick {
  const counts = results.flatMap((r) => {
    const value = toChapterCount(r.chapters)
    return value == null ? [] : [{ source: r.source, value }]
  })
  if (counts.length === 0) return { value: undefined, decidedByRule: false }

  if (isTerminalPublicationStatus(publicationStatus)) {
    return { value: counts[0].value, decidedByRule: false }
  }

  const authority = counts.filter((c) => AUTHORITY.has(c.source))
  if (authority.length > 0) {
    return { value: Math.max(...authority.map((c) => c.value)), decidedByRule: true }
  }
  return { value: Math.max(...counts.map((c) => c.value)), decidedByRule: false }
}
