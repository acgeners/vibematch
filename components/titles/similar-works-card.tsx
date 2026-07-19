"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Sparkles, ImageOff, Info, BookOpen, Star, Users, Target } from "lucide-react"
import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge } from "@/components/ui/status-badge"
import { AdultBadge } from "@/components/ui/adult-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { LABELS } from "@/lib/constants/ui-labels"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { InterestAppliedMark } from "@/components/ui/interest-applied-mark"
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

function formatVotes(votes: number): string {
  if (votes === 0) return "—"
  if (votes < 1000) return String(votes)
  const k = Math.floor(votes / 100) / 10
  const formatted = k % 1 === 0 ? String(k) : k.toFixed(1).replace(".", ",")
  return `${formatted}K`
}

/** Faixa de cor do Alinhamento (percentil) — mesma do /ranking. */
function alignmentTextClass(pct: number): string {
  if (pct >= 75) return "text-emerald-600 dark:text-emerald-400"
  if (pct >= 50) return "text-amber-600 dark:text-amber-400"
  if (pct >= 25) return "text-orange-600 dark:text-orange-400"
  return "text-muted-foreground"
}

/** Faixa de cor do Veredito IA (0–100) — mesma do /ranking. */
function verdictTextClass(v: number): string {
  if (v >= 80) return "text-violet-600 dark:text-violet-300"
  if (v >= 60) return "text-sky-600 dark:text-sky-300"
  if (v >= 40) return "text-amber-600 dark:text-amber-300"
  return "text-slate-600 dark:text-slate-300"
}

/** Escala de 4 corações (mesma do hover/ranking). */
function Hearts({ quality, variant }: { quality: string; variant: "manual" | "pred" }) {
  const filled = Math.min(4, Math.max(0, [...quality].length))
  const empty = 4 - filled
  return (
    <span
      className={cn(
        "text-[15px] leading-none tracking-[0.12em]",
        variant === "manual" ? "text-red-500" : "text-orange-500",
      )}
    >
      {"♥".repeat(filled)}
      {empty > 0 && <span className="opacity-25">{"♥".repeat(empty)}</span>}
    </span>
  )
}

/** Interesse: manual (vermelho) + previsto pela IA (laranja + selo IA). */
function InterestHearts({
  manual,
  manualFromPrediction = false,
  predicted,
  predictedStale,
}: {
  manual: string | null
  /** Manual foi aplicado da previsão (não definido à mão) → selo ✨. */
  manualFromPrediction?: boolean
  predicted: string | null
  predictedStale: boolean
}) {
  if (!manual && !predicted) return null
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" aria-label="Interesse na obra">
      {manual && <Hearts quality={manual} variant="manual" />}
      {manual && manualFromPrediction && <InterestAppliedMark size={12} />}
      {manual && predicted && <span className="h-3 w-px bg-border/70" aria-hidden />}
      {predicted && (
        <span className="inline-flex items-center gap-1">
          <Hearts quality={predicted} variant="pred" />
          <span
            className={cn(
              "rounded border border-orange-500/40 px-[3px] text-[8px] font-extrabold leading-[1.4] tracking-wide text-orange-500 dark:text-orange-400",
              predictedStale && "opacity-60",
            )}
          >
            IA
          </span>
        </span>
      )}
    </span>
  )
}

/** Status de publicação discreto: emoji + código curto na cor do status (hex do DB). */
function StatusFacet({ statusId }: { statusId: number }) {
  const info = PUBLICATION_STATUSES_BY_ID[statusId]
  if (!info) return null
  return (
    <span className="inline-flex items-center gap-1" title={info.status}>
      <span aria-hidden>{info.symbol}</span>
      <span className="font-medium" style={info.color ? { color: info.color } : undefined}>
        {info.short}
      </span>
    </span>
  )
}

/** Métrica compacta: rótulo minúsculo + ícone/valor — mesmo padrão do hover/ranking. */
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap text-[8px] font-bold uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="inline-flex items-center gap-1 text-[13px] font-bold leading-none tabular-nums">
        {children}
      </span>
    </div>
  )
}

