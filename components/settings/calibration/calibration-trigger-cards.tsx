"use client"

import { useState, useTransition } from "react"
import { ChartNoAxesCombined, Info, Loader2, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { runBiasReportAction, runCalibrationAuditAction } from "@/server/actions/calibration"
import { formatRelativeDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { AuditStaleness, AuditStalenessLevel, CalibrationRunRow } from "@/lib/ai-calibration/types"
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

const STALENESS_STYLE: Record<
  AuditStalenessLevel,
  { label: string; pill: string; dot: string; fill: string }
> = {
  fresh: {
    label: "Em dia",
    pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25",
    dot: "bg-emerald-400",
    fill: "bg-emerald-500",
  },
  review: {
    label: "Vale revisar",
    pill: "bg-amber-500/10 text-amber-400 ring-amber-500/25",
    dot: "bg-amber-400",
    fill: "bg-amber-500",
  },
  stale: {
    label: "Recomendado rodar",
    pill: "bg-orange-500/12 text-orange-400 ring-orange-500/30",
    dot: "bg-orange-400",
    fill: "bg-orange-500",
  },
  never: {
    label: "Nunca auditado",
    pill: "bg-orange-500/12 text-orange-400 ring-orange-500/30",
    dot: "bg-orange-400",
    fill: "bg-orange-500",
  },
}

/** Texto do tooltip — a explicação que saiu do card enxuto e virou hover/foco no chip. */
function stalenessReason(s: AuditStaleness): ReactNode {
  const since = s.lastRunAt ? formatRelativeDateTime(s.lastRunAt) : null

  if (s.level === "never") {
    return (
      <>
        <b>Nunca auditado.</b> {s.ratedWorks} obras avaliadas esperando a primeira auditoria.
      </>
    )
  }

  const facets: string[] = []
  if (s.changedByScore > 0) facets.push(`${s.changedByScore} com nota pessoal alterada`)
  if (s.changedByCriteria > 0) facets.push(`${s.changedByCriteria} com avaliação IA refeita`)
  const facetText = facets.length ? ` Sinais: ${facets.join(" · ")}.` : ""

  if (s.level === "fresh") {
    return (
      <>
        <b>{s.changedWorks} obras</b> que a auditoria poderia rever
        {since ? ` desde ${since}` : ""}. Pouca coisa mudou — pode esperar.{facetText}
      </>
    )
  }

  return (
    <>
      {s.modelDrift && (
        <>
          <b>A régua mudou desde o último run</b>
          {s.driftDetail ? ` (${s.driftDetail})` : ""}.{" "}
        </>
      )}
      <b>{s.changedWorks} obras</b> que a auditoria poderia rever{since ? ` desde ${since}` : ""}.
      {facetText} Nem toda vai mudar ao re-rodar — é uma estimativa do que vale reconferir.
    </>
  )
}

/** Linha de defasagem: pill de status (tooltip) + chip de drift + barra de %. */
function AuditStalenessRow({ staleness }: { staleness: AuditStaleness }) {
  // Sem obras avaliadas não há o que auditar — o botão já vem desabilitado; some com a linha.
  if (staleness.ratedWorks === 0) return null

  const style = STALENESS_STYLE[staleness.level]
  const pct = Math.round(staleness.staleFraction * 100)

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <TooltipProvider delayDuration={150}>
        <div className="flex flex-wrap items-center gap-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset outline-none focus-visible:ring-2",
                  style.pill,
                )}
              >
                <span className={cn("size-1.5 rounded-full", style.dot)} />
                {style.label}
                <Info className="size-3 opacity-70" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
              {stalenessReason(staleness)}
            </TooltipContent>
          </Tooltip>

          {staleness.modelDrift && staleness.driftDetail && (
            <span className="inline-flex items-center rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-border">
              {staleness.driftDetail}
            </span>
          )}

          <div className="flex min-w-[150px] flex-1 items-center gap-2.5">
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", style.fill)}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
              <span className="absolute inset-y-[-1px] w-px bg-foreground/25" style={{ left: "10%" }} />
              <span className="absolute inset-y-[-1px] w-px bg-foreground/25" style={{ left: "25%" }} />
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {pct}% ({staleness.changedWorks}/{staleness.ratedWorks})
            </span>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}

export function AuditTriggerZone({
  lastAudit,
  ratedWorksCount,
  staleness,
}: {
  lastAudit: CalibrationRunRow | null
  ratedWorksCount: number
  staleness: AuditStaleness
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
      footer={<AuditStalenessRow staleness={staleness} />}
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
