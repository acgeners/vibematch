import { createClient } from "@/lib/supabase/server"
import { Header } from "@/components/layout/header"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { Badge } from "@/components/ui/badge"

async function getPendingWorks() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, publication_status, personal_status, total_chapters,
      calculated_scores(final_score)
    `)
    .eq("ai_eval_status", "pending")
    .eq("is_archived", false)
    .order("title")
    .limit(100)

  if (error) throw new Error(error.message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((w: any) => ({
    id: w.id,
    title: w.title,
    publication_status: w.publication_status,
    personal_status: w.personal_status,
    total_chapters: w.total_chapters,
    final_score: w.calculated_scores?.final_score ?? null,
  }))
}

export default async function AiEvaluationPage() {
  const pendingWorks = await getPendingWorks()

  return (
    <div className="max-w-3xl space-y-6">
      <Header
        title="Avaliação IA"
        description="Obras aguardando avaliação por inteligência artificial"
        actions={
          <Badge variant="outline" className="text-base px-3 py-1">
            {pendingWorks.length} pendente{pendingWorks.length !== 1 ? "s" : ""}
          </Badge>
        }
      />

      <AiEvaluationPanel pendingWorks={pendingWorks} />
    </div>
  )
}
