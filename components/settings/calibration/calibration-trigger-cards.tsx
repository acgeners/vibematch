"use client"

import { useState } from "react"
import { ChartNoAxesCombined, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { runBiasReportAction } from "@/server/actions/calibration"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { formatRelativeDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { CalibrationRunRow } from "@/lib/ai-calibration/types"
import type { ReactNode } from "react"

const BIAS_TASK_ID = "bias-report"

/**
 * Faixa de ação (action-zone) no topo de cada card de calibração. Diferente dos
 * dois cards gêmeos antigos: aqui cada ação vive no SEU card (auditoria escreve,
 * viés só lê), com hierarquia visual clara. Meta à esquerda, botão à direita.
 */
function ActionZone({
  accent,
  title,
  meta,
  button,
  message,
  footer,
}: {
  accent: "cyan" | "violet"
  title: ReactNode
  meta: ReactNode
  button: ReactNode
  message: string | null
  /** Faixa full-width abaixo da meta (ex.: linha de defasagem da auditoria). */
  footer?: ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-muted/30 p-3.5",
        accent === "cyan" ? "border-l-[3px] border-l-cyan-500" : "border-l-[3px] border-l-violet-500",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span
              className={cn(
                "size-2 rounded-[3px]",
                accent === "cyan" ? "bg-cyan-500" : "bg-violet-500",
              )}
            />
            {title}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{meta}</div>
        </div>
        {button}
      </div>
      {message && <p className="mt-2 text-xs text-foreground/80">{message}</p>}
      {footer}
    </div>
  )
}

export function BiasTriggerZone({
  lastBias,
  ratedWorksCount,
}: {
  lastBias: CalibrationRunRow | null
  ratedWorksCount: number
}) {
  const tasks = useAppTasks()
  const biasPending = tasks.some((t) => t.id === BIAS_TASK_ID && t.status === "running")
  const [biasMsg, setBiasMsg] = useState<string | null>(null)
  const confirmCost = useCostConfirm()

  const handleBias = async () => {
    if (
      !(await confirmCost({
        action: "bias_report",
        title: "Gerar relatório de viés?",
        description: "Análise agregada usando estatísticas e exemplos de outliers. Não altera scores.",
        confirmLabel: "Gerar",
      }))
    ) {
      return
    }
    setBiasMsg(null)
    runTask({
      id: BIAS_TASK_ID,
      kind: "bias-report",
      label: "Gerando relatório de viés",
      run: async () => {
        const res = await runBiasReportAction()
        if (res.error) throw new Error(res.error)
        return res
      },
      successToast: () => ({ message: "Relatório de viés atualizado." }),
      onDone: () => setBiasMsg("Relatório de viés atualizado."),
      onError: (err) => setBiasMsg(`Erro: ${err instanceof Error ? err.message : "falhou"}`),
    })
  }

  return (
    <ActionZone
      accent="violet"
      title="Detectar viés global"
      meta={
        lastBias ? (
          <span className="tabular-nums">
            Último relatório {formatRelativeDateTime(lastBias.completed_at ?? lastBias.created_at)}
          </span>
        ) : (
          "Ainda não executado."
        )
      }
      message={biasMsg}
      button={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void handleBias()}
          disabled={biasPending || ratedWorksCount === 0}
        >
          {biasPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ChartNoAxesCombined className="mr-2 h-4 w-4" />
          )}
          Gerar relatório
        </Button>
      }
    />
  )
}
