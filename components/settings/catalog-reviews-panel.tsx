"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Loader2, MessageSquarePlus, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RunningStrip } from "@/components/settings/running-strip"
import { StatCard } from "@/components/settings/stat-card"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { ACCENT_BUTTON } from "@/lib/settings-accent"
import type { SettingsAccent } from "@/lib/settings-accent"
import { runTask, setTaskProgress } from "@/lib/tasks-store"
import { useRefresh } from "@/lib/use-refresh"
import { runCatalogReviewBatch, summarizeReviewBatch } from "@/lib/reviews/catalog-review-batch"
import type { ReviewBatchSummary } from "@/lib/reviews/catalog-review-batch"
import { refreshReviewsForWorks } from "@/server/actions/reviews"
import { checkProtectedSourcesHealth } from "@/server/actions/source-health"
import type { CatalogReviewsOverview } from "@/server/queries/catalog-reviews"

const TASK_ID = "catalog-reviews"

/**
 * O "Parar" mora no MÓDULO, não no estado do componente: o laço roda dentro do `runTask`, que
 * sobrevive à navegação, e o painel pode ter sido desmontado e montado de novo quando a pessoa
 * clica em Parar. Um `useState` aqui pararia só a cópia que já não existe.
 */
let stopRequested = false

/** Até onde a estimativa cabe em minutos, e de onde passa a ser em horas. */
function formatDuration(seconds: number): string {
  if (seconds < 3600) return `~${Math.max(1, Math.round(seconds / 60))} min`
  return `~${(seconds / 3600).toFixed(1).replace(".", ",")} h`
}

/**
 * Lote do catálogo: busca de novo as REVIEWS de todas as obras ativas, pelas fontes já vinculadas
 * (`refreshReviewsForWorks`). Não chama IA. Grava enquanto roda ⇒ tarefa AZUL (pode navegar).
 *
 * Separado do lote de capítulos de propósito: lá são ~0,6 s por obra; aqui ~37 s (Mangago).
 * Quem quer saber QUAIS obras ganharam mais olha a fila "Reviews novas", que ordena por isso.
 *
 * ⚠️ Comix e Mangago exigem o FlareSolverr (Docker) no Mac: rode no localhost:3000. O painel confere
 * antes de começar e para sozinho se o bypass cair no meio.
 */
