"use client"

import { ChevronRight, Info } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AI_OPERATIONS } from "@/lib/ai-observability/types"
import { cn } from "@/lib/utils"
import type { OperationMetrics } from "@/lib/ai-observability"
import type { CacheEventMetrics } from "@/lib/ai-cache/cache-events"
import { DetailGrid } from "./detail-grid"
import type { DetailBlockData } from "./detail-grid"
import { formatLatency, formatPct, formatTokens, formatUsd, formatUsdPrecise, topKey } from "./format"
import { WorkloadPill } from "./pills"

interface Props {
  operations: OperationMetrics[]
  cache: CacheEventMetrics[]
  active: string | null
}

type SortKey = "label" | "cost" | "calls" | "costPerSuccess" | "p50" | "p95" | "errorRate"

interface Column {
  key: SortKey
  label: string
  num: boolean
  /** direção inicial ao clicar (asc p/ texto, desc p/ números). */
  initialDir: "asc" | "desc"
}

const COLUMNS: Column[] = [
  { key: "label", label: "Operação", num: false, initialDir: "asc" },
  { key: "cost", label: "Custo", num: true, initialDir: "desc" },
  { key: "calls", label: "Chamadas", num: true, initialDir: "desc" },
  { key: "costPerSuccess", label: "Custo/sucesso", num: true, initialDir: "desc" },
  { key: "p50", label: "Lat. p50", num: true, initialDir: "desc" },
  { key: "p95", label: "Lat. p95", num: true, initialDir: "desc" },
  { key: "errorRate", label: "Erro", num: true, initialDir: "desc" },
]

interface Row {
  op: OperationMetrics
  cache: CacheEventMetrics | null
  label: string
  cost: number
  calls: number
  costPerSuccess: number | null
  p50: number | null
  p95: number | null
  errorRate: number
}

function labelOf(op: string): string {
  return AI_OPERATIONS[op as keyof typeof AI_OPERATIONS]?.label ?? op
}

/** null sempre por último; senão compara conforme dir. */
function cmp(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir === "asc" ? a - b : b - a
}

export function OperationsTable({ operations, cache, active }: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [sortKey, setSortKey] = useState<SortKey>("cost")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const cacheByOp = useMemo(() => {
    const m = new Map<string, CacheEventMetrics>()
    for (const c of cache) m.set(c.operation, c)
    return m
  }, [cache])

  const rows = useMemo<Row[]>(() => {
    const built = operations.map((op) => ({
      op,
      cache: cacheByOp.get(op.operation) ?? null,
      label: labelOf(op.operation),
      cost: op.costUsd,
      calls: op.attempts,
      costPerSuccess: op.costPerSuccess,
      p50: op.latencyP50Ms,
      p95: op.latencyP95Ms,
      errorRate: op.errorRate,
    }))
    built.sort((a, b) => {
      if (sortKey === "label") {
        return sortDir === "asc"
          ? a.label.localeCompare(b.label)
          : b.label.localeCompare(a.label)
      }
      return cmp(a[sortKey], b[sortKey], sortDir)
    })
    return built
  }, [operations, cacheByOp, sortKey, sortDir])

  function toggleSort(col: Column) {
    if (col.key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(col.key)
      setSortDir(col.initialDir)
    }
  }

  function toggleExpand(opKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(opKey)) next.delete(opKey)
      else next.add(opKey)
      return next
    })
  }

  function opHref(opKey: string, isActive: boolean): string {
    const params = new URLSearchParams(searchParams.toString())
    if (isActive) params.delete("op")
    else params.set("op", opKey)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  if (operations.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        Nenhuma chamada registrada no período.
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {COLUMNS.map((col) => {
                const isSorted = col.key === sortKey
                return (
                  <th
                    key={col.key}
                    aria-sort={isSorted ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn("px-4 py-2", col.num && "text-right")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col)}
                      title={`Ordenar por ${col.label}`}
                      className={cn(
                        "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide transition-colors hover:bg-muted/60 hover:text-foreground",
                        col.num && "flex-row-reverse",
                        isSorted && "text-foreground",
                      )}
                    >
                      {col.label}
                      <span
                        className={cn(
                          "text-[10px]",
                          isSorted ? "text-primary" : "text-muted-foreground/70",
                        )}
                      >
                        {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                )
              })}
              <th className="px-4 py-2">Workload</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const opKey = row.op.operation
              const def = AI_OPERATIONS[opKey as keyof typeof AI_OPERATIONS]
              const isActive = active === opKey
              const isOpen = expanded.has(opKey)
              const domWorkload = topKey(row.op.byWorkload) ?? "unknown"
              return (
                <FragmentRow
                  key={opKey}
                  row={row}
                  def={def}
                  opKey={opKey}
                  isActive={isActive}
                  isOpen={isOpen}
                  domWorkload={domWorkload}
                  onToggle={() => toggleExpand(opKey)}
                  href={opHref(opKey, isActive)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}

function FragmentRow({
  row,
  def,
  opKey,
  isActive,
  isOpen,
  domWorkload,
  onToggle,
  href,
}: {
  row: Row
  def: (typeof AI_OPERATIONS)[keyof typeof AI_OPERATIONS] | undefined
  opKey: string
  isActive: boolean
  isOpen: boolean
  domWorkload: string
  onToggle: () => void
  href: string
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-t border-border/40",
          isActive ? "bg-primary/10" : "hover:bg-muted/30",
        )}
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
            <span className="font-semibold text-foreground">{row.label}</span>
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-[10.5px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
              title={isActive ? "Remover filtro" : `Filtrar por ${opKey}`}
            >
              {opKey}
            </Link>
            {def?.description && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground/70 hover:text-foreground"
                    aria-label={`O que é ${row.label}`}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] font-normal normal-case tracking-normal">
                  {def.description}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatUsd(row.cost)}</td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">{row.calls}</td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">
          {formatUsdPrecise(row.costPerSuccess)}
        </td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatLatency(row.p50)}</td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatLatency(row.p95)}</td>
        <td
          className={cn(
            "px-4 py-2 text-right font-mono tabular-nums",
            row.errorRate > 0 && "text-rose-600 dark:text-rose-400",
          )}
        >
          {formatPct(row.errorRate)}
        </td>
        <td className="px-4 py-2">
          <WorkloadPill workload={domWorkload} />
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-border/40 bg-muted/20">
          <td colSpan={8} className="px-4 py-4 pl-10">
            <OperationDetail row={row} def={def} />
          </td>
        </tr>
      )}
    </>
  )
}

