"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RunningStrip } from "@/components/settings/running-strip"
import { StatCard } from "@/components/settings/stat-card"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { ACCENT_BUTTON } from "@/lib/settings-accent"
import type { SettingsAccent } from "@/lib/settings-accent"
import { runTask, setTaskProgress } from "@/lib/tasks-store"
import { useRefresh } from "@/lib/use-refresh"
import { checkReadingUpdates } from "@/server/actions/reading"
import type { ReadingUpdateResult } from "@/server/actions/reading"
import type { CatalogSyncOverview } from "@/server/queries/catalog-sync"

const TASK_ID = "catalog-sync"
/** Múltiplo do `CHECK_CONCURRENCY = 3` do servidor — o mesmo passo da `/reading`. */
const CHUNK = 6

interface StatusChange {
  title: string
  status: string
}

interface RunSummary {
  checked: number
  newChapters: number
  statusChanges: StatusChange[]
  failed: string[]
}

function summarize(results: ReadingUpdateResult[], titleById: Map<string, string>): RunSummary {
  const title = (id: string) => titleById.get(id) ?? id
  return {
    checked: results.length,
    newChapters: results.filter((r) => r.hasNew).length,
    statusChanges: results
      .filter((r) => r.statusApplied)
      .map((r) => ({ title: title(r.workId), status: r.statusApplied as string })),
    failed: results.filter((r) => r.failed).map((r) => title(r.workId)),
  }
}

/**
 * Lote do catálogo: checa capítulos e status de publicação das obras Ongoing, Hiatus e
 * Unknown (`CATALOG_SYNC_STATUSES`) com a MESMA checagem da `/reading` (`checkReadingUpdates`),
 * e portanto a mesma regra de capítulos (`pickTotalChapters`) e de status
 * (`decidePublicationStatus`). Grava enquanto roda ⇒ tarefa AZUL (pode navegar).
 *
 * ⚠️ Precisa do bypass do Cloudflare (sidecar + FlareSolverr), que só existe no Mac: rode no
 * localhost:3000. Sem ele a obra falha por fonte e nada dela é gravado.
 */
export function CatalogSyncPanel({
  accent,
  overview,
  staleDays,
}: {
  accent: SettingsAccent
  overview: CatalogSyncOverview
  staleDays: number
}) {
  const { targets, neverChecked, checkedLongAgo } = overview
  const tasks = useAppTasks()
  const isRunning = tasks.some((t) => t.id === TASK_ID && t.status === "running")
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const refresh = useRefresh()

  const handleRun = () => {
    const ids = targets.map((t) => t.id)
    const total = ids.length
    if (total === 0) return
    const titleById = new Map(targets.map((t) => [t.id, t.title]))

    runTask({
      id: TASK_ID,
      kind: "catalog-sync",
      label: `Verificando capítulos e status: ${total} obras`,
      run: async () => {
        setTaskProgress(TASK_ID, 0, total)
        const all: ReadingUpdateResult[] = []
        for (let i = 0; i < total; i += CHUNK) {
          const res = await checkReadingUpdates(ids.slice(i, i + CHUNK))
          // 🔴 A action devolve `[]` sem lançar quando o gate de admin recusa. Sem o throw, o
          // indicador anunciaria "pronto" para uma checagem que não aconteceu.
          if (res.length === 0) {
            throw new Error("nenhuma obra foi verificada (sem permissão ou sessão expirada)")
          }
          all.push(...res)
          setTaskProgress(TASK_ID, Math.min(i + CHUNK, total), total)
        }
        return all
      },
      onDone: (results) => {
        const s = summarize(results, titleById)
        setSummary(s)
        refresh()
        const parts = [
          `${s.newChapters} com capítulo novo`,
          `${s.statusChanges.length} mudança(s) de status`,
        ]
        if (s.failed.length > 0) parts.push(`${s.failed.length} não verificada(s)`)
        const notify = s.failed.length > 0 ? toast.warning : toast.success
        notify(`Catálogo verificado: ${s.checked} obras`, { description: parts.join(" · ") })
      },
      // O desfecho tem dois tons (tudo verificado / com falhas); quem emite é o `onDone`.
      successToast: () => null,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1 text-sm text-muted-foreground">
          <p>
            Atualiza o <strong className="font-semibold text-foreground">último capítulo disponível</strong> e o{" "}
            <strong className="font-semibold text-foreground">status de publicação</strong> das obras em andamento, em
            hiato ou sem status, com a mesma checagem da página Acompanhamento (Comix, Mangago e MangaUpdates). Não
            chama IA.
          </p>
          <p className="text-xs">
            Rode no localhost:3000: Mangago e Comix dependem do bypass do Cloudflare, que só existe no Mac. Leva
            alguns minutos (~1,5 s por obra); pode navegar enquanto roda. As obras checadas há mais tempo vão primeiro.
          </p>
        </div>
        <Button onClick={handleRun} disabled={isRunning || targets.length === 0} className={`shrink-0 ${ACCENT_BUTTON[accent]}`}>
          {isRunning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
          {isRunning ? "Verificando…" : "Verificar capítulos e status"}
        </Button>
      </div>

      <RunningStrip accent={accent} label="Verificando capítulos e status do catálogo" running={isRunning} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Obras no lote" value={targets.length} hint="em andamento, em hiato ou sem status" />
        <StatCard label="Nunca verificadas" value={neverChecked} hint="sem checagem de capítulos" />
        <StatCard label={`Há mais de ${staleDays} dias`} value={checkedLongAgo} hint="última checagem antiga" />
      </div>

      {summary && (
        <div className="space-y-2 rounded-md border border-border p-3 text-xs">
          <p className="font-medium text-foreground">
            Última execução: {summary.checked} obras · {summary.newChapters} com capítulo novo ·{" "}
            {summary.statusChanges.length} mudança(s) de status
            {summary.failed.length > 0 ? ` · ${summary.failed.length} não verificada(s)` : ""}
          </p>
          {summary.statusChanges.length > 0 && (
            <ul className="space-y-0.5 text-muted-foreground">
              {summary.statusChanges.map((c, i) => (
                <li key={i}>
                  {c.title} → <span className="text-foreground">{c.status}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.failed.length > 0 && (
            <p className="text-muted-foreground">
              Não verificadas (nenhuma fonte de capítulo respondeu): {summary.failed.slice(0, 10).join(", ")}
              {summary.failed.length > 10 ? ` e mais ${summary.failed.length - 10}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
