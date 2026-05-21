import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronDown, Plus } from "lucide-react"
import { getWorkWithAiEvaluations, getWorkBySlug, getWorkIdsBySlug } from "@/server/queries/works"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getWorkReviews } from "@/server/queries/work-reviews"
import { WorkReviewsCard } from "@/components/titles/work-reviews-card"
import { ScoreBadge } from "@/components/ui/score-badge"
import {
  PublicationStatusBadge,
  PersonalStatusBadge,
} from "@/components/ui/status-badge"
import { CalculationBreakdown } from "@/components/titles/calculation-breakdown"
import { SimilarWorksCard } from "@/components/titles/similar-works-card"
import { getSimilarWorks } from "@/server/queries/similar-works"
import { WorkDetailActions } from "@/components/titles/work-detail-actions"
import { WorkPersonalFields } from "@/components/titles/work-personal-fields"
import { BatchCreatedNavigator } from "@/components/titles/batch-created-navigator"
import { WorkCoverGallery } from "@/components/titles/work-cover-gallery"
import { SynopsesViewer } from "@/components/titles/synopses-viewer"
import { BackButton } from "@/components/titles/back-button"
import { CriterionTitleTooltip } from "@/components/titles/criterion-title-tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExpandableText } from "@/components/ui/expandable-text"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CRITERIA_INFO, PLATFORM_LABELS } from "@/lib/constants/criteria"
import { getPublicationStatusNameById, getPersonalStatusNameById } from "@/lib/constants/status-lookups"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import type { PersonalStatus } from "@/types/domain"
import { pickPrimarySynopsis, pickPrimaryCover } from "@/lib/work-derived"
import { TAG_GROUP_IDS, TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  DEFAULT_POST_READING_WEIGHTS,
  POST_READING_WEIGHT_LABELS,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"
import { cn, titleToSlug } from "@/lib/utils"
import { createAdminClient } from "@/lib/supabase/admin"
import { unstable_cache } from "next/cache"

interface TitleDetailPageProps {
  params: Promise<{ id: string }>
}

type DetailTag = {
  key: string
  label: string
}

type WorkTagForDisplay = {
  id?: string
  slug?: string
  name?: string
  tag_group_id?: string | null
}

function getCriterionColor(score: number, slug: string): string {
  const isNegative = slug === "drama" || slug === "tragedy"
  if (isNegative) {
    if (score <= 3) return "bg-green-100 text-green-800"
    if (score <= 5) return "bg-yellow-100 text-yellow-800"
    return "bg-red-100 text-red-800"
  }
  if (score >= 8) return "bg-emerald-100 text-emerald-800"
  if (score >= 6) return "bg-green-100 text-green-800"
  if (score >= 4) return "bg-yellow-100 text-yellow-800"
  return "bg-red-100 text-red-800"
}

function normalizePlatformName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function formatRating(score: number) {
  return Number.isInteger(score)
    ? String(score)
    : score.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

function formatVotes(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

function formatSynopsisInterest(value: string | null | undefined) {
  return value?.trim() || null
}

function getTagGroupLabel(tagGroupId: string | null | undefined) {
  if (!tagGroupId) return "Sem grupo"
  const entry = Object.entries(TAG_GROUP_IDS).find(([, id]) => id === tagGroupId)
  if (!entry) return "Sem grupo"
  return TAG_GROUP_LABELS[entry[0] as TagGroupSlug] ?? entry[0]
}

const getSourceRows = unstable_cache(
  async () => {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("source")
      .select("name, order")
      .order("order", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true })
    return data ?? []
  },
  ["source-order-rows"],
  { revalidate: 300 }
)

const POST_READING_SCORE_FIELDS = Object.keys(DEFAULT_POST_READING_WEIGHTS) as PostReadingScoreField[]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function TitleDetailPage({ params }: TitleDetailPageProps) {
  const { id } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let work: any = null
  if (UUID_RE.test(id)) {
    work = await getWorkWithAiEvaluations(id)
    if (work) {
      const slug = titleToSlug(work.title)
      const slugMatches = await getWorkIdsBySlug(slug)
      if (slugMatches.length === 1 && slugMatches[0] === work.id) {
        redirect(`/titles/${slug}`)
      }
    }
  } else {
    work = await getWorkBySlug(id)
  }

  if (!work) notFound()

  // Carrega só o distance_p95 do formula_config pro CalculationBreakdown
  // mostrar rótulos de distância calibrados (perto/médio/longe relativos).
  const configClient = createAdminClient()
  const [{ data: configRow }, scoreThresholds, reviewsSnapshot, similarWorks] = await Promise.all([
    configClient
      .from("formula_config")
      .select("distance_p95")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getScoreColorThresholds(),
    getWorkReviews(work.id as string),
    getSimilarWorks(work.id as string, 8),
  ])
  const distanceP95: number | null = configRow?.distance_p95 == null ? null : Number(configRow.distance_p95)

  const scoreMap: Record<string, number> = {}
  for (const cs of work.category_scores ?? []) {
    scoreMap[cs.criterion_slug] = cs.score
  }

  const aiEvaluations: Array<{
    id: string
    status: string
    model_name: string | null
    prompt_version: string | null
    summary: string | null
    confidence: number | null
    created_at: string
    ai_evaluation_scores?: Array<{
      criterion_slug: string
      suggested_score: number | null
      justification: string | null
      accepted_score: number | null
    }>
  }> = work.ai_evaluations ?? []

  const latestAiEval = aiEvaluations
    .filter((e) => e.status !== "failed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const latestAiScoreMap = new Map(
    (latestAiEval?.ai_evaluation_scores ?? []).map((score) => [score.criterion_slug, score])
  )

  const genres = Array.isArray(work.genres) ? work.genres.filter(Boolean) : []
  const tags = Array.isArray(work.tags) ? work.tags.filter(Boolean) : []
  const primaryCover = pickPrimaryCover(work.work_covers)
  const primarySynopsis = pickPrimarySynopsis(work.work_synopses)
  const tagGroupMap = new Map<string, DetailTag[]>()
  for (const tag of tags as Array<WorkTagForDisplay | string>) {
    const label = typeof tag === "string" ? tag : tag.name
    if (!label) continue
    const groupLabel = typeof tag === "string" ? "Sem grupo" : getTagGroupLabel(tag.tag_group_id)
    const groupTags = tagGroupMap.get(groupLabel) ?? []
    groupTags.push({
      key: typeof tag === "string" ? tag : tag.id ?? tag.slug ?? label,
      label,
    })
    tagGroupMap.set(groupLabel, groupTags)
  }
  const tagGroups = Array.from(tagGroupMap.entries())
    .map(([groupName, groupTags]) => ({
      groupName,
      tags: groupTags.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.groupName.localeCompare(b.groupName))
  const postReadingScores = POST_READING_SCORE_FIELDS.map((field) => ({
    field,
    label: POST_READING_WEIGHT_LABELS[field],
    score: work[field] == null ? null : Number(work[field]),
  })).filter((item) => item.score != null && Number.isFinite(item.score))
  const hasPostReadingScores = postReadingScores.length > 0

  const sources = await getSourceRows()
  const sourceOrder = new Map(
    sources.map((source, index) => [normalizePlatformName(source.name), index])
  )
  const platformRatings = ([...(work.platform_ratings ?? [])] as Array<{
    platform: string
    rating: number | null
    vote_count: number
  }>).sort((a, b) => {
    const aOrder = sourceOrder.get(normalizePlatformName(a.platform)) ?? 999
    const bOrder = sourceOrder.get(normalizePlatformName(b.platform)) ?? 999
    if (aOrder !== bOrder) return aOrder - bOrder
    return a.platform.localeCompare(b.platform)
  })

  const totalVotes = platformRatings.reduce((sum, pr) => sum + (pr.vote_count ?? 0), 0)
  const ratedPlatforms = platformRatings.filter((pr) => pr.rating != null && pr.vote_count > 0)
  const bayesianAvg =
    ratedPlatforms.length > 0
      ? ratedPlatforms.reduce((sum, pr) => sum + Number(pr.rating) * pr.vote_count, 0) /
        ratedPlatforms.reduce((sum, pr) => sum + pr.vote_count, 0)
      : null
  const chapterText = (() => {
    const total = work.total_chapters == null || Number(work.total_chapters) <= 0
      ? null
      : Number(work.total_chapters)
    const read = work.chapters_read == null || Number(work.chapters_read) <= 0
      ? null
      : Number(work.chapters_read)
    if (read != null && total != null) return `${read} / ${total} capítulos`
    if (total != null) return `${total} capítulos`
    if (read != null) return `${read} capítulos lidos`
    return null
  })()

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <Button asChild size="sm">
          <Link href="/titles/new">
            <Plus className="h-4 w-4" />
            Novo título
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList variant="line">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="scores">Notas & Avaliações</TabsTrigger>
          <TabsTrigger value="reviews">Reviews & Categorias</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
      {/* Header: capa + info */}
      <section className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Coluna esquerda: apenas capa */}
        <div className="flex flex-col gap-3 w-full max-w-[220px] justify-self-center md:max-w-none md:justify-self-start">
          <WorkCoverGallery
            title={work.title}
            fallbackUrl={primaryCover}
            covers={work.work_covers ?? []}
          />
        </div>

        {/* Coluna direita: título, badges, botões, sinopse (estica) */}
        <div className="min-w-0 flex flex-col gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
              {work.title}
            </h1>
            {work.alternative_titles?.length > 0 && (
              <ExpandableText
                text={work.alternative_titles.join(" / ")}
                limit={200}
                className="text-xs leading-snug text-muted-foreground/70"
              />
            )}
          </div>

          {/* Metadata abaixo do título: status + interesse sinopse + capítulos */}
          <div className="flex flex-wrap items-center gap-1.5">
            <PublicationStatusBadge statusId={work.publication_status_id} />
            <PersonalStatusBadge statusId={work.personal_status_id} />
            {formatSynopsisInterest(work.synopsis_quality) && (
              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                {formatSynopsisInterest(work.synopsis_quality)}
              </span>
            )}
            {chapterText && (
              <span className="inline-flex items-center rounded-md border bg-background px-2.5 py-0.5 text-xs font-mono font-semibold text-foreground">
                {chapterText}
              </span>
            )}
            {work.is_archived && (
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                Arquivada
              </span>
            )}
          </div>

          {/* Botões de ação */}
          {(() => {
            const statusInitial: WorkStatusValues = {
              personal_status:
                (getPersonalStatusNameById(work.personal_status_id) as PersonalStatus | undefined) ?? "To read",
              personal_status_id: work.personal_status_id ?? null,
              synopsis_quality: work.synopsis_quality ?? null,
              observation_adjustment: work.observation_adjustment ?? 0,
              observations: work.observations ?? null,
              chapters_read: work.chapters_read != null ? Number(work.chapters_read) : null,
              manual_score: work.manual_score ?? null,
              post_story_score: work.post_story_score ?? null,
              post_fl_score: work.post_fl_score ?? null,
              post_ml_score: work.post_ml_score ?? null,
              post_character_development_score: work.post_character_development_score ?? null,
              post_pacing_score: work.post_pacing_score ?? null,
              post_art_visual_score: work.post_art_visual_score ?? null,
              post_impact_immersion_score: work.post_impact_immersion_score ?? null,
              post_originality_score: work.post_originality_score ?? null,
            }
            return (
              <WorkDetailActions
                workId={work.id}
                workSlug={id}
                workTitle={work.title}
                isArchived={work.is_archived}
                isFavorite={work.is_favorite}
                coverUrl={primaryCover}
                hasCriteriaScores={Object.keys(scoreMap).length > 0}
                className="min-w-0"
                currentWork={{
                  title: work.title,
                  originalTitle: work.original_title,
                  synopsis: primarySynopsis,
                  coverUrl: primaryCover,
                  publicationStatus: getPublicationStatusNameById(work.publication_status_id) ?? "Unknown",
                  totalChapters: work.total_chapters != null ? Number(work.total_chapters) : null,
                }}
                statusInitialValues={statusInitial}
                totalChapters={work.total_chapters != null ? Number(work.total_chapters) : null}
              />
            )
          })()}

          {/* Sinopse — line-clamp para alinhar com altura das capas */}
          <div className="flex-1 max-w-4xl">
            <SynopsesViewer
              synopses={work.work_synopses}
              maxLines={11}
              className="text-sm leading-7 text-foreground/85"
            />
          </div>
        </div>
      </section>

      {/* Anotações pessoais (Ajuste, Interesse sinopse, Observações) */}
      {(() => {
        const personalInitial: WorkStatusValues = {
          personal_status:
            (getPersonalStatusNameById(work.personal_status_id) as PersonalStatus | undefined) ?? "To read",
          personal_status_id: work.personal_status_id ?? null,
          synopsis_quality: work.synopsis_quality ?? null,
          observation_adjustment: work.observation_adjustment ?? 0,
          observations: work.observations ?? null,
          chapters_read: work.chapters_read != null ? Number(work.chapters_read) : null,
          manual_score: work.manual_score ?? null,
          post_story_score: work.post_story_score ?? null,
          post_fl_score: work.post_fl_score ?? null,
          post_ml_score: work.post_ml_score ?? null,
          post_character_development_score: work.post_character_development_score ?? null,
          post_pacing_score: work.post_pacing_score ?? null,
          post_art_visual_score: work.post_art_visual_score ?? null,
          post_impact_immersion_score: work.post_impact_immersion_score ?? null,
          post_originality_score: work.post_originality_score ?? null,
        }
        return <WorkPersonalFields workId={work.id} initialValues={personalInitial} />
      })()}

      <BatchCreatedNavigator currentId={work.id} />
        </TabsContent>

        <TabsContent value="scores" className="mt-4 space-y-6">
      {/* Notas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex flex-col items-center gap-1.5 p-3 rounded-md border bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground">Nota.Final</p>
              <ScoreBadge score={work.calculated_scores?.final_score ?? null} size="lg" thresholds={scoreThresholds} />
            </div>
            <div className="flex flex-col items-center gap-1.5 p-3 rounded-md border bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground">Nota.IA</p>
              <ScoreBadge score={work.calculated_scores?.calc_score ?? null} size="lg" thresholds={scoreThresholds} />
            </div>
            <div className="flex flex-col items-center gap-1.5 p-3 rounded-md border bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground">Prevista</p>
              <ScoreBadge
                score={work.calculated_scores?.predicted_score ?? null}
                size="lg"
                showStub={work.calculated_scores?.predicted_is_stub ?? false}
                thresholds={scoreThresholds}
              />
            </div>
            {hasPostReadingScores ? (
              <details className="group rounded-md border bg-muted/20">
                <summary className="flex cursor-pointer list-none flex-col items-center gap-1.5 p-3 text-center [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Pessoal</p>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                  <ScoreBadge score={work.manual_score ?? null} size="lg" />
                </summary>
                <div className="border-t px-3 pb-3 pt-2">
                  <div className="grid gap-2">
                    {postReadingScores.map((item) => (
                      <div key={item.field} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {item.label}
                        </span>
                        <ScoreBadge score={item.score} size="sm" variant="soft" />
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ) : (
              <div className="flex flex-col items-center gap-1.5 p-3 rounded-md border bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground">Pessoal</p>
                <ScoreBadge score={work.manual_score ?? null} size="lg" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Avaliações externas */}
      {platformRatings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="text-base">Avaliações externas</CardTitle>
              {bayesianAvg != null && (
                <div className="text-right shrink-0">
                  <p className="text-xs font-medium text-muted-foreground">Média externa</p>
                  <p className="text-3xl font-black font-mono leading-none text-foreground">{bayesianAvg.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">{formatVotes(totalVotes)} votos</p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {platformRatings.map((pr) => (
                <div key={pr.platform} className="p-3 rounded-md border bg-muted/20">
                  <p className="text-xs font-medium text-muted-foreground truncate">
                    {PLATFORM_LABELS[pr.platform] ?? pr.platform}
                  </p>
                  <div className="flex items-baseline gap-2 mt-1">
                    {pr.rating != null ? (
                      <span className="text-lg font-bold font-mono">
                        {formatRating(Number(pr.rating))}
                      </span>
                    ) : (
                      <span className="text-lg font-bold text-muted-foreground">—</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatVotes(pr.vote_count)} votos
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notas por critério */}
      <Card>
        <CardHeader className="pb-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-base">Notas por critério</CardTitle>
              {latestAiEval && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Modelo:{" "}
                    <span className="font-medium text-foreground">
                      {latestAiEval.model_name ?? "—"}
                      {latestAiEval.prompt_version ? `/${latestAiEval.prompt_version}` : ""}
                    </span>
                  </span>
                  <span>
                    Confiança:{" "}
                    <span className="font-medium text-foreground">
                      {latestAiEval.confidence != null
                        ? `${(latestAiEval.confidence * 100).toFixed(0)}%`
                        : "—"}
                    </span>
                  </span>
                  <span>
                    Data:{" "}
                    <span className="font-medium text-foreground">
                      {new Date(latestAiEval.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </span>
                </div>
              )}
            </div>
            {latestAiEval?.summary && (
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                  Resumo da última avaliação IA
                </p>
                <ExpandableText
                  text={latestAiEval.summary}
                  limit={300}
                  className="text-sm leading-6 text-foreground/80"
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CRITERION_SLUGS.map((slug) => {
              const info = CRITERIA_INFO[slug]
              const score = scoreMap[slug]
              const aiScore = latestAiScoreMap.get(slug)
              return (
                <div
                  key={slug}
                  className="flex items-center gap-3 rounded-md border bg-muted/20 p-3"
                >
                  <div className="shrink-0 flex flex-col items-center gap-1">
                    <span className="text-4xl leading-none" aria-hidden>
                      {info.emoji}
                    </span>
                    {score != null ? (
                      <div
                        className={cn(
                          "grid place-items-center w-14 h-9 rounded-md font-mono text-xl font-bold leading-none",
                          getCriterionColor(score, slug)
                        )}
                      >
                        {score.toFixed(1)}
                      </div>
                    ) : (
                      <div className="grid place-items-center w-14 h-9 rounded-md border border-dashed text-muted-foreground text-base">
                        —
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <CriterionTitleTooltip
                      name={info.name}
                      description={info.description}
                    />
                    {aiScore?.justification && (
                      <ExpandableText
                        text={aiScore.justification}
                        limit={140}
                        className="text-[11px] leading-4 text-muted-foreground/80"
                      />
                    )}
                    {aiScore && aiScore.suggested_score != null && aiScore.suggested_score !== score && (
                      <p className="text-[10px] text-muted-foreground/70">
                        Sugestão IA:{" "}
                        <span className="font-mono font-semibold">
                          {Number(aiScore.suggested_score).toFixed(1)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Detalhamento do cálculo */}
      {work.calculated_scores && (
        <CalculationBreakdown
          calculatedScore={work.calculated_scores}
          aiConfidence={latestAiEval?.confidence ?? null}
          criteriaCoverage={Object.keys(scoreMap).length / CRITERION_SLUGS.length}
          distanceP95={distanceP95}
        />
      )}

      {/* Obras semanticamente parecidas (via embeddings) */}
      <SimilarWorksCard works={similarWorks} />
        </TabsContent>

        <TabsContent value="reviews" className="mt-4 space-y-6">
      {/* Reviews externas */}
      <WorkReviewsCard snapshot={reviewsSnapshot} />

      {/* Categorias */}
      {(genres.length > 0 || tags.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Categorias</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {genres.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Gêneros</p>
                <div className="flex flex-wrap gap-1.5">
                  {genres.map((genre: string) => (
                    <Badge key={genre} variant="secondary" className="font-normal text-xs py-0">
                      {genre}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {tags.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
                <div className="space-y-2">
                  {tagGroups.map((group) => (
                    <div key={group.groupName}>
                      <p className="mb-1 text-[11px] text-muted-foreground/70">
                        {group.groupName}
                        <span className="ml-1 text-muted-foreground/50">({group.tags.length})</span>
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {group.tags.map((tag) => (
                          <Badge key={tag.key} variant="outline" className="font-normal text-xs py-0 h-5">
                            {tag.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>

      <div className="flex gap-3">
        <Link href="/titles" className="text-sm text-muted-foreground hover:underline">
          Voltar para a lista
        </Link>
      </div>
    </div>
  )
}