function OperationDetail({
  row,
  def,
}: {
  row: Row
  def: (typeof AI_OPERATIONS)[keyof typeof AI_OPERATIONS] | undefined
}) {
  const o = row.op
  const c = row.cache
  const defaultModel = def?.defaultModel ?? topKey(o.byModel) ?? "—"

  const blocks: DetailBlockData[] = [
    {
      label: "Por modelo",
      hint: "Quantas chamadas cada modelo fez no período. “(A/B)” = avaliação com o modelo trocado de propósito (botão “Reavaliar com…”).",
      entries: mapEntries(o.byModel),
    },
    {
      label: "Prompt version",
      hint: "Qual versão do prompt gerou cada chamada. Versões antigas aparecem em chamadas mais velhas.",
      entries: mapEntries(o.byPromptVersion),
    },
    {
      label: "Cache de resultado",
      hint: "hit rate = % das consultas ao cache que já tinham resposta pronta (evitou chamar o modelo). L1/L2 = acerto na memória / no banco. miss = foi ao modelo. dedup = pedidos idênticos simultâneos que aguardaram um já em voo.",
      entries: c
        ? [
            ["hit rate", c.hitRate != null ? formatPct(c.hitRate) : "—"],
            ["L1 / L2 / miss", `${c.layerHits.memory} / ${c.layerHits.persistent} / ${c.misses}`],
            ["dedup evitado", String(c.dedupWaits)],
          ]
        : [["eventos", "nenhum na janela"]],
    },
    ...(o.failures > 0
      ? [
          {
            label: `Erros (${o.failures})`,
            hint: "Falhas por categoria. 529 = Anthropic sobrecarregada; image_invalid = capa recusada pelo modelo; schema_validation = resposta reprovada na validação Zod.",
            entries: mapEntries(o.errorsByCategory),
          } satisfies DetailBlockData,
        ]
      : []),
    {
      label: "Solicitação lógica",
      hint: "tentativas = chamadas físicas (1 linha cada). solic. lógicas = pedidos distintos. tent./solic. = média de tentativas por pedido (>1 = houve retries/fallback).",
      entries: [
        ["tentativas", String(o.attempts)],
        [
          "solic. lógicas",
          o.logicalRequests != null ? String(o.logicalRequests) : `~${o.logicalRequestsApprox}`,
        ],
        [
          "tent./solic.",
          o.attemptsPerLogicalRequest != null ? o.attemptsPerLogicalRequest.toFixed(2) : "—",
        ],
      ],
    },
    {
      label: "Tokens",
      hint: "input/output = tokens enviados/gerados. cache R/W = tokens lidos/escritos no cache de prompt da Anthropic (barateiam repetições) — diferente do cache de resultado acima.",
      entries: [
        ["input", formatTokens(o.inputTokens)],
        ["output", formatTokens(o.outputTokens)],
        ["cache R/W", `${formatTokens(o.cacheReadTokens)} / ${formatTokens(o.cacheCreationTokens)}`],
      ],
    },
  ]

  return (
    <div className="space-y-3">
      <p className="max-w-[74ch] text-[12.5px] leading-relaxed text-foreground/90">
        {def?.description ?? "Operação sem descrição no catálogo."}{" "}
        <span className="text-muted-foreground">
          Modelo padrão <span className="font-mono text-foreground/80">{defaultModel}</span>
          {def?.hasResultCache ? " · possui cache de resultado." : "."}
        </span>
      </p>
      <DetailGrid blocks={blocks} />
    </div>
  )
}

function mapEntries(counts: Record<string, number>): Array<[string, string]> {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return [["—", ""]]
  return entries.map(([k, n]) => [k, String(n)])
}
