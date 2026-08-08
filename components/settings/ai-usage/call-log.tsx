"use client"

import { AlertTriangle, ChevronRight, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import type { AiCallRow } from "@/server/queries/ai-usage"
import { DetailGrid } from "./detail-grid"
import type { DetailBlockData } from "./detail-grid"
import { formatLatency, formatRelative, formatTokens } from "./format"
import { formatUsd } from "@/lib/format/money"
import { ModelPill, shortModel, StatusPill } from "./pills"

interface Props {
  calls: AiCallRow[]
}

type SortKey = "createdAt" | "tokens" | "cost" | "latency"

function accessor(c: AiCallRow, key: SortKey): number {
  switch (key) {
    case "createdAt":
      return new Date(c.createdAt).getTime()
    case "tokens":
      return c.totalTokens
    case "cost":
      return c.totalCostUsd
    case "latency":
      return c.latencyMs
  }
}

export function CallLog({ calls }: Props) {
  const models = useMemo(
    () => Array.from(new Set(calls.map((c) => c.modelName))).sort(),
    [calls],
  )

  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [showOk, setShowOk] = useState(true)
  const [showErr, setShowErr] = useState(true)
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = calls.filter((c) => {
      if (c.status === "success" && !showOk) return false
      if (c.status === "error" && !showErr) return false
      if (hiddenModels.has(c.modelName)) return false
      if (q) {
        const hay = `${c.operation} ${c.subOperation ?? ""} ${c.errorMessage ?? ""} ${c.errorCategory ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    filtered.sort((a, b) => {
      const av = accessor(a, sortKey)
      const bv = accessor(b, sortKey)
      return sortDir === "asc" ? av - bv : bv - av
    })
    return filtered
  }, [calls, showOk, showErr, hiddenModels, query, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function toggleModel(m: string) {
    setHiddenModels((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Status
        </span>
        <FilterChip active={showOk} tone="ok" onClick={() => setShowOk((v) => !v)}>
          ok
        </FilterChip>
        <FilterChip active={showErr} tone="err" onClick={() => setShowErr((v) => !v)}>
          erro
        </FilterChip>
        {models.length > 1 && (
          <>
            <span className="ml-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Modelo
            </span>
            {models.map((m) => (
              <FilterChip key={m} active={!hiddenModels.has(m)} onClick={() => toggleModel(m)}>
                {shortModel(m)}
              </FilterChip>
            ))}
          </>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="operação, erro…"
            className="w-32 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortTh label="Quando" active={sortKey === "createdAt"} dir={sortDir} onClick={() => toggleSort("createdAt")} />
              <th className="px-4 py-2">Operação</th>
              <th className="px-4 py-2">Modelo</th>
              <SortTh label="Tokens" num active={sortKey === "tokens"} dir={sortDir} onClick={() => toggleSort("tokens")} />
              <SortTh label="Custo" num active={sortKey === "cost"} dir={sortDir} onClick={() => toggleSort("cost")} />
              <SortTh label="Latência" num active={sortKey === "latency"} dir={sortDir} onClick={() => toggleSort("latency")} />
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhuma chamada corresponde aos filtros.
                </td>
              </tr>
            )}
            {visible.map((c) => {
              const isOpen = expanded.has(c.id)
              return (
                <CallRow key={c.id} call={c} isOpen={isOpen} onToggle={() => toggleExpand(c.id)} />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortTh({
  label,
  num,
  active,
  dir,
  onClick,
}: {
  label: string
  num?: boolean
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
}) {
  return (
    <th
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-4 py-2", num && "text-right")}
    >
      <button
        type="button"
        onClick={onClick}
        title={`Ordenar por ${label}`}
        className={cn(
          "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide transition-colors hover:bg-muted/60 hover:text-foreground",
          num && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <span className={cn("text-[10px]", active ? "text-primary" : "text-muted-foreground/70")}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  )
}

function CallRow({
  call: c,
  isOpen,
  onToggle,
}: {
  call: AiCallRow
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-t border-border/40 hover:bg-muted/30">
        <td className="px-4 py-2 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight
              className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")}
            />
            {/* Tempo relativo depende do relógio → difere entre SSR e cliente;
                suppressHydrationWarning é o padrão do React p/ timestamps. */}
            <span title={new Date(c.createdAt).toLocaleString("pt-BR")} suppressHydrationWarning>
              {formatRelative(c.createdAt)}
            </span>
          </span>
        </td>
        <td className="px-4 py-2 font-mono text-[11px]">{c.operation}</td>
        <td className="px-4 py-2">
          <ModelPill model={c.modelName} />
        </td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatTokens(c.totalTokens)}</td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatUsd(c.totalCostUsd)}</td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatLatency(c.latencyMs)}</td>
        <td className="px-4 py-2">
          <StatusPill status={c.status} />
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-border/40 bg-muted/20">
          <td colSpan={7} className="px-4 py-4 pl-10">
            <CallDetail call={c} />
          </td>
        </tr>
      )}
    </>
  )
}

function CallDetail({ call: c }: { call: AiCallRow }) {
  const blocks: DetailBlockData[] = [
    {
      label: "Identificação",
      hint: "sub-operação = a que item a chamada se refere. prompt version = versão do prompt. logical req. = id do pedido lógico (agrupa tentativas). attempt = nº da tentativa (0 = primeira).",
      entries: [
        ["sub-operação", c.subOperation ?? "—"],
        ["prompt version", c.promptVersion ?? "—"],
        ["logical req.", c.logicalRequestId ? `${c.logicalRequestId.slice(0, 10)}…` : "—"],
        ["attempt", c.attempt != null ? String(c.attempt) : "—"],
      ],
    },
    {
      label: "Tokens",
      hint: "input/output = tokens enviados/gerados. cache read/write = tokens lidos/escritos no cache de prompt da Anthropic (barateiam repetições).",
      entries: [
        ["input", formatTokens(c.inputTokens)],
        ["output", formatTokens(c.outputTokens)],
        ["cache read / write", `${formatTokens(c.cacheReadTokens)} / ${formatTokens(c.cacheCreationTokens)}`],
      ],
    },
    {
      label: "Execução",
      hint: "cache status = como o cache respondeu (hit/miss/bypass). image status = destino da capa (fetch_success, provider_rejected…). stop reason = por que o modelo parou. workload = origem da chamada.",
      entries: [
        ["cache status", c.cacheStatus ?? "—"],
        ["image status", c.imageStatus ?? "—"],
        ["stop reason", c.stopReason ?? "—"],
        ["workload", c.workload],
      ],
    },
  ]

  return (
    <div className="space-y-3">
      {c.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[12px] text-rose-700 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-semibold">{c.errorCategory ?? "erro"}</span>
            {c.errorMessage && <span className="text-rose-700/80 dark:text-rose-300/80"> — {c.errorMessage}</span>}
          </div>
        </div>
      )}
      <DetailGrid blocks={blocks} />
    </div>
  )
}

function FilterChip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean
  tone?: "ok" | "err"
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
        !active && "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
        active && tone === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        active && tone === "err" && "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
        active && !tone && "border-primary/40 bg-primary/10 text-primary",
      )}
    >
      {children}
    </button>
  )
}
