import { Wrench } from "lucide-react"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { pickPrimaryCover } from "@/lib/work-derived"
import { MODEL, PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM, parsePromptVersion } from "@/lib/ai-evaluation/service"
import {
  PUB_STATUS_NAME_TO_ID,
  PERSONAL_STATUS_NAME_TO_ID,
  parseStatusList,
  parseSynopsisQualities,
  parsePredictionQualities,
  toParam,
} from "@/lib/ai-evaluation/queue-filters"
import { Suspense } from "react"
import { unstable_cache } from "next/cache"
import type { ReactNode } from "react"
import { EvalTabLink } from "@/components/ai-evaluation/eval-tab-link"
import { TagsReviewsTab } from "@/components/ai-evaluation/tags-reviews-tab"
import type { TagsReviewsWork } from "@/components/ai-evaluation/tags-reviews-tab"
import { getWorksWithoutReviews } from "@/server/queries/works-without-reviews"
import { getWorksWithoutTags } from "@/server/queries/works-without-tags"
import { getWorkTagReviewCounts } from "@/server/queries/work-card-meta"
import { fetchAdultScoreFlags } from "@/server/queries/adult-score-flags"
import { getReadAckSets, getEvalReadSummary } from "@/server/queries/ai-eval-read"
import type { ReadQueue } from "@/server/queries/ai-eval-read"
import { filterWorkIdsByInterest } from "@/server/queries/interest-filter"
import { MarkReadButton } from "@/components/ai-evaluation/mark-read-button"
import { AiEvalSettingsDialog } from "@/components/ai-evaluation/ai-eval-settings-dialog"
import type { FormulaConfig } from "@/types/domain"

const ALL_FILTERS = ["pending", "review-pending", "low-confidence", "outdated-model", "outdated-reviews"] as const
export type EvaluationFilter = (typeof ALL_FILTERS)[number]

const DEFAULT_FILTERS: EvaluationFilter[] = ["pending", "review-pending"]
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.8

function parseFilters(raw: string | string[] | undefined): EvaluationFilter[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return DEFAULT_FILTERS
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean)
  const valid = parts.filter((p): p is EvaluationFilter =>
    (ALL_FILTERS as readonly string[]).includes(p)
  )
  return valid.length > 0 ? valid : DEFAULT_FILTERS
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
  /** Conteúdo adulto (18+) efetivo — works.is_adult. Renderiza o chip 🔞 no card. */
  is_adult?: boolean
  /** Sua nota (user_score) do DONO (via works_owner) — mostra "Real" ao lado da Prevista. */
  user_score?: number | null
  /** Hidratados só na aba ativa (cards) — ausentes no caminho do cache de contagens. */
  tagCount?: number | null
  reviewCount?: number | null
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
 *
 * ⚠️ Varre a tabela inteira (cresce sem teto — ~1.6k linhas e subindo, várias
 * avals por obra). Só é necessário para os filtros `low-confidence`/
 * `outdated-model`, que precisam olhar TODAS as obras. Para apenas hidratar a
 * metadata de avaliação dos cards exibidos, use `loadLatestEvalsForIds`.
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

/**
 * Versão direcionada de `loadLatestEvalsMap`: carrega a última aval completed só
 * para os `ids` informados (os cards que serão exibidos, ≤500). Evita varrer a
 * tabela inteira no caminho padrão (filtros pending/review-pending), onde a fila
 * tem poucas obras mas a tabela de avaliações é grande.
 *
 * A dedup "primeira por work_id" continua correta mesmo em chunks: cada work_id
 * só aparece dentro do seu próprio chunk (chunks particionam por work_id), então
 * o `order(created_at desc)` por chunk basta.
 */
