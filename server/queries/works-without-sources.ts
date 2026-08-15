import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { SELECTABLE_EXTERNAL_SOURCES } from "@/lib/external/source-order"
import { tallySourceGaps } from "@/lib/external/source-gaps"
import { pickPrimaryCover } from "@/lib/work-derived"
import { workCardCountsRpc } from "@/server/queries/work-card-meta"
import { filterWorkIdsByInterest } from "@/server/queries/interest-filter"
import { hiatusFieldsFromRow } from "@/lib/works/hiatus-display"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import type { ExternalSourceId } from "@/lib/external/types"

export type { SourceLinkState } from "@/lib/external/source-link-state"

export interface SourceGapWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatusId: number | null
  hiatusKind: HiatusKind | null
  hiatusKindConfidence: "high" | "low" | null
  publicationStatusNote: string | null
  personalStatusId: number | null
  expectedScore: number | null
  isAdult: boolean
  userScore: number | null
  /** Fontes com vínculo aceito, na ordem canônica. */
  linked: ExternalSourceId[]
  /** Fontes marcadas como "não existe aqui" — decididas, não pendentes. */
  absent: ExternalSourceId[]
  /** Fontes NUNCA avaliadas. É o que a fila existe pra fechar. */
  gaps: ExternalSourceId[]
  /** Reviews ÚTEIS (≥40 chars) — o que a lacuna custa em evidência. */
  usefulReviews: number
  tagCount: number
}

export interface SourceGapQueue {
  works: SourceGapWork[]
  /** Nº de obras com lacuna POR fonte — alimenta os chips do mapa. Ordem canônica. */
  gapsBySource: Array<{ source: ExternalSourceId; missing: number }>
  /** Obras ativas no catálogo (denominador dos chips). */
  totalWorks: number
  /** Obras com ≥1 lacuna — o tamanho real da fila, independente do filtro de fonte. */
  withGapsCount: number
}

export interface SourceGapFilters {
  pubStatusIds?: number[]
  personalStatusIds?: number[]
  /** Interesse manual (♥…♥♥♥♥ + "none") — o mesmo filtro das outras abas. */
  synopsisQualities?: string[]
  /** Interesse previsto pela IA — idem. */
  predictionQualities?: string[]
  /** Mostrar só quem tem lacuna NESTA fonte (o chip do mapa). */
  source?: ExternalSourceId | null
}

interface WorkRow {
  id: string
  title: string | null
  publication_status_id: number | null
  personal_status_id: number | null
  hiatus_kind: HiatusKind | null
  hiatus_kind_confidence: "high" | "low" | null
  publication_status_note: string | null
  user_score: number | null
  work_covers?: Array<{ url: string; is_primary: boolean | null; position: number | null }> | null
  calculated_scores?: { expected_score?: number | null } | null
}

interface ExternalIdRow {
  work_id: string
  source: string
  external_id: string | null
  is_rejected: boolean | null
}

