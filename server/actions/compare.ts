"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getWorksByIds } from "@/server/queries/works"
import { computeDecisionScore } from "@/lib/calculations/decision"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug, WorkWithRelations } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"
import { TAG_GROUP_IDS, TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { getAllTags } from "@/server/queries/tags"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { buildTagStanceLookup, resolveTagStance } from "@/lib/tags/segment"
import type { TagStanceInfo, TagStanceLookup } from "@/lib/tags/segment"

export interface CompareCriterionEntry {
  slug: CriterionSlug
  score: number | null
  aiJustification: string | null
}

export interface CompareWork {
  id: string
  title: string
  slug: string
  alternativeTitles: string[]
  coverUrl: string | null
  synopsis: string | null
  year: number | null
  synopsisQuality: string | null
  publicationStatusId: number | null
  personalStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
  isFavorite: boolean
  expectedScore: number | null
  /** Prioridade (0–10) — âncora na Prevista + IA Rk quando há (ver lib/calculations/decision.ts). */
  decisionScore: number | null
  /** Alinhamento com o perfil: cru (0–1) e percentil na biblioteca (0–100). */
  personalFit: number | null
  personalFitPercentile: number | null
  calcScore: number | null
  userScore: number | null
  platformAvg: number | null
  totalVotes: number
  /** Chance de gostar (0–100) — Força 1 da Bússola (chance_score calibrado). NULL quando stub/arquivada. */
  chanceScore: number | null
  alignmentScore: number | null
  alignmentJustification: string | null
  alignmentAt: string | null
  genres: string[]
  /** `stance` = amada/evitada pelo gosto do usuário (perfil ∪ preferências declaradas) + ênfase 2×. */
  tags: Array<{ slug: string; name: string; groupId: string | null; groupName: string | null; subGroupName: string | null; stance: TagStanceInfo | null }>
  criteria: CompareCriterionEntry[]
}

const GROUP_ID_TO_LABEL: Record<string, string> = Object.fromEntries(
  (Object.keys(TAG_GROUP_IDS) as TagGroupSlug[]).map((slug) => [
    TAG_GROUP_IDS[slug],
    TAG_GROUP_LABELS[slug],
  ])
)

import { titleToSlug } from "@/lib/utils"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"

export async function fetchCompareWorks(ids: string[]): Promise<CompareWork[]> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, MAX_COMPARE_WORKS)
  if (unique.length === 0) return []

  const supabase = createAdminClient()
  const [works, aiJustifications, tagCatalog, declaredPrefs, profileRow] = await Promise.all([
    getWorksByIds(unique),
    supabase
      .from("ai_evaluations")
      .select(`
        work_id,
        created_at,
        ai_evaluation_scores(criterion_slug, justification, accepted_score, suggested_score)
      `)
      .in("work_id", unique)
      .order("created_at", { ascending: false }),
    getAllTags(),
    getDeclaredTagPreferences(supabase),
    loadCurrentTasteProfile(),
  ])
  const subGroupBySlug = new Map<string, string>()
  for (const t of tagCatalog) {
    if (t.subGroupName) subGroupBySlug.set(t.slug, t.subGroupName)
  }
  // Stance (amada/evitada) por tag: preferências declaradas ∪ perfil de gosto.
  const stanceLookup = buildTagStanceLookup(
    declaredPrefs.map((p) => ({ slug: p.slug, stance: p.stance, weight: p.weight })),
    profileRow?.profile.loved_tags ?? [],
    profileRow?.profile.avoided_tags ?? [],
  )

  // For each work, pick the most recent ai_evaluation justifications by criterion.
  const justificationByWork = new Map<string, Map<string, string>>()
  for (const row of (aiJustifications.data ?? []) as Array<{
    work_id: string
    ai_evaluation_scores: Array<{ criterion_slug: string; justification: string | null }> | null
  }>) {
    if (justificationByWork.has(row.work_id)) continue
    const map = new Map<string, string>()
    for (const s of row.ai_evaluation_scores ?? []) {
      if (s.justification) map.set(s.criterion_slug, s.justification)
    }
    justificationByWork.set(row.work_id, map)
  }

  return works.map((work) => mapWorkToCompare(work, justificationByWork.get(work.id), subGroupBySlug, stanceLookup))
}