async function loadLatestEvalsForIds(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
  chunkSize: number,
): Promise<Map<string, LatestEvalRow>> {
  const { data, error } = await chunkedInQuery<LatestEvalRow>(ids, chunkSize, (chunk) =>
    supabase
      .from("ai_evaluations")
      .select("work_id, confidence, model_name, prompt_version, created_at, updated_at")
      .eq("status", "completed")
      .in("work_id", chunk)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => ({ data: (data ?? []) as LatestEvalRow[], error })),
  )
  if (error) throw new Error(String((error as { message?: string }).message ?? error))

  const latest = new Map<string, LatestEvalRow>()
  for (const row of data) {
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

  if (filters.includes("outdated-reviews")) {
    queries.push(
      (async () => {
        // Avaliação concluída cujo pool de reviews mudou depois (flag mantida por
        // saveWorkReviews — migration 120). Query direta, sem o mapa de avaliações.
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_reviews_stale", true)
          .eq("is_archived", false)
        if (error) throw new Error(error.message)
        return { filter: "outdated-reviews" as const, ids: new Set((data ?? []).map((w) => w.id)) }
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
    user_score: number | null
    hiatus_kind: HiatusKind | null
    hiatus_kind_confidence: "high" | "low" | null
    publication_status_note: string | null
  }
  const worksResult = await chunkedInQuery<WorkRow>(eligibleIds, CHUNK_SIZE, (chunk) => {
    // `works_owner`: a fila de curadoria mostra o status de leitura, o ♥ e a NOTA DO DONO (é a
    // tela de trabalho dele). Vêm do espelho dele via a view — `works` já perdeu essas colunas.
    let q = supabase
      .from("works_owner")
      .select("id, title, publication_status_id, personal_status_id, synopsis_quality, total_chapters, user_score, hiatus_kind, hiatus_kind_confidence, publication_status_note")
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

  // Hidrata covers + calculated_scores + última aval em chunks, tudo em paralelo
  // sobre os IDs exibidos. No caminho padrão (pending/review-pending) a aval é
  // carregada direcionada (≤500 IDs) em vez de varrer a tabela inteira; quando os
  // filtros low-confidence/outdated já dispararam o full-load, reusamos o promise.
  type CoverRow = { work_id: string; url: string | null; is_primary: boolean | null; position: number | null }
  type ScoreRow = { work_id: string; expected_score: number | null }
  // `is_adult` é catálogo (não está na view works_owner) — busca direta em `works`.
  type AdultRow = { id: string; is_adult: boolean | null }
  const [coversResult, scoresResult, adultResult, latestEvals] = await Promise.all([
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
    chunkedInQuery<AdultRow>(displayedIds, CHUNK_SIZE, (chunk) =>
      supabase
        .from("works")
        .select("id, is_adult")
        .in("id", chunk)
        .then(({ data, error }) => ({ data: (data ?? []) as AdultRow[], error })),
    ),
    loadLatestEvalsForIds(supabase, displayedIds, CHUNK_SIZE),
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
  const adultByWork = new Map<string, boolean>()
  for (const a of adultResult.data) {
    adultByWork.set(a.id, Boolean(a.is_adult))
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
      hiatusKind: row.hiatus_kind ?? null,
      hiatusKindConfidence: row.hiatus_kind_confidence ?? null,
      publicationStatusNote: row.publication_status_note ?? null,
      personal_status: "",
      personal_status_id: row.personal_status_id ?? null,
      synopsis_quality: row.synopsis_quality ?? null,
      total_chapters: row.total_chapters,
      cover_url: pickPrimaryCover(coversByWork.get(row.id) ?? []),
      expected_score: scoreByWork.get(row.id)?.expected_score ?? null,
      is_adult: adultByWork.get(row.id) ?? false,
      user_score: row.user_score ?? null,
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

/**
 * Aba "IA atributos" — fila de avaliação/revisão das 9 notas por critério.
 * Componente apresentacional: a fila já vem buscada pelo pai (a contagem
 * alimenta o título da aba, então precisa rodar independente da aba ativa).
 */
function IaAttributesTab({
  works,
  readIds,
  activeFilters,
  promptVersionTolerance,
  lowConfidenceThreshold,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  predictionQualities,
}: {
  works: EligibleWork[]
  readIds: string[]
  activeFilters: EvaluationFilter[]
  promptVersionTolerance: number
  lowConfidenceThreshold: number
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  predictionQualities: string[]
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
        activePredictionQualities={predictionQualities}
      />
      <AiEvaluationPanel pendingWorks={works} readIds={readIds} />
    </div>
  )
}

interface TabHrefs {
  attr: string
  tagsReviews: string
}

/** Barra de abas. `counts=null` (fallback do Suspense) mostra "(…)" enquanto os
 *  contadores carregam — não bloqueia o render do conteúdo da aba ativa. */
function EvalTabBar({
  activeTab,
  hrefs,
  counts,
}: {
  activeTab: string
  hrefs: TabHrefs
  counts: TabCounts | null
}) {
  const n = (v: number | undefined) => (counts ? ` (${v ?? 0})` : " (…)")
  return (
    <div className="flex items-center gap-1 border-b border-border/60">
      <EvalTabLink href={hrefs.attr} active={activeTab === "atributos"} dot={(counts?.attr ?? 0) > 0}>IA Atributos{n(counts?.attr)}</EvalTabLink>
      <EvalTabLink href={hrefs.tagsReviews} active={activeTab === "tags-reviews"}>Tags &amp; Reviews{n(counts?.tagsReviews)}</EvalTabLink>
    </div>
  )
}

interface CountArgs {
  activeFilters: EvaluationFilter[]
  pubStatusIds: number[]
  personalStatusIds: number[]
  synopsisQualities: string[]
  toleranceOverride: number | null
  predictionQualities: string[]
  minReviews: number
  maxReviews: number
  minTags: number
  maxTags: number
}

interface TabCounts {
  attr: number
  tagsReviews: number
}

/**
 * Contagens das 2 abas de Curadoria da Obra, cacheadas por combinação de
 * filtros (`unstable_cache`). Metade do que era `getAiEvalTabCounts` antes de
 * /ai-evaluation virar duas páginas — a outra metade (Veredito IA, Interesse,
 * Untracked) mora em app/fila-recomendacao/page.tsx. Mesma tag de invalidação
 * (`ai-eval-tab-counts`) das duas páginas: uma mutação em qualquer uma invalida
 * as duas — sem problema, é um refetch barato no DB local.
 */
const getCuradoriaTabCounts = unstable_cache(
  async (args: CountArgs): Promise<TabCounts> => {
    const [attr, revC, tagsC, ackSets] = await Promise.all([
      getEligibleWorks(args.activeFilters, args.pubStatusIds, args.personalStatusIds, [], args.toleranceOverride),
      getWorksWithoutReviews({ pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds, minReviews: args.minReviews, maxReviews: args.maxReviews }, { countOnly: true }),
      getWorksWithoutTags({ pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds, minTags: args.minTags, maxTags: args.maxTags }, { countOnly: true }),
      getReadAckSets(),
    ])
    const ackAttr = ackSets.get("attr")!
    const ackTR = ackSets.get("tags_reviews")!
    const attrIds = attr.works.map((w) => w.id)
    const trIds = [...new Set([...(revC.ids ?? []), ...(tagsC.ids ?? [])])]
    const [keepAttr, keepTR] = await Promise.all([
      filterWorkIdsByInterest(attrIds, args.synopsisQualities, args.predictionQualities),
      filterWorkIdsByInterest(trIds, args.synopsisQualities, args.predictionQualities),
    ])
    return {
      attr: attrIds.filter((id) => keepAttr.has(id) && !ackAttr.has(id)).length,
      tagsReviews: trIds.filter((id) => keepTR.has(id) && !ackTR.has(id)).length,
    }
  },
  ["curadoria-tab-counts-v1"],
  { revalidate: 60, tags: ["ai-eval-tab-counts"] },
)

const ACTIVE_TAB_COUNT_KEY: Record<string, keyof TabCounts> = {
  atributos: "attr",
  "tags-reviews": "tagsReviews",
}

/**
 * Contadores das 2 abas — async, renderizado dentro de um <Suspense> para NÃO
 * bloquear o conteúdo da aba ativa. `activeCount` é a contagem fresca da aba
 * ATIVA (a fila já foi buscada no corpo da página) — sobrescreve o valor
 * possivelmente cacheado, garantindo que o badge da aba aberta nunca fique
 * stale e bata exatamente com a lista exibida.
 */
async function TabCountsBar({ activeTab, hrefs, args, activeCount }: { activeTab: string; hrefs: TabHrefs; args: CountArgs; activeCount: number }) {
  const counts = await getCuradoriaTabCounts(args)
  const merged: TabCounts = { ...counts, [ACTIVE_TAB_COUNT_KEY[activeTab] ?? "attr"]: activeCount }
  return <EvalTabBar activeTab={activeTab} hrefs={hrefs} counts={merged} />
}

const CURADORIA_QUEUES: readonly ReadQueue[] = ["attr", "tags_reviews"]

/**
 * Estado do toggle "Marcar tudo como lido" das 2 filas de Curadoria da Obra.
 * Cacheado (60s + tag `ai-eval-tab-counts`, invalidada nas mutações de leitura)
 * pra não re-varrer as filas a cada navegação. Renderiza no slot de ações do Header.
 */
const getEvalReadSummaryCached = unstable_cache(
  async () => getEvalReadSummary(CURADORIA_QUEUES),
  ["ai-eval-read-summary-curadoria-v1"],
  { revalidate: 60, tags: ["ai-eval-tab-counts"] },
)

async function MarkReadControl() {
  const summary = await getEvalReadSummaryCached()
  // Nada pendente nem lido ⇒ nada a fazer: esconde o botão.
  if (!summary.hasAnyRead && summary.totalUnread === 0) return null
  return <MarkReadButton allRead={summary.allRead} queues={CURADORIA_QUEUES} badgeKey="curadoria" />
}

// Config dos filtros da fila de IA Atributos (tolerância de versão + limiar de
// confiança). Busca a config e abre num diálogo ("Definir Thresholds").
async function AiEvalSettingsControl() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("formula_config")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
  const config = data?.[0] as FormulaConfig | undefined
  if (!config) return null
  return (
    <AiEvalSettingsDialog
      config={config}
      currentPromptVersion={PROMPT_VERSION}
      currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
    />
  )
}

export default async function CuradoriaDaObraPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string | string[]
    pub?: string | string[]
    personal?: string | string[]
    synopsis_q?: string | string[]
    tolerance?: string | string[]
    tab?: string | string[]
    pq?: string | string[]
    maxrev?: string | string[]
    maxtags?: string | string[]
    minrev?: string | string[]
    mintags?: string | string[]
  }>
}) {
  const params = await searchParams
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab
  const activeTab: "atributos" | "tags-reviews" =
    // "sem-reviews"/"sem-tags" (URLs antigas) redirecionam pra aba unificada.
    tabRaw === "tags-reviews" || tabRaw === "sem-reviews" || tabRaw === "sem-tags" ? "tags-reviews"
    : "atributos"

  const parseMax = (v: string | string[] | undefined): number => {
    const raw = Array.isArray(v) ? v[0] : v
    const n = raw != null && /^\d+$/.test(raw) ? parseInt(raw, 10) : 0
    return Math.max(0, n)
  }
  const maxReviews = parseMax(params.maxrev)
  const maxTags = parseMax(params.maxtags)
  const minReviews = parseMax(params.minrev)
  const minTags = parseMax(params.mintags)

  // Filtros de Status + interesse compartilhados pelas 2 abas.
  const { names: pubStatusNames, ids: pubStatusIds } = parseStatusList(params.pub, PUB_STATUS_NAME_TO_ID)
  const { names: personalStatusNames, ids: personalStatusIds } = parseStatusList(
    params.personal,
    PERSONAL_STATUS_NAME_TO_ID,
  )
  const synopsisQualities = parseSynopsisQualities(params.synopsis_q)
  const predictionQualities = parsePredictionQualities(params.pq)

  // Filtros específicos da aba de atributos.
  const activeFilters = parseFilters(params.filter)
  const toleranceRaw = Array.isArray(params.tolerance) ? params.tolerance[0] : params.tolerance
  const toleranceOverride = toleranceRaw != null && /^\d+$/.test(toleranceRaw)
    ? parseInt(toleranceRaw, 10)
    : null

  // Obras marcadas como "lidas" por fila (silenciadas). Os cards exibem o selo
  // "Lida" e o activeCount abaixo desconta as lidas (bate com o contador da aba).
  const ackSets = await getReadAckSets()
  const readIdsFor = (queue: ReadQueue, works: { id: string }[]): string[] => {
    const set = ackSets.get(queue)!
    return works.filter((w) => set.has(w.id)).map((w) => w.id)
  }

  let activeContent: ReactNode = null
  // Contagem fresca da aba ativa — sobrescreve o valor cacheado no TabCountsBar
  // (badge da aba aberta nunca stale, bate com a lista exibida).
  let activeCount = 0
  if (activeTab === "tags-reviews") {
    // Fusão "Tags & Reviews": roda os dois universos (sem reviews / sem tags) em
    // paralelo e UNE por id, marcando de qual eixo cada obra veio.
    const [revRes, tagRes] = await Promise.all([
      getWorksWithoutReviews({ pubStatusIds, personalStatusIds, minReviews, maxReviews }),
      getWorksWithoutTags({ pubStatusIds, personalStatusIds, minTags, maxTags }),
    ])
    const merged = new Map<string, TagsReviewsWork>()
    const base = (w: { id: string; title: string; coverUrl: string | null; publicationStatusId?: number | null; personalStatusId?: number | null; interest: string | null; canonicalPresent: boolean; inGolden: boolean; expectedScore: number | null; hiatusKind?: HiatusKind | null; hiatusKindConfidence?: "high" | "low" | null; publicationStatusNote?: string | null }) => ({
      id: w.id,
      title: w.title,
      coverUrl: w.coverUrl,
      publicationStatusId: w.publicationStatusId ?? null,
      personalStatusId: w.personalStatusId ?? null,
      interest: w.interest,
      canonicalPresent: w.canonicalPresent,
      inGolden: w.inGolden,
      expectedScore: w.expectedScore,
      hiatusKind: w.hiatusKind ?? null,
      hiatusKindConfidence: w.hiatusKindConfidence ?? null,
      publicationStatusNote: w.publicationStatusNote ?? null,
      tagCount: 0,
      reviewCount: 0,
    })
    for (const w of revRes.works) merged.set(w.id, { ...base(w), reviewGap: true, tagGap: false })
    for (const w of tagRes.works) {
      const ex = merged.get(w.id)
      if (ex) {
        ex.tagGap = true
        ex.readiness = w.readiness
      } else {
        merged.set(w.id, { ...base(w), reviewGap: false, tagGap: true, readiness: w.readiness })
      }
    }
    const mergedAll = [...merged.values()]
    // Filtro de Interesse (manual + Previsão da IA) pós-fetch, uniforme.
    const keep = await filterWorkIdsByInterest(mergedAll.map((w) => w.id), synopsisQualities, predictionQualities)
    const mergedWorks = mergedAll.filter((w) => keep.has(w.id))
    // Reaproveita as contagens JÁ computadas nos scans de getWorksWithout* (mapas de
    // TODAS as obras) — evita re-varrer work_tags/work_reviews aqui (getWorkTagReviewCounts).
    const tagCounts = tagRes.tagCountByWork ?? new Map<string, number>()
    const revCounts = revRes.usefulCountByWork ?? new Map<string, number>()
    const flags = await fetchAdultScoreFlags(mergedWorks.map((w) => w.id))
    for (const w of mergedWorks) {
      w.tagCount = tagCounts.get(w.id) ?? 0
      w.reviewCount = revCounts.get(w.id) ?? 0
      const f = flags.get(w.id)
      w.isAdult = f?.isAdult ?? false
      w.userScore = f?.userScore ?? null
    }
    const readIds = readIdsFor("tags_reviews", mergedWorks)
    activeCount = mergedWorks.length - readIds.length
    activeContent = (
      <TagsReviewsTab
        works={mergedWorks}
        readIds={readIds}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeInterest={synopsisQualities}
        activePredictionQualities={predictionQualities}
        minReviews={minReviews}
        maxReviews={maxReviews}
        minTags={minTags}
        maxTags={maxTags}
      />
    )
  } else {
    // Interesse (manual + Previsão da IA) filtrado uniformemente pós-fetch (não no
    // getEligibleWorks) — cobre ♥/none/unknown + previsão em todas as abas.
    const attrResult = await getEligibleWorks(activeFilters, pubStatusIds, personalStatusIds, [], toleranceOverride)
    const keep = await filterWorkIdsByInterest(attrResult.works.map((w) => w.id), synopsisQualities, predictionQualities)
    const members = attrResult.works.filter((w) => keep.has(w.id))
    const counts = await getWorkTagReviewCounts(members.map((w) => w.id))
    const works = members.map((w) => ({
      ...w,
      tagCount: counts.get(w.id)?.tagCount ?? 0,
      reviewCount: counts.get(w.id)?.reviewCount ?? 0,
    }))
    const readIds = readIdsFor("attr", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <IaAttributesTab
        works={works}
        readIds={readIds}
        activeFilters={activeFilters}
        promptVersionTolerance={attrResult.promptVersionTolerance}
        lowConfidenceThreshold={attrResult.lowConfidenceThreshold}
        pubStatusNames={pubStatusNames}
        personalStatusNames={personalStatusNames}
        synopsisQualities={synopsisQualities}
        predictionQualities={predictionQualities}
      />
    )
  }

  // Preserva os filtros ao trocar de aba.
  const filter = toParam(params.filter)
  const pub = toParam(params.pub)
  const personal = toParam(params.personal)
  const tolerance = toParam(params.tolerance)
  const synq = toParam(params.synopsis_q)

  const attrParams = new URLSearchParams()
  if (filter) attrParams.set("filter", filter)
  if (pub) attrParams.set("pub", pub)
  if (personal) attrParams.set("personal", personal)
  if (synq) attrParams.set("synopsis_q", synq)
  if (tolerance) attrParams.set("tolerance", tolerance)
  const attrHref = attrParams.toString() ? `/ai-evaluation?${attrParams}` : "/ai-evaluation"

  const tagsReviewsParams = new URLSearchParams({ tab: "tags-reviews" })
  if (pub) tagsReviewsParams.set("pub", pub)
  if (personal) tagsReviewsParams.set("personal", personal)
  if (synq) tagsReviewsParams.set("synopsis_q", synq)
  if (minReviews > 0) tagsReviewsParams.set("minrev", String(minReviews))
  if (maxReviews > 0) tagsReviewsParams.set("maxrev", String(maxReviews))
  if (minTags > 0) tagsReviewsParams.set("mintags", String(minTags))
  if (maxTags > 0) tagsReviewsParams.set("maxtags", String(maxTags))
  const tagsReviewsHref = `/ai-evaluation?${tagsReviewsParams}`

  const hrefs: TabHrefs = { attr: attrHref, tagsReviews: tagsReviewsHref }
  const countArgs: CountArgs = {
    activeFilters,
    pubStatusIds,
    personalStatusIds,
    synopsisQualities,
    toleranceOverride,
    predictionQualities,
    minReviews,
    maxReviews,
    minTags,
    maxTags,
  }

  return (
    <div className="space-y-4">
      <Header
        title="Curadoria da Obra"
        description="Notas de IA e dados do catálogo — uma linha por obra, compartilhada por todo mundo. Editar aqui muda o que qualquer leitor vê."
        icon={<Wrench />}
        actions={
          <>
            <Suspense fallback={null}>
              <AiEvalSettingsControl />
            </Suspense>
            <Suspense fallback={null}>
              <MarkReadControl />
            </Suspense>
          </>
        }
      />

      <Suspense fallback={<EvalTabBar activeTab={activeTab} hrefs={hrefs} counts={null} />}>
        <TabCountsBar activeTab={activeTab} hrefs={hrefs} args={countArgs} activeCount={activeCount} />
      </Suspense>

      {activeContent}
    </div>
  )
}