export function SimilarWorksCard({ works, className }: SimilarWorksCardProps) {
  const [sortBy, setSortBy] = useState<"sim" | "nota">("sim")
  const sorted = useMemo(() => {
    // Nota exibida no card: pessoal quando avaliada, senão a Nota Prevista.
    const score = (w: SimilarWork) => w.userScore ?? w.expectedScore
    if (sortBy === "nota") {
      // Maior nota primeiro; obras sem nota vão pro fim (sort estável preserva a
      // ordem de similaridade original como desempate).
      return [...works].sort((a, b) => {
        const sa = score(a)
        const sb = score(b)
        if (sa == null && sb == null) return 0
        if (sa == null) return 1
        if (sb == null) return -1
        return sb - sa
      })
    }
    return [...works].sort((a, b) => b.similarity - a.similarity)
  }, [works, sortBy])

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
                  <strong>Similaridade semântica.</strong> De cada obra montamos um
                  “retrato” em texto — sinopse, tags e gêneros, as notas dos atributos
                  avaliados pela IA e um resumo das reviews — e transformamos esse texto
                  num vetor (<strong>embedding</strong>). O <strong>%</strong> é a
                  proximidade entre os dois vetores, medida por distância cosseno.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>

          {works.length > 1 && (
            <div className="flex items-center gap-2.5 sm:shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground/60">
                Ordenar por
              </span>
              <div className="inline-flex gap-0.5 rounded-full border border-border/50 bg-muted/20 p-[3px]">
                <button
                  type="button"
                  onClick={() => setSortBy("sim")}
                  aria-pressed={sortBy === "sim"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors",
                    sortBy === "sim" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Target className="size-3" />
                  Similaridade
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy("nota")}
                  aria-pressed={sortBy === "nota"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors",
                    sortBy === "nota" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Star className="size-3" />
                  Nota prevista
                </button>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Barra de Legenda */}
        <div className="flex flex-col gap-2 border-b border-border/40 pb-4 mb-4 text-xs text-muted-foreground bg-muted/15 p-3 rounded-lg mt-1">
          <div className="flex items-center gap-1">
            <span className="font-bold text-foreground text-[13px]">Legenda das informações:</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-1">
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold leading-none">
                  similar
                </span>
                <Badge
                  variant="outline"
                  className="h-8 min-w-[3rem] font-mono text-sm font-bold px-2 py-0.5 rounded-md border flex items-center justify-center shadow-xs bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300 pointer-events-none"
                >
                  NN%
                </Badge>
              </div>
              <p className="text-[13px] leading-snug">
                Similaridade semântica com esta obra. Calculada por distância cosseno entre os embeddings de cada obra.
              </p>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold leading-none">
                  prevista
                </span>
                <ScoreBadge score={null} variant="solid" className="h-8 min-w-[3rem] text-sm font-bold shadow-xs px-2 pointer-events-none" />
              </div>
              <p className="text-[13px] leading-snug">
                Sua nota pessoal se você já avaliou (rótulo <em>pessoal</em>), ou a Nota Prevista pelo sistema se ainda não (rótulo <em>prevista</em>).
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {sorted.map((w) => {
            const displayScore = w.userScore ?? w.expectedScore
            const isManual = w.userScore != null
            // Status de leitura: oculta "Untracked" (id 10 = sem status ativo).
            const readingStatusId =
              w.personalStatusId != null && w.personalStatusId !== 10 ? w.personalStatusId : null
            const alignmentPct =
              w.personalFitPercentile != null
                ? Math.round(w.personalFitPercentile)
                : w.personalFit != null
                  ? Math.round(w.personalFit * 100)
                  : null
            const hasMetaLine =
              w.year != null ||
              w.totalChapters != null ||
              w.publicationStatusId != null ||
              readingStatusId != null

            return (
              <div
                key={w.id}
                className="group grid grid-cols-1 sm:grid-cols-[auto_minmax(0,300px)_minmax(0,1fr)_auto] rounded-xl border border-border/50 bg-card/25 hover:bg-card/70 hover:border-primary/20 hover:shadow-md transition-all duration-300 overflow-hidden"
              >
                {/* Col 1 — capa */}
                <div className="flex items-start justify-center p-3">
                  <Link
                    href={`/titles/${titleToSlug(w.title)}`}
                    className="block h-[148px] w-[104px] overflow-hidden rounded-lg border border-border bg-muted shadow-sm transition-transform group-hover:scale-[1.02]"
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
                </div>

                {/* Col 2 — título, status, interesse, métricas */}
                <div className="flex min-w-0 flex-col gap-2 border-t border-border/40 p-4 sm:border-l sm:border-t-0">
                  <WorkTitleLink
                    title={w.title}
                    className="block font-bold text-[15px] leading-tight text-foreground group-hover:text-primary transition-colors hover:underline line-clamp-2"
                  />

                  {w.isAdult && <AdultBadge className="w-fit px-1.5 py-0 text-[11px]" />}

                  {hasMetaLine && (
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] font-medium text-foreground/85">
                      {w.year != null && <span>{w.year}</span>}
                      {w.year != null && w.totalChapters != null && (
                        <span className="text-muted-foreground/40">·</span>
                      )}
                      {w.totalChapters != null && (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <BookOpen className="size-3 text-muted-foreground/70" />
                          {w.totalChapters}
                        </span>
                      )}
                      {(w.year != null || w.totalChapters != null) && w.publicationStatusId != null && (
                        <span className="text-muted-foreground/40">·</span>
                      )}
                      {w.publicationStatusId != null && <StatusFacet statusId={w.publicationStatusId} />}
                      {readingStatusId != null && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <PersonalStatusBadge
                            statusId={readingStatusId}
                            className="h-[19px] gap-1 rounded-full border px-2 py-0 text-[11px] font-semibold"
                          />
                        </>
                      )}
                    </div>
                  )}

                  <InterestHearts
                    manual={w.synopsisQuality}
                    manualFromPrediction={w.synopsisFromPrediction}
                    predicted={w.predictedSynopsisQuality}
                    predictedStale={w.predictedSynopsisStale}
                  />

                  {/* Métricas: Externa · Votos · Alinhamento · Veredito IA */}
                  <div className="mt-auto flex flex-wrap items-end gap-x-4 gap-y-2 pt-2">
                    {w.platformAvg != null && (
                      <Metric label="Externa">
                        <Star className="size-3 fill-amber-500 text-amber-500" />
                        {w.platformAvg.toFixed(1).replace(".", ",")}
                      </Metric>
                    )}
                    {w.totalVotes != null && w.totalVotes > 0 && (
                      <Metric label="Votos">
                        <Users className="size-3 text-muted-foreground/70" />
                        {formatVotes(w.totalVotes)}
                      </Metric>
                    )}
                    {alignmentPct != null && (
                      <Metric label="Alinhamento">
                        <span className={cn("inline-flex items-center gap-1", alignmentTextClass(alignmentPct))}>
                          <Target className="size-3" />
                          {alignmentPct}%
                        </span>
                      </Metric>
                    )}
                    <Metric label={LABELS.alignment_score.full}>
                      {w.alignmentScore != null ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            verdictTextClass(w.alignmentScore),
                            w.alignmentStale && "opacity-60",
                          )}
                        >
                          <Sparkles className="size-3" />
                          {Math.round(w.alignmentScore)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </Metric>
                  </div>
                </div>

                {/* Col 3 — sinopse canônica */}
                <div className="min-w-0 border-t border-border/40 p-4 sm:border-l sm:border-t-0">
                  {w.synopsis ? (
                    <p className="text-[13px] italic text-muted-foreground leading-snug line-clamp-6">
                      {w.synopsis}
                    </p>
                  ) : (
                    <p className="text-[13px] italic text-muted-foreground/50">Sem sinopse.</p>
                  )}
                </div>

                {/* Col 4 — Similar + Prevista/Pessoal */}
                <div className="flex flex-row items-center justify-center gap-4 border-t border-border/40 p-4 sm:flex-col sm:border-l sm:border-t-0">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold leading-none">
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
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold leading-none">
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
