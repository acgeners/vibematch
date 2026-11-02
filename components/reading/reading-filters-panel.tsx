"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Info, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FilterCount } from "@/components/ui/filter-count"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { INTEREST_NONE } from "@/lib/interest-sentinels"
import { filterSegmentClass } from "@/lib/ui/filter-segment-tone"
import { STATUS_TONE } from "@/lib/ui/status-tone"
import {
  READING_ATTRIBUTE_FIELDS,
  READING_NOTE_FIELDS,
  countReadingWorks,
  formatReadingScore,
  readingFilterChips,
  readingScoreHistogram,
  readingScoreValue,
  withoutReadingRange,
} from "@/lib/reading/reading-filters"
import type {
  ReadingAdultMode,
  ReadingFilterFields,
  ReadingFilters,
  ReadingScoreField,
} from "@/lib/reading/reading-filters"
import { InterestOtherToggle, QualityToggles } from "@/components/ranking/interest-toggles"
import {
  ScorePill,
  ThresholdManual,
  ThresholdOffGridHint,
  ThresholdPresets,
  ThresholdSlider,
  fmtScore,
  useThresholdControls,
} from "@/components/ranking/score-pills"
import { SYNOPSIS_QUALITIES } from "@/types/domain"

type UpdateParams = (updates: Record<string, string | null>) => void

const PANEL_ID = "reading-filters-panel"

/** Do maior para o menor: é o ♥♥♥♥ que se procura numa lista de leitura. */
const HEARTS_DESC = [...SYNOPSIS_QUALITIES].reverse()

// O `dark:` é obrigatório: o variant outline traz `dark:bg-input/30`, que venceria o fundo no tema do app.
const FILTERS_ACTIVE_TONE =
  "bg-primary/10 text-primary ring-1 ring-inset ring-primary/40 hover:bg-primary/15 hover:text-primary dark:bg-primary/10 dark:hover:bg-primary/15"
const FILTERS_OPEN_TONE =
  "bg-primary/20 text-primary ring-1 ring-inset ring-primary/70 hover:bg-primary/25 hover:text-primary dark:bg-primary/20 dark:hover:bg-primary/25"

/** O gatilho do painel, ao lado de "Leitura" e da ordenação. Aberto vence "tem filtro ligado". */
export function ReadingFiltersButton({
  open,
  onToggle,
  activeCount,
}: {
  open: boolean
  onToggle: () => void
  activeCount: number
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={PANEL_ID}
      className={cn("rounded-lg text-xs", open ? FILTERS_OPEN_TONE : activeCount > 0 && FILTERS_ACTIVE_TONE)}
    >
      <SlidersHorizontal className="size-3.5" />
      Filtros
      {activeCount > 0 && (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-primary-foreground">
          {activeCount}
        </span>
      )}
      <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
    </Button>
  )
}

/**
 * O que está filtrando, sempre à vista — inclusive com o painel fechado. Filtro ativo escondido é
 * como "a lista diminuiu" passa a parecer defeito.
 */
export function ReadingActiveFilters({
  filters,
  updateParams,
  onClear,
}: {
  filters: ReadingFilters
  updateParams: UpdateParams
  onClear: () => void
}) {
  const chips = readingFilterChips(filters)
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filtrando</span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex h-[26px] items-center gap-1 rounded-full bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary"
        >
          {chip.hearts ? (
            <>
              <span className="sr-only">Interesse </span>
              <span className="tracking-[0.06em] text-red-500">{chip.label}</span>
            </>
          ) : (
            chip.label
          )}
          <button
            type="button"
            onClick={() => updateParams(chip.clear)}
            aria-label={`Remover ${chip.hearts ? "interesse " : ""}${chip.label}`}
            className="grid size-4 place-items-center rounded-full transition-colors hover:bg-primary/25"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Button type="button" variant="ghost" size="xs" onClick={onClear} className="font-medium text-muted-foreground">
        Limpar tudo
      </Button>
    </div>
  )
}

/** A régua da versão, dita em voz alta: é a única coisa aqui que difere do /ranking. */
function r19Hint(works: readonly ReadingFilterFields[]): string | null {
  const mixed = works.filter((w) => w.isMixed)
  if (mixed.length === 0) return null
  const r18 = mixed.filter((w) => w.readEdition === "r18").length
  const normal = mixed.filter((w) => w.readEdition === "normal").length
  const unknown = mixed.length - r18 - normal
  const parts = [
    r18 > 0 ? `${r18} na R18` : null,
    normal > 0 ? `${normal} na normal` : null,
    unknown > 0 ? `${unknown} sem versão marcada, que ${unknown === 1 ? "fica" : "ficam"} nos dois lados` : null,
  ].filter(Boolean)
  return `Obras R19 seguem a versão que você lê: ${parts.join(", ")}.`
}

