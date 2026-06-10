import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getWorkWithAiEvaluations, getWorkBySlug, getWorkTitleByIdOrSlug } from "@/server/queries/works"
import { titleToSlug } from "@/lib/utils"
import { Header } from "@/components/layout/header"
import { WorkForm, type WorkFormAiEvaluation } from "@/components/titles/work-form"
import type { WorkFormValues } from "@/lib/validations/work.schema"
import type { WorkWithRelations } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  getPublicationStatusNameById,
  getPersonalStatusNameById,
} from "@/lib/constants/status-lookups"
import { dedupeWorkSynopses, joinSynopsesForDisplay, pickPrimaryCover } from "@/lib/work-derived"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface EditPageProps {
  params: Promise<{ id: string }>
}

function workToFormValues(work: WorkWithRelations): Partial<WorkFormValues> {
  const scoreMap: Record<string, number> = {}
  for (const cs of work.category_scores) {
    scoreMap[cs.criterion_slug] = cs.score
  }

  const getPlatform = (platform: string) =>
    work.platform_ratings.find((p) =>
      p.platform.replace(/[^a-z0-9]+/gi, "").toLowerCase() ===
      platform.replace(/[^a-z0-9]+/gi, "").toLowerCase()
    )

  const mu = getPlatform("mangaupdates")
  const ap = getPlatform("animeplanet")
  const cmx = getPlatform("comick")
  const knownPlatforms = new Set(["mangaupdates", "animeplanet", "comick"])
  const extraPlatformRatings = work.platform_ratings
    .filter((p) => !knownPlatforms.has(p.platform.replace(/[^a-z0-9]+/gi, "").toLowerCase()))
    .map((p) => ({
      platform: p.platform,
      rating: p.rating ?? null,
      votes: p.vote_count ?? null,
    }))

  const criterionValues = Object.fromEntries(
    CRITERION_SLUGS.map((slug) => [slug, scoreMap[slug] ?? null])
  )

  return {
    title: work.title,
    original_title: work.original_title ?? undefined,
    alternative_titles: work.alternative_titles ?? [],
    synopsis: joinSynopsesForDisplay(work.work_synopses) || undefined,
    synopses: dedupeWorkSynopses(work.work_synopses).map((s) => ({
      source: s.source,
      text: s.text,
      isPrimary: s.is_primary,
    })),
    genres: work.genres ?? [],
    tags: work.tags.map((t) => t.name),
    year: work.year ?? undefined,
    year_end: work.year_end ?? undefined,
    publication_status:
      (getPublicationStatusNameById((work as { publication_status_id?: number | null }).publication_status_id) as WorkFormValues["publication_status"]) ??
      "Unknown",
    personal_status:
      (getPersonalStatusNameById((work as { personal_status_id?: number | null }).personal_status_id) as WorkFormValues["personal_status"]) ??
      "To read",
    publication_status_id: (work as { publication_status_id?: number | null }).publication_status_id ?? null,
    personal_status_id: (work as { personal_status_id?: number | null }).personal_status_id ?? null,
    total_chapters: work.total_chapters ?? undefined,
    chapters_read: work.chapters_read ?? undefined,
    synopsis_quality: work.synopsis_quality ?? undefined,
    observation_adjustment: work.observation_adjustment,
    observations: work.observations ?? undefined,
    user_score: work.user_score ?? undefined,
    post_story_score: work.post_story_score ?? undefined,
    post_fl_score: work.post_fl_score ?? undefined,
    post_ml_score: work.post_ml_score ?? undefined,
    post_character_development_score: work.post_character_development_score ?? undefined,
    post_pacing_score: work.post_pacing_score ?? undefined,
    post_art_visual_score: work.post_art_visual_score ?? undefined,
    post_impact_immersion_score: work.post_impact_immersion_score ?? undefined,
    post_originality_score: work.post_originality_score ?? undefined,
    cover_url: pickPrimaryCover(work.work_covers) ?? "",
    covers: (work.work_covers ?? []).map((c) => ({
      url: c.url,
      source: c.source,
      isPrimary: c.is_primary,
    })),
    ai_eval_status: work.ai_eval_status,
    mu_rating: mu?.rating ?? undefined,
    mu_votes: mu?.vote_count ?? undefined,
    ap_rating: ap?.rating ?? undefined,
    ap_votes: ap?.vote_count ?? undefined,
    cmx_rating: cmx?.rating ?? undefined,
    cmx_votes: cmx?.vote_count ?? undefined,
    extra_platform_ratings: extraPlatformRatings,
    ...criterionValues,
  }
}

export async function generateMetadata({ params }: EditPageProps): Promise<Metadata> {
  const { id } = await params
  const title = await getWorkTitleByIdOrSlug(id)
  return { title: title ? `Editar: ${title} · SatorIA` : "Editar · SatorIA" }
}

export default async function EditTitlePage({ params }: EditPageProps) {
  const { id } = await params

  let work: WorkWithRelations | null = null
  if (UUID_RE.test(id)) {
    const fetched = await getWorkWithAiEvaluations(id)
    work = (fetched as WorkWithRelations | null) ?? null
    if (work) {
      const slug = titleToSlug(work.title)
      if (slug && slug !== id) redirect(`/titles/${slug}/edit`)
    }
  } else {
    const fetched = await getWorkBySlug(id)
    work = (fetched as WorkWithRelations | null) ?? null
  }

  if (!work) notFound()

  const slug = titleToSlug(work.title) || work.id
  const initialValues = workToFormValues(work)

  const aiEvaluations = (work as WorkWithRelations & {
    ai_evaluations?: Array<{
      status?: string | null
      model_name: string | null
      confidence: number | null
      summary: string | null
      created_at: string
      ai_evaluation_scores?: Array<{ criterion_slug: string; justification: string | null }>
    }>
  }).ai_evaluations ?? []

  const latestAiEval = aiEvaluations
    .filter((e) => e.status !== "failed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]

  const aiEvaluationForForm: WorkFormAiEvaluation | null = latestAiEval
    ? {
        model_name: latestAiEval.model_name,
        confidence: latestAiEval.confidence,
        created_at: latestAiEval.created_at,
        summary: latestAiEval.summary,
        scores: (latestAiEval.ai_evaluation_scores ?? []).map((s) => ({
          criterion_slug: s.criterion_slug,
          justification: s.justification,
        })),
      }
    : null

  return (
    <div className="w-full max-w-6xl space-y-6">
      <Header
        kicker="Catálogo"
        title={`Editar: ${work.title}`}
        description="Atualize os dados da obra"
      />
      <WorkForm
        workId={work.id}
        workSlug={slug}
        initialValues={initialValues}
        aiEvaluation={aiEvaluationForForm}
      />
    </div>
  )
}
