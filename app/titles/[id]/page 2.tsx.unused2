import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { Pencil, Archive, ArchiveRestore, Trash2, Sparkles, RefreshCw, ChevronDown } from "lucide-react"
import { getWorkWithAiEvaluations } from "@/server/queries/works"
import { Header } from "@/components/layout/header"
import { ScoreBadge } from "@/components/ui/score-badge"
import {
  PublicationStatusBadge,
  PersonalStatusBadge,
  AiStatusBadge,
} from "@/components/ui/status-badge"
import { CalculationBreakdown } from "@/components/titles/calculation-breakdown"
import { WorkDetailActions } from "@/components/titles/work-detail-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CRITERIA_INFO, PLATFORM_LABELS } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { cn } from "@/lib/utils"

interface TitleDetailPageProps {
  params: Promise<{ id: string }>
}

function getCriterionColor(score: number, slug: string): string {
  const isNegative = slug === "drama" || slug === "tragedy"
  if (isNegative) {
    if (score <= 3) return "bg-green-100 text-green-800"
    if (score <= 5) return "bg-yellow-100 text-yellow-800"
    return "bg-red-100 text-red-800"
  }
  if (score >= 8) return "bg-emerald-100 text-emerald-800"
  if (score >= 6) return "bg-green-100 text-green-800"
  if (score >= 4) return "bg-yellow-100 text-yellow-800"
  return "bg-red-100 text-red-800"
}

export default async function TitleDetailPage({ params }: TitleDetailPageProps) {
  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const work = await getWorkWithAiEvaluations(id) as any

  if (!work) notFound()

  const scoreMap: Record<string, number> = {}
  for (const cs of work.category_scores ?? []) {
    scoreMap[cs.criterion_slug] = cs.score
  }

  const aiEvaluations: Array<{
    id: string
    status: string
    model_name: string | null
    summary: string | null
    confidence: number | null
    created_at: string
    ai_evaluation_scores?: Array<{
      criterion_slug: string
      suggested_score: number | null
      justification: string | null
      accepted_score: number | null
    }>
  }> = work.ai_evaluations ?? []

  const latestAiEval = aiEvaluations
    .filter((e) => e.status === "completed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{work.title}</h1>
          <div className="flex flex-wrap gap-2">
            <PublicationStatusBadge status={work.publication_status} />
            <PersonalStatusBadge status={work.personal_status} />
            <AiStatusBadge status={work.ai_eval_status} />
            {work.is_archived && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                Arquivada
              </span>
            )}
          </div>
        </div>
        <WorkDetailActions workId={id} isArchived={work.is_archived} />
      </div>

      {/* Score principal */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">NotaFinal</p>
              <ScoreBadge score={work.calculated_scores?.final_score ?? null} size="lg" />
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Nota.Calc</p>
              <ScoreBadge score={work.calculated_scores?.calc_score ?? null} size="md" />
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Nota.Pr</p>
              <ScoreBadge
                score={work.calculated_scores?.predicted_score ?? null}
                size="md"
                showStub={work.calculated_scores?.predicted_is_stub ?? false}
              />
            </div>
            {work.manual_score != null && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Nota Pessoal</p>
                <ScoreBadge score={work.manual_score} size="md" />
              </div>
            )}
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Capítulos</p>
              <span className="text-sm font-mono">
                {work.chapters_read ?? "?"}/{work.total_chapters ?? "?"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Critérios */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notas por critério</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CRITERION_SLUGS.map((slug) => {
              const info = CRITERIA_INFO[slug]
              const score = scoreMap[slug]

              return (
                <div
                  key={slug}
                  className="flex items-center gap-3 p-3 rounded-md border bg-muted/20"
                >
                  <span className="text-xl" title={info.name}>
                    {info.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{info.name}</p>
                    {score != null ? (
                      <span
                        className={cn(
                          "inline-block mt-1 px-2 py-0.5 rounded text-xs font-mono font-semibold",
                          getCriterionColor(score, slug)
                        )}
                      >
                        {score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Calculation Breakdown */}
      {work.calculated_scores && (
        <CalculationBreakdown calculatedScore={work.calculated_scores} />
      )}

      {/* Plataformas */}
      {work.platform_ratings?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avaliações externas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(work.platform_ratings as Array<{ platform: string; rating: number | null; vote_count: number }>).map((pr) => (
                <div key={pr.platform} className="p-3 rounded-md border bg-muted/20">
                  <p className="text-xs font-medium text-muted-foreground">
                    {PLATFORM_LABELS[pr.platform] ?? pr.platform}
                  </p>
                  <div className="flex items-baseline gap-2 mt-1">
                    {pr.rating != null ? (
                      <span className="text-lg font-bold font-mono">{pr.rating.toFixed(2)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    <span className="text-xs text-muted-foreground">{pr.vote_count} votos</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Última avaliação IA */}
      {latestAiEval && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Última avaliação IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Modelo: </span>
                <span className="font-medium">{latestAiEval.model_name ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Confiança: </span>
                <span className="font-medium">
                  {latestAiEval.confidence != null
                    ? `${(latestAiEval.confidence * 100).toFixed(0)}%`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Data: </span>
                <span className="font-medium">
                  {new Date(latestAiEval.created_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
            </div>

            {latestAiEval.summary && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Resumo da IA</p>
                <p className="text-sm">{latestAiEval.summary}</p>
              </div>
            )}

            {latestAiEval.ai_evaluation_scores && latestAiEval.ai_evaluation_scores.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {latestAiEval.ai_evaluation_scores.map((es) => {
                  const info = CRITERIA_INFO[es.criterion_slug]
                  return (
                    <div key={es.criterion_slug} className="p-2 rounded border bg-muted/20 text-xs">
                      <div className="flex items-center gap-1 mb-1">
                        <span>{info?.emoji}</span>
                        <span className="font-medium">{info?.name ?? es.criterion_slug}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">Sugerido:</span>
                        <span className="font-mono">{es.suggested_score ?? "—"}</span>
                        {es.accepted_score != null && es.accepted_score !== es.suggested_score && (
                          <>
                            <span className="text-muted-foreground">→ Aceito:</span>
                            <span className="font-mono">{es.accepted_score}</span>
                          </>
                        )}
                      </div>
                      {es.justification && (
                        <p className="mt-1 text-muted-foreground line-clamp-2">{es.justification}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Links */}
      <div className="flex gap-3">
        <Link
          href={`/titles/${id}/edit`}
          className="text-sm text-primary hover:underline"
        >
          Editar esta obra
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href="/titles" className="text-sm text-muted-foreground hover:underline">
          Voltar para a lista
        </Link>
      </div>
    </div>
  )
}
