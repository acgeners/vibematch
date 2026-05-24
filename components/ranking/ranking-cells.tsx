"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { rerankSingleWorkAction } from "@/server/actions/recommendations"

/**
 * Botão pequeno que substitui o "—" da `AlignmentScoreCell` quando há um
 * `workId`. Dispara `rerankSingleWorkAction` (1 LLM call) e força refresh
 * dos server components pra cell renderizar o badge com a nova nota.
 */
function RerankSingleWorkButton({ workId }: { workId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleClick = () => {
    startTransition(async () => {
      const result = await rerankSingleWorkAction(workId)
      if (result.error || !result.data) {
        toast.error(result.error ?? "Erro ao rankear obra.")
        return
      }
      toast.success(`IA Rk: ${Math.round(result.data.alignmentScore)}`)
      router.refresh()
    })
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs text-muted-foreground hover:border-violet-500/60 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-50 disabled:cursor-wait"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            <span>{isPending ? "..." : "Rankear"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          Rodar IA re-rank só pra esta obra. Conta uma execução do limite diário.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Cell pra `alignment_score` (0–100) — badge azul/violet com tooltip da
 * justificativa do LLM. NULL vira "—" (obra ainda não passou pelo re-rank);
 * se `workId` está presente, vira um botão "Rankear" que dispara o re-rank
 * inline pra aquela obra.
 */
export function AlignmentScoreCell({
  score,
  justification,
  workId,
}: {
  score: number | null
  justification: string | null
  workId?: string
}) {
  if (score == null) {
    if (workId) {
      return <RerankSingleWorkButton workId={workId} />
    }
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
