"use client"

import { useState, useTransition } from "react"
import { ChartNoAxesCombined, Loader2, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { runBiasReportAction, runCalibrationAuditAction } from "@/server/actions/calibration"
import { formatRelativeDateTime } from "@/lib/date-utils"
import type { CalibrationRunRow } from "@/lib/ai-calibration/types"

interface CalibrationTriggerCardsProps {
  lastAudit: CalibrationRunRow | null
  lastBias: CalibrationRunRow | null
  ratedWorksCount: number
}

export function CalibrationTriggerCards({
  lastAudit,
  lastBias,
  ratedWorksCount,
}: CalibrationTriggerCardsProps) {
  const [auditPending, startAudit] = useTransition()
  const [biasPending, startBias] = useTransition()
  const [auditMsg, setAuditMsg] = useState<string | null>(null)
  const [biasMsg, setBiasMsg] = useState<string | null>(null)
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanSearch className="h-4 w-4 text-cyan-500" />
              Auditar obras
            </CardTitle>
            <CardDescription className="text-xs">
              IA olha cada obra com nota pessoal e sugere ajustes nos 9 critérios. Sugestões
              fortes (confidence ≥ 0.8 e |Δ| ≤ 1.5) são auto-aplicadas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {lastAudit ? (
                <>
                  <div>Último run: {formatRelativeDateTime(lastAudit.completed_at ?? lastAudit.created_at)}</div>
                  <div>
                    {lastAudit.n_works_scanned} obras · {lastAudit.n_auto_applied} auto-aplicadas
                    · {lastAudit.n_suggestions - lastAudit.n_auto_applied} pendentes
                  </div>
                </>
              ) : (
                <div>Ainda não executado.</div>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => void handleAudit()}
              disabled={auditPending || ratedWorksCount === 0}
            >
              {auditPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="mr-2 h-4 w-4" />
              )}
              Rodar auditoria
            </Button>
            {auditMsg && <p className="text-xs text-foreground/80">{auditMsg}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ChartNoAxesCombined className="h-4 w-4 text-violet-500" />
              Detectar viés global
            </CardTitle>
            <CardDescription className="text-xs">
              Análise agregada do catálogo. Detecta deslocamentos sistemáticos (ex.: romance
              está +1.2 sistematicamente alto). Só relatório, não muda scores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {lastBias ? (
                <div>Último relatório: {formatRelativeDateTime(lastBias.completed_at ?? lastBias.created_at)}</div>
              ) : (
                <div>Ainda não executado.</div>
              )}
            </div>
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
            {biasMsg && <p className="text-xs text-foreground/80">{biasMsg}</p>}
          </CardContent>
        </Card>
    </div>
  )
}
