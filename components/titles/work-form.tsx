"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import { refreshChrome } from "@/lib/chrome-refresh"
import { useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { titleToSlug, readingProgressPercent } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { dedupeSynopsisEntries, joinSynopsisBlocks, splitSynopsesFromText } from "@/lib/work-derived"
import { workFormSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues, WorkFormInput } from "@/lib/validations/work.schema"
import { ChipInput } from "@/components/ui/chip-input"
import { Textarea } from "@/components/ui/textarea"
import { ExternalSearch } from "@/components/titles/external-search"
import { CoversManager } from "@/components/titles/covers-manager"
import type { ExternalWorkData } from "@/lib/external/types"
import type { ExistingWorkMatch } from "@/server/actions/external"
import { createWork, createWorksBatch, findDuplicateWorkById, findDuplicateWorkByTitle, updateWork } from "@/server/actions/works"
import type { DuplicateWorkForForm } from "@/server/actions/works"
import { previewCanonicalSynopsis } from "@/server/actions/synopsis"
import { GENRE_NAMES, TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import { evaluateCandidateForCreate, listGenreCatalog } from "@/server/actions/external"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { previewCascade } from "@/lib/cost-preview/catalog"
import {
  PUBLICATION_STATUSES,
  PERSONAL_STATUSES,
  SYNOPSIS_QUALITIES,
  CRITERION_SLUGS,
} from "@/types/domain"
import {
  CRITERIA_INFO,
  CRITERIA_RUBRICS,
  PUBLICATION_STATUS_LABELS,
  PERSONAL_STATUS_LABELS,
  SYNOPSIS_QUALITY_LABELS,
  PLATFORM_LABELS,
} from "@/lib/constants/criteria"
import {
  DEFAULT_POST_READING_WEIGHTS,
  normalizePostReadingScore,
  POST_READING_STAR_HINTS,
  POST_READING_WEIGHT_LABELS,
  POST_READING_WEIGHT_STORAGE_KEY,
  scoreToPostReadingStars,
  starsToPostReadingScore,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { StarRating } from "@/components/ui/star-rating"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart3, ChevronDown, ImageIcon, Info, LayoutDashboard, Loader2, Pencil, Plus, Settings2, Tags, Trash2, User, X } from "lucide-react"
import { PROGRESS_PERSONAL_STATUSES } from "@/lib/constants/criteria"
import { isFullyReadPersonalStatus } from "@/lib/constants/status-lookups"

export interface WorkFormAiEvaluation {
  model_name: string | null
  confidence: number | null
  created_at: string
  summary: string | null
  scores: Array<{
    criterion_slug: string
    justification: string | null
  }>
}

interface WorkFormProps {
  workId?: string
  workSlug?: string
  initialValues?: Partial<WorkFormValues>
  aiEvaluation?: WorkFormAiEvaluation | null
  /** Se a avaliação IA roda automaticamente ao criar via "Buscar dados" (setting, default false). */
  aiEvalOnCreate?: boolean
  /** Conteúdo extra renderizado na aba "Notas e avaliações" (ex.: reviews
   *  manuais). É independente do form — não é um campo, só um slot visual. */
  reviewsSlot?: React.ReactNode
  /** IDs externos já vinculados à obra (edição) — ex.: `{ comix: "003kd" }`.
   *  Exibidos/mantidos no passo de seleção de fontes do "Buscar dados". */
  existingExternalIds?: Record<string, string>
}

type EditTab = "geral" | "notas" | "status" | "tags"

// Mapeia cada campo do form pra aba onde ele aparece, pra trocar de aba e mostrar
// o erro quando a validação falha num campo de aba inativa (senão o submit
// "trava em silêncio"). Campos não listados caem em "geral".
const FIELD_TAB_MAP: Record<string, EditTab> = {
  // Geral
  title: "geral", original_title: "geral", alternative_titles: "geral",
  synopsis: "geral", synopses: "geral", year: "geral", year_end: "geral",
  publication_status: "geral", publication_status_id: "geral",
  total_chapters: "geral", cover_url: "geral", covers: "geral", external_ids: "geral",
  // Notas e avaliações
  romance: "notas", couple_dynamics: "notas", fantasy_nobility: "notas",
  action_adventure: "notas", adult_content: "notas", protagonist: "notas",
  humor: "notas", drama: "notas", tragedy: "notas",
  mu_rating: "notas", mu_votes: "notas", ap_rating: "notas", ap_votes: "notas",
  cmx_rating: "notas", cmx_votes: "notas", extra_platform_ratings: "notas",
  ai_justifications: "notas", ai_eval_status: "notas",
  // Meu status
  personal_status: "status", personal_status_id: "status", chapters_read: "status",
  synopsis_quality: "status", observation_adjustment: "status", observations: "status",
  user_score: "status",
  post_story_score: "status", post_fl_score: "status", post_ml_score: "status",
  post_character_development_score: "status", post_pacing_score: "status",
  post_art_visual_score: "status", post_impact_immersion_score: "status",
  post_originality_score: "status",
  // Gêneros e tags
  genres: "tags", tags: "tags",
}

// Mesmo visual das abas da página de exibição (app/titles/[id]/page.tsx).
const EDIT_TABS_LIST_CLASS =
  "h-auto w-full flex flex-wrap justify-start gap-2 bg-transparent rounded-none p-0"
const EDIT_TAB_TRIGGER_CLASS =
  "flex-1 min-w-[120px] cursor-pointer gap-2.5 rounded-md border border-border bg-card px-4 py-5 text-base font-semibold tracking-normal text-foreground shadow-md transition-all duration-200 hover:bg-primary/5 hover:border-primary/40 hover:text-primary hover:-translate-y-0.5 hover:shadow-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=active]:shadow-[0_0_32px_-2px_hsl(var(--primary)/0.6),0_8px_22px_-6px_hsl(var(--primary)/0.65)] dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground [&_svg]:h-5 [&_svg]:w-5"

// Em edição agrupa as seções em abas; na criação (`flat`) mantém o layout
// empilhado — a revisão dos dados do "Buscar dados" é melhor numa página só.
// Componentes de módulo (não inline) pra não remontar o form a cada render.
function EditTabsShell({
  flat,
  activeTab,
  onTabChange,
  children,
}: {
  flat: boolean
  activeTab: EditTab
  onTabChange: (tab: EditTab) => void
  children: React.ReactNode
}) {
  if (flat) return <div className="space-y-6">{children}</div>
  return (
    <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as EditTab)} className="w-full">
      <TabsList className={EDIT_TABS_LIST_CLASS}>
        <TabsTrigger value="geral" className={EDIT_TAB_TRIGGER_CLASS}>
          <LayoutDashboard />
          Geral
        </TabsTrigger>
        <TabsTrigger value="notas" className={EDIT_TAB_TRIGGER_CLASS}>
          <BarChart3 />
          <span className="hidden sm:inline">Notas e avaliações</span>
          <span className="sm:hidden">Notas</span>
        </TabsTrigger>
        <TabsTrigger value="status" className={EDIT_TAB_TRIGGER_CLASS}>
          <User />
          <span className="hidden sm:inline">Meu status</span>
          <span className="sm:hidden">Status</span>
        </TabsTrigger>
        <TabsTrigger value="tags" className={EDIT_TAB_TRIGGER_CLASS}>
          <Tags />
          <span className="hidden sm:inline">Gêneros e tags</span>
          <span className="sm:hidden">Tags</span>
        </TabsTrigger>
      </TabsList>
      {children}
    </Tabs>
  )
}

function TabPanel({
  flat,
  tab,
  children,
}: {
  flat: boolean
  tab: EditTab
  children: React.ReactNode
}) {
  if (flat) return <div className="space-y-6">{children}</div>
  return (
    <TabsContent value={tab} className="mt-6 space-y-6">
      {children}
    </TabsContent>
  )
}

const PLATFORM_FIELDS = [
  { key: "mu",  label: "Manga Updates", ratingField: "mu_rating"  as const, votesField: "mu_votes"  as const },
  { key: "cmx", label: "Comick",       ratingField: "cmx_rating" as const, votesField: "cmx_votes" as const },
  { key: "ap",  label: "Anime Planet", ratingField: "ap_rating"  as const, votesField: "ap_votes"  as const },
]

// Lista de fontes externas. Deriva de PLATFORM_LABELS (constante já no bundle) —
// antes vinha de um fetch("/api/sources") que só reembrulhava esta mesma constante.
const SOURCE_OPTIONS = Object.values(PLATFORM_LABELS).map((name, index) => ({
  id: index + 1,
  name,
  order: index + 1,
}))

// Vem do banco (`personal_status.tracks_progress`). A lista à mão tinha "Paused" — um status
// que NUNCA existiu na tabela — e "Completed", que deixou de existir.
const READING_STATUSES_WITH_PROGRESS = new Set<string>(PROGRESS_PERSONAL_STATUSES)

const POST_READING_SCORE_FIELDS = [
  {
    name: "post_story_score",
    label: POST_READING_WEIGHT_LABELS.post_story_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Coerência do enredo</li>
          <li>Qualidade dos conflitos</li>
          <li>Construção e resolução da trama</li>
        </ul>
        <p>👉 Faz sentido e se sustenta ao longo da obra?</p>
      </div>
    ),
  },
  {
    name: "post_fl_score",
    label: POST_READING_WEIGHT_LABELS.post_fl_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Carisma / presença</li>
          <li>Inteligência / agência (toma decisões relevantes?)</li>
          <li>Consistência de comportamento</li>
        </ul>
        <p>👉 A protagonista carrega a obra ou é arrastada por ela?</p>
      </div>
    ),
  },
  {
    name: "post_ml_score",
    label: POST_READING_WEIGHT_LABELS.post_ml_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Carisma / presença</li>
          <li>Consistência de comportamento</li>
          <li>Dinâmica com a protagonista</li>
        </ul>
        <p>👉 Tem presença forte ou é genérico / prejudica a obra?</p>
      </div>
    ),
  },
  {
    name: "post_character_development_score",
    label: POST_READING_WEIGHT_LABELS.post_character_development_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Evolução ao longo da história</li>
          <li>Arcos bem construídos</li>
          <li>Relações entre personagens (dinâmica, química, conflitos)</li>
        </ul>
        <p>👉 Os personagens mudam de forma convincente?</p>
      </div>
    ),
  },
  {
    name: "post_pacing_score",
    label: POST_READING_WEIGHT_LABELS.post_pacing_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Equilíbrio entre partes lentas e rápidas</li>
          <li>Presença de enrolação ou cortes bruscos</li>
          <li>Progressão da história</li>
        </ul>
        <p>👉 Flui bem ou cansa em algum ponto?</p>
      </div>
    ),
  },
  {
    name: "post_art_visual_score",
    label: POST_READING_WEIGHT_LABELS.post_art_visual_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Qualidade do desenho / animação</li>
          <li>Direção de cena / composição</li>
          <li>Consistência ao longo da obra</li>
        </ul>
        <p>👉 Visualmente bem executado ou inconsistente?</p>
      </div>
    ),
  },
  {
    name: "post_impact_immersion_score",
    label: POST_READING_WEIGHT_LABELS.post_impact_immersion_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Envolvimento emocional</li>
          <li>Capacidade de prender atenção</li>
          <li>Momentos memoráveis</li>
        </ul>
        <p>👉 Te puxou pra dentro da história de verdade?</p>
      </div>
    ),
  },
  {
    name: "post_originality_score",
    label: POST_READING_WEIGHT_LABELS.post_originality_score,
    help: (
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-4">
          <li>Ideia central diferente ou bem executada</li>
          <li>Uso de clichês (preguiçoso vs inteligente)</li>
          <li>Identidade própria</li>
        </ul>
        <p>👉 Tem personalidade ou é mais do mesmo?</p>
      </div>
    ),
  },
] as const

