"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getWorksByIds } from "@/server/queries/works"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug, WorkWithRelations } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"

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
  finalScore: number | null
  calcScore: number | null
  predictedScore: number | null
  predictedIsStub: boolean
  manualScore: number | null
  platformAvg: number | null
  totalVotes: number
  genres: string[]
  tags: Array<{ slug: string; name: string }>
  criteria: CompareCriterionEntry[]
}

import { titleToSlug } from "@/lib/utils"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"

export async function fetchCompareWorks(ids: string[]): Promise<CompareWork[]> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, MAX_COMPARE_WORKS)
  if (unique.length === 0) return []

  const supabase = createAdminClient()
  const [works, aiJustifications] = await Promise.all([
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
  ])

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

  return works.map((work) => mapWorkToCompare(work, justificationByWork.get(work.id)))
}

function mapWorkToCompare(
  work: WorkWithRelations,
  justifications: Map<string, string> | undefined
): CompareWork {
  const scoreByCrit: Record<string, number> = {}
  for (const cs of work.category_scores ?? []) {
    scoreByCrit[cs.criterion_slug] = Number(cs.score)
  }

  const tags = (work.tags ?? [])
    .filter(Boolean)
    .map((t) => ({
      slug: (t.slug ?? "") as string,
      name: (t.name ?? "") as string,
    }))
    .filter((t) => t.name)

  const primaryCover = pickPrimaryCover(work.work_covers)
  const primarySynopsis = pickPrimarySynopsis(work.work_synopses)

  return {
    id: work.id,
    title: work.title,
    slug: titleToSlug(work.title),
    alternativeTitles: work.alternative_titles ?? [],
    coverUrl: primaryCover,
    synopsis: primarySynopsis,
    year: (work as { year?: number | null }).year ?? null,
    synopsisQuality: (work as { synopsis_quality?: string | null }).synopsis_quality ?? null,
    publicationStatusId: work.publication_status_id ?? null,
    personalStatusId: work.personal_status_id ?? null,
    chaptersRead: work.chapters_read != null ? Number(work.chapters_read) : null,
    totalChapters: work.total_chapters != null ? Number(work.total_chapters) : null,
    isFavorite: Boolean(work.is_favorite),
    finalScore: work.calculated_scores?.final_score ?? null,
    calcScore: work.calculated_scores?.calc_score ?? null,
    predictedScore: work.calculated_scores?.predicted_score ?? null,
    predictedIsStub: work.calculated_scores?.predicted_is_stub ?? false,
    manualScore: (work as { manual_score?: number | null }).manual_score ?? null,
    platformAvg: work.calculated_scores?.platform_avg ?? null,
    totalVotes: work.calculated_scores?.total_votes ?? 0,
    genres: work.genres ?? [],
    tags,
    criteria: CRITERION_SLUGS.map((slug) => ({
      slug,
      score: scoreByCrit[slug] ?? null,
      aiJustification: justifications?.get(slug) ?? null,
    })),
  }
}