function AdultSegment({
  value,
  counts,
  onChange,
}: {
  value: ReadingAdultMode
  counts: Readonly<Record<ReadingAdultMode, number>>
  onChange: (mode: ReadingAdultMode) => void
}) {
  // O vermelho é o de CONTEÚDO (fato sobre a obra); o tom tem dono em `filter-segment-tone.ts`.
  const options: Array<{ mode: ReadingAdultMode; label: string; adult: boolean }> = [
    { mode: "all", label: "Tudo", adult: false },
    { mode: "hide", label: "Ocultar", adult: true },
    { mode: "only", label: "Só 18+", adult: true },
  ]
  return (
    <div className="inline-flex max-w-full rounded-md border border-border/70 bg-background/60 p-0.5">
      {options.map(({ mode, label, adult }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          className={filterSegmentClass(value === mode, adult ? "adult" : "selected")}
        >
          {label}
          {adult && <span aria-hidden>🔞</span>}
          <FilterCount value={counts[mode]} className="ml-0.5" />
        </button>
      ))}
    </div>
  )
}

function SectionLabel({ children, info }: { children: React.ReactNode; info?: React.ReactNode }) {
  return (
    <span className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
      {info}
    </span>
  )
}

/** O ⓘ abre no clique, não no hover: o card é usado no celular, onde tooltip não abre. */
function R19Info({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Como as obras R19 entram neste filtro"
          className="inline-grid size-4 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 max-w-[calc(100vw-2rem)]">
        <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
      </PopoverContent>
    </Popover>
  )
}

function ScoreHistogram({
  works,
  filters,
  field,
}: {
  works: readonly ReadingFilterFields[]
  filters: ReadingFilters
  field: ReadingScoreField
}) {
  const bins = readingScoreHistogram(works, filters, field)
  const top = Math.max(1, ...bins.map((b) => b.count))
  return (
    <div className="flex h-8 items-end gap-px" aria-hidden>
      {bins.map((bin) => (
        <span
          key={bin.value}
          title={`${fmtScore(field, bin.value)}: ${bin.count}`}
          className={cn("min-w-0 flex-1 rounded-t-[2px]", bin.inRange && bin.count > 0 ? "bg-primary" : "bg-muted")}
          style={{ height: bin.count > 0 ? `${Math.max(8, (bin.count / top) * 100)}%` : "3%" }}
        />
      ))}
    </div>
  )
}

/** O aviso sobre quem não tem nota: sair ou ficar na lista não é dedutível da tela. */
function absenceNote(field: ReadingScoreField, absent: number, total: number, active: boolean): string | null {
  if (absent === 0) return null
  const { fullLabel: name } = field
  if (field.absentPasses) return `${absent} ${absent === 1 ? "obra" : "obras"} sem ${name} continuam na lista, como no /ranking.`
  if (active) return `${absent} ${absent === 1 ? "obra" : "obras"} sem nota de ${name} ${absent === 1 ? "sai" : "saem"} da lista enquanto este filtro estiver ligado.`
  return `Só ${total - absent} das ${total} obras têm nota de ${name} por enquanto.`
}

function ScoreEditor({
  field,
  works,
  filters,
  params,
  updateParams,
  onClose,
}: {
  field: ReadingScoreField
  works: readonly ReadingFilterFields[]
  filters: ReadingFilters
  params: Pick<URLSearchParams, "get">
  updateParams: UpdateParams
  onClose: () => void
}) {
  const controls = useThresholdControls(field, params, updateParams, { live: true })
  const { display } = controls
  const others = useMemo(() => withoutReadingRange(filters, field.key), [filters, field.key])
  const absent = works.filter((w) => readingScoreValue(w, field, filters.adult) == null).length
  const note = absenceNote(field, absent, works.length, filters.ranges[field.key] != null)
  return (
    <div className="grid gap-x-5 gap-y-2.5 rounded-lg border border-border/70 bg-background/35 p-3 md:grid-cols-2">
      <div className="flex items-center justify-between gap-2 md:col-span-2">
        <span className="text-[13px] font-semibold">
          {field.emoji} {field.fullLabel}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="grid size-[22px] place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-w-0 space-y-1">
        <ScoreHistogram works={works} filters={filters} field={field} />
        <ThresholdSlider def={field} controls={controls} />
        <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{field.poles?.[0] ?? field.min}</span>
          <span className="font-semibold tabular-nums text-primary">
            {fmtScore(field, display[0])} – {fmtScore(field, display[1])}
          </span>
          <span>{field.poles?.[1] ?? field.max}</span>
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <ThresholdPresets
          def={field}
          controls={controls}
          countFor={(range) => countReadingWorks(works, { ...others, ranges: { ...others.ranges, [field.key]: range } })}
        />
        <ThresholdManual def={field} controls={controls} updateParams={updateParams} />
      </div>
      <div className="space-y-1 md:col-span-2 empty:hidden">
        <ThresholdOffGridHint def={field} controls={controls} />
        {note && (
          <p
            className={cn(
              "flex w-fit max-w-full items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium leading-snug",
              STATUS_TONE.absent.box,
              STATUS_TONE.absent.text,
            )}
          >
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {note}
          </p>
        )}
        {field.key === "adult_content" && (
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Obra R19 usa a nota da versão em contexto: a que você lê, a normal em &quot;Ocultar&quot; e a R18 em &quot;Só 18+&quot;.
          </p>
        )}
      </div>
    </div>
  )
}