const POST_READING_STAR_LEGEND = [
  { stars: "★", value: "2", label: "Fraco / prejudica a obra" },
  { stars: "★★", value: "4", label: "Mediano baixo / aceitável" },
  { stars: "★★★", value: "6,5", label: "Bom / cumpre bem" },
  { stars: "★★★★", value: "8", label: "Muito bom / acima da média" },
  { stars: "★★★★★", value: "10", label: "Excelente / ponto forte da obra" },
]

type SectionKey = "new" | "basic" | "external" | "criteria" | "status" | "categorization"
type AiMetaSnapshot = {
  inputHash: string
  modelName: string
  promptVersion: string
  confidence: number | null
  summary?: string | null
  noReviewsReason?: "no_external_ids" | "all_rejected" | "search_miss" | "sources_returned_empty" | null
}

// Mesmo limiar usado no AiEvaluationReviewForm (Path A) pra "Aceitar todos".
// Desacoplado do `formula_config.low_confidence_threshold` (que filtra a fila).
const CREATE_FLOW_CONFIRM_THRESHOLD = 0.7

const NO_REVIEWS_REASON_LABEL: Record<NonNullable<AiMetaSnapshot["noReviewsReason"]> & string, string> = {
  no_external_ids: "obra ainda não foi linkada a fontes externas",
  all_rejected: "todas as fontes desta obra foram rejeitadas",
  search_miss: "busca por título não encontrou candidato confiável nas fontes",
  sources_returned_empty: "fontes linkadas existem, mas não devolveram reviews",
}
type ExternalReviewsSnapshot = NonNullable<ExternalWorkData["externalReviews"]>
type BatchDraft = {
  localId: string
  values: WorkFormValues
  aiMeta?: AiMetaSnapshot | null
  externalReviews?: ExternalReviewsSnapshot | null
}
type CriteriaJustifications = Partial<Record<import("@/types/domain").CriterionSlug, string>>
type DuplicateResolutionMode = "create" | "addMore"
type DuplicateChoice = "existing" | "incoming"
type DuplicateResolutionState = {
  mode: DuplicateResolutionMode
  existing: DuplicateWorkForForm
  incoming: WorkFormValues
  choices: Partial<Record<DuplicateFieldName, DuplicateChoice>>
}

const BATCH_DRAFTS_STORAGE_KEY = "animedb:new-title-batch-drafts"

function readBatchDrafts(): BatchDraft[] {
  if (typeof window === "undefined") return []
  try {
    const stored = window.localStorage.getItem(BATCH_DRAFTS_STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as BatchDraft[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function readPostReadingWeights(): Record<PostReadingScoreField, number> {
  if (typeof window === "undefined") return { ...DEFAULT_POST_READING_WEIGHTS }
  const stored = window.localStorage.getItem(POST_READING_WEIGHT_STORAGE_KEY)
  if (!stored) return { ...DEFAULT_POST_READING_WEIGHTS }

  try {
    const parsed = JSON.parse(stored) as Partial<Record<PostReadingScoreField, number>>
    return {
      ...DEFAULT_POST_READING_WEIGHTS,
      ...Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value))
      ),
    }
  } catch {
    return { ...DEFAULT_POST_READING_WEIGHTS }
  }
}

const DUPLICATE_FIELD_CONFIGS = [
  { name: "title", label: "Título" },
  { name: "original_title", label: "Título original" },
  { name: "synopsis", label: "Sinopse" },
  { name: "synopses", label: "Sinopses (todas as fontes)" },
  { name: "genres", label: "Gêneros" },
  { name: "tags", label: "Tags" },
  { name: "cover_url", label: "Capa" },
  { name: "covers", label: "Capas (todas as fontes)" },
  { name: "publication_status", label: "Status de publicação" },
  { name: "year", label: "Ano de início" },
  { name: "year_end", label: "Ano de fim" },
  { name: "total_chapters", label: "Total de capítulos" },
  { name: "personal_status", label: "Status leitura" },
  { name: "chapters_read", label: "Capítulos lidos" },
  { name: "synopsis_quality", label: "Interesse sinopse" },
  { name: "observation_adjustment", label: "Ajuste" },
  { name: "observations", label: "Observações" },
  { name: "mu_rating", label: "MangaUpdates - nota" },
  { name: "mu_votes", label: "MangaUpdates - votos" },
  { name: "ap_rating", label: "AnimePlanet - nota" },
  { name: "ap_votes", label: "AnimePlanet - votos" },
  { name: "cmx_rating", label: "ComicK - nota" },
  { name: "cmx_votes", label: "ComicK - votos" },
  { name: "extra_platform_ratings", label: "Outras fontes" },
] as const satisfies ReadonlyArray<{ name: keyof WorkFormValues; label: string }>

type DuplicateFieldName = (typeof DUPLICATE_FIELD_CONFIGS)[number]["name"]

const DEFAULT_OPEN_SECTIONS: Record<SectionKey, boolean> = {
  new: true,
  basic: true,
  external: true,
  criteria: true,
  status: true,
  categorization: true,
}

const optionalNumber = (value: unknown) => {
  if (value === "" || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const numberOrZero = (value: unknown) => {
  const parsed = optionalNumber(value)
  return parsed ?? 0
}

const normalizeSourceName = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")

const getBuiltInSourceKey = (name: string) => {
  const normalized = normalizeSourceName(name)
  if (normalized === "mangaupdates") return "mu"
  if (normalized === "comick" || normalized === "comickio") return "cmx"
  if (normalized === "animeplanet") return "ap"
  return null
}

const formatYearRange = (start: unknown, end: unknown, isComplete: boolean) => {
  const startYear = optionalNumber(start)
  const endYear = optionalNumber(end)
  if (!isComplete) return startYear == null ? "" : String(startYear)
  if (startYear == null && endYear == null) return ""
  if (startYear != null && endYear != null) return `${startYear} - ${endYear}`
  return String(startYear ?? endYear ?? "")
}

const parseYearRange = (value: string) => {
  const years = value.match(/\b(19\d{2}|20\d{2}|2100)\b/g)?.map(Number) ?? []
  return {
    start: years[0] ?? null,
    end: years[1] ?? null,
  }
}

const normalizeComparableValue = (value: unknown): unknown => {
  if (value === undefined || value === "") return null
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim()
        if (item && typeof item === "object") return normalizeComparableObject(item as Record<string, unknown>)
        return item
      })
      .filter((item) => item !== "")
  }
  if (value && typeof value === "object") return normalizeComparableObject(value as Record<string, unknown>)
  return value
}

const normalizeComparableObject = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, normalizeComparableValue(item)] as const)
      .filter(([, item]) => item !== null)
      .sort(([a], [b]) => a.localeCompare(b))
  )

const valuesAreEqual = (a: unknown, b: unknown) =>
  JSON.stringify(normalizeComparableValue(a)) === JSON.stringify(normalizeComparableValue(b))

const hasComparableValue = (value: unknown) => {
  const normalized = normalizeComparableValue(value)
  if (normalized == null) return false
  if (Array.isArray(normalized)) return normalized.length > 0
  if (typeof normalized === "object") return Object.keys(normalized).length > 0
  return true
}

const formatDuplicateValue = (value: unknown): string => {
  const normalized = normalizeComparableValue(value)
  if (normalized == null) return "—"
  if (Array.isArray(normalized)) {
    if (normalized.length === 0) return "—"
    return normalized
      .map((item) => {
        if (typeof item === "object" && item != null) {
          const record = item as Record<string, unknown>
          if (record.text != null && record.source != null) {
            const text = String(record.text)
            const snippet = text.length > 80 ? `${text.slice(0, 80)}…` : text
            return `[${record.source}] ${snippet}`
          }
          if (record.url != null && record.source != null) {
            return `[${record.source}] ${record.url}`
          }
          return [record.platform, record.rating, record.votes].filter((part) => part != null && part !== "").join(" · ")
        }
        return String(item)
      })
      .join("\n")
  }
  if (typeof normalized === "object") return JSON.stringify(normalized)
  return String(normalized)
}

const getDifferentDuplicateFields = (existing: WorkFormValues, incoming: WorkFormValues) =>
  DUPLICATE_FIELD_CONFIGS.filter((field) => !valuesAreEqual(existing[field.name], incoming[field.name]))

const buildDuplicateChoices = (existing: WorkFormValues, incoming: WorkFormValues) => {
  const choices: Partial<Record<DuplicateFieldName, DuplicateChoice>> = {}
  for (const field of getDifferentDuplicateFields(existing, incoming)) {
    choices[field.name] = !hasComparableValue(existing[field.name]) && hasComparableValue(incoming[field.name])
      ? "incoming"
      : "existing"
  }
  return choices
}

const createLocalId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const getEmptyCreateValues = (): Partial<WorkFormValues> => ({
  title: "",
  original_title: "",
  alternative_titles: [],
  synopsis: "",
  genres: [],
  tags: [],
  year: null,
  year_end: null,
  publication_status: "Unknown",
  personal_status: "Untracked",
  total_chapters: null,
  chapters_read: null,
  synopsis_quality: null,
  observation_adjustment: 0,
  user_score: null,
  post_story_score: null,
  post_fl_score: null,
  post_ml_score: null,
  post_character_development_score: null,
  post_pacing_score: null,
  post_art_visual_score: null,
  post_impact_immersion_score: null,
  post_originality_score: null,
  observations: "",
  cover_url: "",
  ai_eval_status: "pending",
  ai_justifications: {},
  romance: null,
  couple_dynamics: null,
  fantasy_nobility: null,
  action_adventure: null,
  adult_content: null,
  protagonist: null,
  humor: null,
  drama: null,
  tragedy: null,
  mu_rating: null,
  mu_votes: null,
  ap_rating: null,
  ap_votes: null,
  cmx_rating: null,
  cmx_votes: null,
  extra_platform_ratings: [],
  covers: [],
  synopses: [],
})

