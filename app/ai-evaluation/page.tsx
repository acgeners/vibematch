import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { Badge } from "@/components/ui/badge"
import { pickPrimaryCover } from "@/lib/work-derived"

async function getPendingWorks() {
  const supabase = createAdminClient()

  const [worksResult, countResult] = await Promise.all([
    supabase
      .from("works")
      .select(`
        id, title, publication_status_id, personal_status_id, total_chapters,
        work_covers(url, is_primary, position),
        calculated_scores(final_score)
      `)
      .eq("ai_eval_status", "pending")
      .eq("is_archived", false)
      .order("title")
      .limit(100),
    supabase
      .from("works")
      .select("id", { count: "exact", head: true })
      .eq("ai_eval_status", "pending")
      .eq("is_archived", false),
  ])

  if (worksResult.error) throw new Error(worksResult.error.message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const works = (worksResult.data ?? []).map((w: any) => ({
    id: w.id,
    title: w.title,
    publication_status: "" as string,
    publication_status_id: w.publication_status_id ?? null,
    personal_status: "" as string,
    personal_status_id: w.personal_status_id ?? null,
    total_chapters: w.total_chapters,
    cover_url: pickPrimaryCover(w.work_covers),
    final_score: w.calculated_scores?.final_score ?? null,
  }))

  return { works, totalCount: countResult.count ?? works.length }
}

export default async function AiEvaluationPage() {
  const { works: pendingWorks, totalCount } = await getPendingWorks()

  return (
    <div className="max-w-3xl space-y-6">
      <Header
        title="Avaliação IA"
        description="Obras aguardando avaliação por inteligência artificial"
        actions={
          <Badge variant="outline" className="text-base px-3 py-1">
            {totalCount} pendente{totalCount !== 1 ? "s" : ""}
          </Badge>
        }
      />

      <AiEvaluationPanel pendingWorks={pendingWorks} />
    </div>
  )
}
