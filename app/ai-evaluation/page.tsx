import { Sparkles } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { Badge } from "@/components/ui/badge"
import { pickPrimaryCover } from "@/lib/work-derived"
import { MODEL, PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM, parsePromptVersion } from "@/lib/ai-evaluation/service"
import {
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
} from "@/lib/constants/criteria"

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
  cover_url?: string | null
  final_score: number | null
  /** Razões pelas quais a obra apareceu (intersecção com os filtros ativos). */
  matchedFilters: EvaluationFilter[]
  evaluation: {
    confidence: number | null
    modelName: string | null
    promptVersion: string | null
    evaluatedAt: string | null
  } | null
}

async function getEligibleWorks(
  filters: EvaluationFilter[],
  pubStatusIds: number[],
  personalStatusIds: number[]
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
  const promptVersionTolerance = Math.max(0, Number(configRow?.prompt_version_tolerance ?? 0))
  const lowConfidenceThreshold = Math.min(
    1,
    Math.max(0, Number(configRow?.low_confidence_threshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD))
  )

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
        const { data, error } = await supabase
          .from("latest_ai_evaluation_per_work")
          .select("work_id")
          .lt("confidence", lowConfidenceThreshold)
        if (error) throw new Error(error.message)
        return { filter: "low-confidence" as const, ids: new Set((data ?? []).map((r) => r.work_id)) }
      })()
    )
  }

  if (filters.includes("outdated-model")) {
    queries.push(
      (async () => {
        // Busca todas latest evals e filtra em JS — Postgres não tem helper
        // ergonômico pra parsear "vXX" → int. Trivial em JS com ~milhares
        // de rows.
        const { data, error } = await supabase
          .from("latest_ai_evaluation_per_work")
          .select("work_id, model_name, prompt_version")
        if (error) throw new Error(error.message)
        const ids = new Set<string>()
        for (const row of data ?? []) {
          const versionNum = parsePromptVersion(row.prompt_version as string | null)
          const modelMismatch = (row.model_name as string | null) !== MODEL
          const promptMismatch =
            versionNum == null ||
            CURRENT_PROMPT_VERSION_NUM - versionNum > promptVersionTolerance
          if (modelMismatch || promptMismatch) ids.add(row.work_id as string)
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

  let worksQuery = supabase
    .from("works")
    .select(`
      id, title, publication_status_id, personal_status_id, total_chapters,
      work_covers(url, is_primary, position),
      calculated_scores(final_score)
    `)
    .in("id", eligibleIds)
    .eq("is_archived", false)
  if (pubStatusIds.length > 0) {
    worksQuery = worksQuery.in("publication_status_id", pubStatusIds)
  }
  if (personalStatusIds.length > 0) {
    worksQuery = worksQuery.in("personal_status_id", personalStatusIds)
  }

  const [worksResult, evalsResult] = await Promise.all([
    worksQuery.order("title").limit(500),
    supabase
      .from("latest_ai_evaluation_per_work")
      .select("work_id, confidence, model_name, prompt_version, updated_at, created_at")
      .in("work_id", eligibleIds),
  ])

  if (worksResult.error) throw new Error(worksResult.error.message)
  if (evalsResult.error) throw new Error(evalsResult.error.message)

  const evalByWork = new Map(
    (evalsResult.data ?? []).map((e) => [
      e.work_id as string,
      {
        confidence: e.confidence == null ? null : Number(e.confidence),
        modelName: (e.model_name as string | null) ?? null,
        promptVersion: (e.prompt_version as string | null) ?? null,
        // updated_at reflete a última mudança da avaliação (substituição, edição
        // de scores, etc.). Fallback pra created_at se a view não tiver updated.
        evaluatedAt:
          (e.updated_at as string | null) ?? (e.created_at as string | null) ?? null,
      },
    ])
  )

  const works: EligibleWork[] = (worksResult.data ?? []).map((w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = w as any
    return {
      id: row.id,
      title: row.title,
      publication_status: "",
      publication_status_id: row.publication_status_id ?? null,
      personal_status: "",
      personal_status_id: row.personal_status_id ?? null,
      total_chapters: row.total_chapters,
      cover_url: pickPrimaryCover(row.work_covers),
      final_score: row.calculated_scores?.final_score ?? null,
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

export default async function AiEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string | string[]
    pub?: string | string[]
    personal?: string | string[]
  }>
}) {
  const params = await searchParams
  const activeFilters = parseFilters(params.filter)
  const { names: pubStatusNames, ids: pubStatusIds } = parseStatusList(
    params.pub,
    PUB_STATUS_NAME_TO_ID
  )
  const { names: personalStatusNames, ids: personalStatusIds } = parseStatusList(
    params.personal,
    PERSONAL_STATUS_NAME_TO_ID
  )
  const { works, totalCount, promptVersionTolerance, lowConfidenceThreshold } =
    await getEligibleWorks(activeFilters, pubStatusIds, personalStatusIds)

  return (
    <div className="space-y-4">
      <Header
        kicker="Avaliação"
        title="Avaliação IA"
        description="Obras elegíveis para avaliação, revisão ou re-avaliação por IA"
        icon={<Sparkles />}
        actions={
          <Badge variant="outline" className="text-xs">
            {totalCount} obra{totalCount !== 1 ? "s" : ""}
          </Badge>
        }
      />

      <AiEvaluationFilters
        activeFilters={activeFilters}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={promptVersionTolerance}
        lowConfidenceThreshold={lowConfidenceThreshold}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
      />

      <AiEvaluationPanel pendingWorks={works} />
    </div>
  )
}
