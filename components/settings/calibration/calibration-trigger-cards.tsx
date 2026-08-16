"use client"

import { useState } from "react"
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
import { AUTO_APPLY_ENABLED } from "@/lib/ai-calibration/policy"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { formatRelativeDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { AuditStaleness, AuditStalenessLevel, CalibrationRunRow } from "@/lib/ai-calibration/types"
import type { ReactNode } from "react"

const AUDIT_TASK_ID = "calibration-audit"
const BIAS_TASK_ID = "bias-report"

/** Resumo do run — o mesmo texto serve à linha inline e ao toast de conclusão. */
function auditSummary(d: {
  nWorksScanned: number
  nAutoApplied: number
  nSuggestions: number
  scope: string
}): string {
  if (d.nWorksScanned === 0) return "Nada mudou desde a última auditoria — nenhum run criado."
  const label = d.scope === "full" ? "Varredura completa" : "Incremental"
  // Com o auto-apply desligado o termo não aparece: "0 auto-aplicadas" anuncia um caminho
  // que não existe mais e faz procurar defeito onde há política.
  const aplicadas = AUTO_APPLY_ENABLED ? `${d.nAutoApplied} auto-aplicadas · ` : ""
  return `${label}: ${d.nWorksScanned} obras · ${aplicadas}${d.nSuggestions - d.nAutoApplied} pendentes pra revisar.`
}

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
  // A auditoria varre TODAS as obras com nota pessoal e grava `calibration_runs` —
  // durável e das mais longas da console. Pendência vem do store; a linha de
  // resumo continua inline, que é onde ela é útil pra quem fica.
  const tasks = useAppTasks()
  const auditPending = tasks.some((t) => t.id === AUDIT_TASK_ID && t.status === "running")
  const [auditMsg, setAuditMsg] = useState<string | null>(null)
  const confirmCost = useCostConfirm()

  // Escopo que o botão primário vai rodar: completa quando a régua mudou / nunca rodou (todas
  // stale), senão só as que mudaram. Espelha a decisão de runCalibrationAuditAction.
  const driftOrNever = staleness.modelDrift || !staleness.hasRun
  const willScan = driftOrNever ? ratedWorksCount : staleness.changedWorks
  const nothingChanged = !driftOrNever && willScan === 0

  const handleAudit = async (full: boolean) => {
    const scanCount = full || driftOrNever ? ratedWorksCount : staleness.changedWorks
    if (scanCount === 0) return
    const fullRun = full || driftOrNever
    if (
      !(await confirmCost({
        action: "calibration_audit",
        scale: scanCount,
        title: fullRun ? "Rodar auditoria completa?" : "Rodar auditoria incremental?",
        description: fullRun
          ? `Reavalia as ${scanCount} obras com nota pessoal${driftOrNever && !full ? " (a régua mudou desde o último run)" : ""}. Scores "manual"/"ai_edited" não são tocados.`
          : `Reavalia só as ${scanCount} obras que mudaram desde a última auditoria. Scores "manual"/"ai_edited" não são tocados.`,
        confirmLabel: "Rodar",
      }))
    ) {
      return
    }
    setAuditMsg(null)
    runTask({
      id: AUDIT_TASK_ID,
      kind: "calibration-audit",
      label: `Auditando ${scanCount} obra${scanCount !== 1 ? "s" : ""}`,
      run: async () => {
        const res = await runCalibrationAuditAction(full ? { full: true } : {})
        // A action devolve `{ error }` em vez de lançar; sem converter, o store
        // anunciaria "pronto" pra uma falha.
        if (res.error || !res.data) throw new Error(res.error ?? "Falha na auditoria.")
        return res.data
      },
      successToast: (d) => ({ message: auditSummary(d) }),
      onDone: (d) => setAuditMsg(auditSummary(d)),
      // Só a linha inline: o `runTask` já emite o `toast.error`.
      onError: (err) => setAuditMsg(`Erro: ${err instanceof Error ? err.message : "falhou"}`),
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
            {lastAudit.n_works_scanned} obras ·{" "}
            {/* Run ANTIGO que auto-aplicou segue mostrando o número — é fato daquele run.
                O que sai é o "0 auto-aplicadas" dos runs de agora. */}
            {lastAudit.n_auto_applied > 0 ? `${lastAudit.n_auto_applied} auto-aplicadas · ` : ""}
            {lastAudit.n_suggestions - lastAudit.n_auto_applied} pendentes
          </span>
        ) : (
          "Ainda não executado."
        )
      }
      message={auditMsg}
      footer={<AuditStalenessRow staleness={staleness} />}
      button={
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            onClick={() => void handleAudit(false)}
            disabled={auditPending || ratedWorksCount === 0 || nothingChanged}
          >
            {auditPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ScanSearch className="mr-2 h-4 w-4" />
            )}
            {nothingChanged
              ? "Nada a auditar"
              : `Rodar auditoria${ratedWorksCount > 0 ? ` · ${willScan}` : ""}`}
          </Button>
          {staleness.modelDrift && (
            <span className="text-[10.5px] text-muted-foreground/70">varre tudo · régua mudou</span>
          )}
          {!driftOrNever && ratedWorksCount > 0 && (
            <button
              type="button"
              onClick={() => void handleAudit(true)}
              disabled={auditPending}
              className="text-[11px] text-muted-foreground/70 underline underline-offset-2 outline-none hover:text-foreground focus-visible:text-foreground disabled:opacity-50"
            >
              rodar tudo ({ratedWorksCount})
            </button>
          )}
        </div>
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
