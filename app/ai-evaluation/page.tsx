import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { Badge } from "@/components/ui/badge"
import { pickPrimaryCover } from "@/lib/work-derived"
import { MODEL, PROMPT_VERSION } from "@/lib/ai-evaluation/service"

const ALL_FILTERS = ["pending", "low-confidence", "outdated-model"] as const
export type EvaluationFilter = (typeof ALL_FILTERS)[number]

const LOW_CONFIDENCE_THRESHOLD = 0.8

function parseFilters(raw: string | string[] | undefined): EvaluationFilter[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return ["pending"]
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean)
  const valid = parts.filter((p): p is EvaluationFilter =>
    (ALL_FILTERS as readonly string[]).includes(p)
  )
  return valid.length > 0 ? valid : ["pending"]
}

interface EligibleWork {
  id: string
  title: string
  publication_status: string
  publication_status_id: number | null
  personal_status: string
  personal_status_id: number | null
  total_chapters: number | null
  cover_url?: string | null
  final_score: number | null
  /** Razões pelas quais a obra apareceu (intersecção com os filtros ativos). */
  matchedFilters: EvaluationFilter[]
  evaluation: {
    confidence: number | null
    modelName: string | null
    promptVersion: string | null
  } | null
}

async function getEligibleWorks(filters: EvaluationFilter[]) {
  const supabase = createAdminClient()

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

  if (filters.includes("low-confidence")) {
    queries.push(
      (async () => {
        const { data, error } = await supabase
          .from("latest_ai_evaluation_per_work")
          .select("work_id")
          .lt("confidence", LOW_CONFIDENCE_THRESHOLD)
        if (error) throw new Error(error.message)
        return { filter: "low-confidence" as const, ids: new Set((data ?? []).map((r) => r.work_id)) }
      })()
    )
  }

  if (filters.includes("outdated-model")) {
    queries.push(
      (async () => {
        const { data, error } = await supabase
          .from("latest_ai_evaluation_per_work")
          .select("work_id, model_name, prompt_version")
          .or(`model_name.neq.${MODEL},prompt_version.neq.${PROMPT_VERSION}`)
        if (error) throw new Error(error.message)
        return { filter: "outdated-model" as const, ids: new Set((data ?? []).map((r) => r.work_id)) }
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
    return { works: [] as EligibleWork[], totalCount: 0, activeFilters: filters }
  }

  const eligibleIds = [...matchedByWork.keys()]

  const [worksResult, evalsResult] = await Promise.all([
    supabase
      .from("works")
      .select(`
        id, title, publication_status_id, personal_status_id, total_chapters,
        work_covers(url, is_primary, position),
        calculated_scores(final_score)
      `)
      .in("id", eligibleIds)
      .eq("is_archived", false)
      .order("title")
      .limit(500),
    supabase
      .from("latest_ai_evaluation_per_work")
      .select("work_id, confidence, model_name, prompt_version")
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
    }
  })

  return { works, totalCount: works.length, activeFilters: filters }
}

export default async function AiEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>
}) {
  const params = await searchParams
  const activeFilters = parseFilters(params.filter)
  const { works, totalCount } = await getEligibleWorks(activeFilters)

  return (
    <div className="max-w-3xl space-y-6">
      <Header
        title="Avaliação IA"
        description="Obras elegíveis para avaliação, revisão ou re-avaliação por IA"
        actions={
          <Badge variant="outline" className="text-base px-3 py-1">
            {totalCount} obra{totalCount !== 1 ? "s" : ""}
          </Badge>
        }
      />

      <AiEvaluationFilters
        activeFilters={activeFilters}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        lowConfidenceThreshold={LOW_CONFIDENCE_THRESHOLD}
      />

      <AiEvaluationPanel pendingWorks={works} />
    </div>
  )
}
