import { Sparkles } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { pickPrimaryCover } from "@/lib/work-derived"
import { MODEL, PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM, parsePromptVersion } from "@/lib/ai-evaluation/service"
import {
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
} from "@/lib/constants/criteria"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { StaleRerankPanel } from "@/components/ranking/stale-rerank-panel"
import { SynopsisPredictPanel } from "@/components/titles/synopsis-predict-panel"
import { SynopsisAccuracyBar } from "@/components/titles/synopsis-accuracy-bar"
import { getAlignmentQueueWorks, getSynopsisQueueWorks } from "@/server/queries/recommendations"
import type { AlignmentQueueWork, SynopsisQueueWork } from "@/server/queries/recommendations"
import { getSynopsisPredictionAccuracy, getSynopsisVersionComparison } from "@/server/queries/synopsis-quality"
import type { SynopsisPredictionAccuracy, SynopsisVersionComparison } from "@/server/queries/synopsis-quality"
import { getCurrentPlan } from "@/server/queries/current-user"
import { planAllows } from "@/lib/plans/capabilities"

const ALL_FILTERS = ["pending", "review-pending", "low-confidence", "outdated-model"] as const
export type EvaluationFilter = (typeof ALL_FILTERS)[number]

const DEFAULT_FILTERS: EvaluationFilter[] = ["pending", "review-pending"]
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.8

const PUB_STATUS_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.values(PUBLICATION_STATUSES_BY_ID).map((info) => [info.status, info.id])
)
const PERSONAL_STATUS_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info.id])
)

function parseFilters(raw: string | string[] | undefined): EvaluationFilter[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return DEFAULT_FILTERS
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean)
  const valid = parts.filter((p): p is EvaluationFilter =>
    (ALL_FILTERS as readonly string[]).includes(p)
  )
  return valid.length > 0 ? valid : DEFAULT_FILTERS
}

function parseSynopsisQualities(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  const valid = new Set<string>(SYNOPSIS_QUALITIES)
  return value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => valid.has(p))
}

function parseStatusList(
  raw: string | string[] | undefined,
  nameToId: Record<string, number>
): { names: string[]; ids: number[] } {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return { names: [], ids: [] }
  const names = value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p in nameToId)
  const ids = names.map((n) => nameToId[n])
  return { names, ids }
}

interface EligibleWork {
  id: string
  title: string
  publication_status: string
  publication_status_id: number | null
  personal_status: string
  personal_status_id: number | null
  synopsis_quality: string | null
  cover_url?: string | null
  expected_score: number | null
  /** Razões pelas quais a obra apareceu (intersecção com os filtros ativos). */
  matchedFilters: EvaluationFilter[]
  evaluation: {
    confidence: number | null
    modelName: string | null
    promptVersion: string | null
    evaluatedAt: string | null
  } | null
}

/**
 * Roda uma query Supabase em chunks de IDs e concatena. Necessário porque
 * `.in("id", [...500+ uuids])` estoura o limite de URL do PostgREST (~16KB)
 * e a request fica pendurada até dar timeout.
 */
async function chunkedInQuery<T>(
  ids: string[],
  chunkSize: number,
  query: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  if (ids.length === 0) return { data: [], error: null }
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { data, error } = await query(chunk)
    if (error) return { data: out, error }
    if (data) out.push(...data)
  }
  return { data: out, error: null }
}

interface LatestEvalRow {
  work_id: string
  confidence: number | null
  model_name: string | null
  prompt_version: string | null
  updated_at: string | null
  created_at: string | null
}

/**
 * Carrega a última avaliação completed por work_id, fazendo a dedup em JS em
 * vez de via view `latest_ai_evaluation_per_work`. Evita o DISTINCT ON do
 * Postgres que ficava no limite do statement timeout sob carga.
 *
 * Usa o índice `idx_ai_evaluations_status` (status='completed'), retorna todas
 * as linhas ordenadas e mantém só a primeira por work_id.
 */
