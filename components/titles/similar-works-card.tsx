import Link from "next/link"
import { Sparkles, ImageOff, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
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

function formatVotes(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
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
      <CardHeader className="pb-0">
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
        {/* Barra de Legenda */}
        <div className="flex flex-col gap-2 border-b border-border/40 pb-4 mb-4 text-xs text-muted-foreground bg-muted/15 p-3 rounded-lg mt-1">
          <div className="flex items-center gap-1">
            <span className="font-bold text-foreground">Legenda das informações:</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-1">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="font-mono text-[11px] font-bold py-0.5 px-2 border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300 shrink-0 mt-0.5">
                80%
              </Badge>
              <p className="text-[11px] leading-relaxed">
                <strong className="text-foreground">Similaridade:</strong> Similaridade semântica com esta obra. Calculada por distância cosseno entre os embeddings das descrições.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="flex gap-1 shrink-0 mt-0.5">
                <ScoreBadge score={8.0} size="sm" variant="solid" className="h-6 min-w-[2rem] text-[10px] font-bold pointer-events-none" />
              </div>
              <p className="text-[11px] leading-relaxed">
                <strong className="text-foreground">Nota pessoal/prevista:</strong> Sua nota pessoal se você já avaliou esta obra, ou a Nota Final prevista pelo sistema se você ainda não avaliou.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
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

            const displayScore = w.userScore ?? w.finalScore
            const isManual = w.userScore != null
            return (
              <div
                key={w.id}
                className="group flex gap-4 p-3.5 rounded-xl border border-border/50 bg-card/25 hover:bg-card/70 hover:border-primary/20 hover:shadow-md transition-all duration-300"
              >
                <Link
                  href={`/titles/${titleToSlug(w.title)}`}
                  className="shrink-0 w-20 h-28 overflow-hidden rounded-lg border border-border bg-muted relative shadow-sm transition-transform group-hover:scale-[1.02]"
                >
                  {w.coverUrl ? (
                    <CoverImage
                      url={w.coverUrl}
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground">
                      <ImageOff className="h-5 w-5" />
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
                  <div className="space-y-1.5">
                    <WorkTitleLink
                      title={w.title}
                      workId={w.id}
                      className="block font-bold text-[16px] text-foreground group-hover:text-primary transition-colors hover:underline line-clamp-1"
                    />

                    {topGenres.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {topGenres.map((g) => (
                          <span
                            key={g}
                            className="rounded-md bg-muted/65 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {w.platformAvg != null && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                      <span className="font-semibold text-foreground/85">Média externa:</span>
                      <span className="font-mono font-bold text-foreground bg-muted/40 px-1.5 py-0.5 rounded text-[11px]">
                        {w.platformAvg.toFixed(2)}
                      </span>
                      {w.totalVotes != null && w.totalVotes > 0 && (
                        <span className="text-[11px] text-muted-foreground/70">
                          ({formatVotes(w.totalVotes)} votos)
                        </span>
                      )}
                    </div>
                  )}

                  {(metaParts.length > 0 ||
                    w.publicationStatusId != null ||
                    w.personalStatusId != null) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mt-2">
                      {metaParts.length > 0 && (
                        <span className="tabular-nums font-medium bg-muted/40 px-2 py-0.5 rounded-md border border-border/30">{metaParts.join(" · ")}</span>
                      )}
                      {w.publicationStatusId != null && (
                        <PublicationStatusBadge
                          statusId={w.publicationStatusId}
                          compact
                          className="px-2 py-0.5 text-[10px] font-medium"
                        />
                      )}
                      {w.personalStatusId != null && (
                        <PersonalStatusBadge
                          statusId={w.personalStatusId}
                          className="px-2 py-0.5 text-[10px] font-medium"
                        />
                      )}
                    </div>
                  )}

                  {!hasAnyMeta && w.synopsis && (
                    <p className="line-clamp-2 text-xs italic text-muted-foreground mt-2">
                      {w.synopsis}
                    </p>
                  )}
                </div>

                <div className={cn(
                  "flex flex-col items-center shrink-0 self-stretch pl-2 min-w-[80px] py-1",
                  displayScore != null ? "justify-between" : "justify-center"
                )}>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold text-center block w-full leading-none">
                      Similar
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-8 min-w-[3rem] font-mono text-sm font-bold px-2 py-0.5 rounded-md border flex items-center justify-center shadow-xs",
                        similarityClasses(w.similarity),
                      )}
                    >
                      {formatSimilarity(w.similarity)}
                    </Badge>
                  </div>

                  {displayScore != null && (
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold text-center block w-full leading-none">
                        {isManual ? "pessoal" : "prevista"}
                      </span>
                      <ScoreBadge
                        score={displayScore}
                        variant="solid"
                        className="h-8 min-w-[3rem] text-sm font-bold shadow-xs px-2"
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
