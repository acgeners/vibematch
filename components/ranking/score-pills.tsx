"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { fmtSigma, sigmaToScore, SCORE_GRID } from "@/lib/ranking/criterion-unit"
import {
  equivalentGridThreshold,
  formatThresholdNumber,
  isOffGrid,
  numParam,
  parseThresholdInput,
  thresholdToParam,
  toDisplayValue,
} from "@/lib/ranking/score-threshold"
import type { ThresholdScale } from "@/lib/ranking/score-threshold"

/**
 * A grade de "pills" de nota da aba Notas e o editor que abre embaixo dela.
 *
 * Mora fora do `ranking-filters.tsx` porque é a única parte daquele painel que
 * dá pra montar sozinha — `def`, `searchParams` e `updateParams`, sem router e
 * sem as ~40 props de dado. É o que permite que o teste renderize o controle DE
 * VERDADE em vez de uma réplica: o que regride aqui (o rótulo do pill divergir
 * do que a query aplica, o campo manual sumir) só aparece na árvore desenhada.
 */

export type ScoreDef = ThresholdScale & {
  key: string
  emoji: string
  label: string
  minKey: string
  maxKey: string
  presets: number[]
  kind?: "votes"
  fullWidth?: boolean
  /**
   * Unidade de EXIBIÇÃO/EDIÇÃO. Ausente = pontos. "sd" = o controle mostra e
   * edita em desvios-padrão contra a média do catálogo.
   *
   * 🔴 A URL guarda SEMPRE pontos, em qualquer unidade. σ é uma lente, não um
   * formato de armazenamento — e é isso que mantém todo consumidor correto sem
   * saber que σ existe: `getRanking`, os presets salvos
   * (`ranking_filter_presets` guarda a query crua) e o
   * `parseFiltersFromSearchParams` do diálogo de recomendação, que lê a URL do
   * /ranking pra montar o universo de candidatos. Guardar σ na URL fazia
   * `min_romance=-0.5` virar "romance ≥ −0,5 PONTOS" lá — isto é, filtro
   * nenhum, sem erro e com resultado.
   *
   * Corolário de graça: trocar a unidade não mexe em nenhum valor, então NUNCA
   * muda o resultado — vira só outra forma de ler o mesmo limiar.
   */
  unit?: "sd"
  /** Texto do ⓘ ao lado do rótulo do filtro (explica o que a métrica é). */
  help?: string
}

export const VOTES_PRESETS: Array<{ label: string; min: number | null }> = [
  { label: "Qualquer", min: null },
  { label: "≥100", min: 100 },
  { label: "≥500", min: 500 },
  { label: "≥1k", min: 1000 },
  { label: "≥5k", min: 5000 },
  { label: "≥10k", min: 10000 },
]

export function formatVotes(n: number): string {
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(n)
}

export function fmtScore(def: ScoreDef, v: number): string {
  if (def.kind === "votes") return formatVotes(v)
  if (def.unit === "sd") return fmtSigma(v)
  return formatThresholdNumber(v, def.step)
}

/** Estado/rótulo atual de uma nota: Qualquer / ≥X / X–Y / ≤X. */
export function scoreValueInfo(def: ScoreDef, searchParams: Pick<URLSearchParams, "get">) {
  const rawMin = searchParams.get(def.minKey)
  const rawMax = searchParams.get(def.maxKey)
  const hasMin = rawMin != null && rawMin !== ""
  const hasMax = rawMax != null && rawMax !== ""
  const vMin = toDisplayValue(def, numParam(rawMin))
  const vMax = toDisplayValue(def, numParam(rawMax))
  let label = "Qualquer"
  if (hasMin && hasMax && vMin != null && vMax != null) label = `${fmtScore(def, vMin)}–${fmtScore(def, vMax)}`
  else if (hasMin && vMin != null) label = `≥ ${fmtScore(def, vMin)}`
  else if (hasMax && vMax != null) label = `≤ ${fmtScore(def, vMax)}`
  return { hasMin, hasMax, vMin, vMax, active: hasMin || hasMax, maxOnly: hasMax && !hasMin, label }
}

export function editorChip(on: boolean): string {
  return `inline-flex h-7 items-center rounded-lg border px-3 text-xs font-semibold tabular-nums transition-colors ${
    on
      ? "border-transparent bg-primary text-primary-foreground"
      : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground"
  }`
}

