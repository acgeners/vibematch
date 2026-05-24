"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  ImageOff,
  Loader2,
  RotateCcw,
  Rows3,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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

const HIDDEN_ROWS_STORAGE_KEY = "compare_hidden_rows_v1"

interface CompareRowDef {
  key: string
  label: string
}

interface CompareRowGroup {
  id: string
  label: string
  rows: CompareRowDef[]
}

const COMPARE_ROW_GROUPS: CompareRowGroup[] = [
  {
    id: "basico",
    label: "Básico",
    rows: [
      { key: "status", label: "Status" },
      { key: "chapters", label: "Capítulos" },
      { key: "ano", label: "Ano" },
    ],
  },
  {
    id: "notas",
    label: "Notas",
    rows: [
      { key: "score:finalScore", label: "Final" },
      { key: "score:calcScore", label: "IA" },
      { key: "score:predictedScore", label: "Prevista" },
      { key: "score:manualScore", label: "Pessoal" },
      { key: "score:platformAvg", label: "Média externa" },
    ],
  },
  {
    id: "criterios",
    label: "Critérios",
    rows: CRITERION_SLUGS.map((slug) => ({
      key: `crit:${slug}`,
      label: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERIA_INFO[slug]?.name ?? slug}`.trim(),
    })),
  },
  {
    id: "outros",
    label: "Outros",
    rows: [{ key: "tags-genres", label: "Gêneros · Tags" }],
  },
]

const ALL_ROW_KEYS = COMPARE_ROW_GROUPS.flatMap((g) => g.rows.map((r) => r.key))
const TOTAL_ROW_COUNT = ALL_ROW_KEYS.length

function readHiddenRows(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(HIDDEN_ROWS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((k): k is string => typeof k === "string"))
  } catch {
    return new Set()
  }
}

function writeHiddenRows(rows: Set<string>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(HIDDEN_ROWS_STORAGE_KEY, JSON.stringify([...rows]))
  } catch {
    // ignore quota / privacy mode errors
  }
}

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
  const [diffOnly, setDiffOnly] = useState(false)
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(() => readHiddenRows())
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

  const toggleRow = (key: string) =>
    setHiddenRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeHiddenRows(next)
      return next
    })

  const resetRows = () => {
    const next = new Set<string>()
    writeHiddenRows(next)
    setHiddenRows(next)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[92vh] max-h-[92vh] gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <SheetHeader className="flex flex-row items-center justify-between gap-2 border-b bg-card/80 px-4 py-3">
          <SheetTitle className="text-base">
            Comparar {loading ? ids.length : works.length} obra
            {(loading ? ids.length : works.length) !== 1 ? "s" : ""}
            {!loading && works.length < ids.length && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({ids.length - works.length} não carregada
                {ids.length - works.length !== 1 ? "s" : ""})
              </span>
            )}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <CompareRowPicker
              hiddenRows={hiddenRows}
              onToggle={toggleRow}
              onReset={resetRows}
            />
            {works.length >= 2 && (
              <Button
                variant={diffOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setDiffOnly((v) => !v)}
                className="h-7 text-xs"
              >
                Só diferenças
              </Button>
            )}
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
              diffOnly={diffOnly}
              hiddenRows={hiddenRows}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CompareRowPicker({
  hiddenRows,
  onToggle,
  onReset,
}: {
  hiddenRows: Set<string>
  onToggle: (key: string) => void
  onReset: () => void
}) {
  const visibleCount = TOTAL_ROW_COUNT - hiddenRows.size
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <Rows3 className="h-3.5 w-3.5" />
          Linhas
          <span className="rounded-full bg-muted/70 px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
            {visibleCount}/{TOTAL_ROW_COUNT}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-72 flex-col p-3 max-h-[var(--radix-popover-content-available-height)]"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Linhas visíveis
          </p>
          <Button
            variant="ghost"
            size="xs"
            onClick={onReset}
            className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Padrão
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {COMPARE_ROW_GROUPS.map((group) => {
            const groupVisibleCount = group.rows.filter(
              (r) => !hiddenRows.has(r.key)
            ).length
            const allVisible = groupVisibleCount === group.rows.length
            return (
              <div key={group.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.label}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      // Toggle all in group: if any visible → hide all; else show all
                      for (const r of group.rows) {
                        const isCurrentlyHidden = hiddenRows.has(r.key)
                        if (allVisible && !isCurrentlyHidden) onToggle(r.key)
                        if (!allVisible && isCurrentlyHidden) onToggle(r.key)
                      }
                    }}
                    className="text-[10px] text-muted-foreground/70 hover:text-foreground"
                  >
                    {allVisible ? "ocultar todos" : "mostrar todos"}
                  </button>
                </div>
                <div className="space-y-0.5">
                  {group.rows.map((row) => {
                    const id = `compare-row-${row.key}`
                    const checked = !hiddenRows.has(row.key)
                    return (
                      <label
                        key={row.key}
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/60"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={() => onToggle(row.key)}
                        />
                        <span className="truncate">{row.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface CompareGridProps {
  works: CompareWork[]
  onRemoveId: (id: string) => void
  scoreThresholds: ScoreColorThresholds | null
  diffOnly: boolean
  hiddenRows: Set<string>
}

type SectionKey = "notas" | "criterios" | "tags-generos"

const NEGATIVE_CRITERIA = new Set<string>(["drama", "tragedy"])

function CompareGrid({
  works,
  onRemoveId,
  scoreThresholds,
  diffOnly,
  hiddenRows,
}: CompareGridProps) {
  const n = works.length
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set())

  const toggleSection = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const isCollapsed = (key: SectionKey) => collapsed.has(key)

  const bestWorstByRow = useMemo(() => {
    const result: Record<string, { best: number; worst: number }> = {}
    const baseRows: Array<{
      key: string
      getValue: (w: CompareWork) => number | null
      negative?: boolean
    }> = [
      { key: "score:finalScore", getValue: (w) => w.finalScore },
      { key: "score:calcScore", getValue: (w) => w.calcScore },
      { key: "score:predictedScore", getValue: (w) => w.predictedScore },
      { key: "score:manualScore", getValue: (w) => w.manualScore },
      { key: "score:platformAvg", getValue: (w) => w.platformAvg },
    ]
    const critRows = CRITERION_SLUGS.map((slug) => ({
      key: `crit:${slug}`,
      getValue: (w: CompareWork) => w.criteria.find((c) => c.slug === slug)?.score ?? null,
      negative: NEGATIVE_CRITERIA.has(slug),
    }))
    for (const row of [...baseRows, ...critRows]) {
      const values = works
        .map((w) => row.getValue(w))
        .filter((v): v is number => v != null)
      if (values.length === 0) continue
      const max = Math.max(...values)
      const min = Math.min(...values)
      result[row.key] = row.negative ? { best: min, worst: max } : { best: max, worst: min }
    }
    return result
  }, [works])

  const allEqualScore = (getter: (w: CompareWork) => number | null): boolean => {
    if (works.length < 2) return false
    const values = works.map(getter)
    const first = values[0]
    return values.every(
      (v) =>
        (v == null && first == null) ||
        (v != null && first != null && Math.abs(v - first) < 0.05)
    )
  }
  const allEqual = <T,>(getter: (w: CompareWork) => T): boolean => {
    if (works.length < 2) return false
    const values = works.map(getter)
    return values.every((v) => v === values[0])
  }

  // Per-row visibility: user hide + diff-only filter
  const isRowVisible = (
    key: string,
    diffEqualFn?: () => boolean
  ): boolean => {
    if (hiddenRows.has(key)) return false
    if (diffOnly && diffEqualFn && diffEqualFn()) return false
    return true
  }

  const statusVisible = isRowVisible(
    "status",
    () => allEqual((w) => w.publicationStatusId) && allEqual((w) => w.personalStatusId)
  )
  const chaptersVisible = isRowVisible("chapters", () =>
    allEqual((w) => `${w.chaptersRead ?? "?"}/${w.totalChapters ?? "?"}`)
  )
  const yearVisible = isRowVisible("ano", () => allEqual((w) => w.year))

  const notasRowDefs: Array<{
    key: string
    label: string
    get: (w: CompareWork) => number | null
    stub?: (w: CompareWork) => boolean
    formatScore?: (v: number) => string
    thresholds: ScoreColorThresholds | null
    renderExtra?: (w: CompareWork) => React.ReactNode
  }> = [
    {
      key: "score:finalScore",
      label: "Final",
      get: (w) => w.finalScore,
      thresholds: scoreThresholds,
    },
    {
      key: "score:calcScore",
      label: "IA",
      get: (w) => w.calcScore,
      thresholds: scoreThresholds,
    },
    {
      key: "score:predictedScore",
      label: "Prevista",
      get: (w) => w.predictedScore,
      stub: (w) => w.predictedIsStub,
      thresholds: scoreThresholds,
    },
    {
      key: "score:manualScore",
      label: "Pessoal",
      get: (w) => w.manualScore,
      thresholds: null,
    },
    {
      key: "score:platformAvg",
      label: "Média externa",
      get: (w) => w.platformAvg,
      thresholds: null,
      formatScore: (v) => v.toFixed(2),
      renderExtra: (w) =>
        w.totalVotes > 0 ? (
          <span className="text-[10px] text-muted-foreground">
            {formatVotes(w.totalVotes)} votos
          </span>
        ) : null,
    },
  ]

  const visibleNotasRows = notasRowDefs.filter((r) =>
    isRowVisible(r.key, () => allEqualScore(r.get))
  )
  const visibleCritSlugs = CRITERION_SLUGS.filter((slug) =>
    isRowVisible(`crit:${slug}`, () =>
      allEqualScore((w) => w.criteria.find((c) => c.slug === slug)?.score ?? null)
    )
  )
  const tagsGenresVisible = isRowVisible("tags-genres")

  const showNotasSection = visibleNotasRows.length > 0
  const showCriteriosSection = visibleCritSlugs.length > 0

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `120px repeat(${n}, minmax(180px, 240px))`,
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="mx-auto grid w-fit gap-x-2 px-4 py-4 text-sm sm:px-6"
        style={gridStyle}
      >
        {/* Header */}
        <div className="sticky left-0 z-20 bg-background" />
        {works.map((w) => (
          <CompareHeaderCell key={w.id} work={w} onRemove={() => onRemoveId(w.id)} />
        ))}

        {/* Status */}
        {statusVisible && (
          <>
            <SectionLabel label="Status" />
            {works.map((w) => (
              <CompareCell key={w.id}>
                <div className="flex flex-wrap items-center gap-1">
                  <PublicationStatusBadge statusId={w.publicationStatusId ?? undefined} />
                  <PersonalStatusBadge statusId={w.personalStatusId ?? undefined} />
                </div>
              </CompareCell>
            ))}
          </>
        )}

        {/* Capítulos */}
        {chaptersVisible && (
          <>
            <SectionLabel label="Capítulos" />
            {works.map((w) => (
              <CompareCell key={w.id}>
                <span className="font-mono text-sm">
                  {w.chaptersRead ?? "?"} / {w.totalChapters ?? "?"}
                </span>
              </CompareCell>
            ))}
          </>
        )}

        {/* Ano */}
        {yearVisible && (
          <>
            <SectionLabel label="Ano" />
            {works.map((w) => (
              <CompareCell key={w.id}>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {w.year ?? "—"}
                </span>
              </CompareCell>
            ))}
          </>
        )}

        {/* Notas */}
        {showNotasSection && (
          <SectionTitle
            label="Notas"
            collapsed={isCollapsed("notas")}
            onToggle={() => toggleSection("notas")}
          />
        )}
        {showNotasSection && !isCollapsed("notas") &&
          visibleNotasRows.map((row) => (
            <ScoreRow
              key={row.key}
              label={row.label}
              works={works}
              getScore={row.get}
              bestWorst={bestWorstByRow[row.key]}
              thresholds={row.thresholds}
              formatScore={row.formatScore}
              getStub={row.stub}
              renderExtra={row.renderExtra}
            />
          ))}

        {/* Critérios */}
        {showCriteriosSection && (
          <SectionTitle
            label="Critérios"
            collapsed={isCollapsed("criterios")}
            onToggle={() => toggleSection("criterios")}
          />
        )}
        {showCriteriosSection && !isCollapsed("criterios") &&
          visibleCritSlugs.map((slug) => {
            const info = CRITERIA_INFO[slug]
            return (
              <CriterionRow
                key={slug}
                slug={slug}
                label={info.name}
                emoji={info.emoji}
                works={works}
                bestWorst={bestWorstByRow[`crit:${slug}`]}
              />
            )
          })}

        {/* Gêneros · Tags */}
        {tagsGenresVisible && (
          <SectionTitle
            label="Gêneros · Tags"
            collapsed={isCollapsed("tags-generos")}
            onToggle={() => toggleSection("tags-generos")}
          />
        )}
        {tagsGenresVisible && !isCollapsed("tags-generos") && (
          <>
            <SectionLabel label="" />
            {works.map((w) => (
              <CompareCell key={w.id} verticalAlign="top">
                <GenresTagsCell genres={w.genres} tags={w.tags} />
              </CompareCell>
            ))}
          </>
        )}
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
    <div className="relative flex flex-col gap-2 rounded-lg border bg-card/60 p-2.5">
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remover da comparação"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex gap-2.5">
        <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-md border bg-muted/40">
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
              <ImageOff className="h-5 w-5 opacity-40" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/titles/${work.slug}`}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-start gap-1 pr-6 text-sm font-semibold leading-tight hover:underline"
          >
            <span className="line-clamp-3">{work.title}</span>
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" />
          </Link>
          {work.alternativeTitles.length > 0 && (
            <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground/70">
              {work.alternativeTitles.join(" · ")}
            </p>
          )}
          <SynopsisButton
            synopsis={work.synopsis}
            synopsisQuality={work.synopsisQuality}
          />
        </div>
      </div>
    </div>
  )
}

function SynopsisButton({
  synopsis,
  synopsisQuality,
}: {
  synopsis: string | null
  synopsisQuality: string | null
}) {
  if (!synopsis) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="mt-2 inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-md border border-dashed bg-background/40 px-2 text-[11px] text-muted-foreground/60"
            aria-disabled="true"
          >
            <BookOpen className="h-3 w-3" />
            Sinopse
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Sem sinopse
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-2 inline-flex h-6 items-center gap-1 rounded-md border bg-background/60 px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-background hover:text-foreground"
        >
          <BookOpen className="h-3 w-3" />
          Sinopse
          {synopsisQuality && (
            <span className="ml-0.5 text-rose-600">{synopsisQuality}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="max-w-sm space-y-2 p-3 text-sm"
      >
        {synopsisQuality && (
          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 text-[10px] font-semibold text-rose-700">
            Interesse: {synopsisQuality}
          </span>
        )}
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
          {synopsis}
        </p>
      </PopoverContent>
    </Popover>
  )
}

function GenresTagsCell({
  genres,
  tags,
}: {
  genres: string[]
  tags: Array<{ slug: string; name: string }>
}) {
  const total = genres.length + tags.length
  if (total === 0) {
    return <span className="text-xs italic text-muted-foreground">—</span>
  }
  const VISIBLE = 5
  const visibleGenres = genres.slice(0, VISIBLE)
  const remainingForTags = Math.max(0, VISIBLE - visibleGenres.length)
  const visibleTags = tags.slice(0, remainingForTags)
  const remaining = total - visibleGenres.length - visibleTags.length

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleGenres.map((g) => (
        <Badge
          key={`g:${g}`}
          variant="secondary"
          className="h-5 py-0 text-[10px] font-normal"
        >
          {g}
        </Badge>
      ))}
      {visibleTags.map((t) => (
        <Badge
          key={`t:${t.slug}`}
          variant="outline"
          className="h-5 py-0 text-[10px] font-normal"
        >
          {t.name}
        </Badge>
      ))}
      {remaining > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 items-center rounded-full border border-dashed border-border/70 bg-background/40 px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              +{remaining} ver
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="max-w-xs space-y-2 p-3">
            {genres.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Gêneros
                </p>
                <div className="flex flex-wrap gap-1">
                  {genres.map((g) => (
                    <Badge
                      key={`g:${g}`}
                      variant="secondary"
                      className="h-5 py-0 text-[10px] font-normal"
                    >
                      {g}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {tags.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Badge
                      key={`t:${t.slug}`}
                      variant="outline"
                      className="h-5 py-0 text-[10px] font-normal"
                    >
                      {t.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="sticky left-0 z-10 flex items-center bg-background text-xs font-medium text-muted-foreground">
      {label}
    </div>
  )
}

function SectionTitle({
  label,
  collapsed,
  onToggle,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="col-span-full mt-4 mb-1 border-t bg-background pt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="sticky left-0 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            collapsed && "-rotate-90"
          )}
        />
        <span>{label}</span>
      </button>
    </div>
  )
}

interface CompareCellProps {
  children: React.ReactNode
  highlightVariant?: "best" | "worst"
  verticalAlign?: "center" | "top"
}

function CompareCell({
  children,
  highlightVariant,
  verticalAlign = "center",
}: CompareCellProps) {
  return (
    <div
      className={cn(
        "flex min-h-[2rem] rounded-md border border-transparent bg-card/40 px-2 py-1",
        verticalAlign === "top" ? "items-start" : "items-center",
        highlightVariant === "best" && "border-primary/40 bg-primary/5",
        highlightVariant === "worst" && "border-rose-400/30 bg-rose-500/5"
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
  bestWorst: { best: number; worst: number } | undefined
  thresholds: ScoreColorThresholds | null
  formatScore?: (v: number) => string
  getStub?: (w: CompareWork) => boolean
  renderExtra?: (w: CompareWork) => React.ReactNode
}

function ScoreRow({
  label,
  works,
  getScore,
  bestWorst,
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
        const variant = getHighlightVariant(score, bestWorst, works.length)
        return (
          <CompareCell key={w.id} highlightVariant={variant}>
            <div className="flex items-baseline gap-2">
              {formatScore && score != null ? (
                <span className="font-mono text-sm font-semibold">
                  {formatScore(score)}
                </span>
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
  bestWorst: { best: number; worst: number } | undefined
}

function CriterionRow({ slug, label, emoji, works, bestWorst }: CriterionRowProps) {
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center gap-1.5 bg-background text-xs text-muted-foreground">
        <span aria-hidden className="text-base">
          {emoji}
        </span>
        <span className="truncate">{label}</span>
      </div>
      {works.map((w) => {
        const entry = w.criteria.find((c) => c.slug === slug)
        const score = entry?.score ?? null
        const justification = entry?.aiJustification ?? null
        const variant = getHighlightVariant(score, bestWorst, works.length)
        return (
          <CompareCell key={w.id} highlightVariant={variant}>
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
                  <TooltipContent
                    side="top"
                    className="max-w-xs text-xs leading-relaxed"
                  >
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

function getHighlightVariant(
  score: number | null,
  bestWorst: { best: number; worst: number } | undefined,
  worksLength: number
): "best" | "worst" | undefined {
  if (score == null || bestWorst == null || worksLength < 2) return undefined
  if (Math.abs(bestWorst.best - bestWorst.worst) < 0.0001) return undefined
  if (Math.abs(score - bestWorst.best) < 0.0001) return "best"
  if (Math.abs(score - bestWorst.worst) < 0.0001) return "worst"
  return undefined
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
