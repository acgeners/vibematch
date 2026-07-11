import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { BarChart3, Ban, ChevronDown, Compass, Heart, LayoutDashboard, Plus, Sparkles, Tags as TagsIcon, User, BrainCircuit, FileText, Calculator, Globe, Sliders, Hash, ExternalLink } from "lucide-react"
import { AiEvaluationButton } from "@/components/titles/ai-evaluation-button"
import { ComixResolutionWatcher } from "@/components/titles/comix-resolution-watcher"
import { DeepDiveButton } from "@/components/titles/deep-dive-button"
import { RerankAiRkButton } from "@/components/titles/rerank-ai-rk-button"
import { SynopsisQualitySuggestion } from "@/components/titles/synopsis-quality-suggestion"
import { InterestAppliedMark } from "@/components/ui/interest-applied-mark"
import { GenerateAllBanner } from "@/components/titles/generate-all-banner"
import type { CascadeStatus } from "@/lib/generate-all/types"
import { PostReadingFlow } from "@/components/titles/post-reading-flow"
import { getTasteCriteria, getTasteScoresForWork } from "@/server/queries/pilot-taste"
import { TagsExpandAll } from "@/components/titles/tags-expand-all"
import { getWorkWithAiEvaluations, getWorkBySlug, getWorkIdsBySlug, getWorkTitleByIdOrSlug, getWorkExternalIds } from "@/server/queries/works"
import { comixWorkUrl } from "@/lib/external/comix"
import { getAllTags } from "@/server/queries/tags"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { buildTagStanceLookup, resolveTagStance, segmentTags, lowercasedNameSet } from "@/lib/tags/segment"
import {
  getLatestAiEvaluationAttributes,
  getExistingPostReadingAssessment,
} from "@/server/queries/post-attribute-assessment"
import { getCurrentUserId, getCurrentPlan } from "@/server/queries/current-user"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { planAllows } from "@/lib/plans/capabilities"
import { LABELS } from "@/lib/constants/ui-labels"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getWorkReviews } from "@/server/queries/work-reviews"
import { getLastDeepDive } from "@/server/queries/deep-dive"
import { getSynopsisPredictionForWork } from "@/server/queries/synopsis-quality"
import { getGenerationReadinessMany } from "@/server/queries/generation-readiness"
import { WorkReviewsCard } from "@/components/titles/work-reviews-card"
import { readManualExternalReviewsForDisplay } from "@/server/queries/external-manual-reviews"
import { isLocalExternalReviewEditorAllowed } from "@/lib/synopsis-interest/local-external-review-gate"
import { ScoreBadge, getCriterionColorClass, getScoreTextColor } from "@/components/ui/score-badge"
import { ForceMeters } from "@/components/ranking/force-meters"
import { computeWorkForces } from "@/lib/calculations/forces"
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
  StatusActionButton,
  UpdateDataActionButton,
} from "@/components/titles/work-detail-actions"
import { BatchCreatedNavigator } from "@/components/titles/batch-created-navigator"
import { WorkCoverGallery } from "@/components/titles/work-cover-gallery"
import { SynopsesViewer } from "@/components/titles/synopses-viewer"
import { BackButton } from "@/components/titles/back-button"
import { CriterionTitleTooltip } from "@/components/titles/criterion-title-tooltip"
import { AlignmentTooltipContent, VerdictTooltipContent } from "@/components/ranking/score-tooltip-content"
import { Badge } from "@/components/ui/badge"
import { TagRowAction } from "@/components/ai-evaluation/tag-actions"
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
  /** Proveniência: "ai_inferred" = inferida por IA; null/ausente = externa/manual. */
  source?: string | null
  confidence?: number | null
}

