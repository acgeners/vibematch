"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  consolidatePendingSynopses,
  type ConsolidateSynopsesProgress,
} from "@/server/actions/settings"

interface SynopsisConsolidationPanelProps {
  pendingCount: number
  totalCount: number
}

export function SynopsisConsolidationPanel({
  pendingCount,
  totalCount,
}: SynopsisConsolidationPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [lastResult, setLastResult] = useState<ConsolidateSynopsesProgress | null>(null)

  const handleRun = () => {
    startTransition(async () => {
      try {
        const result = await consolidatePendingSynopses(10)
        if (result.error) {
          toast.error(result.error)
          return
        }
        if (result.data) {
          setLastResult(result.data)
          if (result.data.abortedEarly) {
            toast.warning(
              `Anthropic congestionada — abortei após ${result.data.failed} falhas seguidas. ${result.data.consolidated} obras consolidadas antes do abort. Tente de novo daqui a pouco.`,
            )
          } else if (result.data.consolidated === 0 && result.data.failed === 0) {
            toast.info("Nada pra consolidar — todas as obras já estão em dia ou são muito curtas.")
          } else {
            toast.success(
              `${result.data.consolidated} obras consolidadas (~${(result.data.tokensIn + result.data.tokensOut).toLocaleString("pt-BR")} tokens).`,
            )
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao consolidar sinopses")
      }
    })
  }

  const completionPct =
    totalCount > 0 ? Math.round(((totalCount - pendingCount) / totalCount) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 text-sm text-muted-foreground max-w-2xl">
          <p>
            Consolida múltiplas sinopses por obra em uma única canônica via Haiku 4.5
            (~$0.002 por obra). Usada nos prompts de recomendação no lugar do texto
            concatenado com <span className="font-mono">---</span>.
          </p>
          <p className="text-xs">
            Cada clique processa até 10 obras pendentes — pode rodar várias vezes até zerar.
            Se a Anthropic estiver congestionada, aborta após 3 falhas seguidas.
          </p>
        </div>
        <Button type="button" onClick={handleRun} disabled={isPending || pendingCount === 0}>
          <FileText className={isPending ? "animate-pulse" : ""} />
          {isPending ? "Consolidando…" : "Consolidar sinopses pendentes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Pendentes</p>
          <p className="mt-1 font-mono text-base">{pendingCount}</p>
          <p className="text-[10px] text-muted-foreground">sem canonical_synopsis</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Consolidadas</p>
          <p className="mt-1 font-mono text-base">
            {totalCount - pendingCount} / {totalCount}
          </p>
          <p className="text-[10px] text-muted-foreground">{completionPct}% da base</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Modelo</p>
          <p className="mt-1 font-mono text-xs">claude-haiku-4-5</p>
          <p className="text-[10px] text-muted-foreground">~$0.002/obra</p>
        </div>
      </div>

      {lastResult && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">Última execução</p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              Consolidadas:{" "}
              <span className="font-mono text-foreground">{lastResult.consolidated}</span> de{" "}
              {lastResult.attempted} tentativas
            </li>
            {lastResult.skipped > 0 && (
              <li>
                Puladas (texto curto ou IA recusou):{" "}
                <span className="font-mono">{lastResult.skipped}</span>
              </li>
            )}
            {lastResult.failed > 0 && (
              <li className="text-amber-600 dark:text-amber-400">
                Falhas: <span className="font-mono">{lastResult.failed}</span>
              </li>
            )}
            <li>
              Tokens:{" "}
              <span className="font-mono text-foreground">
                {lastResult.tokensIn.toLocaleString("pt-BR")} in /{" "}
                {lastResult.tokensOut.toLocaleString("pt-BR")} out
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
