import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { BarChart3, ChevronDown, LayoutDashboard, Plus, Sparkles, Tags as TagsIcon, User, BrainCircuit, FileText, Calculator, Globe, Sliders, Hash } from "lucide-react"
import { AiEvaluationButton } from "@/components/titles/ai-evaluation-button"
import { DeepDiveButton } from "@/components/titles/deep-dive-button"
import { WorkStatusForm } from "@/components/titles/work-status-form"
import { getWorkWithAiEvaluations, getWorkBySlug, getWorkIdsBySlug } from "@/server/queries/works"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getWorkReviews } from "@/server/queries/work-reviews"
import { getLastDeepDive } from "@/server/queries/deep-dive"
import { WorkReviewsCard } from "@/components/titles/work-reviews-card"
import { ScoreBadge } from "@/components/ui/score-badge"
import {
  PublicationStatusBadge,
  PersonalStatusBadge,
} from "@/components/ui/status-badge"
import { CalculationBreakdown } from "@/components/titles/calculation-breakdown"
import { SimilarWorksCard } from "@/components/titles/similar-works-card"
import { getSimilarWorks } from "@/server/queries/similar-works"
import {
  EditLinkButton,
  FavoriteToggleButton,
  MoreActionsMenu,
  RevalidateSourcesActionButton,
  StatusActionButton,
  UpdateDataActionButton,
} from "@/components/titles/work-detail-actions"
import { BatchCreatedNavigator } from "@/components/titles/batch-created-navigator"
import { WorkCoverGallery } from "@/components/titles/work-cover-gallery"
import { SynopsesViewer } from "@/components/titles/synopses-viewer"
import { BackButton } from "@/components/titles/back-button"
import { CriterionTitleTooltip } from "@/components/titles/criterion-title-tooltip"
import { ScoreLabelTooltip } from "@/components/titles/score-label-tooltip"
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

const DEFAULT_SYNOPSIS_INTEREST = "♥♥"

