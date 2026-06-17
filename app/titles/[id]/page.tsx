import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { BarChart3, ChevronDown, LayoutDashboard, Plus, Sparkles, Tags as TagsIcon, User, BrainCircuit, FileText, Calculator, Globe, Sliders, Hash } from "lucide-react"
import { AiEvaluationButton } from "@/components/titles/ai-evaluation-button"
import { CalculationBreakdown } from "@/components/titles/calculation-breakdown"
import { ComixResolutionWatcher } from "@/components/titles/comix-resolution-watcher"
import { DeepDiveButton } from "@/components/titles/deep-dive-button"
import { RerankAiRkButton } from "@/components/titles/rerank-ai-rk-button"
import { SynopsisQualitySuggestion } from "@/components/titles/synopsis-quality-suggestion"
import { PostReadingFlow } from "@/components/titles/post-reading-flow"
import { TagsExpandAll } from "@/components/titles/tags-expand-all"
import { getWorkWithAiEvaluations, getWorkBySlug, getWorkIdsBySlug, getWorkTitleByIdOrSlug } from "@/server/queries/works"
import { getAllTags } from "@/server/queries/tags"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import {
  getLatestAiEvaluationAttributes,
  getExistingPostReadingAssessment,
} from "@/server/queries/post-attribute-assessment"
import { getCurrentUserId, getCurrentPlan } from "@/server/queries/current-user"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { planAllows } from "@/lib/plans/capabilities"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getWorkReviews } from "@/server/queries/work-reviews"
import { getLastDeepDive } from "@/server/queries/deep-dive"
import { getSynopsisPredictionForWork } from "@/server/queries/synopsis-quality"
import { WorkReviewsCard } from "@/components/titles/work-reviews-card"
import { ScoreBadge, getCriterionColorClass } from "@/components/ui/score-badge"
import {
  PublicationStatusBadge,
  PersonalStatusBadge,
} from "@/components/ui/status-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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
import type { PersonalStatus, SynopsisQuality } from "@/types/domain"
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
  subGroupName?: string
  stance?: "love" | "avoid"
}

