import { CHAPTER_SOURCE_IDS } from "@/lib/external/chapter-sources/types"
import type { ExternalSourceId } from "@/lib/external/types"
import {
  getPublicationStatusIdByName,
  isCancelledPublicationStatus,
  isConcludedPublicationStatus,
} from "@/lib/constants/status-lookups"

/**
 * Dono da régua de `works.total_chapters` quando o valor vem das fontes externas. As duas rotas
 * que gravam o campo usam esta função: a checagem da `/reading` (via `getLatestChapter`) e o
 * "Atualizar dados" da página da obra. Com réguas próprias, uma desfazia a outra (até 2026-10-08).
 *
 * 🔴 **O número é o ÚLTIMO CAPÍTULO DISPONÍVEL PARA LER, não o total oficial da obra**
 * (decidido em 2026-11-09). O app serve para acompanhar e escolher a próxima leitura, e nas duas
 * decisões o que conta é o que dá para ler. O total oficial só diferia num caso — obra terminada
 * no original com a tradução atrasada (ex.: 29 no original, 22 traduzidos) — e ali ele
 * fazia a `/reading` mostrar capítulos a ler que não existem, e o "Terminei" gravar 29 lidos.
 *
 * | ordem | fonte | por quê |
 * |---|---|---|
 * | 1 | Comix (`latestChapter`) | a que mais cobre e a que o "Continue lendo" abre |
 * | 2 | Mangago | só sem Comix (ou com o Comix descartado pela conferência abaixo) |
 * | 3 | as demais | sem nenhuma das duas: concluída/cancelada → a primeira na ordem (MU na frente); senão → a maior |
 *
 * Medido em 2026-11-09 nas 52 obras da `/reading` da dona: com as duas fontes respondendo (42),
 * deram o mesmo número em 32, o Comix à frente em 7 e o Mangago em 3. O Comix cobre 50 das 52.
 *
 * ⚠️ **Não é mais "o MAIOR entre Comix e Mangago".** Com o maior, um capítulo-AVISO do Mangago
 * ("o próximo sai em breve", publicado com o número seguinte) virava capítulo novo. O preço
 * aceito: quando o Mangago está de fato à frente (3 em 42), o app vê depois.
 *
 * ⚠️ **O preço do "disponível", aceito:** obra terminada com tradução incompleta passa a ter o
 * tamanho traduzido (ex.: 56, não os 94 do original). Isso entra na Nota Prevista e
 * no filtro de capítulos.
 *
 * 🔴 **A conferência contra número corrompido** (`isImplausibleChapter`) substitui a proteção que
 * o MangaUpdates-primeiro dava às obras concluídas (Comix 815 numa obra de 81). Ela pega erro de
 * ORDEM DE GRANDEZA, não atraso: fonte BAIXA (tradução atrasada, slug errado) é o caso comum e
 * nunca serve de motivo para descartar quem está acima. Caso medido: Comix 41, Mangago 1 — o 41
 * é o certo.
 */

/** As fontes de "último disponível", em ordem de preferência — as mesmas do `getLatestChapter`. */
const AVAILABLE_ORDER: readonly ExternalSourceId[] = CHAPTER_SOURCE_IDS
const AUTHORITY: ReadonlySet<ExternalSourceId> = new Set<ExternalSourceId>(CHAPTER_SOURCE_IDS)

/** Acima de N vezes a maior referência E com folga absoluta ⇒ erro de ordem de grandeza. */
export const IMPLAUSIBLE_RATIO = 5
export const IMPLAUSIBLE_MIN_GAP = 100

/**
 * Número de capítulo → contagem inteira. `ceil` porque um capítulo decimal (29.1, 63.5) é
 * um capítulo a mais, e é o mesmo arredondamento que a `/reading` sempre usou ao gravar.
 * Zero e negativo não são contagem (o Kitsu devolve 0 em obra sem dado): viram `undefined`.
 */
export function toChapterCount(n: number | null | undefined): number | undefined {
  return n != null && Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined
}

/**
 * `true` quando `value` só pode ser número corrompido: mais de `IMPLAUSIBLE_RATIO` vezes a maior
 * referência E pelo menos `IMPLAUSIBLE_MIN_GAP` capítulos acima dela. As duas condições juntas: a
 * razão sozinha descartaria obra curta (41 × 1), a folga sozinha descartaria obra longa atrasada
 * na outra fonte. Sem referência, não há o que conferir.
 */
export function isImplausibleChapter(value: number, reference: number | null | undefined): boolean {
  if (reference == null || !(reference > 0)) return false
  return value > reference * IMPLAUSIBLE_RATIO && value - reference >= IMPLAUSIBLE_MIN_GAP
}

export interface TotalChaptersPick {
  value: number | undefined
  /** Qual fonte deu o valor (`undefined` quando nenhuma deu). */
  source?: ExternalSourceId
  /**
   * `true` quando o valor saiu de Comix ou Mangago — é o que a `/reading` aplica sozinha, sem
   * humano, então a divergência entre fontes aqui não é conflito para decidir. `false` no
   * fallback para as demais fontes, onde a divergência continua sendo decisão humana.
   */
  decidedByRule: boolean
}

function isTerminalPublicationStatus(name: string | null | undefined): boolean {
  const id = getPublicationStatusIdByName(name)
  return isConcludedPublicationStatus(id) || isCancelledPublicationStatus(id)
}

/**
 * Escolhe o número de capítulos entre os valores das fontes aceitas (ver a tabela do topo).
 *
 * `opts.current` é o total já gravado: entra só como REFERÊNCIA da conferência de número
 * corrompido (a `/reading` só consulta Comix e Mangago, e sem ele uma obra com o Mangago no slug
 * errado não teria contra o que comparar). Nunca é escolhido como valor.
 *
 * `results` tem que vir na ordem de prioridade do merge: é ela que decide o fallback de obra
 * terminada sem Comix nem Mangago.
 */
export function pickTotalChapters(
  results: ReadonlyArray<{ source: ExternalSourceId; chapters?: number | null }>,
  publicationStatus: string | null | undefined,
  opts: { current?: number | null } = {},
): TotalChaptersPick {
  const counts = results.flatMap((r) => {
    const value = toChapterCount(r.chapters)
    return value == null ? [] : [{ source: r.source, value }]
  })
  if (counts.length === 0) return { value: undefined, decidedByRule: false }

  const current = toChapterCount(opts.current)
  for (const source of AVAILABLE_ORDER) {
    const pick = counts.find((c) => c.source === source)
    if (!pick) continue
    const others = counts.filter((c) => c.source !== source).map((c) => c.value)
    const reference = Math.max(0, current ?? 0, ...others)
    if (isImplausibleChapter(pick.value, reference)) continue
    return { value: pick.value, source, decidedByRule: true }
  }

  const rest = counts.filter((c) => !AUTHORITY.has(c.source))
  if (rest.length === 0) return { value: undefined, decidedByRule: false }
  const chosen = isTerminalPublicationStatus(publicationStatus)
    ? rest[0]
    : rest.reduce((best, c) => (c.value > best.value ? c : best))
  return { value: chosen.value, source: chosen.source, decidedByRule: false }
}