type WorkTagForDisplay = {
  id?: string
  slug?: string
  name?: string
  tag_group_id?: string | null
  source?: string | null
  confidence?: number | null
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

/** Rótulo do tooltip de uma tag inferida por IA (null quando externa/manual). */
function tagProvenanceLabel(tag: DetailTag): string | null {
  if (tag.source !== "ai_inferred") return null
  const conf = typeof tag.confidence === "number" ? tag.confidence : null
  // Sonnet verifica as de confiança "média" e grava 0,7; Haiku "alta" grava 0,9.
  const engine = conf != null && conf <= 0.75 ? "Sonnet verificou" : "Haiku"
  const confStr = conf != null ? ` · confiança ${conf.toFixed(2).replace(".", ",")}` : ""
  return `Inferida por IA · ${engine}${confStr}`
}

/**
 * Badge de tag com proveniência: contorno tracejado + ponto violeta quando a tag
 * foi inferida por IA (source="ai_inferred"), com tooltip de fonte/confiança. A
 * cor de stance (amada/evitada) manda no corpo; o marcador de IA só se soma.
 */
function TagBadge({ tag, stance }: { tag: DetailTag; stance?: "love" | "avoid" }) {
  const effectiveStance = stance ?? tag.stance
  const isAi = tag.source === "ai_inferred"
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-normal transition-colors",
        effectiveStance ? tagStanceClass(effectiveStance) : "hover:bg-accent hover:text-accent-foreground",
        isAi && "border-dashed",
      )}
    >
      {tag.label}
      {isAi && <span aria-hidden className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />}
    </Badge>
  )
  const tip = tagProvenanceLabel(tag)
  if (!tip) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
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
  const [scoreThresholds, reviewsSnapshot, similarWorks, lastDeepDive, sources, biasMap, plan, allTagsCatalog, synopsisPrediction, declaredTagPrefs, tasteProfileRow, externalIdMap, tasteCriteria, tasteScoresData] = await Promise.all([
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
    loadCurrentTasteProfile(),
    getWorkExternalIds(work.id as string),
    getTasteCriteria(),
    getTasteScoresForWork(work.id as string),
  ])
  // "Ler no Comix": só pra obras que você acompanha (Reading/Started) e que têm
  // hid aceito. `pending` = capítulos não lidos (total − lidos), sinal persistido
  // e refrescado pela checagem manual do /leitura.
  const personalStatusName = getPersonalStatusNameById(work.personal_status_id)
  const isFollowing = personalStatusName === "Reading" || personalStatusName === "Started"
  const comixHid = externalIdMap.comix ?? null
  const comixReadUrl = isFollowing && comixHid ? comixWorkUrl(comixHid) : null
  const comixPending =
    work.total_chapters != null
      ? Math.max(0, Number(work.total_chapters) - Number(work.chapters_read ?? 0))
      : null
  const subGroupBySlug = new Map<string, string>()
  for (const t of allTagsCatalog) {
    if (t.subGroupName) subGroupBySlug.set(t.slug, t.subGroupName)
  }
  // Stance (amada/evitada) por tag: preferências declaradas (por slug) ∪ perfil
  // de gosto (loved_tags/avoided_tags, por nome).
  const tagStanceLookup = buildTagStanceLookup(
    declaredTagPrefs.map((p) => ({ slug: p.slug, stance: p.stance })),
    tasteProfileRow?.profile.loved_tags ?? [],
    tasteProfileRow?.profile.avoided_tags ?? [],
  )
  const isPaidPlan = planAllows(plan, "deep_dive")

  // Prontidão dos geradores (motor de orquestração → UI). Só no plano Pago, que é
  // quando as ações IA aparecem. UM snapshot pra os dois (Interesse + Veredito).
  const genReadiness = isPaidPlan
    ? await getGenerationReadinessMany(work.id as string, ["predict_interest_potential", "run_alignment"])
    : null
  const interestReadiness = genReadiness?.["predict_interest_potential"] ?? null
  const alignmentReadiness = genReadiness?.["run_alignment"] ?? null

  // Canal ÚNICO de review manual (externas) — para o diálogo "Avaliar" e o card de exibição.
  // Só editável com o gate local aberto (as Server Actions reexecutam o gate).
  const externalEditorEnabled = await isLocalExternalReviewEditorAllowed()
  const externalManualReviews = externalEditorEnabled
    ? await readManualExternalReviewsForDisplay(work.id as string)
    : []

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
  // Normaliza cada tag com nome/slug/grupo + stance (perfil ∪ preferências).
  type NormTag = DetailTag & { name: string; slug?: string; groupLabel: string }
  const normalizedTags: NormTag[] = []
  for (const tag of tags as Array<WorkTagForDisplay | string>) {
    const label = typeof tag === "string" ? tag : tag.name
    if (!label) continue
    const slug = typeof tag === "string" ? undefined : tag.slug
    const groupLabel = typeof tag === "string" ? "Sem grupo" : getTagGroupLabel(tag.tag_group_id)
    normalizedTags.push({
      key: typeof tag === "string" ? tag : tag.id ?? tag.slug ?? label,
      label,
      name: label,
      slug,
      groupLabel,
      subGroupName: slug ? subGroupBySlug.get(slug) : undefined,
      stance: resolveTagStance({ slug, name: label }, tagStanceLookup) ?? undefined,
      source: typeof tag === "string" ? null : tag.source ?? null,
      confidence: typeof tag === "string" ? null : tag.confidence ?? null,
    })
  }

  // Cobertura de proveniência (rodapé do card de tags): quantas vieram de IA.
  const aiTagCount = normalizedTags.filter((t) => t.source === "ai_inferred").length
  const externalTagCount = normalizedTags.length - aiTagCount
  const tagsInferredAt = work.tags_inferred_at ?? null
  // "Passou pela inferência" = flag setada OU já tem tag de IA (histórico pré-flag).
  const tagsInferenceRan = tagsInferredAt != null || aiTagCount > 0

  // Segmenta: Categorias (gêneros, card próprio) › Amadas › Evitadas › Resto.
  // Tags com nome de gênero saem da segmentação (já aparecem em Categorias).
  const byTagLabel = (a: DetailTag, b: DetailTag) => a.label.localeCompare(b.label)
  // Nas Amadas/Evitadas: externas primeiro, inferidas por IA agrupadas ao fim
  // (cada bloco alfabético). O tracejado+ponto já distingue; a ordem agrupa.
  const byProvenanceThenLabel = (a: DetailTag, b: DetailTag) => {
    const aiRank = (t: DetailTag) => (t.source === "ai_inferred" ? 1 : 0)
    return aiRank(a) - aiRank(b) || a.label.localeCompare(b.label)
  }
  const genreNameSet = lowercasedNameSet(genres)
  const segmented = segmentTags(normalizedTags, (t) => t.stance ?? null, genreNameSet)
  const lovedTags = [...segmented.loved].sort(byProvenanceThenLabel)
  const avoidedTags = [...segmented.avoided].sort(byProvenanceThenLabel)

  // Resto agrupado por grupo → sub-grupo (mesma lógica de antes, só sobre o resto).
  const tagGroupMap = new Map<string, DetailTag[]>()
  for (const t of segmented.rest) {
    const groupTags = tagGroupMap.get(t.groupLabel) ?? []
    groupTags.push(t)
    tagGroupMap.set(t.groupLabel, groupTags)
  }
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

  // Células de veredito em "Notas calculadas": Alinhamento (personal_fit),
  // Veredito IA (alignment_score) e Deep Dive (match_score da última análise).
  // Pessoal (user_score) sempre ocupa a linha toda.
  const fitPresent = work.calculated_scores?.personal_fit != null
  const alignPresent = work.calculated_scores?.alignment_score != null
  const deepDivePresent = lastDeepDive?.match_score != null
  const verdictCount = (fitPresent ? 1 : 0) + (alignPresent ? 1 : 0) + (deepDivePresent ? 1 : 0)
  // No grid de 2 colunas, a ÚLTIMA célula de veredito ocupa a linha toda quando
  // o total é ímpar, pra não deixar uma coluna vazia ao lado.
  const lastVerdict = deepDivePresent ? "deep" : alignPresent ? "align" : fitPresent ? "fit" : null
  const spanLastVerdict = verdictCount % 2 === 1
  // Quantos cards aparecem em "Notas calculadas". Com ≤2 cada um ocupa a linha
  // toda (grid 1 coluna); com ≥3 volta a 2 colunas.
  const calcCardCount = verdictCount + (work.user_score != null ? 1 : 0)

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
  // Interesse manual que veio da aplicação da previsão (não definido à mão) → selo ✨.
  const synopsisFromPrediction = work.synopsis_quality_source === "prediction_applied"

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
          {comixReadUrl && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-emerald-500/45 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/60 hover:bg-emerald-500/20 hover:text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/12 dark:text-emerald-300 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-200"
            >
              <a href={comixReadUrl} target="_blank" rel="noopener noreferrer" title="Abre no Comix em nova aba">
                <ExternalLink className="h-4 w-4" />
                Ler no Comix
                {comixPending != null && comixPending > 0 && (
                  <span className="ml-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-950">
                    {comixPending} pend.
                  </span>
                )}
              </a>
            </Button>
          )}
          <FavoriteToggleButton workId={work.id} isFavorite={work.is_favorite} />
          <EditLinkButton workSlug={id} workId={work.id} />
          <StatusActionButton
            workId={work.id}
            statusInitialValues={statusInitial}
            totalChapters={work.total_chapters != null ? Number(work.total_chapters) : null}
            latestAiEvaluation={postAttrAi}
            existingAssessment={postAttrExisting}
            tasteCriteria={tasteCriteria}
            tasteScores={tasteScoresData.scores}
            tasteEndingNa={tasteScoresData.endingNa}
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
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
                  {synopsisInterest}
                  {synopsisFromPrediction && <InterestAppliedMark size={12} />}
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
            {work.calculated_scores?.expected_score != null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {work.user_score != null ? "Prevista / Real" : LABELS.expected_score.full}
                </span>
                {work.user_score != null ? (
                  <div className="flex items-center gap-1.5">
                    <ScoreBadge
                      score={work.calculated_scores.expected_score}
                      size="md"
                      showStub={work.calculated_scores?.expected_is_stub ?? false}
                      thresholds={scoreThresholds?.expected}
                    />
                    <span className="font-mono text-sm text-muted-foreground/50">/</span>
                    <ScoreBadge
                      score={work.user_score}
                      size="md"
                      thresholds={scoreThresholds?.expected}
                    />
                  </div>
                ) : (
                  <ScoreBadge
                    score={work.calculated_scores.expected_score}
                    size="md"
                    showStub={work.calculated_scores?.expected_is_stub ?? false}
                    thresholds={scoreThresholds?.expected}
                  />
                )}
              </div>
            ) : (
              // Sem os 9 atributos IA → expected_score é null (não existe nota
              // "parcial"). Mostra "—" no mesmo slot em vez de sumir, espelhando o
              // fallback do Interesse ao lado.
              <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {LABELS.expected_score.full}
                </span>
                <span title="Aparece após a avaliação IA dos atributos da obra">
                  <ScoreBadge score={null} size="md" />
                </span>
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
                  currentCovers={(work.work_covers ?? []).map(
                    (c: { url: string; source?: string | null; is_primary?: boolean }) => ({
                      url: c.url,
                      source: c.source,
                      isPrimary: c.is_primary,
                    })
                  )}
                />
                <GenerateAllBanner
                  compact
                  workId={work.id}
                  workTitle={work.title}
                  initialStatus={(work as { cascade_status?: CascadeStatus }).cascade_status ?? "idle"}
                  currentWork={{
                    title: work.title,
                    originalTitle: work.original_title,
                    synopsis: primarySynopsis,
                    coverUrl: primaryCover,
                    publicationStatus: getPublicationStatusNameById(work.publication_status_id) ?? "Unknown",
                    totalChapters: work.total_chapters != null ? Number(work.total_chapters) : null,
                    observations: work.observations,
                  }}
                  currentCovers={(work.work_covers ?? []).map(
                    (c: { url: string; source?: string | null; is_primary?: boolean }) => ({
                      url: c.url,
                      source: c.source,
                      isPrimary: c.is_primary,
                    })
                  )}
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
                    readiness={interestReadiness}
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
                tasteCriteria={tasteCriteria}
                tasteScores={tasteScoresData.scores}
                tasteEndingNa={tasteScoresData.endingNa}
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
          fica logo abaixo das notas calculadas/externas, antes das "Notas por critério".
          O "Gerar tudo" mudou pra linha de ações da aba Geral (ao lado de Revalidar/Atualizar). */}
      <AiEvaluationButton
        workId={work.id}
        workTitle={work.title}
        hasCriteriaScores={Object.keys(scoreMap).length > 0}
        coverUrl={primaryCover}
        latestEvaluation={latestAiEval ?? null}
        externalEditorEnabled={externalEditorEnabled}
        externalReviews={externalManualReviews}
      />
      {/* Bússola de leitura — 3 forças de decisão (ver PLANO-BUSSOLA-3-FORCAS.md) */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Compass className="h-4.5 w-4.5 text-muted-foreground" />
            <CardTitle className="text-base font-bold text-foreground">Bússola de leitura</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            Três forças pra decidir: o quanto você tende a gostar, quão bem avaliada é, e quão popular.
          </p>
        </CardHeader>
        <CardContent>
          <ForceMeters
            forces={computeWorkForces({
              chanceScore: work.calculated_scores?.chance_score ?? null,
              platformAvg: work.calculated_scores?.platform_avg ?? null,
              totalVotes: work.calculated_scores?.total_votes ?? null,
            })}
          />
        </CardContent>
      </Card>
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
              {work.calculated_scores?.expected_score != null ? (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-right shrink-0 cursor-help">
                        <p className="text-xs font-medium text-muted-foreground underline-offset-4 decoration-dotted hover:underline">
                          {LABELS.expected_score.full}
                        </p>
                        <p className={cn(
                          "text-3xl font-black font-mono leading-none",
                          getScoreTextColor(work.calculated_scores.expected_score, scoreThresholds?.expected),
                        )}>
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
              ) : (
                // Sem os 9 atributos IA não há Nota Prevista real (ver expected.ts /
                // gate no recalc). Estado explícito no lugar do número oculto.
                <div className="text-right shrink-0" title="Aparece após a avaliação IA dos atributos da obra">
                  <p className="text-xs font-medium text-muted-foreground">{LABELS.expected_score.full}</p>
                  <p className="text-3xl font-black font-mono leading-none text-muted-foreground">—</p>
                  <p className="text-xs text-muted-foreground">após avaliação IA</p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn("grid grid-cols-1 gap-4", calcCardCount >= 3 && "sm:grid-cols-2")}>
              {work.calculated_scores?.personal_fit != null && (
                <div className={cn(
                  "flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm",
                  // Última célula de veredito numa contagem ímpar → ocupa a linha toda.
                  spanLastVerdict && lastVerdict === "fit" && "sm:col-span-2",
                )}>
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Alinhamento</span>
                    <span className="text-[11px] text-muted-foreground">Posição no catálogo pelo seu perfil (percentil)</span>
                  </div>
                  {(() => {
                    // Mostra o PERCENTIL (mesma métrica que o ranking/filtro usam:
                    // personalFitPercentile ?? personal_fit*100). Antes mostrava o
                    // personal_fit cru ×100, divergindo do número do ranking.
                    const pf = work.calculated_scores.personal_fit as number
                    const pctRaw = work.calculated_scores.personal_fit_percentile as number | null
                    const shown = pctRaw != null ? pctRaw : pf * 100
                    const cls =
                      shown >= 75 ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
                      : shown >= 50 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
                      : shown >= 30 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
                      : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"
                    return (
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={cn("flex h-10 w-14 items-center justify-center rounded-md border font-mono text-lg font-bold shrink-0 cursor-help", cls)}>
                              {Math.round(shown)}%
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[280px] space-y-1">
                            <AlignmentTooltipContent value={pf} percentile={pctRaw} />
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )
                  })()}
                </div>
              )}

              {work.calculated_scores?.alignment_score != null && (() => {
                const rk = work.calculated_scores.alignment_score
                const stale = work.calculated_scores.alignment_stale ?? false
                const alignAt = work.calculated_scores.alignment_at
                const cls =
                  rk >= 80 ? "bg-violet-500/15 text-violet-700 border-violet-500/40 dark:text-violet-300"
                  : rk >= 60 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
                  : rk >= 40 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
                  : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"
                return (
                  <div className={cn(
                    "flex items-center justify-between p-4 rounded-xl border bg-card/30 hover:bg-card/50 transition-all duration-200 shadow-sm",
                    stale
                      ? "border-amber-500/55 hover:border-amber-500/70"
                      : "border-border/80 hover:border-border",
                    spanLastVerdict && lastVerdict === "align" && "sm:col-span-2",
                  )}>
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs font-medium text-muted-foreground">{LABELS.alignment_score.full}</span>
                      {stale ? (
                        <span className="inline-flex items-center rounded-full border border-amber-500/55 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          Desatualizado
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {alignAt
                            ? `Calculado em ${new Date(alignAt).toLocaleDateString("pt-BR")}`
                            : "Veredito do consultor IA (0–100)"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Recalcular aparece SÓ quando desatualizado, atrelado ao Veredito, antes da nota. */}
                      {stale && <RerankAiRkButton workId={work.id} hasScore isPaid={isPaidPlan} icon="rotate" readiness={alignmentReadiness} />}
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={cn(
                              "flex h-10 w-14 items-center justify-center rounded-md border font-mono text-lg font-bold shrink-0 cursor-help",
                              cls,
                              // !important: o reset global `* { border-color }` (globals.css,
                              // sem @layer) vence utilities no Tailwind v4; sem o ! a borda fica cinza.
                              stale && "border-amber-600! dark:border-amber-400!",
                            )}>
                              {Math.round(rk)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[400px] space-y-1.5">
                            <VerdictTooltipContent
                              score={rk}
                              justification={work.calculated_scores.alignment_justification}
                              payload={work.calculated_scores.alignment_payload}
                            />
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                )
              })()}

              {deepDivePresent && (
                <div className={cn(
                  "flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-200 shadow-sm",
                  spanLastVerdict && lastVerdict === "deep" && "sm:col-span-2",
                )}>
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Deep Dive</span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(lastDeepDive!.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  {(() => {
                    const ms = lastDeepDive!.match_score as number
                    const cls =
                      ms >= 80 ? "bg-violet-500/15 text-violet-700 border-violet-500/40 dark:text-violet-300"
                      : ms >= 60 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
                      : ms >= 40 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
                      : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"
                    const oneLiner = lastDeepDive!.one_liner?.trim() || null
                    const badge = (
                      <span className={cn("flex h-10 w-14 items-center justify-center rounded-md border font-mono text-lg font-bold shrink-0", cls, oneLiner && "cursor-help")}>
                        {Math.round(ms)}
                      </span>
                    )
                    if (!oneLiner) return badge
                    return (
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>{badge}</TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs whitespace-pre-line text-left leading-relaxed">
                            {`“${oneLiner}”`}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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
                          <span className="text-xs font-medium text-muted-foreground">Pessoal</span>
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
                      <span className="text-xs font-medium text-muted-foreground">Pessoal</span>
                      <span className="text-[11px] text-muted-foreground">Sua nota pós-leitura</span>
                    </div>
                    <ScoreBadge score={work.user_score ?? null} size="lg" className="h-10 w-14 text-lg font-bold shrink-0" />
                  </div>
                )
              )}
            </div>
            {/* Veredito ainda não calculado: única forma de disparar o "Calcular"
                inicial (não há badge pra atrelar). Some assim que o Veredito existe —
                daí em diante o recálculo vive na linha do Veredito, só quando stale. */}
            {work.calculated_scores?.alignment_score == null && (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/40 pt-3">
                <span className="text-xs text-muted-foreground">Veredito IA ainda não calculado</span>
                <RerankAiRkButton workId={work.id} hasScore={false} isPaid={isPaidPlan} readiness={alignmentReadiness} />
              </div>
            )}
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

      {/* Consultor IA — Deep Dive (entre as notas e o detalhamento por critério).
          Em obras lidas (Completed/Dropped) não cabe rodar NOVA análise, mas se já
          existe uma salva o card aparece em modo só-leitura ("Ver análise"). */}
      {(() => {
        const isTerminalStatus =
          statusInitial.personal_status === "Completed" || statusInitial.personal_status === "Dropped"
        if (isTerminalStatus && lastDeepDive == null) return null
        return (
          <DeepDiveButton
            workId={work.id}
            workTitle={work.title}
            lastDive={lastDeepDive}
            isPaid={isPaidPlan}
            allowNew={!isTerminalStatus}
          />
        )
      })()}

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

      {/* Reviews externas — apoiam visualmente os scores da IA */}
      <WorkReviewsCard snapshot={reviewsSnapshot} workId={work.id as string} />
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
                      {tags.length} {tags.length === 1 ? "tag" : "tags"}
                    </span>
                    {tagGroups.some((g) => g.subGroups) && <TagsExpandAll targetId="work-tags-masonry" />}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <TooltipProvider delayDuration={150}>
                {lovedTags.length > 0 && (
                  <section className="mb-5 space-y-2">
                    <div className="flex items-baseline gap-2 border-b-2 border-emerald-500/40 pb-1">
                      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                        <Heart className="h-3 w-3" /> Amadas
                      </h3>
                      <span className="text-[11px] font-semibold text-muted-foreground/70">{lovedTags.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {lovedTags.map((tag) => (
                        <TagBadge key={tag.key} tag={tag} stance="love" />
                      ))}
                    </div>
                  </section>
                )}
                {avoidedTags.length > 0 && (
                  <section className="mb-5 space-y-2">
                    <div className="flex items-baseline gap-2 border-b-2 border-rose-500/40 pb-1">
                      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300">
                        <Ban className="h-3 w-3" /> Evitadas
                      </h3>
                      <span className="text-[11px] font-semibold text-muted-foreground/70">{avoidedTags.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {avoidedTags.map((tag) => (
                        <TagBadge key={tag.key} tag={tag} stance="avoid" />
                      ))}
                    </div>
                  </section>
                )}
                {tagGroups.length > 0 && (
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
                                  <TagBadge key={tag.key} tag={tag} />
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {group.tags.map((tag) => (
                            <TagBadge key={tag.key} tag={tag} />
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-border/60 pt-3 text-[11px] text-muted-foreground">
                  {aiTagCount > 0 && (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-full border border-border" /> Fonte externa / manual
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex h-2.5 w-2.5 items-center justify-center rounded-full border border-dashed border-violet-400">
                          <span className="h-1 w-1 rounded-full bg-violet-500" />
                        </span>
                        Inferida por IA
                      </span>
                    </>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 tabular-nums">
                    {aiTagCount > 0 && (
                      <span>cobertura: <b className="font-semibold text-foreground/80">{aiTagCount}</b> por IA · {externalTagCount} externas</span>
                    )}
                    {tagsInferenceRan ? (
                      <span
                        className="inline-flex items-center gap-1"
                        title={tagsInferredAt ? `Inferência rodou em ${new Date(tagsInferredAt).toLocaleDateString("pt-BR")}` : "Tem tags inferidas por IA (backfill anterior ao registro de data)"}
                      >
                        <Sparkles className="h-3 w-3 text-violet-500" /> inferência de tags aplicada
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <Sparkles className="h-3 w-3" /> inferência de tags: nunca rodou
                      </span>
                    )}
                    {tagsInferenceRan ? (
                      <TagRowAction workId={work.id} variant="ghost" label="Re-inferir" className="h-6 gap-1 px-2 text-[11px]" />
                    ) : (
                      <TagRowAction workId={work.id} label="Inferir tags" className="h-6 gap-1 px-2 text-[11px]" />
                    )}
                  </div>
                </div>
                </TooltipProvider>
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