export function ScorePill({
  def,
  searchParams,
  selected,
  onSelect,
}: {
  def: ScoreDef
  searchParams: Pick<URLSearchParams, "get">
  selected: boolean
  onSelect: () => void
}) {
  const info = scoreValueInfo(def, searchParams)
  const tint = info.maxOnly
    ? "border-amber-400/45 bg-amber-400/[0.08]"
    : info.active
      ? "border-primary/45 bg-primary/[0.08]"
      : "border-border/65 bg-background/45 hover:border-border"
  const ring = selected ? "ring-1 ring-primary/60 !border-primary/70 bg-primary/[0.12]" : ""
  const valCls = info.maxOnly
    ? "bg-amber-400/15 text-amber-500 dark:text-amber-300"
    : info.active
      ? "bg-primary/15 text-primary"
      : "text-muted-foreground"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${tint} ${ring} ${def.fullWidth ? "col-span-full" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-base leading-none">{def.emoji}</span>
        <span className="truncate text-sm font-medium">{def.label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${valCls}`}>{info.label}</span>
        {selected && <ChevronDown className="h-3.5 w-3.5 text-primary" />}
      </span>
    </button>
  )
}

/**
 * Campo de digitação de UMA ponta do limiar.
 *
 * ⚠️ O texto em edição vive em estado LOCAL, e não na URL. O painel é rascunho e
 * grava a cada tecla, então sem isso o campo se reescreveria a partir do valor
 * já gravado no meio da digitação: "7," viraria "7" e o segundo dígito nunca
 * chegaria. No blur o rascunho é largado e o campo volta a mostrar o que está
 * gravado — que é como a pessoa vê o encaixe na grade de 0,5 da lente σ.
 */
function ManualBound({
  def,
  bound,
  value,
  onWrite,
}: {
  def: ScoreDef
  bound: "min" | "max"
  /** Valor gravado, já no domínio de exibição (σ sob a lente). */
  value: number | undefined
  onWrite: (v: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const stored = value != null ? formatThresholdNumber(value, def.step) : ""
  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder={bound === "min" ? "Mín" : "Máx"}
      aria-label={`${bound === "min" ? "Mínimo" : "Máximo"} de ${def.label}`}
      title={
        bound === "min"
          ? "Limiar na ponta de baixo da escala não filtra nada e é descartado."
          : "Limiar na ponta de cima da escala não filtra nada e é descartado."
      }
      size="sm"
      className="h-8 w-24 text-xs tabular-nums"
      value={draft ?? stored}
      onChange={(e) => {
        setDraft(e.target.value)
        onWrite(parseThresholdInput(e.target.value))
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

export function ScoreThresholdEditor({
  def,
  searchParams,
  updateParams,
}: {
  def: ScoreDef
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
}) {
  const info = scoreValueInfo(def, searchParams)
  const [dragValue, setDragValue] = useState<[number, number] | null>(null)
  const committed: [number, number] = [info.vMin ?? def.min, info.vMax ?? def.max]
  const display = dragValue ?? committed
  // O slider e o campo manual trabalham no domínio de EXIBIÇÃO (σ quando a
  // lente está ligada), mas o que vai pra URL é sempre ponto — ver ScoreDef.unit.
  const write = (v: number | null, bound: "min" | "max") => thresholdToParam(def, v, bound)
  const commit = (next: number[]) => {
    const [lo, hi] = next as [number, number]
    updateParams({
      [def.minKey]: lo > def.min ? write(lo, "min") : null,
      [def.maxKey]: hi < def.max ? write(hi, "max") : null,
    })
    setDragValue(null)
  }
  const setMinPreset = (p: number | null) => {
    setDragValue(null)
    updateParams({ [def.minKey]: p != null ? write(p, "min") : null, [def.maxKey]: null })
  }
  // Em σ o preset não bate exato: ele é gravado em pontos e encaixado na grade
  // de 0,5, então "+0,5σ" volta como +0,49σ. Comparar por igualdade deixaria o
  // chip que o usuário acabou de clicar apagado. A tolerância é meia casa da
  // GRADE convertida pro σ daquele atributo — usar um número fixo deixava o chip
  // recém-clicado apagado nos atributos de σ estreito (protagonista, σ 0,89).
  const presetActive = (p: number) => {
    if (info.hasMax || info.vMin == null) return false
    if (def.unit !== "sd") return info.vMin === p
    const sd = def.moment?.sd
    if (!sd) return false
    return Math.abs(info.vMin - p) < SCORE_GRID / (2 * sd)
  }
  // Fora da grade em que as notas existem, o limiar digitado RECORTA o mesmo que
  // o vizinho de cima (mín) ou de baixo (máx). Não é erro — só não compra
  // resolução, e dizê-lo evita que "7,3 dá o mesmo que 7,5" pareça defeito.
  const offGrid = def.grid
    ? ([
        ["min", info.vMin] as const,
        ["max", info.vMax] as const,
      ].filter(([, v]) => v != null && isOffGrid(v, def.grid)) as Array<readonly ["min" | "max", number]>)
    : []
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setMinPreset(null)} className={editorChip(!info.active)}>
          Qualquer
        </button>
        {def.presets.map((p) => (
          <button key={p} type="button" onClick={() => setMinPreset(p)} className={editorChip(presetActive(p))}>
            ≥ {fmtScore(def, p)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Faixa</span>
        <Slider
          value={display}
          min={def.min}
          max={def.max}
          step={def.step}
          minStepsBetweenThumbs={1}
          onValueChange={(v) => setDragValue([v[0], v[1]] as [number, number])}
          onValueCommit={commit}
          className="flex-1"
        />
        <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-primary">
          {fmtScore(def, display[0])} – {fmtScore(def, display[1])}
        </span>
      </div>
      {/* O passo do slider é o da GRADE de leitura (1 ponto nos atributos, 0,5 na
          Nota Prevista, 5 nos percentuais) e não o da distribuição: medido em
          2026-08-19, um passo de 0,5 na Nota Prevista move ~300 obras de uma vez.
          O campo manual é o que dá acesso ao valor intermediário — mesma forma do
          "Manual" dos votos, e passando pela MESMA régua de gravação do slider. */}
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Manual
        </Label>
        <ManualBound
          def={def}
          bound="min"
          value={info.vMin}
          onWrite={(v) => updateParams({ [def.minKey]: write(v, "min") })}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <ManualBound
          def={def}
          bound="max"
          value={info.vMax}
          onWrite={(v) => updateParams({ [def.maxKey]: write(v, "max") })}
        />
        {def.unit === "sd" && <span className="text-xs text-muted-foreground">σ</span>}
      </div>
      {offGrid.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          As notas de atributo existem de {formatThresholdNumber(def.grid as number, def.grid as number)} em{" "}
          {formatThresholdNumber(def.grid as number, def.grid as number)} —{" "}
          {offGrid.map(([bound, v], i) => (
            <span key={bound}>
              {i > 0 && " e "}
              {bound === "min" ? "≥" : "≤"} <span className="tabular-nums">{fmtScore(def, v)}</span> recorta o mesmo
              que {bound === "min" ? "≥" : "≤"}{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {fmtScore(def, equivalentGridThreshold(v, bound, def.grid as number))}
              </span>
            </span>
          ))}
          .
        </p>
      )}
      {/* Em σ o número não diz nada sozinho: "+1σ" é 6,7 em humor e 8,6 em
          romance. Sem esta linha o controle vira um filtro cego — que foi
          exatamente o defeito da Assinatura que este modo substitui. */}
      {def.unit === "sd" && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {def.moment && def.moment.sd > 0 ? (
            <>
              Hoje, em {def.label.toLowerCase()}: {fmtScore(def, display[0])} ={" "}
              <span className="font-semibold tabular-nums text-foreground">
                {(sigmaToScore(display[0], def.moment) ?? 0).toFixed(1)}
              </span>{" "}
              pts e {fmtScore(def, display[1])} ={" "}
              <span className="font-semibold tabular-nums text-foreground">
                {(sigmaToScore(display[1], def.moment) ?? 0).toFixed(1)}
              </span>{" "}
              pts (média {def.moment.mean.toFixed(1)}, σ {def.moment.sd.toFixed(2)}).
            </>
          ) : (
            "Sem média do catálogo para este atributo — o limiar em σ não se aplica."
          )}
        </p>
      )}
    </>
  )
}

export function VotesThresholdEditor({
  searchParams,
  updateParams,
  confidenceVotes,
}: {
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  confidenceVotes?: number | null
}) {
  const currentMin = numParam(searchParams.get("min_votes"))
  const hasMax = searchParams.get("max_votes") != null
  const presetActive = (p: number | null) =>
    !hasMax && (p == null ? currentMin === undefined : currentMin === p)
  // Limiar de confiança do público (pseudo-votos): acima dele a média externa pesa
  // ≥50%. Marca o preset mais perto e oferece um clique pra usar o valor exato.
  const C = confidenceVotes != null && confidenceVotes > 0 ? Math.round(confidenceVotes) : null
  const nearestMin =
    C == null
      ? null
      : VOTES_PRESETS.reduce<number | null>((best, p) => {
          if (p.min == null) return best
          return best == null || Math.abs(p.min - C) < Math.abs(best - C) ? p.min : best
        }, null)
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {VOTES_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() =>
              updateParams({ min_votes: preset.min != null ? String(preset.min) : null, max_votes: null })
            }
            title={preset.min === nearestMin ? "≈ limiar de confiança do público" : undefined}
            className={cn(
              editorChip(presetActive(preset.min)),
              preset.min === nearestMin && "ring-1 ring-emerald-500/50",
            )}
          >
            {preset.label}
            {preset.min === nearestMin && <span className="ml-1 text-emerald-500">✓</span>}
          </button>
        ))}
      </div>
      {C != null && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            <span className="text-emerald-600 dark:text-emerald-400">Confiável</span> ≈{" "}
            <span className="font-mono font-semibold text-foreground">{C.toLocaleString("pt-BR")}</span>{" "}
            votos — acima disso a média externa pesa ≥ 50% na Nota Prevista.
          </span>
          <button
            type="button"
            onClick={() => updateParams({ min_votes: String(C), max_votes: null })}
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
          >
            usar
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Manual
        </Label>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Mín"
          size="sm"
          className="h-8 w-24 text-xs"
          value={searchParams.get("min_votes") ?? ""}
          onChange={(e) => updateParams({ min_votes: e.target.value || null })}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Máx"
          size="sm"
          className="h-8 w-24 text-xs"
          value={searchParams.get("max_votes") ?? ""}
          onChange={(e) => updateParams({ max_votes: e.target.value || null })}
        />
      </div>
    </>
  )
}
