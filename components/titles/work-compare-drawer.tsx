"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ExternalLink, ImageOff, Loader2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScoreBadge, type ScoreColorThresholds } from "@/components/ui/score-badge"
import {
  PersonalStatusBadge,
  PublicationStatusBadge,
} from "@/components/ui/status-badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { cn } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { fetchCompareWorks, type CompareWork } from "@/server/actions/compare"

interface WorkCompareDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: string[]
  onClear: () => void
  onRemoveId: (id: string) => void
  scoreThresholds: ScoreColorThresholds | null
}

export function WorkCompareDrawer({
  open,
  onOpenChange,
  ids,
  onClear,
  onRemoveId,
  scoreThresholds,
}: WorkCompareDrawerProps) {
  const [works, setWorks] = useState<CompareWork[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idsKey = ids.join(",")

  useEffect(() => {
    if (!open || ids.length === 0) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    fetchCompareWorks(ids)
      .then((data) => {
        if (cancelled) return
        setWorks(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "Erro ao carregar"
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, idsKey, ids])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[92vh] max-h-[92vh] gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <SheetHeader className="flex flex-row items-center justify-between border-b bg-card/80 px-4 py-3">
          <SheetTitle className="text-base">
            Comparar {loading ? ids.length : works.length} obra{(loading ? ids.length : works.length) !== 1 ? "s" : ""}
            {!loading && works.length < ids.length && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({ids.length - works.length} não carregada{ids.length - works.length !== 1 ? "s" : ""})
              </span>
            )}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
              Limpar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-7 w-7"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando comparação…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          ) : works.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Nenhuma obra selecionada.
            </div>
          ) : (
            <CompareGrid
              works={works}
              onRemoveId={onRemoveId}
              scoreThresholds={scoreThresholds}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface CompareGridProps {
  works: CompareWork[]
  onRemoveId: (id: string) => void
  scoreThresholds: ScoreColorThresholds | null
}

function CompareGrid({ works, onRemoveId, scoreThresholds }: CompareGridProps) {
  const n = works.length

  const bestByRow = useMemo(() => {
    const best: Record<string, number> = {}
    const rows: Array<{ key: string; getValue: (w: CompareWork) => number | null }> = [
      { key: "finalScore", getValue: (w) => w.finalScore },
      { key: "calcScore", getValue: (w) => w.calcScore },
      { key: "predictedScore", getValue: (w) => w.predictedScore },
      { key: "manualScore", getValue: (w) => w.manualScore },
      { key: "platformAvg", getValue: (w) => w.platformAvg },
      ...CRITERION_SLUGS.map((slug) => ({
        key: `crit:${slug}`,
        getValue: (w: CompareWork) => w.criteria.find((c) => c.slug === slug)?.score ?? null,
      })),
    ]
    for (const row of rows) {
      const values = works.map((w) => row.getValue(w))
      const max = values.reduce<number | null>(
        (acc, v) => (v == null ? acc : acc == null ? v : Math.max(acc, v)),
        null
      )
      if (max != null) best[row.key] = max
    }
    return best
  }, [works])

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `140px repeat(${n}, minmax(240px, 320px))`,
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="mx-auto grid w-fit gap-x-3 px-4 py-4 text-sm sm:px-6"
        style={gridStyle}
      >
        {/* Cabeçalho: capa + título + remover */}
        <div className="sticky top-0 z-10" />
        {works.map((w) => (
          <CompareHeaderCell key={w.id} work={w} onRemove={() => onRemoveId(w.id)} />
        ))}

        {/* Metadados básicos */}
        <SectionLabel label="Status" />
        {works.map((w) => (
          <CompareCell key={w.id}>
            <div className="flex flex-wrap items-center gap-1">
              <PublicationStatusBadge statusId={w.publicationStatusId ?? undefined} />
              <PersonalStatusBadge statusId={w.personalStatusId ?? undefined} />
            </div>
          </CompareCell>
        ))}

        <SectionLabel label="Capítulos" />
        {works.map((w) => (
          <CompareCell key={w.id}>
            <span className="font-mono text-sm">
              {w.chaptersRead ?? "?"} / {w.totalChapters ?? "?"}
            </span>
          </CompareCell>
        ))}

        <SectionLabel label="Ano · Sinopse" />
        {works.map((w) => (
          <CompareCell key={w.id}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{w.year ?? "—"}</span>
              {w.synopsisQuality && (
                <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 text-[10px] font-semibold text-rose-700">
                  {w.synopsisQuality}
                </span>
              )}
            </div>
          </CompareCell>
        ))}

        {/* Notas */}
        <SectionTitle label="Notas" />

        <ScoreRow
          label="Final"
          works={works}
          getScore={(w) => w.finalScore}
          best={bestByRow.finalScore}
          thresholds={scoreThresholds}
        />
        <ScoreRow
          label="IA"
          works={works}
          getScore={(w) => w.calcScore}
          best={bestByRow.calcScore}
          thresholds={scoreThresholds}
        />
        <ScoreRow
          label="Prevista"
          works={works}
          getScore={(w) => w.predictedScore}
          best={bestByRow.predictedScore}
          thresholds={scoreThresholds}
          getStub={(w) => w.predictedIsStub}
        />
        <ScoreRow
          label="Pessoal"
          works={works}
          getScore={(w) => w.manualScore}
          best={bestByRow.manualScore}
          thresholds={null}
        />
        <ScoreRow
          label="Média externa"
          works={works}
          getScore={(w) => w.platformAvg}
          best={bestByRow.platformAvg}
          thresholds={null}
          formatScore={(v) => v.toFixed(2)}
          renderExtra={(w) =>
            w.totalVotes > 0 ? (
              <span className="text-[10px] text-muted-foreground">
                {formatVotes(w.totalVotes)} votos
              </span>
            ) : null
          }
        />

        {/* Critérios */}
        <SectionTitle label="Critérios" />
        {CRITERION_SLUGS.map((slug) => {
          const info = CRITERIA_INFO[slug]
          return (
            <CriterionRow
              key={slug}
              slug={slug}
              label={info.name}
              emoji={info.emoji}
              works={works}
              best={bestByRow[`crit:${slug}`]}
            />
          )
        })}

        {/* Sinopse */}
        <SectionTitle label="Sinopse" />
        <SectionLabel label="" />
        {works.map((w) => (
          <CompareCell key={w.id} verticalAlign="top">
            {w.synopsis ? (
              <p className="text-[13px] leading-relaxed text-foreground/85 line-clamp-[8]">
                {w.synopsis}
              </p>
            ) : (
              <span className="text-xs italic text-muted-foreground">Sem sinopse</span>
            )}
          </CompareCell>
        ))}

        {/* Gêneros e tags */}
        <SectionTitle label="Gêneros · Tags" />
        <SectionLabel label="Gêneros" />
        {works.map((w) => (
          <CompareCell key={w.id}>
            {w.genres.length === 0 ? (
              <span className="text-xs italic text-muted-foreground">—</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {w.genres.slice(0, 8).map((g) => (
                  <Badge key={g} variant="secondary" className="font-normal text-[10px] py-0">
                    {g}
                  </Badge>
                ))}
                {w.genres.length > 8 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{w.genres.length - 8}
                  </span>
                )}
              </div>
            )}
          </CompareCell>
        ))}

        <SectionLabel label="Tags" />
        {works.map((w) => (
          <CompareCell key={w.id}>
            {w.tags.length === 0 ? (
              <span className="text-xs italic text-muted-foreground">—</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {w.tags.slice(0, 10).map((t) => (
                  <Badge key={t.slug} variant="outline" className="font-normal text-[10px] py-0 h-5">
                    {t.name}
                  </Badge>
                ))}
                {w.tags.length > 10 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{w.tags.length - 10}
                  </span>
                )}
              </div>
            )}
          </CompareCell>
        ))}
      </div>
    </TooltipProvider>
  )
}

function CompareHeaderCell({
  work,
  onRemove,
}: {
  work: CompareWork
  onRemove: () => void
}) {
  return (
    <div className="relative flex flex-col gap-2 rounded-lg border bg-card/60 p-3">
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remover da comparação"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex gap-3">
        <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-md border bg-muted/40">
          {work.coverUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={getCoverImageSrc(work.coverUrl)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-6 w-6 opacity-40" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/titles/${work.slug}`}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-start gap-1 text-sm font-semibold leading-tight hover:underline"
          >
            <span className="line-clamp-3">{work.title}</span>
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" />
          </Link>
          {work.alternativeTitles.length > 0 && (
            <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground/70">
              {work.alternativeTitles.join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center text-xs font-medium text-muted-foreground">
      {label}
    </div>
  )
}

function SectionTitle({ label }: { label: string }) {
  return (
    <div className="col-span-full mt-4 mb-1 border-t pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
  )
}

interface CompareCellProps {
  children: React.ReactNode
  highlight?: boolean
  verticalAlign?: "center" | "top"
}

function CompareCell({ children, highlight, verticalAlign = "center" }: CompareCellProps) {
  return (
    <div
      className={cn(
        "flex min-h-[2.5rem] rounded-md border border-transparent bg-card/40 px-2.5 py-1.5",
        verticalAlign === "top" ? "items-start" : "items-center",
        highlight && "border-primary/40 bg-primary/5"
      )}
    >
      {children}
    </div>
  )
}

interface ScoreRowProps {
  label: string
  works: CompareWork[]
  getScore: (w: CompareWork) => number | null
  best: number | undefined
  thresholds: ScoreColorThresholds | null
  formatScore?: (v: number) => string
  getStub?: (w: CompareWork) => boolean
  renderExtra?: (w: CompareWork) => React.ReactNode
}

function ScoreRow({
  label,
  works,
  getScore,
  best,
  thresholds,
  formatScore,
  getStub,
  renderExtra,
}: ScoreRowProps) {
  return (
    <>
      <SectionLabel label={label} />
      {works.map((w) => {
        const score = getScore(w)
        const isBest = score != null && best != null && Math.abs(score - best) < 0.0001 && works.length > 1
        return (
          <CompareCell key={w.id} highlight={isBest}>
            <div className="flex items-baseline gap-2">
              {formatScore && score != null ? (
                <span className="font-mono text-sm font-semibold">{formatScore(score)}</span>
              ) : (
                <ScoreBadge
                  score={score}
                  size="sm"
                  thresholds={thresholds}
                  showStub={getStub?.(w) ?? false}
                />
              )}
              {renderExtra?.(w)}
            </div>
          </CompareCell>
        )
      })}
    </>
  )
}

interface CriterionRowProps {
  slug: string
  label: string
  emoji: string
  works: CompareWork[]
  best: number | undefined
}

function CriterionRow({ slug, label, emoji, works, best }: CriterionRowProps) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className="text-base">
          {emoji}
        </span>
        <span className="truncate">{label}</span>
      </div>
      {works.map((w) => {
        const entry = w.criteria.find((c) => c.slug === slug)
        const score = entry?.score ?? null
        const justification = entry?.aiJustification ?? null
        const isBest = score != null && best != null && Math.abs(score - best) < 0.0001 && works.length > 1
        return (
          <CompareCell key={w.id} highlight={isBest}>
            <div className="flex items-center gap-2">
              {score == null ? (
                <span className="font-mono text-sm text-muted-foreground">—</span>
              ) : (
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-md font-mono text-sm font-bold",
                    getCriterionColor(score, slug)
                  )}
                >
                  {score.toFixed(1)}
                </span>
              )}
              {justification && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-[10px] uppercase tracking-wide text-muted-foreground/70 hover:text-foreground"
                    >
                      ver
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                    {justification}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </CompareCell>
        )
      })}
    </>
  )
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

function formatVotes(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}