const normalizePostReadingScoresInValues = (values: WorkFormValues): WorkFormValues => {
  const next = { ...values }
  for (const field of POST_READING_SCORE_FIELDS) {
    const normalized = normalizePostReadingScore(next[field.name])
    next[field.name] = normalized
  }
  if (typeof next.synopsis === "string") {
    const parts = splitSynopsesFromText(next.synopsis)
    const previousSynopses = next.synopses ?? []
    next.synopses = dedupeSynopsisEntries(parts.map((text, index) => ({
      source: previousSynopses.find((s) => s.text?.trim() === text)?.source ?? "manual",
      text,
      isPrimary: previousSynopses.find((s) => s.text?.trim() === text)?.isPrimary ?? index === 0,
    })))
    next.synopsis = joinSynopsisBlocks(next.synopses.map((s) => s.text))
  }
  return next
}

const scrollToTop = () => {
  document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" })
  window.scrollTo({ top: 0, behavior: "smooth" })
}

export function WorkForm({ workId, workSlug, initialValues, aiEvaluation, aiEvalOnCreate = false, reviewsSlot, existingExternalIds }: WorkFormProps) {
  const router = useRouter()
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  const isCreating = !workId

  // Em edição, sempre mostra as notas. Na criação, só mostra se a avaliação IA
  // na criação estiver ligada (senão as notas nem são geradas nessa etapa).
  const showCriteriaSection = !isCreating || aiEvalOnCreate

  const defaultValues: Partial<WorkFormValues> = {
    ...getEmptyCreateValues(),
    ...initialValues,
  }

  const {
    register,
    handleSubmit,
    setValue,
    control,
    getValues,
    reset,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<WorkFormInput, unknown, WorkFormValues>({
    resolver: zodResolver(workFormSchema),
    defaultValues,
  })
  const externalSearchButtonRef = useRef<HTMLButtonElement>(null)

  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchDrafts, setBatchDrafts] = useState<BatchDraft[]>([])
  // Sincroniza com localStorage (sistema externo) no mount; SSR seguro porque
  // readBatchDrafts retorna [] quando window é undefined.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isCreating) setBatchDrafts(readBatchDrafts())
  }, [isCreating])
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null)
  // Metadata da IA usada na busca externa (Path B). Não vai pro Zod schema
  // — passa por canal paralelo no createWork pra preencher ai_evaluations.input_hash.
  const [aiMeta, setAiMeta] = useState<AiMetaSnapshot | null>(null)
  // Pool de reviews coletado durante "Buscar dados". Mantido em state pra
  // persistir após createWork criar a obra (workId só existe pós-save).
  const [pendingExternalReviews, setPendingExternalReviews] = useState<ExternalReviewsSnapshot | null>(null)
  // Submit pendente quando a IA reportou confiança baixa — espera confirmação.
  const [pendingLowConfidenceSubmit, setPendingLowConfidenceSubmit] = useState<
    null | { kind: "create" | "create-and-add"; values: WorkFormValues }
  >(null)
  const [reevaluatingOpus, setReevaluatingOpus] = useState(false)
  const [criteriaJustifications, setCriteriaJustifications] = useState<CriteriaJustifications>(() => {
    if (!aiEvaluation?.scores?.length) return {}
    const map: CriteriaJustifications = {}
    for (const score of aiEvaluation.scores) {
      if (score.justification) {
        map[score.criterion_slug as keyof CriteriaJustifications] = score.justification
      }
    }
    return map
  })
  const [topFeedback, setTopFeedback] = useState<string | null>(null)
  const [duplicateResolution, setDuplicateResolution] = useState<DuplicateResolutionState | null>(null)
  const [canonicalPreview, setCanonicalPreview] = useState<string | null>(null)
  const [canonicalLoading, setCanonicalLoading] = useState(false)
  const [canonicalError, setCanonicalError] = useState<string | null>(null)
  // Token monotônico que invalida respostas de gerações canceladas/superadas.
  const canonicalRunIdRef = useRef(0)

  const generateCanonicalPreview = useCallback(async (blocks: string[]) => {
    const cleaned = blocks.map((b) => b.trim()).filter((b) => b.length > 0)
    if (cleaned.length === 0) {
      setCanonicalPreview(null)
      setCanonicalError(null)
      setCanonicalLoading(false)
      return
    }
    const runId = ++canonicalRunIdRef.current
    setCanonicalLoading(true)
    setCanonicalError(null)
    try {
      const result = await previewCanonicalSynopsis(cleaned)
      if (runId !== canonicalRunIdRef.current) return
      if (result.canonical) {
        setCanonicalPreview(result.canonical)
        setCanonicalError(null)
      } else {
        setCanonicalError(result.error ?? "Falha ao consolidar.")
      }
    } catch (err) {
      if (runId !== canonicalRunIdRef.current) return
      setCanonicalError(err instanceof Error ? err.message : "Falha ao consolidar.")
    } finally {
      if (runId === canonicalRunIdRef.current) setCanonicalLoading(false)
    }
  }, [])

  const regenerateCanonicalFromForm = useCallback(() => {
    const current = getValues("synopses") ?? []
    const blocks = current.map((s) => s.text).filter((t): t is string => Boolean(t?.trim()))
    if (blocks.length === 0) {
      const raw = (getValues("synopsis") ?? "").trim()
      if (raw) blocks.push(raw)
    }
    void generateCanonicalPreview(blocks)
  }, [generateCanonicalPreview, getValues])

  const {
    fields: extraPlatformFields,
  } = useFieldArray({
    control,
    name: "extra_platform_ratings",
  })

  const pubStatus = useWatch({ control, name: "publication_status" })
  const personalStatus = useWatch({ control, name: "personal_status" })
  const coverUrl = useWatch({ control, name: "cover_url" })
  const covers = useWatch({ control, name: "covers" }) ?? []
  const userScore = useWatch({ control, name: "user_score" })
  const titleValue = useWatch({ control, name: "title" })
  const yearValue = useWatch({ control, name: "year" })
  const yearEndValue = useWatch({ control, name: "year_end" })
  const totalChapters = useWatch({ control, name: "total_chapters" })
  const chaptersReadValue = useWatch({ control, name: "chapters_read" })
  const alternativeTitlesValue = useWatch({ control, name: "alternative_titles" })
  const genresValue = useWatch({ control, name: "genres" })
  const tagsValue = useWatch({ control, name: "tags" })
  const synopsisQualityValue = useWatch({ control, name: "synopsis_quality" })
  const [coverPreviewFailedUrl, setCoverPreviewFailedUrl] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN_SECTIONS)
  const [activeTab, setActiveTab] = useState<EditTab>("geral")
  // Fontes externas reveladas manualmente via "+" mesmo estando vazias. Por
  // padrão só mostramos as preenchidas, pra não poluir o form com ~10 linhas
  // vazias (#8). Chaves = nome normalizado da fonte.
  const [revealedSources, setRevealedSources] = useState<Set<string>>(new Set())
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [genreSuggestions, setGenreSuggestions] = useState<string[]>(GENRE_NAMES)
  const [postReadingWeights] = useState<Record<PostReadingScoreField, number>>(readPostReadingWeights)
  const coverPreviewSrc = getCoverImageSrc(coverUrl)
  const coverPreviewFailed = coverPreviewFailedUrl === coverPreviewSrc
  const hasProgress = READING_STATUSES_WITH_PROGRESS.has(personalStatus ?? "")
  const postReadingScores = useWatch({
    control,
    name: POST_READING_SCORE_FIELDS.map((field) => field.name),
  })
  const extraPlatformValues = useWatch({
    control,
    name: "extra_platform_ratings",
  }) ?? []
  // Valores das 3 fontes built-in (mu/cmx/ap) — pra saber quais estão preenchidas
  // e decidir a visibilidade da linha (#8). Ordem: rating/votes intercalados.
  const builtInRatingValues = useWatch({
    control,
    name: ["mu_rating", "mu_votes", "cmx_rating", "cmx_votes", "ap_rating", "ap_votes"],
  })

  const filterKnownGenres = useCallback((values: string[]) => {
    const byKey = new Map(genreSuggestions.map((genre) => [normalizeSourceName(genre), genre]))
    const seen = new Set<string>()
    return (values ?? []).flatMap((value) => {
      const genre = byKey.get(normalizeSourceName(value))
      if (!genre) return []
      const key = normalizeSourceName(genre)
      if (seen.has(key)) return []
      seen.add(key)
      return [genre]
    })
  }, [genreSuggestions])

  const buildFixedExtraPlatformRatings = useCallback((
    baseValues: WorkFormValues["extra_platform_ratings"] = []
  ) => {
    const availableSources = SOURCE_OPTIONS
    const fixedExtraSources = availableSources.filter((source) => !getBuiltInSourceKey(source.name))
    const currentByName = new Map(
      (baseValues ?? [])
        .filter((item) => item?.platform)
        .map((item) => [normalizeSourceName(item.platform), item])
    )
    const fixedNames = new Set(fixedExtraSources.map((source) => normalizeSourceName(source.name)))
    return [
      ...fixedExtraSources.map((source) => {
        const existing = currentByName.get(normalizeSourceName(source.name))
        return existing ?? { platform: source.name, rating: null, votes: null }
      }),
      ...(baseValues ?? []).filter((item) =>
        item?.platform && !fixedNames.has(normalizeSourceName(item.platform))
      ),
    ]
  }, [])

  // —— Visibilidade das fontes externas (#8) ——
  // Uma linha de fonte aparece se está preenchida (rating ou votos) OU foi
  // revelada manualmente pelo "+". As demais ficam ocultas e disponíveis no
  // picker. As linhas vazias seguem semeadas no form (valor null não persiste);
  // ocultá-las é puramente visual.
  const builtInSourceFilled = (key: string): boolean => {
    const [muR, muV, cmxR, cmxV, apR, apV] = builtInRatingValues
    if (key === "mu") return muR != null || muV != null
    if (key === "cmx") return cmxR != null || cmxV != null
    if (key === "ap") return apR != null || apV != null
    return false
  }
  const isExternalSourceVisible = (name: string): boolean => {
    const norm = normalizeSourceName(name)
    if (revealedSources.has(norm)) return true
    const builtInKey = getBuiltInSourceKey(name)
    if (builtInKey) return builtInSourceFilled(builtInKey)
    const item = (extraPlatformValues ?? []).find(
      (i) => normalizeSourceName(i?.platform ?? "") === norm
    )
    return Boolean(item && (item.rating != null || item.votes != null))
  }
  const hiddenExternalSources = SOURCE_OPTIONS.filter((s) => !isExternalSourceVisible(s.name))
  const revealExternalSource = (name: string) => {
    setRevealedSources((prev) => new Set(prev).add(normalizeSourceName(name)))
    setSourcePickerOpen(false)
  }

  const clearFormState = () => {
    setCriteriaJustifications({})
    setCoverPreviewFailedUrl(null)
    setAiMeta(null)
    setPendingExternalReviews(null)
    // Form novo/resetado: volta a mostrar só as preenchidas.
    setRevealedSources(new Set())
  }

  const resetForNewEntry = () => {
    reset({
      ...getEmptyCreateValues(),
      extra_platform_ratings: buildFixedExtraPlatformRatings([]),
    })
    clearFormState()
  }

  useEffect(() => {
    if (GENRE_NAMES.length > 0) return
    listGenreCatalog().then((items) => {
      if (items.length > 0) setGenreSuggestions(items.map((i) => i.name))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (genreSuggestions.length === 0) return
    const filtered = filterKnownGenres(genresValue ?? [])
    if (JSON.stringify(filtered) !== JSON.stringify(genresValue ?? [])) {
      setValue("genres", filtered, { shouldDirty: false, shouldValidate: true })
    }
  }, [filterKnownGenres, genreSuggestions.length, genresValue, setValue])

  useEffect(() => {
    const current = getValues("extra_platform_ratings") ?? []
    const next = buildFixedExtraPlatformRatings(current)

    if (JSON.stringify(current) !== JSON.stringify(next)) {
      setValue("extra_platform_ratings", next, { shouldDirty: false, shouldValidate: false })
    }
  }, [buildFixedExtraPlatformRatings, getValues, setValue])

  // Auto-preencher chapters_read = total_chapters quando status muda para Completed.
  useEffect(() => {
    if (!isFullyReadPersonalStatus(personalStatus)) return
    if (typeof totalChapters !== "number" || totalChapters <= 0) return
    const current = getValues("chapters_read")
    if (current != null && current >= totalChapters) return
    setValue("chapters_read", totalChapters, { shouldDirty: true, shouldValidate: true })
  }, [personalStatus, totalChapters, getValues, setValue])

  useEffect(() => {
    const weightedScores = postReadingScores.reduce(
      (acc, score, index) => {
        const normalizedScore = normalizePostReadingScore(score)
        if (normalizedScore == null) return acc
        const weight = postReadingWeights[POST_READING_SCORE_FIELDS[index].name]
        return {
          scoreSum: acc.scoreSum + normalizedScore * weight,
          totalWeight: acc.totalWeight + weight,
        }
      },
      { scoreSum: 0, totalWeight: 0 }
    )
    const totalWeight = weightedScores.totalWeight
    const calculatedScore = totalWeight > 0
      ? Math.round((weightedScores.scoreSum / totalWeight) * 10) / 10
      : null

    if (calculatedScore === userScore) return
    if (calculatedScore == null && initialValues?.user_score != null) return

    setValue(
      "user_score",
      calculatedScore,
      { shouldValidate: true }
    )
  }, [initialValues?.user_score, userScore, postReadingScores, postReadingWeights, setValue])

  const checkDuplicateBeforeCreate = async (
    values: WorkFormValues,
    mode: DuplicateResolutionMode
  ) => {
    if (workId) return false
    const duplicate = await findDuplicateWorkByTitle(
      values.title,
      [values.original_title ?? "", ...(values.alternative_titles ?? [])].filter(Boolean)
    )
    if (!duplicate) return false

    setTopFeedback(null)
    setDuplicateResolution({
      mode,
      existing: duplicate,
      incoming: values,
      choices: buildDuplicateChoices(duplicate.values, values),
    })
    return true
  }

  const handleDuplicateChoiceChange = (field: DuplicateFieldName, choice: DuplicateChoice) => {
    setDuplicateResolution((current) => current
      ? {
          ...current,
          choices: {
            ...current.choices,
            [field]: choice,
          },
        }
      : current
    )
  }

  const handleResolveDuplicate = async () => {
    if (!duplicateResolution) return

    scrollToTop()
    setTopFeedback("Atualizando obra existente...")
    const mergedValues: WorkFormValues = {
      ...duplicateResolution.existing.values,
    }

    for (const field of getDifferentDuplicateFields(
      duplicateResolution.existing.values,
      duplicateResolution.incoming
    )) {
      if ((duplicateResolution.choices[field.name] ?? "existing") === "incoming") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(mergedValues as any)[field.name] = duplicateResolution.incoming[field.name]
      }
    }

    mergedValues.external_ids = {
      ...(duplicateResolution.existing.values.external_ids ?? {}),
      ...(duplicateResolution.incoming.external_ids ?? {}),
    }
    mergedValues.ai_justifications = {}

    const result = await updateWork(duplicateResolution.existing.id, mergedValues)
    setTopFeedback(null)

    if (result.error) {
      const firstError = Object.values(result.error as Record<string, string[]>).flat()[0]
      toast.error(firstError ?? "Erro ao atualizar obra existente")
      return
    }

    const mode = duplicateResolution.mode
    const title = duplicateResolution.existing.title
    setDuplicateResolution(null)
    toast.success(`"${title}" atualizada com os dados escolhidos.`)

    if (mode === "addMore") {
      setEditingDraftId(null)
      resetForNewEntry()
      setTimeout(() => {
        const titleField = document.getElementById("title") as HTMLInputElement | null
        titleField?.focus()
      }, 0)
      return
    }

    const finalTitle = mergedValues.title || title
    router.push(`/titles/${finalTitle ? titleToSlug(finalTitle) : (result.data?.id ?? duplicateResolution.existing.id)}`)
  }

  const handleExternalSelect = (data: ExternalWorkData) => {
    if (data.title) setValue("title", data.title)
    if (data.originalTitle) setValue("original_title", data.originalTitle)
    if (data.alternativeTitles?.length) setValue("alternative_titles", data.alternativeTitles)
    if (data.coverUrl) setValue("cover_url", data.coverUrl)
    if (data.multiCovers?.length) {
      const primaryUrl = data.coverUrl
      setValue("covers", data.multiCovers.map((c) => ({
        url: c.url,
        source: c.source,
        isPrimary: c.url === primaryUrl,
      })))
    }
    let synopsisBlocksForCanonical: string[] = []
    if (data.multiSynopses?.length) {
      const synopses = dedupeSynopsisEntries(data.multiSynopses.map((s, index) => ({
        source: s.source,
        text: s.text,
        isPrimary: index === 0,
      })))
      setValue("synopses", synopses)
      setValue("synopsis", joinSynopsisBlocks(synopses.map((s) => s.text)))
      synopsisBlocksForCanonical = synopses.map((s) => s.text)
    } else if (data.synopsis) {
      const synopsis = joinSynopsisBlocks([data.synopsis])
      setValue("synopsis", synopsis)
      setValue("synopses", synopsis ? [{ source: "manual", text: synopsis, isPrimary: true }] : [])
      if (synopsis) synopsisBlocksForCanonical = [synopsis]
    }
    if (synopsisBlocksForCanonical.length > 0) {
      void generateCanonicalPreview(synopsisBlocksForCanonical)
    }
    if (data.year) setValue("year", data.year)
    if (data.yearEnd) setValue("year_end", data.yearEnd)
    if (data.publicationStatus) setValue("publication_status", data.publicationStatus)
    if (data.totalChapters) setValue("total_chapters", data.totalChapters)
    if (data.genres?.length) setValue("genres", filterKnownGenres(data.genres), { shouldDirty: true, shouldValidate: true })
    if (data.tags?.length) setValue("tags", data.tags)
    // "0 com 0 votos" significa "ainda sem rating" — não preenche o form pra
    // não confundir com avaliação real.
    const hasRealRating = (rating?: number | null, votes?: number | null) =>
      rating != null && rating > 0 && (votes == null || votes > 0)
    if (hasRealRating(data.muRating, data.muVotes)) setValue("mu_rating", data.muRating!)
    if (data.muVotes != null && data.muVotes > 0) setValue("mu_votes", data.muVotes)
    if (hasRealRating(data.cmxRating, data.cmxVotes)) setValue("cmx_rating", data.cmxRating!)
    if (data.cmxVotes != null && data.cmxVotes > 0) setValue("cmx_votes", data.cmxVotes)
    if (hasRealRating(data.apRating, data.apVotes)) setValue("ap_rating", data.apRating!)
    if (data.apVotes != null && data.apVotes > 0) setValue("ap_votes", data.apVotes)
    if (data.externalPlatformRatings?.length) {
      const current = getValues("extra_platform_ratings") ?? []
      const currentByName = new Map(
        current
          .filter((item) => item?.platform)
          .map((item) => [normalizeSourceName(item.platform), item])
      )
      for (const rating of data.externalPlatformRatings) {
        if (!rating.platform || getBuiltInSourceKey(rating.platform)) continue
        const key = normalizeSourceName(rating.platform)
        currentByName.set(key, {
          platform: rating.platform,
          rating: rating.rating ?? currentByName.get(key)?.rating ?? null,
          votes: rating.votes ?? currentByName.get(key)?.votes ?? null,
        })
      }
      setValue(
        "extra_platform_ratings",
        buildFixedExtraPlatformRatings([...currentByName.values()]),
        { shouldDirty: true, shouldValidate: true }
      )
    }
    if (data.criteriaScores) {
      for (const [slug, score] of Object.entries(data.criteriaScores)) {
        if (score != null) setValue(slug as import("@/types/domain").CriterionSlug, score)
      }
    }
    setCriteriaJustifications(data.criteriaJustifications ?? {})
    setValue("ai_justifications", data.criteriaJustifications ?? {})
    if (data.aiMeta) setAiMeta(data.aiMeta)
    if (data.externalReviews && data.externalReviews.length > 0) {
      setPendingExternalReviews(data.externalReviews)
    }
    if (data.externalIds && Object.keys(data.externalIds).length > 0) {
      const cleaned: Record<string, string> = {}
      for (const [source, id] of Object.entries(data.externalIds)) {
        if (id) cleaned[source] = String(id)
      }
      setValue("external_ids", cleaned, { shouldDirty: true })
    }
    // Pré-preenche Observações com o "Status in Country of Origin" do MU
    // quando a obra está em Hiatus (status enum ou palavra no texto cru). Só
    // toca se o usuário ainda não escreveu nada manualmente.
    const statusText = data.mangaUpdatesStatusText
    if (statusText) {
      const isHiatus =
        data.publicationStatus === "Hiatus" ||
        statusText.toLowerCase().includes("hiatus")
      const currentObs = (getValues("observations") ?? "").trim()
      if (isHiatus && !currentObs) {
        setValue("observations", statusText, { shouldDirty: true })
      }
    }
  }

  const handleExternalDuplicateUpdate = async (match: ExistingWorkMatch, data: ExternalWorkData) => {
    handleExternalSelect(data)
    scrollToTop()
    setTopFeedback("Preparando atualização da obra existente...")

    try {
      const existing = await findDuplicateWorkById(match.id)
      if (!existing) {
        toast.error("Não consegui carregar a obra existente para comparar os dados.")
        return
      }

      const parsed = workFormSchema.safeParse(getValues())
      if (!parsed.success) {
        const firstError = Object.values(parsed.error.flatten().fieldErrors).flat()[0]
        toast.error(firstError ?? "Confira os dados antes de atualizar a obra existente.")
        return
      }

      const incoming = normalizePostReadingScoresInValues(parsed.data)
      setDuplicateResolution({
        mode: "create",
        existing,
        incoming,
        choices: buildDuplicateChoices(existing.values, incoming),
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao preparar atualização da obra existente.")
    } finally {
      setTopFeedback(null)
    }
  }

  const validateEnteredField = (input: HTMLInputElement) => {
    if (input.id === "year_range") {
      void trigger(["year", "year_end"])
      return
    }
    if (!input.name) return
    void trigger(input.name as FieldPath<WorkFormValues>)
  }

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter") return
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.nativeEvent.isComposing) return

    const target = event.target
    if (!(target instanceof HTMLInputElement)) return

    const type = target.type.toLowerCase()
    if (["button", "submit", "reset", "checkbox", "radio", "file", "image", "color", "range"].includes(type)) {
      return
    }

    event.preventDefault()
    validateEnteredField(target)
    target.blur()
  }

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.nativeEvent.isComposing) return

    event.preventDefault()
    event.stopPropagation()
    void trigger("title")
    externalSearchButtonRef.current?.click()
  }

  const isLowConfidenceAiMeta =
    !workId &&
    aiMeta?.confidence != null &&
    aiMeta.confidence < CREATE_FLOW_CONFIRM_THRESHOLD

  const executeCreateSubmit = async (
    values: WorkFormValues,
    submitOpts?: { skipAiEnrichment?: boolean },
  ) => {
    scrollToTop()
    const shouldCheckDuplicate = !workId && Object.keys(values.external_ids ?? {}).length === 0
    setTopFeedback(workId ? "Atualizando obra..." : shouldCheckDuplicate ? "Verificando duplicidade..." : "Criando obra...")
    if (shouldCheckDuplicate && await checkDuplicateBeforeCreate(values, "create")) return

    setTopFeedback(workId ? "Atualizando obra..." : "Criando obra...")
    const result = workId
      ? await updateWork(workId, values)
      : await createWork(values, aiMeta ?? undefined, pendingExternalReviews ?? undefined, {
          skipAiEnrichment: submitOpts?.skipAiEnrichment,
        })

    if (result.error) {
      setTopFeedback(null)
      const firstError = Object.values(result.error as Record<string, string[]>).flat()[0]
      const duplicateError = Object.values(result.error as Record<string, string[]>)
        .flat()
        .some((message) => message?.toLowerCase().includes("já existe"))
      if (!workId && duplicateError && await checkDuplicateBeforeCreate(values, "create")) {
        return
      }
      toast.error(firstError ?? "Erro ao salvar obra")
      return
    }

    toast.success(workId ? "Obra atualizada!" : "Obra criada!")
    // Navegar SEMPRE pelo slug canônico novo (devolvido pela action). Antes, no
    // update, navegava pelo UUID e deixava /titles/{uuid} fazer um redirect()
    // server-side pro slug — mas esse redirect falha numa navegação soft (RSC),
    // mostrando "This page couldn't load"; só funcionava após refresh (hard nav).
    // Ir direto no slug elimina o redirect. getWorkBySlug tem fallback direto no
    // banco, então o cache slug->id desatualizado não causa 404.
    const newSlug = result.data?.slug ?? (values.title ? titleToSlug(values.title) : "")
    const destination = newSlug || result.data?.id || workSlug || workId
    router.push(`/titles/${destination}`)
    // Chrome (badge "Avaliação IA" / footer de recálculo): atualiza pelo barramento,
    // SEM router.refresh(). Chamar router.refresh() logo ANTES do push() cria uma
    // corrida que ENGOLE a navegação — o WorkForm não desmonta e o overlay
    // "Atualizando obra..." (topFeedback, só limpo no erro) fica preso pra sempre.
    // A rota de destino já vem fresca via revalidatePath() na server action; só os
    // chips persistentes do chrome (client) precisam do nudge.
    refreshChrome()
  }

  // Flow 1 do popup de custo: ao CRIAR uma obra com dados externos, o createWork
  // dispara enriquecimento pago em 2º plano (tags + resumo/digest de reviews).
  // Mostra a cascata; Confirmar = salva + enriquece, Cancelar = salva sem IA.
  // Sem dados externos (entrada manual) o enriquecimento é negligível → sem popup.
  const resolveCreateEnrichment = async (values: WorkFormValues): Promise<boolean> => {
    const hasExternal =
      Object.keys(values.external_ids ?? {}).length > 0 || pendingExternalReviews != null
    if (!hasExternal) return false
    const cascade = previewCascade([
      { action: "infer_tags", label: "Inferir tags" },
      { action: "review_summary", label: "Resumo de reviews" },
      { action: "review_digest", label: "Digest de reviews" },
    ])
    const ok = await confirmCost({
      estimate: {
        likelyUsd: cascade.likelyUsd,
        upperBoundUsd: cascade.upperBoundUsd,
        etaSeconds: cascade.etaSeconds,
        background: true,
        scale: 1,
      },
      steps: cascade.steps,
      title: "Salvar e enriquecer com IA?",
      description:
        "Gravar a obra é grátis. Em 2º plano posso enriquecê-la com IA: tags da sinopse + resumo/digest das reviews externas.",
      confirmLabel: "Salvar e enriquecer",
      cancelLabel: "Salvar sem IA",
    })
    // Confirmar → enriquece (skip=false); Cancelar/Esc → salva sem IA (skip=true).
    return !ok
  }

  // Handler do react-hook-form. Quando a IA reportou confiança baixa, segura o
  // submit e mostra o ConfirmDialog antes de prosseguir.
  const onSubmit = async (rawValues: WorkFormValues) => {
    const values = normalizePostReadingScoresInValues(rawValues)
    if (isLowConfidenceAiMeta) {
      setPendingLowConfidenceSubmit({ kind: "create", values })
      return
    }
    const skipAiEnrichment = await resolveCreateEnrichment(values)
    await executeCreateSubmit(values, { skipAiEnrichment })
  }

  const persistDrafts = (drafts: BatchDraft[]) => {
    setBatchDrafts(drafts)
    window.localStorage.setItem(BATCH_DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
  }

  const executeAddMoreSubmit = async (values: WorkFormValues) => {
    scrollToTop()
    const shouldCheckDuplicate = Object.keys(values.external_ids ?? {}).length === 0
    if (shouldCheckDuplicate) {
      setTopFeedback("Verificando duplicidade...")
      if (await checkDuplicateBeforeCreate(values, "addMore")) return
    }
    setTopFeedback(null)

    const draft: BatchDraft = {
      localId: editingDraftId ?? createLocalId(),
      values,
      aiMeta: aiMeta ?? null,
      externalReviews: pendingExternalReviews ?? null,
    }

    const nextDrafts = editingDraftId
      ? batchDrafts.map((item) => item.localId === editingDraftId ? draft : item)
      : [...batchDrafts, draft]

    persistDrafts(nextDrafts)
    setEditingDraftId(null)
    toast.success(`"${values.title}" ${editingDraftId ? "atualizada no lote" : "salva em standby"}.`)
    resetForNewEntry()
    setTimeout(() => {
      const titleField = document.getElementById("title") as HTMLInputElement | null
      titleField?.focus()
    }, 0)
  }

  const onSubmitAddMore = async (rawValues: WorkFormValues) => {
    if (workId) return
    const values = normalizePostReadingScoresInValues(rawValues)
    if (isLowConfidenceAiMeta) {
      setPendingLowConfidenceSubmit({ kind: "create-and-add", values })
      return
    }
    await executeAddMoreSubmit(values)
  }

  const handleConfirmLowConfidenceSubmit = async () => {
    if (!pendingLowConfidenceSubmit) return
    const pending = pendingLowConfidenceSubmit
    setPendingLowConfidenceSubmit(null)
    if (pending.kind === "create") {
      await executeCreateSubmit(pending.values)
    } else {
      await executeAddMoreSubmit(pending.values)
    }
  }

  const handleReevaluateOpus = async () => {
    if (reevaluatingOpus) return
    const values = getValues()
    const title = (values.title ?? "").trim()
    if (!title) {
      toast.error("Preencha o título antes de reavaliar com Opus.")
      return
    }
    setReevaluatingOpus(true)
    try {
      const externalIds = values.external_ids as Record<string, string> | undefined
      const result = await evaluateCandidateForCreate({
        title,
        originalTitle: values.original_title ?? null,
        alternativeTitles: values.alternative_titles ?? null,
        synopsis: values.synopsis ?? null,
        genres: values.genres ?? [],
        tags: values.tags ?? [],
        coverUrl: values.cover_url ?? null,
        externalIds: externalIds as Partial<Record<import("@/lib/external/types").ExternalSourceId, string>>,
        model: "opus",
        // Reavaliação explícita: segue mesmo sem reviews externas.
        proceedWithoutReviews: true,
      })
      if ("needsReviewConfirmation" in result) return
      for (const [slug, score] of Object.entries(result.scores)) {
        if (score != null) setValue(slug as import("@/types/domain").CriterionSlug, score)
      }
      setCriteriaJustifications(result.justifications ?? {})
      setValue("ai_justifications", result.justifications ?? {})
      setAiMeta({
        inputHash: result.inputHash,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
        confidence: result.confidence,
        summary: result.summary,
        noReviewsReason: result.noReviewsReason,
      })
      toast.success("Reavaliação com Opus concluída.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido"
      toast.error(`Reavaliação falhou: ${message}`)
    } finally {
      setReevaluatingOpus(false)
    }
  }

  const handleEditDraft = (draft: BatchDraft) => {
    // Já está editando este mesmo draft — só re-foca, nada a preservar.
    if (editingDraftId === draft.localId) {
      const titleField = document.getElementById("title") as HTMLInputElement | null
      titleField?.focus()
      return
    }

    // Preserva a obra em progresso no form antes de carregar a selecionada, pra
    // não perder o que estava sendo digitado/avaliado. Se já havia um draft em
    // edição, grava as alterações de volta nele; senão, com título preenchido,
    // guarda o que está no form como um novo item em standby.
    const currentValues = getValues() as WorkFormValues
    const currentTitle = (currentValues.title ?? "").trim()
    if (editingDraftId) {
      persistDrafts(
        batchDrafts.map((item) =>
          item.localId === editingDraftId
            ? {
                ...item,
                values: currentValues,
                aiMeta: aiMeta ?? null,
                externalReviews: pendingExternalReviews ?? null,
              }
            : item,
        ),
      )
    } else if (currentTitle) {
      persistDrafts([
        ...batchDrafts,
        {
          localId: createLocalId(),
          values: currentValues,
          aiMeta: aiMeta ?? null,
          externalReviews: pendingExternalReviews ?? null,
        },
      ])
      toast.success(`"${currentTitle}" guardada em standby.`)
    }

    setEditingDraftId(draft.localId)
    reset({
      ...draft.values,
      extra_platform_ratings: buildFixedExtraPlatformRatings(draft.values.extra_platform_ratings),
    })
    setCriteriaJustifications({})
    setAiMeta(draft.aiMeta ?? null)
    setPendingExternalReviews(draft.externalReviews ?? null)
    setTimeout(() => {
      const titleField = document.getElementById("title") as HTMLInputElement | null
      titleField?.focus()
    }, 0)
  }

  const handleRemoveDraft = (localId: string) => {
    const nextDrafts = batchDrafts.filter((draft) => draft.localId !== localId)
    persistDrafts(nextDrafts)
    if (editingDraftId === localId) {
      setEditingDraftId(null)
      resetForNewEntry()
    }
  }

  const handleCreateBatch = async () => {
    if (!isCreating || batchDrafts.length === 0) return
    setBatchSubmitting(true)
    scrollToTop()
    setTopFeedback("Criando lote...")
    try {
      const currentValues = getValues() as WorkFormValues
      const currentTitle = currentValues.title?.trim()
      let itemsToCreate: Array<{
        values: WorkFormValues
        aiMeta?: AiMetaSnapshot
        externalReviews?: ExternalReviewsSnapshot
      }> = batchDrafts.map((draft) => ({
        values: normalizePostReadingScoresInValues(draft.values),
        aiMeta: draft.aiMeta ?? undefined,
        externalReviews: draft.externalReviews ?? undefined,
      }))

      if (currentTitle) {
        const parsedCurrent = workFormSchema.safeParse(currentValues)
        if (!parsedCurrent.success) {
          const firstError = Object.values(parsedCurrent.error.flatten().fieldErrors).flat()[0]
          toast.error(firstError ?? "Confira os dados da obra atual antes de criar o lote")
          setTopFeedback(null)
          return
        }
        const normalizedCurrent = normalizePostReadingScoresInValues(parsedCurrent.data)
        if (Object.keys(normalizedCurrent.external_ids ?? {}).length === 0) {
          setTopFeedback("Verificando duplicidade...")
          if (await checkDuplicateBeforeCreate(normalizedCurrent, "addMore")) return
        }
        setTopFeedback("Criando lote...")
        const currentItem = {
          values: normalizedCurrent,
          aiMeta: aiMeta ?? undefined,
          externalReviews: pendingExternalReviews ?? undefined,
        }
        // Se o form está editando um draft que já está no standby, substitui esse
        // item pelos valores atuais do form — anexar duplicaria a obra (e o lote
        // seria rejeitado por título repetido). Caso contrário (obra nova, ou
        // draft em edição já removido), anexa.
        const editingIndex = editingDraftId
          ? batchDrafts.findIndex((draft) => draft.localId === editingDraftId)
          : -1
        itemsToCreate =
          editingIndex >= 0
            ? itemsToCreate.map((item, idx) => (idx === editingIndex ? currentItem : item))
            : [...itemsToCreate, currentItem]
      }

      const result = await createWorksBatch(itemsToCreate)
      if (result.error) {
        if (result.data?.created?.length) {
          const created = result.data.created
          persistDrafts(batchDrafts.filter((draft) =>
            !created.some((item) => item.title === draft.values.title)
          ))
        }
        const firstError = Object.values(result.error as Record<string, string[]>).flat()[0]
        if (result.data?.created?.length === itemsToCreate.length && result.data.created[0]) {
          persistDrafts([])
          setEditingDraftId(null)
          resetForNewEntry()
          toast.warning(firstError ?? "Obras criadas, mas houve um aviso ao finalizar.")
          refresh()
          const idsParam = result.data.created.map((c) => c.id).join(",")
          router.push(`/titles/batch?ids=${idsParam}`)
          return
        }
        toast.error(firstError ?? "Erro ao criar lote")
        setTopFeedback(null)
        return
      }

      const created = result.data?.created ?? []
      persistDrafts([])
      setEditingDraftId(null)
      resetForNewEntry()
      toast.success(`${created.length} obra${created.length === 1 ? "" : "s"} criada${created.length === 1 ? "" : "s"}. A Nota Prevista é calculada após a Avaliação IA.`)
      refresh()
      if (created[0]) {
        const idsParam = created.map((c) => c.id).join(",")
        router.push(`/titles/batch?ids=${idsParam}`)
      }
    } finally {
      setBatchSubmitting(false)
      setTopFeedback(null)
    }
  }

  const toggleSection = (section: SectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const renderCriterionRubric = (slug: string) => {
    const rubric = CRITERIA_RUBRICS[slug]
    if (!rubric) return CRITERIA_INFO[slug]?.description

    return (
      <div className="space-y-3">
        <p className="font-medium text-foreground">{rubric.title}</p>
        <ul className="list-disc space-y-1 pl-4">
          {rubric.ranges.map((range) => (
            <li key={range}>{range}</li>
          ))}
        </ul>
        {rubric.note && (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">{rubric.note}</p>
        )}
      </div>
    )
  }

  const renderFieldLabel = (htmlFor: string, label: string, help?: React.ReactNode) => (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {help && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Informações sobre ${label}`}
              className="text-muted-foreground/70 transition-colors hover:text-muted-foreground"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-3 text-sm text-muted-foreground" side="top" align="start">
            {help}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )

  const renderSectionHeader = (
    section: SectionKey,
    title: string,
    options?: {
      description?: string
      action?: React.ReactNode
      className?: string
    }
  ) => {
    const isOpen = openSections[section]

    return (
      <CardHeader className={options?.className ?? "gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between"}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => toggleSection(section)}
          className="flex min-w-0 items-start gap-2 text-left"
        >
          <ChevronDown
            className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`}
          />
          <span className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {options?.description && (
              <CardDescription>{options.description}</CardDescription>
            )}
          </span>
        </button>
        {options?.action && isOpen && options.action}
      </CardHeader>
    )
  }

  // Quando a validação falha, pula pra aba do primeiro campo com erro — senão o
  // erro fica escondido numa aba inativa e o submit parece travar sem motivo.
  const handleInvalidSubmit = (formErrors: Record<string, unknown>) => {
    const firstKey = Object.keys(formErrors)[0]
    if (firstKey) setActiveTab(FIELD_TAB_MAP[firstKey] ?? "geral")
  }

  const actionButtons = (
    <div className="flex flex-wrap justify-end gap-3">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          if (workSlug || workId) {
            router.push(`/titles/${workSlug ?? workId}`)
          } else {
            router.back()
          }
        }}
        disabled={isSubmitting || batchSubmitting}
      >
        Cancelar
      </Button>
      {isCreating && (
        <Button
          type="button"
          variant="secondary"
          onClick={handleSubmit(onSubmitAddMore)}
          disabled={isSubmitting || batchSubmitting}
          title="Salva no banco mas adia o recálculo até o fim do lote"
        >
          {batchSubmitting
            ? "Salvando..."
            : editingDraftId
              ? "Atualizar standby"
              : "Salvar e incluir mais"}
        </Button>
      )}
      <Button
        type={isCreating && batchDrafts.length > 0 ? "button" : "submit"}
        disabled={isSubmitting || batchSubmitting}
        onClick={isCreating && batchDrafts.length > 0 ? handleCreateBatch : undefined}
      >
        {isSubmitting || batchSubmitting
          ? "Salvando..."
          : workId
            ? "Atualizar"
            : batchDrafts.length > 0
              ? `Criar ${batchDrafts.length + (titleValue?.trim() ? 1 : 0)} obra${batchDrafts.length + (titleValue?.trim() ? 1 : 0) === 1 ? "" : "s"}`
              : "Criar obra"}
      </Button>
    </div>
  )

  return (
    <form onSubmit={handleSubmit(onSubmit, handleInvalidSubmit)} onKeyDown={handleFormKeyDown} className="space-y-6">
      <ConfirmDialog
        open={pendingLowConfidenceSubmit != null}
        onOpenChange={(open) => {
          if (!open) setPendingLowConfidenceSubmit(null)
        }}
        title="Confiança baixa"
        description={`A IA declarou ${
          aiMeta?.confidence != null ? `${Math.round(aiMeta.confidence * 100)}%` : "?"
        } de confiança, abaixo do limiar de ${Math.round(
          CREATE_FLOW_CONFIRM_THRESHOLD * 100
        )}%. Salvar a obra com essas notas mesmo assim?`}
        confirmText={pendingLowConfidenceSubmit?.kind === "create-and-add" ? "Salvar no lote" : "Criar obra"}
        cancelText="Voltar"
        onConfirm={() => void handleConfirmLowConfidenceSubmit()}
      />

      {actionButtons}
      {topFeedback && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-sm rounded-xl border border-emerald-300 bg-background p-6 text-center shadow-2xl shadow-emerald-950/20">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
            <p className="text-base font-semibold text-foreground">{topFeedback}</p>
            <p className="mt-1 text-sm text-muted-foreground">Pode levar alguns segundos.</p>
          </div>
        </div>
      )}

      <Dialog
        open={duplicateResolution != null}
        onOpenChange={(open) => {
          if (!open) setDuplicateResolution(null)
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Esta obra já existe</DialogTitle>
            <DialogDescription>
              Compare os dados salvos com os novos e escolha o que deve permanecer na obra existente.
            </DialogDescription>
          </DialogHeader>

          {duplicateResolution && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-950">
                Encontramos <span className="font-semibold">{duplicateResolution.existing.title}</span> no banco.
                Ao confirmar, a obra existente será atualizada com os campos escolhidos.
              </div>

              <div className="space-y-3">
                {getDifferentDuplicateFields(duplicateResolution.existing.values, duplicateResolution.incoming).map((field) => {
                  const selected = duplicateResolution.choices[field.name] ?? "existing"
                  const existingValue = formatDuplicateValue(duplicateResolution.existing.values[field.name])
                  const incomingValue = formatDuplicateValue(duplicateResolution.incoming[field.name])

                  return (
                    <div key={field.name} className="rounded-lg border bg-muted/20 p-3">
                      <p className="mb-2 text-sm font-medium">{field.label}</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <button
                          type="button"
                          className={`rounded-md border p-3 text-left text-sm transition-colors ${
                            selected === "existing"
                              ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                              : "bg-background hover:bg-accent/40"
                          }`}
                          onClick={() => handleDuplicateChoiceChange(field.name, "existing")}
                        >
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Salvo
                          </span>
                          <span className="line-clamp-4 whitespace-pre-wrap break-words">{existingValue}</span>
                        </button>
                        <button
                          type="button"
                          className={`rounded-md border p-3 text-left text-sm transition-colors ${
                            selected === "incoming"
                              ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                              : "bg-background hover:bg-accent/40"
                          }`}
                          onClick={() => handleDuplicateChoiceChange(field.name, "incoming")}
                        >
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Novo
                          </span>
                          <span className="line-clamp-4 whitespace-pre-wrap break-words">{incomingValue}</span>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {getDifferentDuplicateFields(duplicateResolution.existing.values, duplicateResolution.incoming).length === 0 && (
                <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Os dados preenchidos são iguais aos dados já salvos.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDuplicateResolution(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleResolveDuplicate}>
              Atualizar obra existente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditTabsShell flat={isCreating} activeTab={activeTab} onTabChange={setActiveTab}>
        <TabPanel flat={isCreating} tab="geral">
      {/* 0. Nova Obra — busca */}
      <Card>
        {renderSectionHeader("new", "Nova obra")}
        {openSections.new && (
          <CardContent className="space-y-2">
            <Label htmlFor="title">Título *</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Input
                  id="title"
                  {...register("title")}
                  onKeyDown={handleTitleKeyDown}
                  placeholder="Nome da obra"
                  className="pr-9"
                />
                {titleValue && (
                  <button
                    type="button"
                    aria-label="Limpar título"
                    onClick={() => setValue("title", "", { shouldDirty: true, shouldValidate: true })}
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <ExternalSearch
                searchButtonRef={externalSearchButtonRef}
                titleQuery={titleValue ?? ""}
                onSelect={handleExternalSelect}
                onDuplicateUpdate={handleExternalDuplicateUpdate}
                evaluateAi={aiEvalOnCreate}
                enableResultCache
                existingExternalIds={existingExternalIds}
              />
            </div>
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
          </CardContent>
        )}
      </Card>

      {isCreating && batchDrafts.length > 0 && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold">
                  {batchDrafts.length} obra{batchDrafts.length === 1 ? "" : "s"} em standby
                </p>
                <p className="text-sm text-muted-foreground">
                  Elas estão salvas neste navegador e só serão enviadas ao banco ao criar o lote.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => {
                  persistDrafts([])
                  setEditingDraftId(null)
                  resetForNewEntry()
                }}
              >
                Limpar lote
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {batchDrafts.map((draft, index) => (
                <div
                  key={draft.localId}
                  className="flex items-center gap-2 rounded-md border bg-muted/40 p-2"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {draft.values.title}
                  </p>
                  {editingDraftId === draft.localId && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                      editando
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Editar obra em standby"
                    onClick={() => handleEditDraft(draft)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Remover obra do lote"
                    onClick={() => handleRemoveDraft(draft.localId)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1. Dados básicos */}
      <Card>
        {renderSectionHeader("basic", "Dados básicos")}
        {openSections.basic && (
          <CardContent className="space-y-6">

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-stretch">
              <div className="flex flex-col gap-5">
                {/* Título original */}
                <div className="space-y-1.5">
                  <Label htmlFor="original_title">Título original</Label>
                  <Input
                    id="original_title"
                    {...register("original_title")}
                    placeholder="Ex: 나 혼자만 레벨업"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Nomes alternativos</Label>
                  <ChipInput
                    value={alternativeTitlesValue ?? []}
                    onChange={(v) => setValue("alternative_titles", v)}
                    placeholder="Ex: título em inglês, romanizado, aliases (Enter para adicionar)"
                  />
                </div>

                {/* Status de publicação + Ano de início/fim + Total de capítulos */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,220px)_minmax(0,160px)_minmax(0,180px)]">
                  <div className="space-y-1.5">
                    <Label>Status de publicação</Label>
                    <Select
                      value={pubStatus}
                      onValueChange={(v) => setValue("publication_status", v as WorkFormValues["publication_status"])}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PUBLICATION_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {PUBLICATION_STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="year_range">
                      {pubStatus === "Completed" ? "Ano de início/fim" : "Ano de início"}
                    </Label>
                    <Input
                      id="year_range"
                      inputMode="numeric"
                      placeholder={pubStatus === "Completed" ? "Ex: 2020 - 2024" : "Ex: 2022"}
                      value={formatYearRange(yearValue, yearEndValue, pubStatus === "Completed")}
                      onChange={(event) => {
                        const { start, end } = parseYearRange(event.target.value)
                        setValue("year", start, { shouldDirty: true, shouldValidate: true })
                        setValue("year_end", pubStatus === "Completed" ? end : null, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }}
                    />
                    {errors.year && (
                      <p className="text-xs text-destructive">{errors.year.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="total_chapters">Total de capítulos</Label>
                    <Input
                      id="total_chapters"
                      type="number"
                      min={0}
                      {...register("total_chapters", { setValueAs: optionalNumber })}
                    />
                  </div>
                </div>

                {/* Sinopse */}
                <div className="flex flex-1 flex-col space-y-1.5">
                  <Label htmlFor="synopsis">Sinopse</Label>
                  <Textarea
                    id="synopsis"
                    {...register("synopsis")}
                    placeholder="Breve descrição da obra..."
                    className="h-full min-h-[200px] flex-1 resize-none"
                  />
                </div>

                {/* Preview da sinopse canônica (consolidada via IA) */}
                {(canonicalPreview || canonicalLoading || canonicalError) && (
                  <div className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Sinopse canônica (preview)
                        </p>
                        <p className="text-[11px] text-muted-foreground/70">
                          Consolidação via IA — será salva ao criar a obra.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={canonicalLoading}
                        onClick={regenerateCanonicalFromForm}
                      >
                        {canonicalLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {canonicalLoading ? "Gerando..." : "Regerar"}
                      </Button>
                    </div>
                    {canonicalError ? (
                      <p className="text-xs text-destructive">{canonicalError}</p>
                    ) : canonicalLoading && !canonicalPreview ? (
                      <p className="text-sm text-muted-foreground">Consolidando sinopses...</p>
                    ) : canonicalPreview ? (
                      <p className="whitespace-pre-line text-sm leading-6 text-foreground/85">
                        {canonicalPreview}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Capa (multi-source manager) */}
              <div className="space-y-3">
                <div className="flex aspect-[3/4] w-full max-w-[320px] items-center justify-center overflow-hidden rounded-lg border bg-muted">
                  {coverUrl && !coverPreviewFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverPreviewSrc}
                      alt="Capa da obra"
                      className="h-full w-full object-cover"
                      onError={() => setCoverPreviewFailedUrl(coverPreviewSrc)}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
                      <ImageIcon className="h-9 w-9 opacity-50" />
                      <p className="text-xs">
                        {coverUrl ? "Imagem indisponível" : "Prévia da capa"}
                      </p>
                    </div>
                  )}
                </div>
                <CoversManager
                  value={covers}
                  onChange={(next) => {
                    setValue("covers", next, { shouldDirty: true })
                    // Keep the legacy single cover_url in sync with the primary,
                    // so list/card views (which still read cover_url) update too.
                    const primary = next.find((c) => c.isPrimary) ?? next[0]
                    setValue("cover_url", primary?.url ?? "", { shouldDirty: true })
                  }}
                />
              </div>
            </div>

          </CardContent>
        )}
      </Card>
        </TabPanel>

        <TabPanel flat={isCreating} tab="status">
      {/* 2. Status */}
      <Card>
        {renderSectionHeader("status", "Status")}
        {openSections.status && (
          <CardContent className="space-y-8">

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium">Informações de antes de iniciar a leitura</h3>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,240px)_minmax(0,180px)]">
                {/* Status leitura */}
                <div className="space-y-1.5">
                  <Label>Status leitura</Label>
                  <Select
                    value={personalStatus}
                    onValueChange={(v) => setValue("personal_status", v as WorkFormValues["personal_status"])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERSONAL_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {PERSONAL_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Interesse sinopse */}
                <div className="space-y-1.5">
                  <Label>Interesse sinopse</Label>
                  <Select
                    value={synopsisQualityValue ?? "none"}
                    onValueChange={(v) =>
                      setValue("synopsis_quality", v === "none" ? null : (v as WorkFormValues["synopsis_quality"]), { shouldValidate: true })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Não avaliada" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não avaliada</SelectItem>
                      {SYNOPSIS_QUALITIES.map((q) => (
                        <SelectItem key={q} value={q}>
                          {q} — {SYNOPSIS_QUALITY_LABELS[q]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Ajuste manual: positivo = bônus, negativo = penalidade */}
                <div className="space-y-1.5">
                  {renderFieldLabel("observation_adjustment", "Ajuste", "negativo = penalidade · positivo = bônus · 0 = neutro · range −0.30 a +0.30")}
                  <Input
                    id="observation_adjustment"
                    type="number"
                    step={0.05}
                    min={-0.30}
                    max={0.30}
                    {...register("observation_adjustment", { setValueAs: numberOrZero })}
                  />
                  {errors.observation_adjustment && (
                    <p className="text-xs text-destructive">{errors.observation_adjustment.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="observations">Observações</Label>
                <Textarea
                  id="observations"
                  {...register("observations")}
                  placeholder="Notas pessoais sobre a obra..."
                  rows={3}
                  className="resize-none"
                />
              </div>
            </div>

            {hasProgress && (
              <div className="space-y-4 border-t pt-6">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="max-w-[260px] space-y-1.5">
                    <Label htmlFor="chapters_read">Capítulos lidos</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="chapters_read"
                        type="number"
                        min={0}
                        {...register("chapters_read", { setValueAs: optionalNumber })}
                      />
                      <span className="text-muted-foreground">/</span>
                      <div className="flex h-9 min-w-16 items-center justify-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                        {typeof totalChapters === "number" && Number.isFinite(totalChapters) ? totalChapters : "?"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>% lido</Label>
                    <div className="flex h-9 min-w-16 items-center justify-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                      {(() => {
                        const pct = readingProgressPercent(chaptersReadValue, totalChapters)
                        return pct != null ? `${pct}%` : "—"
                      })()}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-medium">Critérios de avaliação</h3>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 text-xs sm:w-auto"
                      onClick={() => router.push("/settings")}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Editar pesos
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
                  {POST_READING_STAR_LEGEND.map((item) => (
                    <TooltipProvider key={item.value}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="rounded-md bg-background/80 px-3 py-2 transition-colors hover:bg-background">
                            <span className="block whitespace-nowrap text-amber-500">{item.stars}</span>
                            <p className="mt-1 text-xs leading-snug text-muted-foreground">{item.label}</p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Valor: {item.value}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {POST_READING_SCORE_FIELDS.map((field, index) => {
                    const currentValue = postReadingScores[index]
                    const selectedStars = scoreToPostReadingStars(currentValue)
                    const selectedHint = selectedStars == null
                      ? null
                      : POST_READING_STAR_HINTS[field.name][selectedStars - 1]
                    return (
                      <div key={field.name} className="space-y-1.5">
                        {renderFieldLabel(field.name, field.label, field.help)}
                        <StarRating
                          id={field.name}
                          value={currentValue}
                          valueForStars={starsToPostReadingScore}
                          starsForValue={scoreToPostReadingStars}
                          showValue={false}
                          starDescriptions={POST_READING_STAR_HINTS[field.name]}
                          onChange={(value) =>
                            setValue(field.name as PostReadingScoreField, value, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        />
                        {selectedHint && (
                          <p className="text-xs leading-snug text-muted-foreground whitespace-pre-line">
                            {selectedHint}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="max-w-[280px] space-y-2 rounded-lg border bg-primary/5 p-4">
                  {renderFieldLabel("user_score", "Minha nota", "Calculada pela média ponderada dos 8 critérios de avaliação.")}
                  <Input
                    id="user_score"
                    type="number"
                    step={0.5}
                    min={0}
                    max={10}
                    placeholder="—"
                    readOnly
                    className="bg-background text-base font-semibold"
                    {...register("user_score", {
                      setValueAs: optionalNumber,
                    })}
                  />
                </div>
              </div>
            )}

          </CardContent>
        )}
      </Card>
        </TabPanel>

        <TabPanel flat={isCreating} tab="notas">
      {/* 3. Avaliações externas */}
      <Card>
        {renderSectionHeader("external", "Avaliações externas", {
          description: "Rating 0 - 10",
          action: (
            <Popover open={sourcePickerOpen} onOpenChange={setSourcePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Adicionar fonte externa"
                  title="Adicionar fonte externa"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" side="bottom" align="end">
                {hiddenExternalSources.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    Todas as fontes já estão visíveis.
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {hiddenExternalSources.map((source) => (
                      <button
                        key={source.id}
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => revealExternalSource(source.name)}
                      >
                        {source.name}
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ),
        })}
        {openSections.external && (
          <CardContent className="space-y-4">
            {(() => {
              const availableSources = SOURCE_OPTIONS
              const builtInByKey = new Map(PLATFORM_FIELDS.map((plat) => [plat.key, plat]))
              const sourceNames = new Set(availableSources.map((source) => normalizeSourceName(source.name)))

              const renderBuiltIn = (plat: typeof PLATFORM_FIELDS[number]) => (
                <div
                  key={plat.key}
                  className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_120px_120px_auto] sm:items-end"
                >
                  <div className="space-y-1.5">
                    <Label>Fonte</Label>
                    <Input value={plat.label} readOnly className="bg-background" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={plat.ratingField}>Nota</Label>
                    <Input
                      id={plat.ratingField}
                      type="number"
                      step={0.01}
                      min={0}
                      max={10}
                      placeholder="—"
                      {...register(plat.ratingField, { setValueAs: optionalNumber })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={plat.votesField}>Votos</Label>
                    <Input
                      id={plat.votesField}
                      type="number"
                      min={0}
                      placeholder="0"
                      {...register(plat.votesField, { setValueAs: optionalNumber })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    aria-label={`Remover ${plat.label}`}
                    title={`Remover ${plat.label}`}
                    onClick={() => {
                      setValue(plat.ratingField, null, { shouldDirty: true, shouldValidate: true })
                      setValue(plat.votesField, null, { shouldDirty: true, shouldValidate: true })
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )

              const renderExtra = (index: number, field: { id: string }) => (
                <div
                  key={field.id}
                  className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_120px_120px_auto] sm:items-end"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={`extra_platform_ratings.${index}.platform`}>Fonte</Label>
                    <Select
                      value={extraPlatformValues?.[index]?.platform ?? ""}
                      onValueChange={(value) =>
                        setValue(`extra_platform_ratings.${index}.platform`, value, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      <SelectTrigger id={`extra_platform_ratings.${index}.platform`} className="w-full">
                        <SelectValue placeholder="Selecione a fonte" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSources.map((source) => (
                          <SelectItem key={source.id} value={source.name}>
                            {source.name}
                          </SelectItem>
                        ))}
                        {extraPlatformValues?.[index]?.platform &&
                          !availableSources.some((s) => s.name === extraPlatformValues[index]?.platform) && (
                            <SelectItem value={extraPlatformValues[index]?.platform ?? ""}>
                              {extraPlatformValues[index]?.platform}
                            </SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                    {errors.extra_platform_ratings?.[index]?.platform && (
                      <p className="text-xs text-destructive">
                        {errors.extra_platform_ratings[index]?.platform?.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`extra_platform_ratings.${index}.rating`}>Nota</Label>
                    <Input
                      id={`extra_platform_ratings.${index}.rating`}
                      type="number"
                      step={0.01}
                      min={0}
                      max={10}
                      placeholder="—"
                      {...register(`extra_platform_ratings.${index}.rating`, { setValueAs: optionalNumber })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`extra_platform_ratings.${index}.votes`}>Votos</Label>
                    <Input
                      id={`extra_platform_ratings.${index}.votes`}
                      type="number"
                      min={0}
                      placeholder="0"
                      {...register(`extra_platform_ratings.${index}.votes`, { setValueAs: optionalNumber })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    aria-label="Remover fonte"
                    title="Remover fonte"
                    onClick={() => {
                      setValue(`extra_platform_ratings.${index}.rating`, null, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                      setValue(`extra_platform_ratings.${index}.votes`, null, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )

              return (
                <>
                  {availableSources.map((source) => {
                    if (!isExternalSourceVisible(source.name)) return null
                    const builtInKey = getBuiltInSourceKey(source.name)
                    if (builtInKey) {
                      const builtIn = builtInByKey.get(builtInKey)
                      return builtIn ? renderBuiltIn({ ...builtIn, label: source.name }) : null
                    }

                    const extraIndex = extraPlatformValues.findIndex((item) =>
                      normalizeSourceName(item?.platform ?? "") === normalizeSourceName(source.name)
                    )
                    const field = extraIndex >= 0 ? extraPlatformFields[extraIndex] : null
                    return field ? renderExtra(extraIndex, field) : null
                  })}
                  {extraPlatformFields.map((field, index) => {
                    const platform = extraPlatformValues?.[index]?.platform
                    if (!platform || sourceNames.has(normalizeSourceName(platform))) return null
                    return renderExtra(index, field)
                  })}
                </>
              )
            })()}
          </CardContent>
        )}
      </Card>

      {/* 4. Notas por atributo */}
      {showCriteriaSection && (
      <Card>
        {renderSectionHeader("criteria", "Notas por atributo", {
          description: "Rating 0 - 10",
          action: (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs sm:w-auto"
              onClick={() => router.push("/settings")}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Editar pesos e limites
            </Button>
          ),
        })}
        {openSections.criteria && (
          <CardContent className="space-y-4">
            {aiEvaluation && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Modelo:{" "}
                    <span className="font-medium text-foreground">
                      {aiEvaluation.model_name ?? "—"}
                    </span>
                  </span>
                  <span>
                    Confiança:{" "}
                    <span className="font-medium text-foreground">
                      {aiEvaluation.confidence != null
                        ? `${(aiEvaluation.confidence * 100).toFixed(0)}%`
                        : "—"}
                    </span>
                  </span>
                  <span>
                    Data:{" "}
                    <span className="font-medium text-foreground">
                      {new Date(aiEvaluation.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </span>
                </div>
                {aiEvaluation.summary && (
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                      Resumo da última avaliação IA
                    </p>
                    <p className="text-sm leading-6 text-foreground/80 whitespace-pre-line">
                      {aiEvaluation.summary}
                    </p>
                  </div>
                )}
              </div>
            )}
            {!aiEvaluation && aiMeta && (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-medium uppercase text-muted-foreground">
                    Avaliação IA
                  </span>
                  <span className="text-muted-foreground">
                    Modelo:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {aiMeta.modelName}
                    </span>
                  </span>
                  {aiMeta.confidence != null && (
                    <span
                      className={
                        "rounded-full border px-2 py-0.5 font-medium " +
                        (aiMeta.confidence >= 0.75
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : aiMeta.confidence >= 0.5
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-rose-300 bg-rose-50 text-rose-700")
                      }
                      title="Confiança declarada pela IA: 0 = sem certeza, 1 = alta certeza"
                    >
                      Confiança: {Math.round(aiMeta.confidence * 100)}%
                    </span>
                  )}
                  {aiMeta.noReviewsReason && (
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                      sem reviews externas
                    </span>
                  )}
                </div>
                {aiMeta.summary && (
                  <p className="text-sm leading-6 text-foreground/80 whitespace-pre-line">
                    {aiMeta.summary}
                  </p>
                )}
                {aiMeta.noReviewsReason && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Motivo:</span>{" "}
                    {NO_REVIEWS_REASON_LABEL[aiMeta.noReviewsReason]}.
                  </p>
                )}
                {aiMeta.confidence != null &&
                  aiMeta.confidence < CREATE_FLOW_CONFIRM_THRESHOLD &&
                  aiMeta.modelName !== "claude-opus-4-7" && (
                    <div>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={reevaluatingOpus}
                        onClick={() => void handleReevaluateOpus()}
                        title="Modelo alternativo. A Nota Prevista continua usando calibração do Sonnet."
                      >
                        {reevaluatingOpus ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : null}
                        Reavaliar com Opus 4.7
                      </Button>
                    </div>
                  )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {CRITERION_SLUGS.map((slug) => {
                const info = CRITERIA_INFO[slug]
                return (
                  <div key={slug} className="space-y-1">
                    {renderFieldLabel(slug, `${info.emoji} ${info.name}`, renderCriterionRubric(slug))}
                    <Input
                      id={slug}
                      type="number"
                      step={0.5}
                      min={0}
                      max={10}
                      placeholder="—"
                      {...register(slug, {
                        setValueAs: optionalNumber,
                      })}
                    />
                    {criteriaJustifications[slug] && (
                      <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">IA: </span>
                        {criteriaJustifications[slug]}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        )}
      </Card>
      )}

      {reviewsSlot}
        </TabPanel>

        <TabPanel flat={isCreating} tab="tags">
      {/* 5. Categorização */}
      <Card>
        {renderSectionHeader("categorization", "Categorização")}
        {openSections.categorization && (
          <CardContent className="space-y-6">
            <div className="space-y-1.5">
              <Label>Gêneros</Label>
              <ChipInput
                value={genresValue ?? []}
                onChange={(v) => setValue("genres", filterKnownGenres(v), { shouldDirty: true, shouldValidate: true })}
                suggestions={genreSuggestions}
                restrictToSuggestions
                showSuggestionMenu={false}
                placeholder="Digite um gênero válido..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tags</Label>
              <ChipInput
                value={tagsValue ?? []}
                onChange={(v) => setValue("tags", v, { shouldDirty: true })}
                suggestionGroups={TAG_GROUPS_CATALOG}
                groups={TAG_GROUPS_CATALOG
                  .map((grp) => ({
                    label: grp.label,
                    values: (tagsValue ?? []).filter((t) => grp.values.includes(t)),
                  }))
                  .filter((g) => g.values.length > 0)}
                placeholder="Digite para buscar tag..."
              />
            </div>
          </CardContent>
        )}
      </Card>
        </TabPanel>
      </EditTabsShell>

      <Separator />

      {actionButtons}
    </form>
  )
}