type WorkTagForDisplay = {
  id?: string
  slug?: string
  name?: string
  tag_group_id?: string | null
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

function getTagGroupLabel(tagGroupId: string | null | undefined) {
  if (!tagGroupId) return "Sem grupo"
  const entry = Object.entries(TAG_GROUP_IDS).find(([, id]) => id === tagGroupId)
  if (!entry) return "Sem grupo"
  return TAG_GROUP_LABELS[entry[0] as TagGroupSlug] ?? entry[0]
}

/** Cor do badge conforme a stance declarada (amo=verde, evito=vermelho). */
function tagStanceClass(stance?: "love" | "avoid"): string {
  if (stance === "love")
    return "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
  if (stance === "avoid")
    return "border-rose-500/50 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 hover:text-rose-800 dark:text-rose-300 dark:hover:text-rose-200"
  return ""
}

/**
 * Extrai a contagem de reviews da avaliação IA a partir do `raw_response`
 * persistido (sem migration — o dado já está lá). `used` = reviews que a IA
 * citou (reviewAudit.usedReviewIds); `provided` = reviews fornecidas no prompt
 * após dedup (evaluationContext). Retorna null quando nenhuma review foi
 * incluída no prompt (obras sem fonte externa).
 */
function extractReviewUsage(rawResponse: unknown): { used: number; provided: number } | null {
  if (!rawResponse || typeof rawResponse !== "object") return null
  const raw = rawResponse as Record<string, unknown>

  const audit = raw.reviewAudit as { usedReviewIds?: unknown } | undefined
  const ctx = raw.evaluationContext as
    | {
        reviewsIncludedInPrompt?: unknown
        sourcedReviewsAfterDedup?: unknown
        legacyReviewsAfterDedup?: unknown
      }
    | undefined

  if (ctx?.reviewsIncludedInPrompt === false) return null

  const used = Array.isArray(audit?.usedReviewIds) ? audit.usedReviewIds.length : 0
  const provided =
    (typeof ctx?.sourcedReviewsAfterDedup === "number" ? ctx.sourcedReviewsAfterDedup : 0) +
    (typeof ctx?.legacyReviewsAfterDedup === "number" ? ctx.legacyReviewsAfterDedup : 0)

  if (provided === 0 && used === 0) return null
  return { used, provided }
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

export async function generateMetadata({ params }: TitleDetailPageProps): Promise<Metadata> {
  const { id } = await params
  const title = await getWorkTitleByIdOrSlug(id)
  return { title: title ? `${title} · SatorIA` : "SatorIA" }
}

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

  const configClient = createAdminClient()
  const [scoreThresholds, reviewsSnapshot, similarWorks, lastDeepDive, sources, biasMap, plan, allTagsCatalog, synopsisPrediction, declaredTagPrefs] = await Promise.all([
    getScoreColorThresholds(),
    getWorkReviews(work.id as string),
    getSimilarWorks(work.id as string, 8),
    getLastDeepDive(work.id as string),
    getSourceRows(),
    getBiasMap(await getCurrentUserId(configClient), configClient),
    getCurrentPlan(configClient),
    getAllTags(),
    getSynopsisPredictionForWork(work.id as string),
    getDeclaredTagPreferences(configClient),
  ])
  const subGroupBySlug = new Map<string, string>()
  for (const t of allTagsCatalog) {
    if (t.subGroupName) subGroupBySlug.set(t.slug, t.subGroupName)
  }
  // Stance declarada (amo/evito) por slug de tag — pra colorir os badges.
  const stanceBySlug = new Map<string, "love" | "avoid">()
  for (const p of declaredTagPrefs) stanceBySlug.set(p.slug, p.stance)
  const isPaidPlan = planAllows(plan, "deep_dive")

  const scoreMap: Record<string, number> = {}
  const sourceMap: Record<string, string> = {}
  for (const cs of work.category_scores ?? []) {
    scoreMap[cs.criterion_slug] = cs.score
    sourceMap[cs.criterion_slug] = cs.source ?? "imported"
  }
  // Atributos cuja nota da IA é calibrada on-read no pipeline (offset != 0 e
  // origem IA). Mostra "→ Y no cálculo" no card de notas por critério.
  const BIAS_APPLICABLE = new Set(["ai_accepted", "ai_calibrated"])

  const aiEvaluations: Array<{
    id: string
    status: string
    model_name: string | null
    prompt_version: string | null
    summary: string | null
    confidence: number | null
    created_at: string
    raw_response?: unknown
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
  const reviewUsage = extractReviewUsage(latestAiEval?.raw_response)

  const genres = Array.isArray(work.genres) ? work.genres.filter(Boolean) : []
  const tags = Array.isArray(work.tags) ? work.tags.filter(Boolean) : []
  const primaryCover = pickPrimaryCover(work.work_covers)
  const primarySynopsis = pickPrimarySynopsis(work.work_synopses)
  const tagGroupMap = new Map<string, DetailTag[]>()
  for (const tag of tags as Array<WorkTagForDisplay | string>) {
    const label = typeof tag === "string" ? tag : tag.name
    if (!label) continue
    const groupLabel = typeof tag === "string" ? "Sem grupo" : getTagGroupLabel(tag.tag_group_id)
    const slug = typeof tag === "string" ? undefined : tag.slug
    const groupTags = tagGroupMap.get(groupLabel) ?? []
    groupTags.push({
      key: typeof tag === "string" ? tag : tag.id ?? tag.slug ?? label,
      label,
      subGroupName: slug ? subGroupBySlug.get(slug) : undefined,
      stance: slug ? stanceBySlug.get(slug) : undefined,
    })
    tagGroupMap.set(groupLabel, groupTags)
  }
  const byTagLabel = (a: DetailTag, b: DetailTag) => a.label.localeCompare(b.label)
  const tagGroups = Array.from(tagGroupMap.entries())
    .map(([groupName, groupTags]) => {
      // When the group has applied sub-groups, split into collapsible sections.
      let subGroups: Array<{ name: string; tags: DetailTag[] }> | null = null
      if (groupTags.some((t) => t.subGroupName)) {
        const bySub = new Map<string, DetailTag[]>()
        const ungrouped: DetailTag[] = []
        for (const t of groupTags) {
          if (t.subGroupName) {
            const arr = bySub.get(t.subGroupName) ?? []
            arr.push(t)
            bySub.set(t.subGroupName, arr)
          } else ungrouped.push(t)
        }
        subGroups = [...bySub.entries()]
          .map(([name, tgs]) => ({ name, tags: tgs.sort(byTagLabel) }))
          .sort((a, b) => a.name.localeCompare(b.name))
        if (ungrouped.length) subGroups.push({ name: "Outras", tags: ungrouped.sort(byTagLabel) })
      }
      return {
        groupName,
        tags: groupTags.sort(byTagLabel),
        subGroups,
      }
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName))
  const postReadingScores = POST_READING_SCORE_FIELDS.map((field) => ({
    field,
    label: POST_READING_WEIGHT_LABELS[field],
    score: work[field] == null ? null : Number(work[field]),
  })).filter((item) => item.score != null && Number.isFinite(item.score))
  const hasPostReadingScores = postReadingScores.length > 0

  // Quantos cards aparecem em "Notas calculadas" (Alinhamento, Match/Veredito IA,
  // Pessoal). Com ≤2 cada um ocupa a linha toda; com 3 volta a 2 colunas.
  const calcCardCount =
    (work.calculated_scores?.personal_fit != null ? 1 : 0) +
    (work.calculated_scores?.alignment_score != null ? 1 : 0) +
    (work.user_score != null ? 1 : 0)

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

  // Interesse na sinopse (♥ a ♥♥♥♥), preenchido manualmente. Quando vazio,
  // mostramos "—" em vez de inventar uma nota — null sinaliza "sem dado ainda".
  const synopsisInterest = work.synopsis_quality?.trim() || null

  const statusInitial: WorkStatusValues = {
    personal_status:
      (getPersonalStatusNameById(work.personal_status_id) as PersonalStatus | undefined) ?? "Want to Read",
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

  // Questionário pós-leitura (atributos): carrega notas da IA + avaliação salva.
  // Sempre carregado pra que o fluxo client-side (PostReadingFlow) possa revelar
  // a seção de atributos na hora em que o status vira terminal — sem reload.
  const postAttrUserId = await getCurrentUserId(configClient)
  const [postAttrAi, postAttrExisting] = await Promise.all([
    getLatestAiEvaluationAttributes(work.id as string, configClient),
    getExistingPostReadingAssessment(work.id as string, postAttrUserId, configClient),
  ])

  const categoriesCount = genres.length + tags.length

  const toValidDate = (raw: string | null | undefined): Date | null => {
    if (!raw) return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // "Atualizada em" reflete só o último "Atualizar dados" (data_refreshed_at),
  // distinto de "Última avaliação" (data da avaliação IA mais recente).
  const dataRefreshedDate = toValidDate(
    (work as { data_refreshed_at?: string | null }).data_refreshed_at
  )
  const lastAiEvalDate = toValidDate(latestAiEval?.created_at)

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
          <StatusActionButton
            workId={work.id}
            statusInitialValues={statusInitial}
            totalChapters={work.total_chapters != null ? Number(work.total_chapters) : null}
            latestAiEvaluation={postAttrAi}
            existingAssessment={postAttrExisting}
          />
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

      <ComixResolutionWatcher workId={work.id} createdAt={work.created_at} />

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

        {/* Stat strip persistente — dividido discretamente em Geral | Pessoal */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {/* Geral: ano, capítulos, publicação */}
          <div className="flex divide-x divide-border/40 rounded-lg border border-border/40 bg-card/20 overflow-hidden">
            {work.year != null && (
              <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Ano
                </span>
                <span className="text-sm font-mono font-semibold text-foreground">
                  {work.year}
                </span>
              </div>
            )}
            {chapterText && (
              <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Capítulos
                </span>
                <span className="text-sm font-mono font-semibold text-foreground">
                  {chapterText}
                </span>
              </div>
            )}
            <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Publicação
              </span>
              <PublicationStatusBadge statusId={work.publication_status_id} />
            </div>
          </div>

          {/* Pessoal: status pessoal, interesse, nota esperada */}
          <div className="flex divide-x divide-border/40 rounded-lg border border-border/40 bg-card/20 overflow-hidden">
            <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pessoal
              </span>
              <PersonalStatusBadge statusId={work.personal_status_id} />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Interesse
              </span>
              {synopsisInterest ? (
                <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
                  {synopsisInterest}
                </span>
              ) : (
                <span
                  className="text-sm font-mono font-semibold text-muted-foreground"
                  title="Interesse na sinopse ainda não informado"
                >
                  —
                </span>
              )}
            </div>
            {work.calculated_scores?.expected_score != null && (
              <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Nota Prevista
                </span>
                <ScoreBadge
                  score={work.calculated_scores.expected_score}
                  size="md"
                  showStub={work.calculated_scores?.expected_is_stub ?? false}
                  thresholds={scoreThresholds?.expected}
                />
              </div>
            )}
          </div>
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

            {(dataRefreshedDate || lastAiEvalDate || work.is_archived || work.last_read_at) && (
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
                {lastAiEvalDate && (
                  <div title={`Última avaliação IA: ${lastAiEvalDate.toLocaleString("pt-BR")}`}>
                    Última avaliação em{" "}
                    <span className="font-medium text-foreground/80">
                      {lastAiEvalDate.toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}
                {dataRefreshedDate && (
                  <div title={`Última atualização de dados: ${dataRefreshedDate.toLocaleString("pt-BR")}`}>
                    Atualizada em{" "}
                    <span className="font-medium text-foreground/80">
                      {dataRefreshedDate.toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}
                {work.is_archived && (
                  <span className="inline-flex w-fit items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
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
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="h-4.5 w-4.5 text-muted-foreground" />
                        <CardTitle className="text-base font-bold text-foreground">Resumo da última avaliação IA</CardTitle>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
                        {reviewUsage && (
                          <span title="Reviews externas citadas pela IA / fornecidas no prompt">
                            Reviews:{" "}
                            <span className="font-medium text-foreground">
                              {reviewUsage.used} de {reviewUsage.provided}
                            </span>
                          </span>
                        )}
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
                  <SynopsisQualitySuggestion
                    workId={work.id as string}
                    manualValue={(work.synopsis_quality as SynopsisQuality | null) ?? null}
                    hasCanonicalSynopsis={Boolean(work.canonical_synopsis)}
                    isPaid={isPaidPlan}
                    prediction={
                      synopsisPrediction
                        ? {
                            predictedQuality: synopsisPrediction.predictedQuality,
                            justification: synopsisPrediction.justification,
                            confidence: synopsisPrediction.confidence,
                            stale: synopsisPrediction.stale,
                          }
                        : null
                    }
                  />
                </CardContent>
              </Card>
              <BatchCreatedNavigator currentId={work.id} />
            </TabsContent>

            <TabsContent value="status" className="mt-0 space-y-5">
              <PostReadingFlow
                workId={work.id as string}
                totalChapters={work.total_chapters != null ? Number(work.total_chapters) : null}
                statusInitial={statusInitial}
                latestAiEvaluation={postAttrAi}
                existingAssessment={postAttrExisting}
              />
            </TabsContent>

            <TabsContent value="recommendations" className="mt-0 space-y-5">
              <SimilarWorksCard works={similarWorks} />
            </TabsContent>

            <TabsContent value="scores" className="mt-0 space-y-6">
      {/* O aviso de drift de modelo/prompt (Guard 1) é um sinal GLOBAL da
          biblioteca — não desta obra. Vive em /settings/calibração →
          "Calibração de atributos" (PredictionHealthCard). */}
      {/* "Atualizar avaliação IA" sozinho numa linha. O Consultor IA (Deep Dive)
          foi movido pra depois do "Detalhamento do cálculo". */}
      <AiEvaluationButton
        workId={work.id}
        workTitle={work.title}
        hasCriteriaScores={Object.keys(scoreMap).length > 0}
        coverUrl={primaryCover}
        latestEvaluation={latestAiEval ?? null}
      />
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
              {work.calculated_scores?.expected_score != null && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-right shrink-0 cursor-help">
                        <p className="text-xs font-medium text-muted-foreground underline-offset-4 decoration-dotted hover:underline">
                          Nota Prevista
                        </p>
                        <p className="text-3xl font-black font-mono leading-none text-foreground">
                          {work.calculated_scores.expected_score.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">estimativa principal</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-left leading-relaxed">
                      {`A previsão vem do Perfil (encaixe com seu tipo de obra): ${work.calculated_scores.expected_score.toFixed(2)}. As 9 notas por critério (que alimentam o Perfil) vêm da avaliação da IA. As 8 dimensões pós-leitura que você preenche NÃO entram na previsão — alimentam seu user_score e o ajuste de bias das notas-IA.`}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn("grid grid-cols-1 gap-4", calcCardCount >= 3 && "sm:grid-cols-2")}>
              {work.calculated_scores?.personal_fit != null && (
                <div className={cn(
                  "flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm",
                  // Sem o par (Veredito IA) ao lado, ocupa a linha toda pra não deixar célula vazia.
                  work.calculated_scores?.alignment_score == null && "sm:col-span-2",
                )}>
                  <div className="flex flex-col items-start gap-1">
                    <ScoreLabelTooltip
                      name="Alinhamento"
                      description="fit_score (0–100%): alinhamento determinístico entre a obra e o seu TasteProfile (gêneros/tags amados e evitados + preferências por critério). Não usa LLM."
                    />
                    <span className="text-[11px] text-muted-foreground">Quão a obra combina com seu perfil</span>
                  </div>
                  {(() => {
                    const fit = work.calculated_scores.personal_fit as number
                    const cls =
                      fit >= 0.75 ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
                      : fit >= 0.5 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
                      : fit >= 0.3 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
                      : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"
                    return (
                      <span className={cn("flex h-10 w-14 items-center justify-center rounded-md border font-mono text-lg font-bold shrink-0", cls)}>
                        {Math.round(fit * 100)}%
                      </span>
                    )
                  })()}
                </div>
              )}

              {work.calculated_scores?.alignment_score != null && (
                <div className={cn(
                  "flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm",
                  work.calculated_scores?.personal_fit == null && "sm:col-span-2",
                )}>
                  <div className="flex flex-col items-start gap-1">
                    <ScoreLabelTooltip
                      name="Veredito IA"
                      description="match_score / Veredito IA (0–100): veredito do consultor LLM sob demanda ('Recomendar com IA' / Deep Dive). Preenchido ao rodar o re-rank."
                    />
                    <span className="text-[11px] text-muted-foreground">Veredito do consultor IA (0–100)</span>
                  </div>
                  {(() => {
                    const rk = work.calculated_scores.alignment_score
                    const cls =
                      rk >= 80 ? "bg-violet-500/15 text-violet-700 border-violet-500/40 dark:text-violet-300"
                      : rk >= 60 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
                      : rk >= 40 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
                      : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"
                    return (
                      <span className={cn("flex h-10 w-14 items-center justify-center rounded-md border font-mono text-lg font-bold shrink-0", cls)}>
                        {Math.round(rk)}
                      </span>
                    )
                  })()}
                </div>
              )}

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
                        <span className="text-[11px] text-muted-foreground">Sua nota pós-leitura</span>
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
                      <span className="text-[11px] text-muted-foreground">Sua nota pós-leitura</span>
                    </div>
                    <ScoreBadge score={work.user_score ?? null} size="lg" className="h-10 w-14 text-lg font-bold shrink-0" />
                  </div>
                )
              )}
            </div>
            <div className="mt-4 flex justify-end border-t border-border/40 pt-3">
              <RerankAiRkButton
                workId={work.id}
                hasScore={work.calculated_scores?.alignment_score != null}
                isPaid={isPaidPlan}
              />
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
                      <span className="text-[11px] text-muted-foreground mt-0.5">
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

      {/* Detalhamento do cálculo (waterfall do expected_score) — colapsável */}
      {work.calculated_scores != null && (
        <CalculationBreakdown calculatedScore={work.calculated_scores} />
      )}

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
                  {reviewUsage && (
                    <span title="Reviews externas citadas pela IA / fornecidas no prompt">
                      Reviews:{" "}
                      <span className="font-medium text-foreground">
                        {reviewUsage.used} de {reviewUsage.provided}
                      </span>
                    </span>
                  )}
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
                          getCriterionColorClass(score, slug, scoreThresholds?.criteria?.[slug])
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
                      <p className="text-[11px] text-muted-foreground/70">
                        Sugestão IA:{" "}
                        <span className="font-mono font-semibold">
                          {Number(aiScore.suggested_score).toFixed(1)}
                        </span>
                      </p>
                    )}
                    {score != null &&
                      BIAS_APPLICABLE.has(sourceMap[slug]) &&
                      (biasMap[slug] ?? 0) !== 0 && (
                        <p
                          className="text-[11px] text-sky-600/80 dark:text-sky-400/80"
                          title={`Offset do seu perfil: ${biasMap[slug] > 0 ? "+" : ""}${biasMap[slug]}. O cálculo usa o valor calibrado, não o bruto da IA.`}
                        >
                          → calibrado p/{" "}
                          <span className="font-mono font-semibold">
                            {(score - biasMap[slug]).toFixed(1)}
                          </span>{" "}
                          no cálculo
                        </p>
                      )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Consultor IA — Deep Dive */}
      {statusInitial.personal_status !== "Completed" && statusInitial.personal_status !== "Dropped" && (
        <DeepDiveButton
          workId={work.id}
          workTitle={work.title}
          lastDive={lastDeepDive}
          isPaid={isPaidPlan}
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
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Hash className="h-4.5 w-4.5 text-muted-foreground" />
                    <CardTitle className="text-base font-bold text-foreground">Tags</CardTitle>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      {tags.length} {tags.length === 1 ? "tag" : "tags"} em {tagGroups.length}{" "}
                      {tagGroups.length === 1 ? "grupo" : "grupos"}
                    </span>
                    {tagGroups.some((g) => g.subGroups) && <TagsExpandAll targetId="work-tags-masonry" />}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div id="work-tags-masonry" className="gap-x-6 sm:columns-2 [&>section]:mb-5 [&>section]:break-inside-avoid">
                  {tagGroups.map((group) => (
                    <section key={group.groupName} className="space-y-2">
                      <div className="flex items-baseline gap-2 border-b-2 border-border/50 pb-1">
                        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">
                          {group.groupName}
                        </h3>
                        <span className="text-[11px] font-semibold text-muted-foreground/70">
                          {group.tags.length}
                        </span>
                      </div>
                      {group.subGroups ? (
                        <div className="ml-1 space-y-1 border-l border-border/30 pl-2">
                          {group.subGroups.map((sg) => (
                            <details key={sg.name} className="group rounded-md bg-muted/20 transition-colors hover:bg-muted/30">
                              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[13px] font-medium text-muted-foreground">
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-open:rotate-180" />
                                <span className="text-foreground/80">{sg.name}</span>
                                <span className="text-[11px] text-muted-foreground/60">{sg.tags.length}</span>
                              </summary>
                              <div className="flex flex-wrap gap-1.5 px-2 pb-2 pl-6">
                                {sg.tags.map((tag) => (
                                  <Badge
                                    key={tag.key}
                                    variant="outline"
                                    className={cn(
                                      "rounded-full px-2.5 py-0.5 text-xs font-normal transition-colors",
                                      tag.stance
                                        ? tagStanceClass(tag.stance)
                                        : "hover:bg-accent hover:text-accent-foreground",
                                    )}
                                  >
                                    {tag.label}
                                  </Badge>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {group.tags.map((tag) => (
                            <Badge
                              key={tag.key}
                              variant="outline"
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-xs font-normal transition-colors",
                                tag.stance
                                  ? tagStanceClass(tag.stance)
                                  : "hover:bg-accent hover:text-accent-foreground",
                              )}
                            >
                              {tag.label}
                            </Badge>
                          ))}
                        </div>
                      )}
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
