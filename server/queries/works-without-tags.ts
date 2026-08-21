import "server-only"
import { hiatusFieldsFromRow } from "@/lib/works/hiatus-display"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows, fetchAllRowsParallel } from "@/lib/supabase/paginate"
import { coverCandidates } from "@/lib/work-derived"
import { PUBLICATION_STATUSES_BY_ID, PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { classifyWorksWithoutTags, type NoTagsWork, type NoTagsFilters, type TagWorkMetaRow } from "@/lib/tags/no-tags-classify"
import { loadEffectiveInterest } from "@/lib/synopsis-interest/effective-interest"
import { workCardCountsRpc } from "@/server/queries/work-card-meta"
import { checkInferTags, TAG_MIN_SYNOPSIS_CHARS } from "@/lib/orchestration/ui-readiness"

export type { NoTagsWork, NoTagsFilters } from "@/lib/tags/no-tags-classify"

export interface NoTagsResult {
  works: NoTagsWork[]
  /** total sem filtro de busca/golden/external (universo "faixa min..máx de tags"). */
  totalWithoutTags: number
  /** ids do universo (faixa de tags) — populado no `countOnly` p/ unir com a aba de reviews. */
  ids?: string[]
  /** Nº de tags por obra (TODAS as obras, já computado no scan) — reaproveitado pela
   *  aba "Tags & Reviews" pra não re-varrer work_tags no card. */
  tagCountByWork?: Map<string, number>
}

/**
 * Loader server-only. Read-only. Espelha `getWorksWithoutReviews`. Poucas queries
 * (sem N+1): work_tags (só work_id), works ativas, external ids aceitos, golden ids.
 * NÃO carrega texto de review/sinopse. NÃO dispara LLM/summary/digest/avaliação.
 *
 * `countOnly` (caminho do badge/contador de aba): computa só `totalWithoutTags`
 * (que só depende de status + faixa de tags, não de busca/golden/external/interesse)
 * e pula a hidratação de capas/fontes/golden/interesse/classificação. Sai bem mais
 * barato no fan-out de contadores das abas.
 */
export async function getWorksWithoutTags(
  filters: NoTagsFilters = {},
  opts: { countOnly?: boolean } = {},
): Promise<NoTagsResult> {
  const sb = createAdminClient()

  // 1) tags: agrega contagem por obra (coluna leve work_id). Scan paralelo:
  // conta primeiro, dispara as páginas juntas (a contagem é order-independent).
  // Caminho rápido: RPC agregada (migration 122) — contagem por obra em SQL, 1 chamada.
  // Fallback: scan paralelo de work_tags (contagem em JS) se a RPC não existir.
  const tagCount = new Map<string, number>()
  const rpcCounts = await workCardCountsRpc(sb, null)
  if (rpcCounts) {
    for (const [id, c] of rpcCounts) tagCount.set(id, c.tagCount)
  } else {
    const tagRows = await fetchAllRowsParallel<{ work_id: string }>(
      () => sb.from("work_tags").select("work_id", { count: "exact", head: true }),
      (from, to) => sb.from("work_tags").select("work_id").range(from, to),
      "work_tags",
    )
    for (const r of tagRows) tagCount.set(r.work_id, (tagCount.get(r.work_id) ?? 0) + 1)
  }

  // 2) works ativas (+ pub/personal filter no SQL). Colunas leves; canonical só presença.
  // Seleciona E FILTRA dado PESSOAL do DONO (personal_status_id, synopsis_quality) → lê do
  // espelho via a view `works_owner`, não da linha compartilhada de `works` (que vai perder
  // essas colunas). Os filtros/`.in()` continuam valendo: a view expõe os mesmos nomes.
  const montaWorksQ = () => {
    let q = sb
      .from("works_owner")
      .select("id, title, ai_eval_status, canonical_synopsis, publication_status_id, personal_status_id, synopsis_quality, hiatus_kind, hiatus_kind_confidence, publication_status_note, work_covers(url, is_primary, position), calculated_scores(expected_score)")
      .eq("is_archived", false)
    if (filters.pubStatusIds && filters.pubStatusIds.length > 0) q = q.in("publication_status_id", filters.pubStatusIds)
    if (filters.personalStatusIds && filters.personalStatusIds.length > 0) q = q.in("personal_status_id", filters.personalStatusIds)
    return q
  }
  // 🔴 PAGINADA: `works_owner` tem 1.019 linhas (2026-08-18) e o PostgREST corta em 1000 sem
  // erro — a fila perderia obras em silêncio, que é o oposto do que uma FILA existe pra fazer.
  const worksData = await fetchAllRows<Record<string, unknown>>(
    (from, to) => montaWorksQ().range(from, to),
    "worksQueue.works_owner",
  )

  type Row = {
    id: string
    title: string
    ai_eval_status: string | null
    canonical_synopsis: string | null
    publication_status_id: number | null
    hiatus_kind?: HiatusKind | null
    hiatus_kind_confidence?: "high" | "low" | null
    publication_status_note?: string | null
    personal_status_id: number | null
    synopsis_quality: string | null
    work_covers?: Array<{ url: string; is_primary: boolean | null; position: number | null }> | null
    calculated_scores?: { expected_score?: number | null } | null
  }
  // Faixa [min, máx] de tags. máx default 0 (= só sem tag). Quando máx < min, o limite
  // superior é ignorado (sem teto) — assim setar só o min dá "≥ min".
  const maxTags = Math.max(0, Math.floor(filters.maxTags ?? 0))
  const minTags = Math.max(0, Math.floor(filters.minTags ?? 0))
  const inBand = (c: number) => c >= minTags && (maxTags < minTags ? true : c <= maxTags)
  const activeFewTags = ((worksData ?? []) as Row[]).filter((w) => inBand(tagCount.get(w.id) ?? 0))
  const totalWithoutTags = activeFewTags.length
  const ids = activeFewTags.map((w) => w.id)

  // Badge/contador de aba: o total já está pronto e não depende de
  // busca/golden/external/interesse — pula toda a hidratação abaixo. Devolve os
  // ids do universo pra aba "Tags & Reviews" unir com o universo de reviews.
  if (opts.countOnly) return { works: [], totalWithoutTags, ids, tagCountByWork: tagCount }

  // 3) external ids aceitos + golden (chunked, leves; chunks em paralelo).
  const acceptedSources = new Map<string, string[]>()
  const goldenIds = new Set<string>()
  const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

  // Sinais do gate de "Inferir tags": comprimento da sinopse (canônica OU bruta
  // ≥ 80 chars, regra do gerador) + contexto de reviews (ajuda). A canônica já
  // veio no scan; só busco as BRUTAS das que têm canônica curta (bounded).
  const canonLen = new Map<string, number>()
  for (const w of activeFewTags) canonLen.set(w.id, String(w.canonical_synopsis ?? "").trim().length)
  const sub80Ids = activeFewTags.filter((w) => (canonLen.get(w.id) ?? 0) < TAG_MIN_SYNOPSIS_CHARS).map((w) => w.id)
  const maxRawLen = new Map<string, number>()
  const hasReviewContext = new Set<string>()

  await Promise.all([
    Promise.all(chunk(ids, 200).map(async (c) => {
      const { data, error } = await sb.from("work_external_ids").select("work_id, source, is_rejected").in("work_id", c)
      if (error) throw new Error(`work_external_ids: ${error.message}`)
      for (const r of (data ?? []) as Array<{ work_id: string; source: string; is_rejected: boolean | null }>) {
        if (!r.is_rejected) {
          const list = acceptedSources.get(r.work_id) ?? []
          list.push(r.source)
          acceptedSources.set(r.work_id, list)
        }
      }
    })),
    Promise.all(chunk(ids, 200).map(async (c) => {
      const { data, error } = await sb.from("synopsis_interest_golden").select("work_id").in("work_id", c)
      if (error) throw new Error(`synopsis_interest_golden: ${error.message}`)
      for (const r of (data ?? []) as Array<{ work_id: string }>) goldenIds.add(r.work_id)
    })),
    // Sinopses BRUTAS só das de canônica curta → maior comprimento (pro gate tags).
    Promise.all(chunk(sub80Ids, 200).map(async (c) => {
      const { data, error } = await sb.from("work_synopses").select("work_id, text").in("work_id", c)
      if (error) throw new Error(`work_synopses: ${error.message}`)
      for (const r of (data ?? []) as Array<{ work_id: string; text?: string | null }>) {
        const len = String(r.text ?? "").trim().length
        if (len > (maxRawLen.get(r.work_id) ?? 0)) maxRawLen.set(r.work_id, len)
      }
    })),
    // Contexto de reviews (digest/summary) — presença JSONB-safe (só `.not null`).
    // Fica em `works` de propósito: digest/summary são de CATÁLOGO (não pessoais) e não
    // existem na view `works_owner`.
    Promise.all(chunk(ids, 200).map(async (c) => {
      const [d, s] = await Promise.all([
        sb.from("works").select("id").in("id", c).not("review_digest", "is", null),
        sb.from("works").select("id").in("id", c).not("review_summary", "is", null),
      ])
      if (d.error) throw new Error(`review_digest: ${d.error.message}`)
      if (s.error) throw new Error(`review_summary: ${s.error.message}`)
      for (const r of (d.data ?? []) as Array<{ id: string }>) hasReviewContext.add(r.id)
      for (const r of (s.data ?? []) as Array<{ id: string }>) hasReviewContext.add(r.id)
    })),
  ])

  // 4) Interesse efetivo (manual ?? previsto) só quando o filtro de interesse está ativo.
  const manualInterest = new Map<string, string | null>()
  for (const w of activeFewTags) manualInterest.set(w.id, w.synopsis_quality ?? null)
  const interestActive = (filters.interest?.length ?? 0) > 0
  const effectiveInterest = interestActive
    ? await loadEffectiveInterest(sb, ids, manualInterest)
    : manualInterest

  const works: TagWorkMetaRow[] = activeFewTags.map((w) => ({
    id: w.id,
    title: w.title,
    coverUrls: coverCandidates(w.work_covers),
    publicationStatus: w.publication_status_id != null ? (PUBLICATION_STATUSES_BY_ID[w.publication_status_id]?.status ?? "Unknown") : "Unknown",
    publicationStatusId: w.publication_status_id,
    ...hiatusFieldsFromRow(w),
    personalStatus: w.personal_status_id != null ? (PERSONAL_STATUSES_BY_ID[w.personal_status_id]?.status ?? "—") : "—",
    personalStatusId: w.personal_status_id,
    aiEvalStatus: w.ai_eval_status,
    canonicalPresent: !!(w.canonical_synopsis && String(w.canonical_synopsis).trim()),
    tagCount: tagCount.get(w.id) ?? 0,
    expectedScore: w.calculated_scores?.expected_score != null ? Number(w.calculated_scores.expected_score) : null,
    interest: effectiveInterest.get(w.id) ?? null,
    readiness: checkInferTags({
      maxSynopsisChars: Math.max(canonLen.get(w.id) ?? 0, maxRawLen.get(w.id) ?? 0),
      hasReviewContext: hasReviewContext.has(w.id),
    }),
  }))

  const result = classifyWorksWithoutTags({
    works,
    acceptedSourcesByWork: acceptedSources,
    goldenWorkIds: goldenIds,
    filters,
  })
  return { works: result, totalWithoutTags, tagCountByWork: tagCount }
}
