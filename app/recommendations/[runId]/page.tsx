import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, BookOpen, ChartNoAxesCombined, Sparkles } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RankedWorkCard } from "@/components/titles/recommendations/ranked-work-card"
import { TasteProfileSummary } from "@/components/titles/recommendations/taste-profile-summary"
import { RunDetailActions } from "@/components/recommendations/run-detail-actions"
import { getRecommendationRun } from "@/server/queries/recommendations"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatRelativeDateTime } from "@/lib/date-utils"
import type { RankedCandidate, TasteProfileRow } from "@/lib/ai-recommendation/types"

export const dynamic = "force-dynamic"

async function loadProfileById(id: string | null): Promise<TasteProfileRow | null> {
  if (!id) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("taste_profile")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id as string,
    version: data.version as number,
    is_current: data.is_current as boolean,
    is_stub: data.is_stub as boolean,
    n_works_used: data.n_works_used as number,
    input_hash: data.input_hash as string,
    model_name: data.model_name as string,
    prompt_version: data.prompt_version as string,
    profile: data.profile as TasteProfileRow["profile"],
    raw_response: data.raw_response,
    created_at: data.created_at as string,
  }
}

interface PageProps {
  params: Promise<{ runId: string }>
}

export default async function RunDetailPage({ params }: PageProps) {
  const { runId } = await params
  const run = await getRecommendationRun(runId)
  if (!run) notFound()

  const [usedProfile, currentProfile] = await Promise.all([
    loadProfileById(run.tasteProfileId),
    loadCurrentTasteProfile(),
  ])

  const profileChanged =
    usedProfile != null && currentProfile != null && usedProfile.id !== currentProfile.id

  const ModeIcon =
    run.mode === "next_read" ? BookOpen : run.mode === "ranking" ? Sparkles : ChartNoAxesCombined
  const modeLabel =
    run.mode === "next_read"
      ? "Próxima leitura"
      : run.mode === "ranking"
        ? "Ranking (filtrado)"
        : "Análise do gosto"

  const droppedCount =
    run.nAvailable != null && run.nAvailable > run.nCandidates
      ? run.nAvailable - run.nCandidates
      : 0

  return (
    <div className="w-full max-w-4xl space-y-4">
      <div>
        <Link
          href="/recommendations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> voltar pra histórico
        </Link>
      </div>

      <Header
        kicker="IA"
        title="Execução de recomendação"
        description={`${modeLabel} · ${formatRelativeDateTime(run.createdAt)}`}
        icon={<Sparkles />}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1">
          <ModeIcon className="h-3 w-3" /> {modeLabel}
        </Badge>
        <Badge variant="outline">{run.nCandidates} candidatos</Badge>
        <Badge variant="outline">{run.modelName}</Badge>
        <Badge variant="outline">prompt {run.promptVersion}</Badge>
        {run.cacheReadTokens != null && run.cacheReadTokens > 0 && (
          <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">
            cache hit {run.cacheReadTokens} tokens
          </Badge>
        )}
        {profileChanged && (
          <Badge variant="outline" className="text-amber-700 border-amber-500/40">
            perfil de gosto mudou desde essa execução
          </Badge>
        )}
      </div>

      {droppedCount > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <strong>{droppedCount}</strong> obra{droppedCount === 1 ? "" : "s"} não entr
          {droppedCount === 1 ? "ou" : "aram"} nesta run (limite de {run.nCandidates}{" "}
          selecionado, total disponível: {run.nAvailable}). As com menor{" "}
          <span className="font-mono">final_score</span> foram descartadas.
        </div>
      )}

      {run.userContext && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Contexto fornecido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm italic text-foreground/90">“{run.userContext}”</p>
          </CardContent>
        </Card>
      )}

      <RunDetailActions runId={run.id} />

      {run.modeSummary && (
        <p className="rounded-md bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
          {run.modeSummary}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ranking ({run.ranked.length} obra(s))
        </h2>
        {run.ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta execução não retornou obras (ou todas foram removidas do catálogo).
          </p>
        ) : (
          <div className="space-y-2">
            {run.ranked.map((r, i) => {
              if (!r.work) {
                return (
                  <div
                    key={r.work_id}
                    className="rounded-lg border bg-card/40 p-3 text-sm text-muted-foreground"
                  >
                    #{i + 1} — obra removida do catálogo · score {Math.round(r.alignment_score)}
                  </div>
                )
              }
              const ranked: RankedCandidate = {
                work_id: r.work_id,
                alignment_score: r.alignment_score,
                justification: r.justification,
                top_match_factors: r.top_match_factors,
                work: r.work,
                coverUrl: r.coverUrl,
              }
              return <RankedWorkCard key={r.work_id} rank={i + 1} ranked={ranked} />
            })}
          </div>
        )}
      </section>

      {usedProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Perfil de gosto usado nesta execução</CardTitle>
          </CardHeader>
          <CardContent>
            <TasteProfileSummary profile={usedProfile} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