function formatSynopsisInterest(value: string | null | undefined) {
  return value?.trim() || DEFAULT_SYNOPSIS_INTEREST
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
  const [{ data: configRow }, scoreThresholds, reviewsSnapshot, similarWorks, lastDeepDive, sources] = await Promise.all([
    configClient
      .from("formula_config")
      .select("distance_p95")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getScoreColorThresholds(),
    getWorkReviews(work.id as string),
    getSimilarWorks(work.id as string, 8),
    getLastDeepDive(work.id as string),
    getSourceRows(),
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

  const statusInitial: WorkStatusValues = {
    personal_status:
      (getPersonalStatusNameById(work.personal_status_id) as PersonalStatus | undefined) ?? "To read",
    personal_status_id: work.personal_status_id ?? null,
    synopsis_quality: work.synopsis_quality ?? null,
    observation_adjustment: work.observation_adjustment ?? 0,
    observations: work.observations ?? null,
    chapters_read: work.chapters_read != null ? Number(work.chapters_read) : null,
    last_read_at: work.last_read_at ?? null,
    user_score: work.user_score ?? null,
    post_story_score: work.post_story_score ?? null,
    post_fl_score: work.post_fl_score ?? null,
    post_ml_score: work.post_ml_score ?? null,
    post_character_development_score: work.post_character_development_score ?? null,
    post_pacing_score: work.post_pacing_score ?? null,
    post_art_visual_score: work.post_art_visual_score ?? null,
    post_impact_immersion_score: work.post_impact_immersion_score ?? null,
    post_originality_score: work.post_originality_score ?? null,
  }

  const categoriesCount = genres.length + tags.length

  const lastUpdatedDate = (() => {
    const candidates = [work.updated_at, latestAiEval?.created_at]
      .filter((d): d is string => Boolean(d))
      .map((d) => new Date(d))
      .filter((d) => !Number.isNaN(d.getTime()))
    if (candidates.length === 0) return null
    return candidates.sort((a, b) => b.getTime() - a.getTime())[0]
  })()

  const tabsListClass =
    "h-auto w-full flex flex-wrap justify-start gap-2 bg-transparent rounded-none p-0"

  const tabTriggerClass =
    "flex-1 min-w-[120px] cursor-pointer gap-2.5 rounded-md border border-border bg-card px-4 py-5 text-base font-semibold tracking-normal text-foreground shadow-md transition-all duration-200 hover:bg-primary/5 hover:border-primary/40 hover:text-primary hover:-translate-y-0.5 hover:shadow-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=active]:shadow-[0_0_32px_-2px_hsl(var(--primary)/0.6),0_8px_22px_-6px_hsl(var(--primary)/0.65)] dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground [&_svg]:h-5 [&_svg]:w-5"

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <div className="flex flex-wrap items-center gap-2">
          <FavoriteToggleButton workId={work.id} isFavorite={work.is_favorite} />
          <EditLinkButton workSlug={id} workId={work.id} />
          <MoreActionsMenu workId={work.id} isArchived={work.is_archived} />
          <Button asChild size="sm">
            <Link href="/titles/new">
              <Plus className="h-4 w-4" />
              Novo título
            </Link>
          </Button>
        </div>
      </div>

      {/* Título (alt titles ficam na aba Visão Geral) */}
      <header className="space-y-1">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          {work.title}
        </h1>
      </header>

      <Tabs defaultValue="overview" className="w-full">
        {/* Tabs navbar (full width, 5 abas com wrap responsivo) */}
        <TabsList className={tabsListClass}>
          <TabsTrigger value="overview" className={tabTriggerClass}>
            <LayoutDashboard />
            <span className="hidden sm:inline">Visão Geral</span>
            <span className="sm:hidden">Geral</span>
          </TabsTrigger>
          <TabsTrigger value="scores" className={tabTriggerClass}>
            <BarChart3 />
            <span className="hidden sm:inline">Notas & Avaliações</span>
            <span className="sm:hidden">Notas</span>
          </TabsTrigger>
          <TabsTrigger value="status" className={tabTriggerClass}>
            <User />
            <span className="hidden sm:inline">Meu Status</span>
            <span className="sm:hidden">Status</span>
          </TabsTrigger>
          <TabsTrigger value="recommendations" className={tabTriggerClass}>
            <Sparkles />
            <span className="hidden sm:inline">Recomendações</span>
            <span className="sm:hidden">Recom.</span>
          </TabsTrigger>
          <TabsTrigger value="tags" className={tabTriggerClass}>
            <TagsIcon />
            <span className="hidden sm:inline">Gêneros e Tags</span>
            <span className="sm:hidden">Tags</span>
            {categoriesCount > 0 && (
              <span className="ml-1 rounded-full bg-current/20 px-1.5 py-0.5 text-[11px] font-bold leading-none">
                {categoriesCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Stat strip persistente — info ambiente, menos peso que as abas */}
        <div className="mt-4 grid grid-cols-2 divide-x divide-border/40 rounded-lg border border-border/40 bg-card/20 overflow-hidden sm:grid-cols-3 lg:grid-cols-6">
          {work.year != null && (
            <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ano
              </span>
              <span className="text-sm font-mono font-semibold text-foreground">
                {work.year}
              </span>
            </div>
          )}
          {chapterText && (
            <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Capítulos
              </span>
              <span className="text-sm font-mono font-semibold text-foreground">
                {chapterText}
              </span>
            </div>
          )}
          <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Publicação
            </span>
            <PublicationStatusBadge statusId={work.publication_status_id} />
          </div>
          <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pessoal
            </span>
            <PersonalStatusBadge statusId={work.personal_status_id} />
          </div>
          {formatSynopsisInterest(work.synopsis_quality) && (
            <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Interesse
              </span>
              <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
                {formatSynopsisInterest(work.synopsis_quality)}
              </span>
            </div>
          )}
          {work.calculated_scores?.final_score != null && (
            <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Nota.Final
              </span>
              <ScoreBadge
                score={work.calculated_scores.final_score}
                size="md"
                thresholds={scoreThresholds?.final}
              />
            </div>
          )}
        </div>

        {/* Layout principal: sidebar (capa + ações) | conteúdo da aba */}
        <div className="mt-5 grid gap-6 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Sidebar persistente — visível em todas as abas */}
          <aside className="space-y-4">
            <div className="w-full max-w-[260px] justify-self-center md:justify-self-start">
              <WorkCoverGallery
                title={work.title}
                fallbackUrl={primaryCover}
                covers={work.work_covers ?? []}
              />
            </div>

            {(lastUpdatedDate || work.is_archived || work.last_read_at) && (
              <div className="flex flex-col gap-1.5 rounded-md border bg-card/40 p-3 text-xs text-muted-foreground">
                {work.last_read_at && (
                  <div>
                    Última leitura em{" "}
                    <span className="font-medium text-foreground/80">
                      {new Date(`${work.last_read_at}T00:00:00`).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}
                {lastUpdatedDate && (
                  <div title={`Última atualização: ${lastUpdatedDate.toLocaleString("pt-BR")}`}>
                    Atualizada em{" "}
                    <span className="font-medium text-foreground/80">
                      {lastUpdatedDate.toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}
                {work.is_archived && (
                  <span className="inline-flex w-fit items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    Arquivada
                  </span>
                )}
              </div>
            )}
          </aside>

          {/* Coluna do conteúdo das abas */}
          <div className="min-w-0">
            <TabsContent value="overview" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <RevalidateSourcesActionButton workId={work.id} />
                <UpdateDataActionButton
                  workId={work.id}
                  currentWork={{
                    title: work.title,
                    originalTitle: work.original_title,
                    synopsis: primarySynopsis,
                    coverUrl: primaryCover,
                    publicationStatus: getPublicationStatusNameById(work.publication_status_id) ?? "Unknown",
                    totalChapters: work.total_chapters != null ? Number(work.total_chapters) : null,
                    observations: work.observations,
                  }}
                />
                <StatusActionButton
                  workId={work.id}
                  statusInitialValues={statusInitial}
                  totalChapters={work.total_chapters != null ? Number(work.total_chapters) : null}
                />
              </div>
              {(() => {
                const alts = [
                  work.original_title,
                  ...(work.alternative_titles ?? []),
                ]
                  .map((t: string | null | undefined) => t?.trim())
                  .filter((t): t is string => Boolean(t) && t !== work.title)
                const unique = Array.from(new Set(alts))
                if (unique.length === 0) return null
                return (
                  <ExpandableText
                    text={`Títulos alternativos: ${unique.join(" / ")}`}
                    limit={220}
                    className="text-xs leading-snug text-muted-foreground/70"
                  />
                )
              })()}
              {latestAiEval?.summary && (
                <Card className="gap-2 py-4 bg-card/50">
                  <CardHeader className="px-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="h-4.5 w-4.5 text-muted-foreground" />
                        <CardTitle className="text-base font-bold text-foreground">Resumo da última avaliação IA</CardTitle>
                      </div>
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
                    </div>
                  </CardHeader>
                  <CardContent className="px-4">
                    <p className="whitespace-pre-line text-sm leading-6 text-foreground/85">
                      {latestAiEval.summary}
                    </p>
                  </CardContent>
                </Card>
              )}
              <Card className="gap-2 py-4 bg-card/50">
                <CardHeader className="px-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4.5 w-4.5 text-muted-foreground" />
                    <CardTitle className="text-base font-bold text-foreground">Sinopses</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-4">
                  <SynopsesViewer
                    synopses={work.work_synopses}
                    canonical={work.canonical_synopsis as string | null | undefined}
                    maxLines={20}
                    className="text-sm leading-6 text-foreground/85"
                  />
                </CardContent>
              </Card>
              <BatchCreatedNavigator currentId={work.id} />
            </TabsContent>

            <TabsContent value="status" className="mt-0 space-y-5">
              <WorkStatusForm
                workId={work.id}
                totalChapters={work.total_chapters != null ? Number(work.total_chapters) : null}
                initialValues={statusInitial}
              />
            </TabsContent>

            <TabsContent value="recommendations" className="mt-0 space-y-5">
              <SimilarWorksCard works={similarWorks} />
            </TabsContent>

            <TabsContent value="scores" className="mt-0 space-y-6">
      <AiEvaluationButton
        workId={work.id}
        workTitle={work.title}
        hasCriteriaScores={Object.keys(scoreMap).length > 0}
        coverUrl={primaryCover}
      />
      {work.personal_status !== "Completed" && work.personal_status !== "Dropped" && (
        <DeepDiveButton
          workId={work.id}
          workTitle={work.title}
          lastDive={lastDeepDive}
        />
      )}
      {/* Notas e Avaliações Externas side-by-side */}
      <div className={cn(platformRatings.length > 0 && "grid grid-cols-1 lg:grid-cols-2 gap-5")}>
        {/* Notas */}
        <Card className={cn(platformRatings.length === 0 && "max-w-3xl")}>
          <CardHeader className="pb-1.5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Calculator className="h-4.5 w-4.5 text-muted-foreground" />
                <CardTitle className="text-base font-bold text-foreground">Notas calculadas</CardTitle>
              </div>
              {work.calculated_scores?.final_score != null && (
                <div className="text-right shrink-0">
                  <p className="text-xs font-medium text-muted-foreground">Nota Final</p>
                  <p className="text-3xl font-black font-mono leading-none text-foreground">
                    {work.calculated_scores.final_score.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">oficial nos rankings</p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn("grid grid-cols-1 gap-4", work.user_score != null && "sm:grid-cols-2")}>
              <div className="flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm">
                <div className="flex flex-col items-start gap-1">
                  <ScoreLabelTooltip
                    name="Nota.IA"
                    description="Soma ponderada das notas por critério dadas pela IA, ajustada por pesos e amplificada (5 + (nota − 5) × 1.25). Aplica penalidades por capítulos e observações."
                  />
                  <span className="text-[10px] text-muted-foreground">Avaliação por inteligência artificial</span>
                </div>
                <ScoreBadge score={work.calculated_scores?.calc_score ?? null} size="lg" thresholds={scoreThresholds?.calc} className="h-10 w-14 text-lg font-bold shrink-0" />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm">
                <div className="flex flex-col items-start gap-1">
                  <ScoreLabelTooltip
                    name="Prevista"
                    description="Previsão por Ridge Regression treinada nas suas próprias notas pessoais. Estima qual seria sua nota baseada nos critérios da IA + dados externos. Requer ≥20 obras avaliadas para ser ativada."
                  />
                  <span className="text-[10px] text-muted-foreground">Previsão por aprendizado de máquina</span>
                </div>
                <ScoreBadge
                  score={work.calculated_scores?.predicted_score ?? null}
                  size="lg"
                  showStub={work.calculated_scores?.predicted_is_stub ?? false}
                  thresholds={scoreThresholds?.predicted}
                  className="h-10 w-14 text-lg font-bold shrink-0"
                />
              </div>

              {work.user_score != null && (
                hasPostReadingScores ? (
                  <details className="group rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm overflow-hidden sm:col-span-2">
                    <summary className="flex cursor-pointer list-none items-center justify-between p-4 [&::-webkit-details-marker]:hidden">
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-1.5">
                          <ScoreLabelTooltip
                            name="Pessoal"
                            description="Média ponderada das suas avaliações por estrelas pós-leitura (Ritmo, Arte, Impacto, Originalidade, etc). Calculada automaticamente conforme você preenche os critérios."
                          />
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                        </div>
                        <span className="text-[10px] text-muted-foreground">Sua nota pós-leitura</span>
                      </div>
                      <ScoreBadge score={work.user_score ?? null} size="lg" className="h-10 w-14 text-lg font-bold shrink-0" />
                    </summary>
                    <div className="border-t border-border/40 px-4 pb-4 pt-3 bg-muted/10">
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
                  <div className="flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm sm:col-span-2">
                    <div className="flex flex-col items-start gap-1">
                      <ScoreLabelTooltip
                        name="Pessoal"
                        description="Média ponderada das suas avaliações por estrelas pós-leitura (Ritmo, Arte, Impacto, Originalidade, etc). Calculada automaticamente conforme você preenche os critérios."
                      />
                      <span className="text-[10px] text-muted-foreground">Sua nota pós-leitura</span>
                    </div>
                    <ScoreBadge score={work.user_score ?? null} size="lg" className="h-10 w-14 text-lg font-bold shrink-0" />
                  </div>
                )
              )}
            </div>
          </CardContent>
        </Card>

        {/* Avaliações externas */}
        {platformRatings.length > 0 && (
          <Card>
            <CardHeader className="pb-1.5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Globe className="h-4.5 w-4.5 text-muted-foreground" />
                  <CardTitle className="text-base font-bold text-foreground">Avaliações externas</CardTitle>
                </div>
                {bayesianAvg != null && (
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-muted-foreground">Média externa</p>
                    <p className="text-3xl font-black font-mono leading-none text-foreground">{bayesianAvg.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{formatVotes(totalVotes)} votos</p>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {platformRatings.map((pr) => (
                  <div key={pr.platform} className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm">
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {PLATFORM_LABELS[pr.platform] ?? pr.platform}
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">
                        {formatVotes(pr.vote_count)} votos
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 pl-2 shrink-0">
                      {pr.rating != null ? (
                        <span className="inline-flex items-center justify-center rounded-md font-mono font-bold px-2 py-1 text-sm bg-muted/50 text-foreground ring-1 ring-inset ring-foreground/10 min-w-[2.25rem]">
                          {formatRating(Number(pr.rating))}
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center rounded-md font-mono font-bold px-2 py-1 text-sm bg-muted/30 text-muted-foreground min-w-[2.25rem]">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Notas por critério */}
      <Card>
        <CardHeader className="pb-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4.5 w-4.5 text-muted-foreground" />
                <CardTitle className="text-base font-bold text-foreground">Notas por critério</CardTitle>
              </div>
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

      {/* Reviews externas — apoiam visualmente os scores da IA */}
      <WorkReviewsCard snapshot={reviewsSnapshot} />
        </TabsContent>

            <TabsContent value="tags" className="mt-0 space-y-6">
      {(genres.length > 0 || tags.length > 0) ? (
        <div className="space-y-6">
          {genres.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <TagsIcon className="h-4.5 w-4.5 text-muted-foreground" />
                    <CardTitle className="text-base font-bold text-foreground">Gêneros</CardTitle>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {genres.length} {genres.length === 1 ? "gênero" : "gêneros"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  {genres.map((genre: string) => (
                    <Badge
                      key={genre}
                      variant="secondary"
                      className="rounded-full px-3 py-1 text-sm font-medium"
                    >
                      {genre}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {tags.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Hash className="h-4.5 w-4.5 text-muted-foreground" />
                    <CardTitle className="text-base font-bold text-foreground">Tags</CardTitle>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {tags.length} {tags.length === 1 ? "tag" : "tags"} em {tagGroups.length}{" "}
                    {tagGroups.length === 1 ? "grupo" : "grupos"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                  {tagGroups.map((group) => (
                    <section key={group.groupName} className="space-y-2">
                      <div className="flex items-baseline gap-2 border-b border-border/60 pb-1.5">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                          {group.groupName}
                        </h3>
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {group.tags.length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.tags.map((tag) => (
                          <Badge
                            key={tag.key}
                            variant="outline"
                            className="rounded-full px-2.5 py-0.5 text-xs font-normal transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            {tag.label}
                          </Badge>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum gênero ou tag cadastrado para esta obra.
          </CardContent>
        </Card>
      )}
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  )
}
