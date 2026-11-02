import { createAdminClient } from "@/lib/supabase/admin"
import { getPersonalStatusIdByName } from "@/lib/constants/status-lookups"
import { coverCandidates } from "@/lib/work-derived"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"
import { personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import { selectByIdsInChunks } from "@/lib/supabase/paginate"
import {
  MIXED_EDITIONS,
  adultContentFor,
  groupEditionRows,
  isMixedEditionState,
  predictionForEdition,
  resolveMixedEdition,
} from "@/lib/editions/mixed-edition"
import type { MixedEdition } from "@/lib/editions/mixed-edition"
import { VISIBLE_CRITERION_SLUGS } from "@/lib/criteria/visible"
import { fetchEditionScoresFor, getMixedEditionSettings, getR18ExtrasWorkIds } from "@/server/queries/edition-scores"
import type { ReadingEditionValues, ReadingFilterFields } from "@/lib/reading/reading-filters"

type CoverRow = { url: string; is_primary: boolean; position: number }
type ExternalIdRow = { source: string; external_id: string | null; is_rejected: boolean }

const VISIBLE_CRITERIA: ReadonlySet<string> = new Set(VISIBLE_CRITERION_SLUGS)

export interface ReadingWork extends ReadingFilterFields {
  id: string
  title: string
  coverUrls: string[]
  personalStatusId: number | null
  publicationStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
  lastReadAt: string | null
  /** Última alteração da pessoa nesta obra — só vem quando não há `lastReadAt` (ver `PaceInput`). */
  lastTouchedAt: string | null
  /** hid do comix (match exato na checagem de capítulos); `null` se não confirmado. */
  comixHid: string | null
  /** Data (aprox.) do último capítulo, cacheada na última checagem. `null` até a migration 087. */
  lastChapterReleasedAt: string | null
  /** Próxima data prevista, cacheada na última checagem. `null` até a migration 087. */
  nextChapterPredictedAt: string | null
  /** Quando esta obra foi verificada pela última vez. `null` até a migration 087 / nunca verificada. */
  chaptersCheckedAt: string | null
  /** Qualifica o hiato (migration 183): separa "a S4 sai em setembro" de "parou há 4 anos". */
  hiatusKind: HiatusKind | null
  hiatusKindConfidence: "high" | "low" | null
  /** Texto cru do MangaUpdates — a prova que o tooltip do badge mostra. */
  publicationStatusNote: string | null
}

// Colunas da migration 087. Mantidas num select separado pra degradar fail-soft
// quando a migration ainda não foi aplicada (não quebra a página).
const DATE_COLUMNS = "last_chapter_released_at, next_chapter_predicted_at, chapters_checked_at"

function isMissingColumnError(message: string): boolean {
  return /does not exist|42703|could not find/i.test(message)
}

/**
 * Obras com status pessoal "Reading" (opcionalmente "Started"), ordenadas pela
 * leitura mais recente. Alimenta a página /reading e a checagem de capítulos.
 * Traz o hid do comix de `work_external_ids` pra checagem exata por ID, e o que os
 * filtros da página consultam: quem filtra no cliente precisa da lista inteira aqui.
 */
export async function getReadingWorks(
  opts?: { statuses?: string[] },
): Promise<ReadingWork[]> {
  const statusIds = (opts?.statuses ?? [personalStatusNameBySlugOrThrow("reading")])
    .map((s) => getPersonalStatusIdByName(s))
    .filter((id): id is number => id != null)
  if (statusIds.length === 0) return []

  const supabase = createAdminClient()

  // ⚠️ Aqui o filtro É o estado pessoal — "o que EU estou lendo". Ele sai de
  // `user_work_state`, pra TODO MUNDO (Fase D): filtrar por `works.personal_status_id` devolvia
  // a lista de leitura DO DONO, com os capítulos DELE, na página de quem quer que abrisse.
  //
  // Aqui, ao contrário do /ranking, o filtro por id é EXATO: "estou lendo" é sempre uma linha
  // explícita de estado. Obra sem linha não é "lendo" — é justamente o que não aparece nesta
  // página. `[]` = não estou lendo nada → página vazia (e NÃO o catálogo inteiro).
  const personal = await getPersonalStateReader()
  // Fatia 2b: a Nota Prevista é de QUEM OLHA. Sem esta troca, ela vinha de `calculated_scores`
  // — a linha do DONO — e a Leitora via a previsão do gosto dele como se fosse a dela.
  const scoresReader = await getScoresReader()
  const ownIds = await resolvePersonalFilterIds({ personalStatusIds: statusIds })
  if (!ownIds || ownIds.length === 0) return []

  const baseSelect = `
    id, title, publication_status_id, total_chapters, is_adult, edition_state,
    hiatus_kind, hiatus_kind_confidence, publication_status_note,
    calculated_scores(expected_score, alignment_score, scoring_contract, expected_by_edition),
    category_scores(criterion_slug, score),
    work_covers(url, is_primary, position),
    work_external_ids(source, external_id, is_rejected)`

  // Em lotes: `.in("id", …)` com embeds despenca o plano do Postgres acima de ~300 ids.
  const runQuery = (select: string) =>
    selectByIdsInChunks<unknown>(ownIds, (chunk) =>
      supabase.from("works").select(select).eq("is_archived", false).in("id", chunk) as unknown as PromiseLike<{
        data: unknown[] | null
        error: { message: string } | null
      }>,
    )

  // Tenta com as colunas de data (migration 087); cai pro select-base se ainda
  // não existirem, sem quebrar a página.
  let { data, error } = await runQuery(`${baseSelect}, ${DATE_COLUMNS}`)
  if (error && isMissingColumnError(error.message)) {
    ({ data, error } = await runQuery(baseSelect))
  }
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    title: string
    publication_status_id: number | null
    total_chapters: number | null
    is_adult?: boolean | null
    edition_state?: string | null
    hiatus_kind?: HiatusKind | null
    hiatus_kind_confidence?: "high" | "low" | null
    publication_status_note?: string | null
    last_chapter_released_at?: string | null
    next_chapter_predicted_at?: string | null
    chapters_checked_at?: string | null
    calculated_scores?: { expected_score?: number | null; alignment_score?: number | null } | null
    category_scores?: Array<{ criterion_slug: string; score: number | null }> | null
    work_covers?: CoverRow[] | null
    work_external_ids?: ExternalIdRow[] | null
  }>

  // Obras `mixed`: a nota de conteúdo adulto e a Nota Prevista são por EDIÇÃO, e o filtro decide
  // qual vale no cliente. Só consulta quando há mixed na lista.
  const mixedIds = rows.filter((w) => isMixedEditionState(w.edition_state)).map((w) => w.id)
  const [editionRows, editionSettings, r18ExtrasWorkIds] =
    mixedIds.length > 0
      ? await Promise.all([fetchEditionScoresFor(supabase, mixedIds), getMixedEditionSettings(), getR18ExtrasWorkIds()])
      : [[], null, new Set<string>()]
  const editionByWork = groupEditionRows(editionRows)

  // Sem data de leitura, a recência sai da última alteração da pessoa na obra. Consulta só essas, e
  // só a coluna: o leitor do estado pessoal roda em toda página e não carrega `updated_at`.
  const semData = personal.userId ? rows.filter((w) => !personal.get(w.id).lastReadAt).map((w) => w.id) : []
  const touched = new Map<string, string>()
  if (semData.length > 0) {
    const { data: touchRows, error: touchError } = await selectByIdsInChunks<{ work_id: string; updated_at: string | null }>(
      semData,
      (chunk) =>
        supabase
          .from("user_work_state")
          .select("work_id, updated_at")
          .eq("user_id", personal.userId as string)
          .in("work_id", chunk) as unknown as PromiseLike<{
          data: Array<{ work_id: string; updated_at: string | null }> | null
          error: { message: string } | null
        }>,
      200,
    )
    if (touchError) throw new Error(`user_work_state.updated_at: ${touchError.message}`)
    for (const r of touchRows) if (r.updated_at) touched.set(r.work_id, r.updated_at)
  }

  const works = rows.map((w) => {
    const comix = (w.work_external_ids ?? []).find(
      (e) => e.source === "comix" && !e.is_rejected && e.external_id,
    )
    const state = personal.get(w.id)
    const calc = scoresReader.overlay(w.id, w.calculated_scores)
    const isMixed = isMixedEditionState(w.edition_state)
    const criterionScores: Record<string, number> = {}
    for (const row of w.category_scores ?? []) {
      if (row.score != null && VISIBLE_CRITERIA.has(row.criterion_slug)) criterionScores[row.criterion_slug] = Number(row.score)
    }
    // 🔴 Cada edição só com o que é DELA: sem linha, ausência — nunca a nota misturada nem a da outra.
    const editionValues = (edition: MixedEdition): ReadingEditionValues => {
      const adult = adultContentFor(
        { isMixed, legacyScore: criterionScores.adult_content, editionRows: editionByWork.get(w.id) },
        edition,
      )
      const expected = predictionForEdition(calc, isMixed, edition).row?.expected_score
      return {
        expectedScore: expected == null ? null : Number(expected),
        adultContent: adult.kind === "edition" ? adult.score : null,
      }
    }
    return {
      id: w.id,
      title: w.title,
      coverUrls: coverCandidates(w.work_covers),
      personalStatusId: state.personalStatusId,
      publicationStatusId: w.publication_status_id ?? null,
      isAdult: Boolean(w.is_adult),
      isMixed,
      synopsisQuality: state.synopsisQuality,
      readEdition: state.readEdition,
      defaultEdition: isMixed
        ? resolveMixedEdition({
            hideAdult: editionSettings?.hideAdult ?? false,
            signedIn: editionSettings?.signedIn ?? false,
            r18OnlyInExtras: r18ExtrasWorkIds.has(w.id),
          }).edition
        : null,
      criterionScores,
      alignmentScore: calc?.alignment_score == null ? null : Number(calc.alignment_score),
      byEdition: isMixed
        ? (Object.fromEntries(MIXED_EDITIONS.map((e) => [e, editionValues(e)])) as Record<MixedEdition, ReadingEditionValues>)
        : null,
      chaptersRead: state.chaptersRead,
      totalChapters: w.total_chapters ?? null,
      lastReadAt: state.lastReadAt,
      lastTouchedAt: touched.get(w.id) ?? null,
      expectedScore: calc?.expected_score ?? null,
      comixHid: comix?.external_id ?? null,
      lastChapterReleasedAt: w.last_chapter_released_at ?? null,
      nextChapterPredictedAt: w.next_chapter_predicted_at ?? null,
      chaptersCheckedAt: w.chapters_checked_at ?? null,
      hiatusKind: w.hiatus_kind ?? null,
      hiatusKindConfidence: w.hiatus_kind_confidence ?? null,
      publicationStatusNote: w.publication_status_note ?? null,
    }
  })

  // A ordenação por "última leitura" é EM MEMÓRIA — pra todo mundo, o dono inclusive.
  //
  // Antes ela era um `.order("last_read_at")` no SQL, ou seja, ordenava pela data que estava em
  // `works`: a DELE. Isso já estava errado pra Leitora (a lista dela saía na ordem de leitura
  // do dono) e era corrigido por um re-sort só pra ela. Agora a data vem do espelho de quem
  // olha, e o SQL não tem mais essa coluna pra ordenar — o re-sort passa a ser o único caminho,
  // e vale pros dois. Nulos por último (era `nullsFirst: false`).
  works.sort((a, b) => {
    if (a.lastReadAt === b.lastReadAt) return 0
    if (a.lastReadAt == null) return 1
    if (b.lastReadAt == null) return -1
    return b.lastReadAt.localeCompare(a.lastReadAt)
  })

  return works
}