/**
 * Fila de "Fontes": obras cujo vínculo com alguma fonte externa nunca foi avaliado.
 *
 * 🔴 **O universo de fontes é `SELECTABLE_EXTERNAL_SOURCES`, derivado da tabela
 * `source` do banco — NUNCA uma lista escrita aqui.** É a mesma constante que o
 * `SourceSelectionStep` (o diálogo que esta aba abre) usa pra desenhar os cards por
 * fonte. Uma segunda lista aqui é como a aba passa a acusar lacuna numa fonte que o
 * diálogo não sabe resolver: a obra entraria na fila, você abriria o diálogo, ela não
 * apareceria, e a obra voltaria pra fila no próximo carregamento — sem erro nenhum.
 *
 * ⚠️ **Lacuna ≠ obra ausente da fonte.** Medido em 2026-08-15 (clone local, 978 obras
 * ativas): NENHUMA obra está sem vínculo nenhum, e a mediana são 8 fontes de 9. O que
 * existe são 1.424 lacunas espalhadas (kitsu 363 · MAL 338 · mangadex 251 · mangago 175
 * · comick 129 · anilist 81 · animeplanet 72 · mangaupdates 15 · comix 0), e elas caem
 * majoritariamente em obra pouco enriquecida — não em obra que a fonte não indexa: por
 * script do título original, o coreano é o MELHOR coberto no MAL (26% de lacuna) contra
 * 60% do jp/cn e 67% das obras sem título original.
 *
 * ⚠️ **A lacuna custa evidência, e a relação é monotônica** (medido no mesmo dia): 0
 * lacunas → 57,2 reviews úteis em média; 3 → 24,5; 5 → 7,4. Abaixo do piso de 4 reviews
 * úteis do digest: 1,1% das obras sem lacuna contra 57% das com 5 lacunas. É por isso
 * que `usefulReviews` vem junto — é ele que separa "lacuna que dói" de "lacuna que só
 * existe".
 *
 * Read-only. US$0: não dispara LLM nem busca externa. Quem faz a busca é o diálogo, sob
 * clique — ver `revalidateWorkSources`.
 */
