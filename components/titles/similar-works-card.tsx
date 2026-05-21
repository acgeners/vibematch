import Link from "next/link"
import { Sparkles, Sparkle, Star, ImageOff } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            via embeddings semânticos
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {works.map((w) => (
            <li key={w.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Link
                href={`/titles/${titleToSlug(w.title)}`}
                className="shrink-0 size-12 overflow-hidden rounded-md border border-border bg-muted relative"
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
                    <ImageOff className="h-4 w-4" />
                  </div>
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <WorkTitleLink
                  title={w.title}
                  workId={w.id}
                  className="block font-medium text-sm hover:underline line-clamp-1"
                />
                {w.synopsis && (
                  <p className="line-clamp-1 text-[11px] text-muted-foreground">{w.synopsis}</p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge
                  variant="outline"
                  className={cn("font-mono text-[10px] py-0 px-1.5", similarityClasses(w.similarity))}
                >
                  {formatSimilarity(w.similarity)}
                </Badge>
                {w.manualScore != null && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 tabular-nums cursor-help">
                          <Star className="h-3 w-3 fill-current" />
                          {w.manualScore.toFixed(1)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[200px]">
                        Sua nota pessoal (manual_score) — você já avaliou esta obra.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {w.manualScore == null && w.finalScore != null && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums cursor-help">
                          <Sparkle className="h-3 w-3" />
                          {w.finalScore.toFixed(1)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[200px]">
                        Nota.Final prevista pelo sistema — você ainda não avaliou.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