export function ReadingFiltersPanel({
  works,
  filters,
  params,
  updateParams,
}: {
  works: readonly ReadingFilterFields[]
  filters: ReadingFilters
  params: Pick<URLSearchParams, "get">
  updateParams: UpdateParams
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = [...READING_NOTE_FIELDS, ...READING_ATTRIBUTE_FIELDS].find((f) => f.key === selectedKey) ?? null
  const hint = r19Hint(works)

  const adultCounts = useMemo(
    () => ({
      all: countReadingWorks(works, { ...filters, adult: "all" }),
      hide: countReadingWorks(works, { ...filters, adult: "hide" }),
      only: countReadingWorks(works, { ...filters, adult: "only" }),
    }),
    [works, filters],
  )
  const interestCount = (value: string) => countReadingWorks(works, { ...filters, interest: new Set([value]) })
  const heartCounts = Object.fromEntries(HEARTS_DESC.map((h) => [h, interestCount(h)]))

  const toggleInterest = (value: string) => {
    const next = new Set(filters.interest)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    updateParams({ synopsis_q: next.size > 0 ? [...next].join(",") : null })
  }

  // Quantas obras têm a nota é assunto do editor: a pílula só diz o nome e o limiar ligado.
  const pill = (field: ReadingScoreField) => (
    <ScorePill
      key={field.key}
      compact
      def={field}
      searchParams={params}
      selected={selectedKey === field.key}
      onSelect={() => setSelectedKey((key) => (key === field.key ? null : field.key))}
      title={field.fullLabel}
    />
  )

  return (
    <div id={PANEL_ID} className="border-t border-border px-4 py-3.5">
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[356px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:flex-wrap md:gap-x-6 lg:flex-col lg:flex-nowrap lg:border-r lg:border-border lg:pr-6">
          <div>
            <SectionLabel info={hint ? <R19Info text={hint} /> : null}>Conteúdo 18+</SectionLabel>
            <AdultSegment
              value={filters.adult}
              counts={adultCounts}
              onChange={(mode) => updateParams({ adult: mode === "all" ? null : mode })}
            />
          </div>
          <div>
            <SectionLabel>Interesse</SectionLabel>
            <QualityToggles
              values={HEARTS_DESC}
              selected={filters.interest}
              onToggle={toggleInterest}
              tone="rose"
              counts={heartCounts}
              extra={
                <InterestOtherToggle
                  active={filters.interest.has(INTEREST_NONE)}
                  onToggle={() => toggleInterest(INTEREST_NONE)}
                  tone="rose"
                  label="Sem interesse marcado"
                  count={interestCount(INTEREST_NONE)}
                />
              }
            />
          </div>
          <div className="min-w-0 md:min-w-72 lg:min-w-0">
            <SectionLabel>Notas</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5">{READING_NOTE_FIELDS.map(pill)}</div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2.5">
          <div>
            <SectionLabel>Atributos</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(166px,1fr))]">
              {READING_ATTRIBUTE_FIELDS.map(pill)}
            </div>
          </div>
          {selected && (
            <ScoreEditor
              key={selected.key}
              field={selected}
              works={works}
              filters={filters}
              params={params}
              updateParams={updateParams}
              onClose={() => setSelectedKey(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * O valor do que está filtrando, no próprio card. Interesse e atributos não aparecem no card de
 * leitura: sem isto, a pessoa filtra por algo que não consegue conferir em obra nenhuma.
 */
export function ReadingFilterEcho({ work, filters }: { work: ReadingFilterFields; filters: ReadingFilters }) {
  const fields = [...READING_NOTE_FIELDS, ...READING_ATTRIBUTE_FIELDS].filter((f) => filters.ranges[f.key])
  if (filters.interest.size === 0 && fields.length === 0) return null
  const chip = "inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-xs tabular-nums"
  return (
    <div className="flex flex-wrap gap-1">
      {filters.interest.size > 0 &&
        (work.synopsisQuality ? (
          <span className={cn(chip, "bg-primary/10 tracking-[0.06em] text-red-500")}>{work.synopsisQuality}</span>
        ) : (
          <span className={cn(chip, "bg-muted text-muted-foreground")}>Sem interesse marcado</span>
        ))}
      {fields.map((field) => {
        const value = readingScoreValue(work, field, filters.adult)
        return (
          <span key={field.key} className={cn(chip, value == null ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
            <span aria-hidden>{field.emoji}</span>
            {field.label} {value == null ? "sem nota" : formatReadingScore(field, value)}
          </span>
        )
      })}
    </div>
  )
}