export async function getSourceGapQueue(
  filters: SourceGapFilters = {},
  opts: { countOnly?: boolean } = {},
): Promise<SourceGapQueue> {
  const sb = createAdminClient()
  const sources = SELECTABLE_EXTERNAL_SOURCES

  // 🔴 O caminho do CONTADOR pede só `id` — medido em 2026-08-15 contra o clone local,
  // 978 obras: a projeção dos cards custa **857 KB** e a de id custa **46 KB** (18×).
  // Não é detalhe: quem chama com `countOnly` é `getCuradoriaTabCounts`, cujo cache é
  // invalidado pela tag `ai-eval-tab-counts` — compartilhada por /ai-evaluation E
  // /fila-recomendacao —, então toda mutação em qualquer das duas repaga isto contra a
  // NUVEM. As colunas de status não entram na projeção de propósito: elas são filtro
  // `.in()` resolvido no SQL, e o filtro de Interesse só precisa dos ids.
  const selectCols = opts.countOnly
    ? "id"
    : "id, title, publication_status_id, personal_status_id, hiatus_kind, hiatus_kind_confidence, publication_status_note, user_score, work_covers(url, is_primary, position), calculated_scores(expected_score)"

  // ⚠️ Os dois scans PAGINAM. O catálogo ativo está em 978 linhas e
  // `work_external_ids` em ~7,4k: sem `.range()` o PostgREST corta em 1000 sem erro
  // e sem log, e o corte aqui é do tipo que produz resultado — obra truncada some do
  // mapa de vínculos, TODAS as fontes dela viram lacuna e ela aparece no topo da fila
  // como se estivesse órfã.
  const [worksRaw, idRows] = await Promise.all([
    fetchAllRows<WorkRow>(
      (from, to) => {
        // Dado PESSOAL do dono (personal_status_id, user_score) vem do espelho via
        // `works_owner` — `works` já não tem essas colunas.
        let q = sb.from("works_owner").select(selectCols).eq("is_archived", false)
        if (filters.pubStatusIds?.length) q = q.in("publication_status_id", filters.pubStatusIds)
        if (filters.personalStatusIds?.length) q = q.in("personal_status_id", filters.personalStatusIds)
        // O cast é necessário e é o mesmo que `getWorksWithoutTags` faz: o supabase-js
        // infere embed to-one (`calculated_scores`) como ARRAY, e em runtime vem objeto.
        return q
          .order("id")
          .range(from, to)
          .then(({ data, error }) => ({ data: (data ?? []) as unknown as WorkRow[], error }))
      },
      "getSourceGapQueue.works",
    ),
    fetchAllRows<ExternalIdRow>(
      (from, to) =>
        sb
          .from("work_external_ids")
          .select("work_id, source, external_id, is_rejected")
          .order("work_id")
          .range(from, to),
      "getSourceGapQueue.externalIds",
    ),
  ])

  // ⚠️ O filtro de Interesse entra ANTES do tally, e é a única exceção à regra do "o
  // mapa não encolhe": Interesse e status recortam o UNIVERSO da pergunta ("dessas
  // obras, quais têm lacuna?"), enquanto o chip de fonte recorta a RESPOSTA. Deixá-lo
  // de fora seria pior de todo jeito — o painel oferece o controle em todas as abas, e
  // um filtro que aparece aplicado e não filtra nada é a pior das duas opções.
  // No-op barato quando nenhum interesse está ativo (nem toca no banco).
  const allowed = await filterWorkIdsByInterest(
    worksRaw.map((w) => w.id),
    filters.synopsisQualities ?? [],
    filters.predictionQualities ?? [],
  )
  const scopedWorks = worksRaw.filter((w) => allowed.has(w.id))

  // 🔴 O cruzamento obra × fonte é `tallySourceGaps`, PURO e testado — inclusive a
  // ordem que importa: os contadores do mapa somam o universo INTEIRO e só depois o
  // filtro de fonte recorta a lista. Inline aqui, essa ordem seria invertida numa
  // refatoração sem nada acusar, e o mapa passaria a encolher junto com o filtro.
  const tally = tallySourceGaps({
    workIds: scopedWorks.map((w) => w.id),
    rows: idRows,
    sources,
    filterSource: filters.source ?? null,
  })

  if (opts.countOnly) {
    return {
      works: [],
      gapsBySource: tally.gapsBySource,
      totalWorks: scopedWorks.length,
      withGapsCount: tally.withGapsCount,
    }
  }

  // `is_adult` é de CATÁLOGO (não está na view do dono) — 1 scan próprio, paginado.
  const adultIds = new Set(
    (
      await fetchAllRows<{ id: string }>(
        (from, to) => sb.from("works").select("id").eq("is_adult", true).order("id").range(from, to),
        "getSourceGapQueue.adult",
      )
    ).map((r) => r.id),
  )

  // Contagens agregadas em SQL (RPC da migration 122) — 1 chamada pro catálogo todo.
  // `null` quando a RPC não existe; aí a coluna simplesmente não é exibida (0), em vez
  // de varrer work_reviews/work_tags aqui só pra enfeitar o card.
  const counts = await workCardCountsRpc(sb, null)

  const works: SourceGapWork[] = []

  for (const w of scopedWorks) {
    const split = tally.perWork.get(w.id)
    if (!split) continue
    const { linked, absent, gaps } = split

    const c = counts?.get(w.id)
    works.push({
      id: w.id,
      title: w.title ?? "",
      coverUrl: pickPrimaryCover(w.work_covers),
      publicationStatusId: w.publication_status_id,
      ...hiatusFieldsFromRow(w),
      personalStatusId: w.personal_status_id,
      expectedScore:
        w.calculated_scores?.expected_score != null ? Number(w.calculated_scores.expected_score) : null,
      isAdult: adultIds.has(w.id),
      userScore: w.user_score ?? null,
      linked,
      absent,
      gaps,
      usefulReviews: c?.reviewCount ?? 0,
      tagCount: c?.tagCount ?? 0,
    })
  }

  // Ordem padrão: mais lacunas primeiro e, no empate, menos evidência primeiro — as
  // duas juntas descrevem "onde falta mais e onde a falta mais dói". Título desempata
  // pra a lista não embaralhar entre carregamentos.
  works.sort(
    (a, b) =>
      b.gaps.length - a.gaps.length ||
      a.usefulReviews - b.usefulReviews ||
      a.title.localeCompare(b.title, "pt-BR"),
  )

  return {
    works,
    gapsBySource: tally.gapsBySource,
    totalWorks: scopedWorks.length,
    withGapsCount: tally.withGapsCount,
  }
}
