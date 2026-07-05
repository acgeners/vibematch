"use client"

import { useState, useTransition } from "react"
import { ChartNoAxesCombined, Loader2, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { runBiasReportAction, runCalibrationAuditAction } from "@/server/actions/calibration"
import { formatRelativeDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { CalibrationRunRow } from "@/lib/ai-calibration/types"
import type { ReactNode } from "react"

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
}: {
  accent: "cyan" | "violet"
  title: ReactNode
  meta: ReactNode
  button: ReactNode
  message: string | null
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
    </div>
  )
}

export function AuditTriggerZone({
  lastAudit,
  ratedWorksCount,
}: {
  lastAudit: CalibrationRunRow | null
  ratedWorksCount: number
}) {
  const [auditPending, startAudit] = useTransition()
  const [auditMsg, setAuditMsg] = useState<string | null>(null)
  const confirmCost = useCostConfirm()

  const handleAudit = async () => {
    if (
      !(await confirmCost({
        action: "calibration_audit",
        scale: ratedWorksCount,
        title: "Rodar auditoria de critérios?",
        description: `Analisa ${ratedWorksCount} obras com nota pessoal e sugere ajustes. Scores com source "manual" ou "ai_edited" não são tocados.`,
        confirmLabel: "Rodar",
      }))
    ) {
      return
    }
    setAuditMsg(null)
    startAudit(async () => {
      const res = await runCalibrationAuditAction()
      if (res.error) {
        setAuditMsg(`Erro: ${res.error}`)
      } else if (res.data) {
        setAuditMsg(
          `${res.data.nWorksScanned} obras processadas, ${res.data.nAutoApplied} auto-aplicadas, ${res.data.nSuggestions - res.data.nAutoApplied} pendentes.`,
        )
      }
    })
  }

  return (
    <ActionZone
      accent="cyan"
      title="Auditar obras"
      meta={
        lastAudit ? (
          <span className="tabular-nums">
            Último run {formatRelativeDateTime(lastAudit.completed_at ?? lastAudit.created_at)} ·{" "}
            {lastAudit.n_works_scanned} obras · {lastAudit.n_auto_applied} auto-aplicadas ·{" "}
            {lastAudit.n_suggestions - lastAudit.n_auto_applied} pendentes
          </span>
        ) : (
          "Ainda não executado."
        )
      }
      message={auditMsg}
      button={
        <Button size="sm" onClick={() => void handleAudit()} disabled={auditPending || ratedWorksCount === 0}>
          {auditPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ScanSearch className="mr-2 h-4 w-4" />
          )}
          Rodar auditoria
        </Button>
      }
    />
  )
}

export function BiasTriggerZone({
  lastBias,
  ratedWorksCount,
}: {
  lastBias: CalibrationRunRow | null
  ratedWorksCount: number
}) {
  const [biasPending, startBias] = useTransition()
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
    startBias(async () => {
      const res = await runBiasReportAction()
      if (res.error) {
        setBiasMsg(`Erro: ${res.error}`)
      } else {
        setBiasMsg("Relatório de viés atualizado.")
      }
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