export function CatalogReviewsPanel({
  accent,
  overview,
  staleDays,
  secondsPerWork,
}: {
  accent: SettingsAccent
  overview: CatalogReviewsOverview
  staleDays: number
  secondsPerWork: number
}) {
  const { targets, neverChecked, checkedLongAgo } = overview
  const tasks = useAppTasks()
  const isRunning = tasks.some((t) => t.id === TASK_ID && t.status === "running")
  const [summary, setSummary] = useState<ReviewBatchSummary | null>(null)
  const [stopping, setStopping] = useState(false)
  const refresh = useRefresh()

  const handleRun = () => {
    const ids = targets.map((t) => t.id)
    const total = ids.length
    if (total === 0) return
    const titleById = new Map(targets.map((t) => [t.id, t.title]))
    stopRequested = false
    setStopping(false)

    runTask({
      id: TASK_ID,
      kind: "catalog-reviews",
      label: `Buscando reviews: ${total} obras`,
      run: async () => {
        // Sem bypass, a Comix e o Mangago voltam vazios em toda obra e o lote roda horas sem
        // gravar o que importa. Confere ANTES de começar, pela chave do check (nunca pelo texto).
        const health = await checkProtectedSourcesHealth()
        const blockers = health.checks.filter((c) => (c.key === "flaresolverr" || c.key === "mangago") && !c.ok)
        if (blockers.length > 0) {
          throw new Error(
            `não comecei — ${blockers.map((b) => `${b.label}: ${b.detail}`).join("; ")}. ` +
              "Ligue o Docker (FlareSolverr) e rode no localhost:3000.",
          )
        }
        return runCatalogReviewBatch(ids, {
          refresh: (id) => refreshReviewsForWorks([id]),
          shouldStop: () => stopRequested,
          onProgress: (done, all) => setTaskProgress(TASK_ID, done, all),
        })
      },
      onDone: (outcome) => {
        const s = summarizeReviewBatch(outcome, titleById)
        setSummary(s)
        setStopping(false)
        refresh()
        const description = `${s.worksWithGain} obra(s) ganharam ${s.totalGained} review(s) útil(eis)`
        if (s.abortedReason) toast.error(`Lote de reviews interrompido após ${s.processed} obras`, { description: s.abortedReason })
        else if (s.stoppedByUser) toast.info(`Lote de reviews parado: ${s.processed} de ${total} obras`, { description })
        else if (s.failed.length > 0) toast.warning(`Reviews buscadas: ${s.processed} obras`, { description: `${description} · ${s.failed.length} com fonte em falha` })
        else toast.success(`Reviews buscadas: ${s.processed} obras`, { description })
      },
      // O desfecho tem quatro tons (ok / com falhas / parado / abortado); quem emite é o `onDone`.
      successToast: () => null,
    })
  }

  const handleStop = () => {
    stopRequested = true
    setStopping(true)
  }

  const pending = neverChecked + checkedLongAgo

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1 text-sm text-muted-foreground">
          <p>
            Busca de novo as <strong className="font-semibold text-foreground">reviews</strong> de todas as obras
            ativas, pelas fontes já vinculadas. Não chama IA: o resumo e o digest são refeitos quando a obra for
            reavaliada. As que ganharam mais reviews desde a avaliação aparecem primeiro na fila{" "}
            <Link href="/curation/works?filter=outdated-reviews" className="underline underline-offset-2 hover:text-foreground">
              Reviews novas
            </Link>
            .
          </p>
          <p className="text-xs">
            Rode no localhost:3000 com o Docker (FlareSolverr) ligado: Comix e Mangago dependem dele. Cerca de{" "}
            {secondsPerWork} s por obra ({formatDuration(targets.length * secondsPerWork)} para todas); pode navegar
            enquanto roda e parar quando quiser — a próxima rodada continua das buscadas há mais tempo.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {isRunning && (
            <Button variant="outline" onClick={handleStop} disabled={stopping}>
              {stopping ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Square className="mr-1 h-4 w-4" />}
              {stopping ? "Parando depois desta obra…" : "Parar"}
            </Button>
          )}
          <Button onClick={handleRun} disabled={isRunning || targets.length === 0} className={ACCENT_BUTTON[accent]}>
            {isRunning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <MessageSquarePlus className="mr-1 h-4 w-4" />}
            {isRunning ? "Buscando…" : "Buscar reviews"}
          </Button>
        </div>
      </div>

      <RunningStrip accent={accent} label="Buscando reviews do catálogo" running={isRunning} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Obras no lote" value={targets.length} hint="todas as ativas" />
        <StatCard label="Nunca buscadas" value={neverChecked} hint="sem busca completa de reviews" />
        <StatCard
          label={`Há mais de ${staleDays} dias`}
          value={checkedLongAgo}
          hint={pending > 0 ? `${formatDuration(pending * secondsPerWork)} para estas e as nunca buscadas` : "última busca antiga"}
        />
      </div>

      {summary && (
        <div className="space-y-2 rounded-md border border-border p-3 text-xs">
          <p className="font-medium text-foreground">
            Última execução: {summary.processed} obras · {summary.worksWithGain} ganharam reviews ·{" "}
            {summary.totalGained} review(s) útil(eis) nova(s)
            {summary.failed.length > 0 ? ` · ${summary.failed.length} com fonte em falha` : ""}
            {summary.remaining > 0 ? ` · ${summary.remaining} ficaram para a próxima` : ""}
          </p>
          {summary.abortedReason && <p className="text-rose-600 dark:text-rose-400">{summary.abortedReason}</p>}
          {summary.top.length > 0 && (
            <ul className="space-y-0.5 text-muted-foreground">
              {summary.top.map((t, i) => (
                <li key={i}>
                  {t.title} <span className="text-foreground">+{t.gained}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.failed.length > 0 && (
            <p className="text-muted-foreground">
              Com fonte em falha (voltam primeiro na próxima rodada):{" "}
              {summary.failed
                .slice(0, 10)
                .map((f) => `${f.title} (${f.reason})`)
                .join(", ")}
              {summary.failed.length > 10 ? ` e mais ${summary.failed.length - 10}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
