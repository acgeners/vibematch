import { notFound } from "next/navigation"
import { getWorkById } from "@/server/queries/works"
import { Header } from "@/components/layout/header"
import { WorkForm } from "@/components/titles/work-form"
import type { WorkFormValues } from "@/lib/validations/work.schema"
import type { WorkWithRelations } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  PERSONAL_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
} from "@/lib/constants/criteria"

interface EditPageProps {
  params: Promise<{ id: string }>
}

function normalizePublicationStatusForForm(value: string | null | undefined): WorkFormValues["publication_status"] {
  const normalized = value ? PUBLICATION_STATUS_LABELS[value] ?? value : null
  switch (normalized) {
    case "C":
    case "CMP":
    case "Completed":
      return "Completed"
    case "O":
    case "ONG":
    case "Ongoing":
      return "Ongoing"
    case "H":
    case "HIA":
    case "Hiatus":
      return "Hiatus"
    case "D":
    case "CXL":
    case "Cancelled":
      return "Cancelled"
    default:
      return "Unknown"
  }
}

function normalizePersonalStatusForForm(value: string | null | undefined): WorkFormValues["personal_status"] {
  const normalized = value ? PERSONAL_STATUS_LABELS[value] ?? value : null
  switch (normalized) {
    case "Completed":
      return "Completed"
    case "Reading":
      return "Reading"
    case "Started":
      return "Started"
    case "Stalled":
      return "Stalled"
    case "Paused":
      return "Paused"
    case "Hiatus":
      return "Hiatus"
    case "On-hold":
      return "On-hold"
    case "Dropped":
      return "Dropped"
    default:
      return "To read"
  }
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
    synopsis: work.synopsis ?? undefined,
    genres: work.genres ?? [],
    tags: work.tags.map((t) => t.name),
    year: work.year ?? undefined,
    year_end: work.year_end ?? undefined,
    publication_status: normalizePublicationStatusForForm(work.publication_status),
    personal_status: normalizePersonalStatusForForm(work.personal_status),
    total_chapters: work.total_chapters ?? undefined,
    chapters_read: work.chapters_read ?? undefined,
    synopsis_quality: work.synopsis_quality ?? undefined,
    observation_penalty: work.observation_penalty,
    manual_score: work.manual_score ?? undefined,
    cover_url: work.cover_url ?? "",
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

export default async function EditTitlePage({ params }: EditPageProps) {
  const { id } = await params
  const work = await getWorkById(id)

  if (!work) notFound()

  const initialValues = workToFormValues(work)

  return (
    <div className="w-full max-w-6xl space-y-6">
      <Header
        title={`Editar: ${work.title}`}
        description="Atualize os dados da obra"
      />
      <WorkForm workId={id} initialValues={initialValues} />
    </div>
  )
}