async function loadLatestEvalsMap(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Map<string, LatestEvalRow>> {
  const { data, error } = await supabase
    .from("ai_evaluations")
    .select("work_id, confidence, model_name, prompt_version, created_at, updated_at")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)

  const latest = new Map<string, LatestEvalRow>()
  for (const row of (data ?? []) as LatestEvalRow[]) {
    if (!latest.has(row.work_id)) latest.set(row.work_id, row)
  }
  return latest
}

async function getEligibleWorks(
  filters: EvaluationFilter[],
  pubStatusIds: number[],
  personalStatusIds: number[],
  synopsisQualities: string[],
  toleranceOverride: number | null
) {
  const supabase = createAdminClient()

  // Carrega tolerância de versão (compartilhada pelo filtro outdated-model
  // e pela UI dos filtros). Default 0 (qualquer divergência conta).
  const { data: configRow } = await supabase
    .from("formula_config")
    .select("prompt_version_tolerance, low_confidence_threshold")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const promptVersionTolerance = toleranceOverride != null
    ? Math.max(0, toleranceOverride)
    : Math.max(0, Number(configRow?.prompt_version_tolerance ?? 0))
  const lowConfidenceThreshold = Math.min(
    1,
    Math.max(0, Number(configRow?.low_confidence_threshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD))
  )

  // Carrega o mapa de últimas avaliações uma vez se algum filtro precisar dele.
  // Bem mais rápido que 3 chamadas separadas à view.
  const needsLatestEvals =
    filters.includes("low-confidence") || filters.includes("outdated-model")
  const latestEvalsPromise = needsLatestEvals ? loadLatestEvalsMap(supabase) : null

  // Os filtros baseados na última avaliação (low-confidence / outdated-model)
  // olham só o registro de avaliação, ignorando o ai_eval_status. Sem isto, uma
  // obra "Pulada" (ai_eval_status="skipped") que tenha uma avaliação antiga de
  // baixa confiança ou modelo desatualizado continuaria reaparecendo na fila.
  // Carregamos o conjunto de obras puladas uma vez pra excluí-las desses filtros.
  const skippedIdsPromise = needsLatestEvals
    ? (async () => {
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_status", "skipped")
        if (error) throw new Error(error.message)
        return new Set((data ?? []).map((w) => w.id))
      })()
    : null

  // Pra cada filtro, descobrimos os work_ids elegíveis e depois unimos.
  // Mais eficiente que um único query com OR complexo (queries simples,
  // índices óbvios). Em paralelo.
  const queries: Promise<{ ids: Set<string>; filter: EvaluationFilter }>[] = []

  if (filters.includes("pending")) {
    queries.push(
      (async () => {
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_status", "pending")
          .eq("is_archived", false)
        if (error) throw new Error(error.message)
        return { filter: "pending" as const, ids: new Set((data ?? []).map((w) => w.id)) }
      })()
    )
  }

  if (filters.includes("review-pending")) {
    queries.push(
      (async () => {
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_status", "review_pending")
          .eq("is_archived", false)
        if (error) throw new Error(error.message)
        return { filter: "review-pending" as const, ids: new Set((data ?? []).map((w) => w.id)) }
      })()
    )
  }

  if (filters.includes("low-confidence")) {
    queries.push(
      (async () => {
        const [latest, skipped] = await Promise.all([latestEvalsPromise!, skippedIdsPromise!])
        const ids = new Set<string>()
        for (const [workId, row] of latest) {
          if (skipped.has(workId)) continue
          if (row.confidence != null && Number(row.confidence) < lowConfidenceThreshold) {
            ids.add(workId)
          }
        }
        return { filter: "low-confidence" as const, ids }
      })()
    )
  }

  if (filters.includes("outdated-model")) {
    queries.push(
      (async () => {
        const [latest, skipped] = await Promise.all([latestEvalsPromise!, skippedIdsPromise!])
        const ids = new Set<string>()
        for (const [workId, row] of latest) {
          if (skipped.has(workId)) continue
          const versionNum = parsePromptVersion(row.prompt_version)
          const modelMismatch = row.model_name !== MODEL
          const promptMismatch =
            versionNum == null ||
            CURRENT_PROMPT_VERSION_NUM - versionNum > promptVersionTolerance
          if (modelMismatch || promptMismatch) ids.add(workId)
        }
        return { filter: "outdated-model" as const, ids }
      })()
    )
  }

  const filterResults = await Promise.all(queries)
  const matchedByWork = new Map<string, EvaluationFilter[]>()
  for (const { filter, ids } of filterResults) {
    for (const id of ids) {
      const existing = matchedByWork.get(id) ?? []
      existing.push(filter)
      matchedByWork.set(id, existing)
    }
  }

  if (matchedByWork.size === 0) {
    return {
      works: [] as EligibleWork[],
      totalCount: 0,
      activeFilters: filters,
      promptVersionTolerance,
      lowConfidenceThreshold,
    }
  }

  const eligibleIds = [...matchedByWork.keys()]

  // Carrega o mapa de últimas evals (uma chamada compartilhada com os filtros
  // outdated/low-confidence acima).
  const latestEvals = await (latestEvalsPromise ?? loadLatestEvalsMap(supabase))

  // Chunk size de 100 IDs por request. PostgREST `?id=in.(...)` codifica cada
  // UUID em ~37 chars; 100 IDs ≈ 3.7KB de URL, confortavelmente abaixo de
  // qualquer limite de proxy/cdn (~16KB). Sem chunk, 500+ IDs ultrapassam o
  // limite e a request fica pendurada.
  const CHUNK_SIZE = 100

  type WorkRow = {
    id: string
    title: string
    publication_status_id: number | null
    personal_status_id: number | null
    synopsis_quality: string | null
    total_chapters: number | null
  }
  const worksResult = await chunkedInQuery<WorkRow>(eligibleIds, CHUNK_SIZE, (chunk) => {
    let q = supabase
      .from("works")
      .select("id, title, publication_status_id, personal_status_id, synopsis_quality, total_chapters")
      .in("id", chunk)
      .eq("is_archived", false)
    if (pubStatusIds.length > 0) q = q.in("publication_status_id", pubStatusIds)
    if (personalStatusIds.length > 0) q = q.in("personal_status_id", personalStatusIds)
    if (synopsisQualities.length > 0) q = q.in("synopsis_quality", synopsisQualities)
    return q.then(({ data, error }) => ({ data: (data ?? []) as WorkRow[], error }))
  })
  if (worksResult.error) throw new Error(String((worksResult.error as { message?: string }).message ?? worksResult.error))

  // Ordena por título em JS e limita aos 500 que serão exibidos.
  const displayedWorks = worksResult.data
    .slice()
    .sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")))
    .slice(0, 500)
  const displayedIds = displayedWorks.map((w) => w.id)

  // Hidrata covers + calculated_scores em chunks também.
  type CoverRow = { work_id: string; url: string | null; is_primary: boolean | null; position: number | null }
  type ScoreRow = { work_id: string; expected_score: number | null }
  const [coversResult, scoresResult] = await Promise.all([
    chunkedInQuery<CoverRow>(displayedIds, CHUNK_SIZE, (chunk) =>
      supabase
        .from("work_covers")
        .select("work_id, url, is_primary, position")
        .in("work_id", chunk)
        .then(({ data, error }) => ({ data: (data ?? []) as CoverRow[], error })),
    ),
    chunkedInQuery<ScoreRow>(displayedIds, CHUNK_SIZE, (chunk) =>
      supabase
        .from("calculated_scores")
        .select("work_id, expected_score")
        .in("work_id", chunk)
        .then(({ data, error }) => ({ data: (data ?? []) as ScoreRow[], error })),
    ),
  ])

  const coversByWork = new Map<string, CoverRow[]>()
  for (const c of coversResult.data) {
    const list = coversByWork.get(c.work_id) ?? []
    list.push(c)
    coversByWork.set(c.work_id, list)
  }
  const scoreByWork = new Map<string, ScoreRow>()
  for (const s of scoresResult.data) {
    scoreByWork.set(s.work_id, s)
  }

  const eligibleIdSet = new Set(eligibleIds)
  const evalByWork = new Map(
    [...latestEvals.entries()]
      .filter(([workId]) => eligibleIdSet.has(workId))
      .map(([workId, e]) => [
        workId,
        {
          confidence: e.confidence == null ? null : Number(e.confidence),
          modelName: e.model_name ?? null,
          promptVersion: e.prompt_version ?? null,
          // updated_at reflete a última mudança da avaliação (substituição, edição
          // de scores, etc.). Fallback pra created_at se updated_at faltar.
          evaluatedAt: e.updated_at ?? e.created_at ?? null,
        },
      ])
  )

  const works: EligibleWork[] = displayedWorks.map((w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = w as any
    return {
      id: row.id,
      title: row.title,
      publication_status: "",
      publication_status_id: row.publication_status_id ?? null,
      personal_status: "",
      personal_status_id: row.personal_status_id ?? null,
      synopsis_quality: row.synopsis_quality ?? null,
      total_chapters: row.total_chapters,
      cover_url: pickPrimaryCover(coversByWork.get(row.id) ?? []),
      expected_score: scoreByWork.get(row.id)?.expected_score ?? null,
      matchedFilters: matchedByWork.get(row.id) ?? [],
      evaluation: evalByWork.get(row.id) ?? null,
    } as EligibleWork
  })

  return {
    works,
    totalCount: works.length,
    activeFilters: filters,
    promptVersionTolerance,
    lowConfidenceThreshold,
  }
}

function EvalTabLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  )
}

/**
 * Aba "IA atributos" — fila de avaliação/revisão das 9 notas por critério.
 * Componente apresentacional: a fila já vem buscada pelo pai (a contagem
 * alimenta o título da aba, então precisa rodar independente da aba ativa).
 */
function IaAttributesTab({
  works,
  activeFilters,
  promptVersionTolerance,
  lowConfidenceThreshold,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
}: {
  works: EligibleWork[]
  activeFilters: EvaluationFilter[]
  promptVersionTolerance: number
  lowConfidenceThreshold: number
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
}) {
  return (
    <div className="space-y-4">
      <AiEvaluationFilters
        activeFilters={activeFilters}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={promptVersionTolerance}
        lowConfidenceThreshold={lowConfidenceThreshold}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
      />
      <AiEvaluationPanel pendingWorks={works} />
    </div>
  )
}

const IA_RK_STATES = ["stale", "unranked"] as const
type IaRkState = (typeof IA_RK_STATES)[number]

function parseIaRkStates(raw: string | string[] | undefined): IaRkState[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value == null) return ["stale"] // default: só "Desatualizado"
  if (value === "none") return []
  const parts = value.split(",").map((p) => p.trim())
  return IA_RK_STATES.filter((s) => parts.includes(s))
}

