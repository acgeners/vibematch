"use client"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Cell pra `alignment_score` (0–100) — badge azul/violet com tooltip da
 * justificativa do LLM. NULL vira "—" (obra ainda não passou pelo re-rank).
 */
export function AlignmentScoreCell({
  score,
  justification,
}: {
  score: number | null
  justification: string | null
}) {
  if (score == null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[280px]">
            Esta obra ainda não passou pelo IA re-rank. Use o botão &quot;Recomendar do
            ranking&quot; aqui no topo da página pra incluí-la numa run — o
            <span className="font-semibold"> alignment_score</span> retornado fica salvo
            nessa coluna.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const colorClass =
    score >= 80 ? "bg-violet-500/15 text-violet-700 border-violet-500/40 dark:text-violet-300"
    : score >= 60 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
    : score >= 40 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
    : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium cursor-help tabular-nums",
              colorClass,
            )}
          >
            {Math.round(score)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[320px] space-y-1">
          <p className="font-semibold text-xs">IA Re-rank: {Math.round(score)}/100</p>
          {justification && <p className="text-xs leading-relaxed">{justification}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Cell pra `personal_fit` (0–1) — barra horizontal com valor numérico.
 * NULL vira "—" (perfil de gosto é stub ou não há dados de critério).
 */
export function AlignmentCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px]">
            Sem alinhamento computado — perfil de gosto ainda é stub ou a obra não tem critérios/tags
            que casem com o perfil.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const pct = Math.round(value * 100)
  const color =
    pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : pct >= 25 ? "bg-orange-500" : "bg-slate-400"

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1.5 cursor-help">
            <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full transition-all", color)} style={{ width: `${pct}%` }} />
            </div>
            <span className="font-mono text-xs tabular-nums">{pct}%</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          Alinhamento determinístico (0–100%) com seu perfil de gosto: combina tags amadas/evitadas
          (40%), faixas ideais de critério (30%) e consistência geral (30%).
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Cell pra `final_score_confidence` (0–1) — badge tri-state Alta/Média/Baixa.
 * NULL vira "—" (calibração insuficiente).
 */
export function ConfidenceCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[280px]">
            Calibração insuficiente — não há manual_scores o bastante (mínimo 20) pra estimar o erro
            do modelo.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const pct = Math.round(value * 100)
  let label: string
  let colorClasses: string
  if (value >= 0.75) {
    label = "Alta"
    colorClasses = "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300"
  } else if (value >= 0.5) {
    label = "Média"
    colorClasses = "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300"
  } else {
    label = "Baixa"
    colorClasses = "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300"
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium cursor-help tabular-nums",
              colorClasses,
            )}
          >
            {label} · {pct}%
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px]">
          Confiança na Nota.Final: combina o erro médio do modelo (RMSE) com a distância dessa obra
          em relação ao que ele já viu treinado. Stub (poucos dados) ou outlier reduz a confiança.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
