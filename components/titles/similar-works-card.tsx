import Link from "next/link"
import { Sparkles, ImageOff, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { cn, titleToSlug } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import type { SimilarWork } from "@/server/queries/similar-works"

interface SimilarWorksCardProps {
  works: SimilarWork[]
  className?: string
}

function formatSimilarity(s: number): string {
  return `${Math.round(s * 100)}%`
}

function similarityClasses(s: number): string {
  if (s >= 0.85) return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
  if (s >= 0.7) return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
  return "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"
}

export function SimilarWorksCard({ works, className }: SimilarWorksCardProps) {
  if (works.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            Obras parecidas
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          Embedding ainda não foi gerado pra esta obra. Vá em Configurações → Embeddings das obras e
          clique em &quot;Atualizar embeddings&quot;.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          Obras parecidas
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Como as recomendações são geradas"
                  className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
                Recomendações geradas por similaridade semântica: comparamos os
                <strong> embeddings vetoriais </strong>
                das descrições, usando distância cosseno. Não depende de gênero ou tags.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {works.map((w) => {
            const topGenres = w.genres.slice(0, 3)
            const metaParts = [
              w.year != null ? String(w.year) : null,
              w.totalChapters != null ? `${w.totalChapters} caps` : null,
            ].filter(Boolean) as string[]

            const hasAnyMeta =
              topGenres.length > 0 ||
              metaParts.length > 0 ||
              w.publicationStatusId != null ||
              w.personalStatusId != null

            const displayScore = w.manualScore ?? w.finalScore
            const isManual = w.manualScore != null
            return (
              <li key={w.id} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                <Link
                  href={`/titles/${titleToSlug(w.title)}`}
                  className="shrink-0 w-24 h-32 overflow-hidden rounded-md border border-border bg-muted relative shadow-sm transition-transform hover:scale-[1.03]"
                >
                  {w.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getCoverImageSrc(w.coverUrl) ?? w.coverUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground">
                      <ImageOff className="h-5 w-5" />
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                  <WorkTitleLink
                    title={w.title}
                    workId={w.id}
                    className="block font-semibold text-[15px] hover:underline line-clamp-1"
                  />

                  {topGenres.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {topGenres.map((g) => (
                        <span
                          key={g}
                          className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  )}

                  {(metaParts.length > 0 ||
                    w.publicationStatusId != null ||
                    w.personalStatusId != null) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {metaParts.length > 0 && (
                        <span className="tabular-nums">{metaParts.join(" · ")}</span>
                      )}
                      {w.publicationStatusId != null && (
                        <PublicationStatusBadge
                          statusId={w.publicationStatusId}
                          compact
                          className="px-1.5 py-0 text-[10px]"
                        />
                      )}
                      {w.personalStatusId != null && (
                        <PersonalStatusBadge
                          statusId={w.personalStatusId}
                          className="px-1.5 py-0 text-[10px]"
                        />
                      )}
                    </div>
                  )}

                  {/* Fallback: se não temos NENHUM metadado estruturado, mostra a sinopse pra não deixar a linha vazia */}
                  {!hasAnyMeta && w.synopsis && (
                    <p className="line-clamp-2 text-xs italic text-muted-foreground">
                      {w.synopsis}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-mono text-sm font-bold py-1 px-2.5 cursor-help",
                            similarityClasses(w.similarity),
                          )}
                        >
                          {formatSimilarity(w.similarity)}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[220px] text-xs leading-relaxed">
                        Similaridade semântica com esta obra ({formatSimilarity(w.similarity)}).
                        Calculada por distância cosseno entre os embeddings das descrições.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {displayScore != null && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">
                            <ScoreBadge score={displayScore} size="lg" variant="soft" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[220px] text-xs leading-relaxed">
                          {isManual
                            ? "Sua nota pessoal (manual_score) — você já avaliou esta obra."
                            : "Nota.Final prevista pelo sistema — você ainda não avaliou."}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