const SYNOPSIS_STATES = ["stale", "unpredicted", "predicted"] as const
type SynopsisState = (typeof SYNOPSIS_STATES)[number]

function parseSynopsisStates(raw: string | string[] | undefined): SynopsisState[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  // Default da fila de ação: desatualizado + não previsto (sem "predicted").
  if (value == null) return ["stale", "unpredicted"]
  if (value === "none") return []
  const parts = value.split(",").map((p) => p.trim())
  return SYNOPSIS_STATES.filter((s) => parts.includes(s))
}

/**
 * Aba "IA Rk" — fila de re-rank: obras com IA Rk desatualizado E/OU não avaliado
 * (sem IA Rk ainda). Recebe a fila já buscada pelo pai (mesma query do badge, pra
 * o contador da aba bater com a lista). Compartilha os filtros de Status com a aba
 * de atributos; troca "Estado da avaliação" por "Estado do IA Rk". Sort é no painel.
 */
function IaRkTab({
  works,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  states,
}: {
  works: AlignmentQueueWork[]
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  states: IaRkState[]
}) {
  return (
    <div className="space-y-4">
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={DEFAULT_LOW_CONFIDENCE_THRESHOLD}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
        showEvalState={false}
        showIaRkState
        activeIaRkStates={states}
      />
      <StaleRerankPanel works={works} />
    </div>
  )
}

