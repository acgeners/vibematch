"use client"

import Link from "next/link"
import { AlertTriangle, CheckCircle2, Crown, ExternalLink, ImageOff, Lightbulb, Trophy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AdultBadge } from "@/components/ui/adult-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CoverImage } from "@/components/ui/cover-image"
import { cn, titleToSlug } from "@/lib/utils"
import { LABELS } from "@/lib/constants/ui-labels"
import type { RankedCandidate } from "@/lib/ai-recommendation/types"

interface RankedWorkWinnerCardProps {
  ranked: RankedCandidate
  /** Total de obras comparadas na run (pro texto "comparou as N obras"). */
  totalCount: number
}

function quality(score: number): { label: string; scoreClass: string; badgeClass: string } {
  if (score >= 90)
    return { label: "Match excepcional", scoreClass: "text-emerald-600 dark:text-emerald-400", badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
  if (score >= 70)
    return { label: "Match forte", scoreClass: "text-lime-600 dark:text-lime-400", badgeClass: "border-lime-500/40 bg-lime-500/10 text-lime-700 dark:text-lime-300" }
  if (score >= 50)
    return { label: "Bom match", scoreClass: "text-amber-600 dark:text-amber-400", badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
  if (score >= 30)
    return { label: "Match fraco", scoreClass: "text-orange-600 dark:text-orange-400", badgeClass: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300" }
  return { label: "Pouco alinhado", scoreClass: "text-rose-600 dark:text-rose-400", badgeClass: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" }
}

export function RankedWorkWinnerCard({ ranked, totalCount }: RankedWorkWinnerCardProps) {
  const { work, coverUrl, alignment_score, justification, top_match_factors } = ranked
  const risks = ranked.risks ?? []
  const href = `/titles/${titleToSlug(work.title)}`
  const q = quality(alignment_score)

  return (
    <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.03] via-card/50 to-card/50 p-5 shadow-lg shadow-amber-500/[0.02] ring-1 ring-amber-400/15">
      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Capa */}
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block w-48 lg:w-full h-full min-h-[280px] lg:min-h-0 overflow-hidden rounded-lg border bg-muted shadow transition-all duration-300 hover:border-amber-400/40"
        >
          {coverUrl ? (
            <CoverImage
              url={coverUrl}
              alt={work.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-8 w-8 opacity-40" />
            </div>
          )}
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-amber-400 px-2 py-1 text-[11px] font-bold text-amber-950 shadow ring-1 ring-amber-300/60 select-none">
            <Crown className="h-3.5 w-3.5 fill-amber-950/20" /> #1
          </span>
        </Link>

        {/* Coluna principal (Detalhes) */}
        <div className="flex min-w-0 flex-col justify-center">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500 select-none">
            <Trophy className="h-3.5 w-3.5 fill-amber-500/10" /> Recomendação principal
          </p>
          <div className="mt-1">
            <Link
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-2xl font-extrabold leading-tight tracking-tight text-foreground hover:underline"
            >
              {work.title}
              <ExternalLink className="h-4 w-4 text-muted-foreground/60 shrink-0" />
            </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn("w-fit text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 select-none", q.badgeClass)}>
              {q.label}
            </Badge>
            {work.isAdult && <AdultBadge className="text-[10px] px-2 py-0.5" />}
          </div>

          {/* AI Score card containing the Laurel Wreath and details */}
          <div className="flex items-center gap-4 rounded-xl border border-border/80 bg-card/65 p-3.5 mt-4">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="relative flex size-16 shrink-0 items-center justify-center cursor-help select-none">
                    {/* Laurel Wreath SVG */}
                    <svg
                      viewBox="0 0 24 24"
                      className={cn("absolute inset-0 size-full", q.scoreClass)}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {/* Left branch */}
                      <path d="M6 18c-1.5-1.5-2.5-4-2.5-6.5S4.5 7 6 5.5" />
                      <path d="M3 14.5c.8-.5 1.7-.2 2 .5M2.5 11c.9-.3 1.8.2 2 1M3 7.5c.9 0 1.6.7 1.8 1.5" />
                      {/* Right branch */}
                      <path d="M18 18c1.5-1.5 2.5-4 2.5-6.5S19.5 7 18 5.5" />
                      <path d="M21 14.5c-.8-.5-1.7-.2-2 .5M21.5 11c-.9-.3-1.8.2-2 1M21 7.5c-.9 0-1.6.7-1.8 1.5" />
                    </svg>
                    <div className="flex flex-col items-center justify-center z-10 mt-[-1px]">
                      <span className={cn("text-2xl font-black leading-none tabular-nums", q.scoreClass)}>
                        {Math.round(alignment_score)}
                      </span>
                      <span className="text-[6px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-0.5">
                        {LABELS.alignment_score.short}
                      </span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[300px] space-y-1.5">
                  <p className="text-xs font-semibold">{LABELS.alignment_score.full}: {Math.round(alignment_score)}/100</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    90+ excepcional · 70–89 forte · 50–69 moderado · 30–49 fraco · &lt;30 pouco alinhado
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">Melhor combinação para seu perfil</p>
              <p className="text-xs leading-relaxed text-muted-foreground mt-0.5">
                Reúne os elementos que mais se alinham com suas preferências e padrões narrativos.
              </p>
            </div>
          </div>

          {/* Justification paragraph in the middle column */}
          <p className="text-sm leading-relaxed text-foreground/90 mt-4 italic border-l-2 border-border/80 pl-3">
            {justification}
          </p>
        </div>

        {/* Coluna da direita (Por que ganhou? + Tags) */}
        <div className="flex flex-col gap-4 justify-start">
          <div className="flex flex-col justify-start rounded-xl border border-border/70 bg-card/30 p-4 lg:p-5">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground select-none">
              <Lightbulb className="h-4 w-4 text-amber-500" /> Por que essa obra ganhou?
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Nossa IA comparou as {totalCount} obras candidatas e identificou que esta obra oferece o melhor equilíbrio
              entre os elementos que você mais valoriza.
            </p>
            {(top_match_factors.length > 0 || risks.length > 0) && (
              <ul className="mt-4 space-y-2">
                {top_match_factors.map((factor) => (
                  <li key={`pro:${factor}`} className="flex items-start gap-2 text-xs leading-snug text-foreground/90">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{factor}</span>
                  </li>
                ))}
                {risks.map((risk) => (
                  <li key={`con:${risk}`} className="flex items-start gap-2 text-xs leading-snug text-foreground/90">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Genre tags of the work inside the right column */}
          {work.tags && work.tags.length > 0 && (
            <div className="flex flex-col gap-2 px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 select-none">
                Tags da obra
              </span>
              <div className="flex flex-wrap gap-2">
                {work.tags.slice(0, 6).map((tag) => (
                  <Badge
                    key={tag.name}
                    variant="secondary"
                    className="bg-muted/60 hover:bg-muted/80 text-muted-foreground/95 text-xs font-medium px-2.5 py-1 select-none transition-colors border-0 rounded-md"
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
