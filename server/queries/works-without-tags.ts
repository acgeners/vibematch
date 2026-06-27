import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover } from "@/lib/work-derived"
import { PUBLICATION_STATUSES_BY_ID, PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { classifyWorksWithoutTags, type NoTagsWork, type NoTagsFilters, type TagWorkMetaRow } from "@/lib/tags/no-tags-classify"
import { loadEffectiveInterest } from "@/lib/synopsis-interest/effective-interest"

export type { NoTagsWork, NoTagsFilters } from "@/lib/tags/no-tags-classify"

export interface NoTagsResult {
  works: NoTagsWork[]
  /** total sem filtro de busca/golden/external (universo "faixa min..máx de tags"). */
  totalWithoutTags: number
}

/**
 * Loader server-only. Read-only. Espelha `getWorksWithoutReviews`. Poucas queries
 * (sem N+1): work_tags (só work_id), works ativas, external ids aceitos, golden ids.
 * NÃO carrega texto de review/sinopse. NÃO dispara LLM/summary/digest/avaliação.
 */
export async function getWorksWithoutTags(filters: NoTagsFilters = {}): Promise<NoTagsResult> {
  const sb = createAdminClient()
  const PAGE = 1000

  // 1) tags: agrega contagem por obra (coluna leve work_id).
  const tagCount = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("work_tags")
      .select("work_id")
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`work_tags: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string }>) {
      tagCount.set(r.work_id, (tagCount.get(r.work_id) ?? 0) + 1)
    }
    if (!data || data.length < PAGE) break
  }

  // 2) works ativas (+ pub/personal filter no SQL). Colunas leves; canonical só presença.
  let worksQ = sb
    .from("works")
    .select("id, title, ai_eval_status, canonical_synopsis, publication_status_id, personal_status_id, synopsis_quality, work_covers(url, is_primary, position), calculated_scores(expected_score)")
    .eq("is_archived", false)
  if (filters.pubStatusIds && filters.pubStatusIds.length > 0) worksQ = worksQ.in("publication_status_id", filters.pubStatusIds)
  if (filters.personalStatusIds && filters.personalStatusIds.length > 0) worksQ = worksQ.in("personal_status_id", filters.personalStatusIds)
  const { data: worksData, error: worksErr } = await worksQ
  if (worksErr) throw new Error(`works: ${worksErr.message}`)

  type Row = {
    id: string
    title: string
    ai_eval_status: string | null
    canonical_synopsis: string | null
    publication_status_id: number | null
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

  // 3) external ids aceitos + golden (chunked, leves).
  const acceptedSources = new Map<string, string[]>()
  const goldenIds = new Set<string>()
  const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
  for (const c of chunk(ids, 200)) {
    const { data, error } = await sb.from("work_external_ids").select("work_id, source, is_rejected").in("work_id", c)
    if (error) throw new Error(`work_external_ids: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string; source: string; is_rejected: boolean | null }>) {
      if (!r.is_rejected) {
        const list = acceptedSources.get(r.work_id) ?? []
        list.push(r.source)
        acceptedSources.set(r.work_id, list)
      }
    }
  }
  for (const c of chunk(ids, 200)) {
    const { data, error } = await sb.from("synopsis_interest_golden").select("work_id").in("work_id", c)
    if (error) throw new Error(`synopsis_interest_golden: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string }>) goldenIds.add(r.work_id)
  }

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
    coverUrl: pickPrimaryCover(w.work_covers),
    publicationStatus: w.publication_status_id != null ? (PUBLICATION_STATUSES_BY_ID[w.publication_status_id]?.status ?? "Unknown") : "Unknown",
    personalStatus: w.personal_status_id != null ? (PERSONAL_STATUSES_BY_ID[w.personal_status_id]?.status ?? "—") : "—",
    aiEvalStatus: w.ai_eval_status,
    canonicalPresent: !!(w.canonical_synopsis && String(w.canonical_synopsis).trim()),
    tagCount: tagCount.get(w.id) ?? 0,
    expectedScore: w.calculated_scores?.expected_score != null ? Number(w.calculated_scores.expected_score) : null,
    interest: effectiveInterest.get(w.id) ?? null,
  }))

  const result = classifyWorksWithoutTags({
    works,
    acceptedSourcesByWork: acceptedSources,
    goldenWorkIds: goldenIds,
    filters,
  })
  return { works: result, totalWithoutTags }
}