/**
 * Aba "Interesse Sinopse" — fila de obras com sinopse canônica que precisam de
 * estimativa IA (desatualizada ou não prevista). Mesmo formato de cards da aba
 * IA Rk. Compartilha os filtros de Status; só os de estado da avaliação não se
 * aplicam.
 */
function SynopsisTab({
  works,
  accuracy,
  comparison,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  states,
  isPaid,
}: {
  works: SynopsisQueueWork[]
  accuracy: SynopsisPredictionAccuracy
  comparison: SynopsisVersionComparison | null
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  states: SynopsisState[]
  isPaid: boolean
}) {
  return (
    <div className="space-y-4">
      <SynopsisAccuracyBar accuracy={accuracy} comparison={comparison} />
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={DEFAULT_LOW_CONFIDENCE_THRESHOLD}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
        showEvalState={false}
        showSynopsisState
        activeSynopsisStates={states}
      />
      <SynopsisPredictPanel works={works} isPaid={isPaid} />
    </div>
  )
}

function toParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined
  return Array.isArray(v) ? v.join(",") : v
}

export default async function AiEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string | string[]
    pub?: string | string[]
    personal?: string | string[]
    synopsis_q?: string | string[]
    tolerance?: string | string[]
    tab?: string | string[]
    rk?: string | string[]
    sq?: string | string[]
  }>
}) {
  const params = await searchParams
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab
  const activeTab: "atributos" | "ia-rk" | "sinopse" =
    tabRaw === "ia-rk" ? "ia-rk" : tabRaw === "sinopse" ? "sinopse" : "atributos"

  // Filtros de Status + interesse compartilhados pelas 2 abas.
  const { names: pubStatusNames, ids: pubStatusIds } = parseStatusList(params.pub, PUB_STATUS_NAME_TO_ID)
  const { names: personalStatusNames, ids: personalStatusIds } = parseStatusList(
    params.personal,
    PERSONAL_STATUS_NAME_TO_ID,
  )
  const synopsisQualities = parseSynopsisQualities(params.synopsis_q)
  const iaRkStates = parseIaRkStates(params.rk)
  const synopsisStates = parseSynopsisStates(params.sq)

  // Filtros específicos da aba de atributos.
  const activeFilters = parseFilters(params.filter)
  const toleranceRaw = Array.isArray(params.tolerance) ? params.tolerance[0] : params.tolerance
  const toleranceOverride = toleranceRaw != null && /^\d+$/.test(toleranceRaw)
    ? parseInt(toleranceRaw, 10)
    : null

  // Roda as três filas em paralelo. Todas alimentam o contador do título da aba
  // (precisa estar certo mesmo na aba inativa) e o conteúdo. Queries leves
  // (~tamanho da biblioteca).
  const [attrResult, iaRkQueue, synopsisQueue, synopsisAccuracy, synopsisComparison, plan] = await Promise.all([
    getEligibleWorks(activeFilters, pubStatusIds, personalStatusIds, synopsisQualities, toleranceOverride),
    getAlignmentQueueWorks({
      states: iaRkStates,
      pubStatusIds,
      personalStatusIds,
      synopsisQualities,
    }),
    getSynopsisQueueWorks({
      states: synopsisStates,
      pubStatusIds,
      personalStatusIds,
      synopsisQualities,
    }),
    getSynopsisPredictionAccuracy(),
    getSynopsisVersionComparison(),
    getCurrentPlan(),
  ])
  const attrCount = attrResult.works.length
  const iaRkCount = iaRkQueue.length
  const synopsisCount = synopsisQueue.length
  const isPaidPlan = planAllows(plan, "smart_shortlist")

  // Preserva os filtros ao trocar de aba.
  const filter = toParam(params.filter)
  const pub = toParam(params.pub)
  const personal = toParam(params.personal)
  const tolerance = toParam(params.tolerance)
  const synq = toParam(params.synopsis_q)
  const rk = toParam(params.rk)
  const sq = toParam(params.sq)

  const attrParams = new URLSearchParams()
  if (filter) attrParams.set("filter", filter)
  if (pub) attrParams.set("pub", pub)
  if (personal) attrParams.set("personal", personal)
  if (synq) attrParams.set("synopsis_q", synq)
  if (tolerance) attrParams.set("tolerance", tolerance)
  const attrHref = attrParams.toString() ? `/ai-evaluation?${attrParams}` : "/ai-evaluation"

  const rkParams = new URLSearchParams({ tab: "ia-rk" })
  if (pub) rkParams.set("pub", pub)
  if (personal) rkParams.set("personal", personal)
  if (synq) rkParams.set("synopsis_q", synq)
  if (rk) rkParams.set("rk", rk)
  const rkHref = `/ai-evaluation?${rkParams}`

  const synParams = new URLSearchParams({ tab: "sinopse" })
  if (pub) synParams.set("pub", pub)
  if (personal) synParams.set("personal", personal)
  if (synq) synParams.set("synopsis_q", synq)
  if (sq) synParams.set("sq", sq)
  const synHref = `/ai-evaluation?${synParams}`

  return (
    <div className="space-y-4">
      <Header
        kicker="Avaliação"
        title="Avaliação IA"
        description="Fila de avaliação/revisão das notas por IA (atributos) e de re-rank (IA Rk) desatualizado ou não avaliado."
        icon={<Sparkles />}
      />

      <div className="flex items-center gap-1 border-b border-border/60">
        <EvalTabLink href={attrHref} active={activeTab === "atributos"}>
          IA atributos ({attrCount})
        </EvalTabLink>
        <EvalTabLink href={rkHref} active={activeTab === "ia-rk"}>
          IA Rk ({iaRkCount})
        </EvalTabLink>
        <EvalTabLink href={synHref} active={activeTab === "sinopse"}>
          Interesse Sinopse ({synopsisCount})
        </EvalTabLink>
      </div>

      {activeTab === "sinopse" ? (
        <SynopsisTab
          works={synopsisQueue}
          accuracy={synopsisAccuracy}
          comparison={synopsisComparison}
          pubStatusNames={pubStatusNames}
          personalStatusNames={personalStatusNames}
          synopsisQualities={synopsisQualities}
          states={synopsisStates}
          isPaid={isPaidPlan}
        />
      ) : activeTab === "ia-rk" ? (
        <IaRkTab
          works={iaRkQueue}
          pubStatusNames={pubStatusNames}
          personalStatusNames={personalStatusNames}
          synopsisQualities={synopsisQualities}
          states={iaRkStates}
        />
      ) : (
        <IaAttributesTab
          works={attrResult.works}
          activeFilters={activeFilters}
          promptVersionTolerance={attrResult.promptVersionTolerance}
          lowConfidenceThreshold={attrResult.lowConfidenceThreshold}
          pubStatusNames={pubStatusNames}
          personalStatusNames={personalStatusNames}
          synopsisQualities={synopsisQualities}
        />
      )}
    </div>
  )
}