function mapWorkToCompare(
  work: WorkWithRelations,
  justifications: Map<string, string> | undefined,
  subGroupBySlug: Map<string, string>,
  stanceLookup: TagStanceLookup,
): CompareWork {
  const scoreByCrit: Record<string, number> = {}
  for (const cs of work.category_scores ?? []) {
    scoreByCrit[cs.criterion_slug] = Number(cs.score)
  }

  const tags = (work.tags as Array<{ slug?: string; name?: string; tag_group_id?: string | null }> ?? [])
    .filter(Boolean)
    .map((t) => {
      const groupId = (t.tag_group_id ?? null) as string | null
      const slug = (t.slug ?? "") as string
      const name = (t.name ?? "") as string
      return {
        slug,
        name,
        groupId,
        groupName: groupId ? GROUP_ID_TO_LABEL[groupId] ?? null : null,
        subGroupName: subGroupBySlug.get(slug) ?? null,
        stance: resolveTagStance({ slug, name }, stanceLookup),
      }
    })
    .filter((t) => t.name)

  const primaryCover = pickPrimaryCover(work.work_covers)
  const primarySynopsis = pickPrimarySynopsis(work.work_synopses)
  // Prefere a sinopse canônica (consolidada via IA) — mesma exibida na página
  // de detalhe — e cai pra primária só quando ela ainda não foi gerada.
  const canonicalSynopsis =
    (work as { canonical_synopsis?: string | null }).canonical_synopsis?.trim() || null

  return {
    id: work.id,
    title: work.title,
    slug: titleToSlug(work.title),
    alternativeTitles: work.alternative_titles ?? [],
    coverUrl: primaryCover,
    synopsis: canonicalSynopsis ?? primarySynopsis,
    year: (work as { year?: number | null }).year ?? null,
    synopsisQuality: (work as { synopsis_quality?: string | null }).synopsis_quality ?? null,
    publicationStatusId: work.publication_status_id ?? null,
    personalStatusId: work.personal_status_id ?? null,
    chaptersRead: work.chapters_read != null ? Number(work.chapters_read) : null,
    totalChapters: work.total_chapters != null ? Number(work.total_chapters) : null,
    isFavorite: Boolean(work.is_favorite),
    expectedScore: work.calculated_scores?.expected_score ?? null,
    decisionScore: computeDecisionScore({
      expected: work.calculated_scores?.expected_score ?? null,
      alignment: work.calculated_scores?.alignment_score ?? null,
      confidence:
        (work.calculated_scores?.alignment_payload as { confidence?: number } | null)?.confidence ??
        null,
    }),
    personalFit: work.calculated_scores?.personal_fit ?? null,
    personalFitPercentile: work.calculated_scores?.personal_fit_percentile ?? null,
    calcScore: work.calculated_scores?.calc_score ?? null,
    userScore: (work as { user_score?: number | null }).user_score ?? null,
    platformAvg: work.calculated_scores?.platform_avg ?? null,
    totalVotes: work.calculated_scores?.total_votes ?? 0,
    chanceScore: work.calculated_scores?.chance_score ?? null,
    alignmentScore: work.calculated_scores?.alignment_score ?? null,
    alignmentJustification: work.calculated_scores?.alignment_justification ?? null,
    alignmentAt: work.calculated_scores?.alignment_at ?? null,
    genres: work.genres ?? [],
    tags,
    criteria: CRITERION_SLUGS.map((slug) => ({
      slug,
      score: scoreByCrit[slug] ?? null,
      aiJustification: justifications?.get(slug) ?? null,
    })),
  }
}
