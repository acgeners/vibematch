"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Layers, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/settings/stat-card"
import { ACCENT_BUTTON, type SettingsAccent } from "@/lib/settings-accent"
import { useRefresh } from "@/lib/use-refresh"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import {
  consolidatePendingReviewDigests,
  type ConsolidateReviewDigestsProgress,
} from "@/server/actions/settings"

interface ReviewDigestPanelProps {
  accent: SettingsAccent
  /** Obras com reviews e digest nulo/versão antiga (espelha o filtro da action). */
  pendingCount: number
  /** Obras com ≥1 review (universo digestável). */
  totalCount: number
}

/**
 * Item C, Passe 2 — backfill OPT-IN do digest estruturado (Sonnet). Diferente do
 * resumo-texto (Haiku, automático), o digest é gerado só sob demanda aqui pra o
 * user controlar o gasto Sonnet (~$0.02/obra, one-time). NÃO entra no badge da
 * sidebar (opt-in), mas mostra a fila (Pendentes/Gerados) igual ao Resumo —
 * `pendingCount`/`totalCount` vêm de `countReviewDigestCoverage` (mesmo filtro).
 */
export function ReviewDigestPanel({ accent, pendingCount, totalCount }: ReviewDigestPanelProps) {
  const [lastResult, setLastResult] = useState<ConsolidateReviewDigestsProgress | null>(null)
  const refresh = useRefresh()
  const tasks = useAppTasks()
  const confirmCost = useCostConfirm()
  const isPending = tasks.some((t) => t.id === "digest" && t.status === "running")

  // Roda em segundo plano via store global: aparece no indicador, você pode sair
  // das configurações enquanto processa. `consolidatePendingReviewDigests` resolve
  // com { error } | { data } (não lança), então o sucesso/erro vem no onDone.
  const handleRun = async () => {
    // Processa até 10 pendentes por clique — estima pelo teto do lote.
    if (
      !(await confirmCost({
        action: "review_digest",
        scale: Math.min(pendingCount, 10),
        title: "Gerar digests pendentes (até 10 obras)?",
      }))
    ) {
      return
    }
    runTask({
      id: "digest",
      kind: "digest",
      label: "Consolidando digests de reviews",
      run: () => consolidatePendingReviewDigests(10),
      successToast: () => null, // mensagens específicas vão no onDone (warning/info/success)
      onDone: (result) => {
        if (result.error) {
          toast.error(result.error)
          return
        }
        if (!result.data) return
        setLastResult(result.data)
        if (result.data.digested > 0) refresh()
        if (result.data.abortedEarly) {
          toast.warning(
            `Anthropic congestionada — abortei após ${result.data.failed} falhas seguidas. ${result.data.digested} digests gerados antes do abort.`,
          )
        } else if (result.data.digested === 0 && result.data.failed === 0) {
          toast.info("Nada pra processar — todas as obras com reviews já têm digest em dia.")
        } else {
          toast.success(
            `${result.data.digested} digests gerados (~${(result.data.tokensIn + result.data.tokensOut).toLocaleString("pt-BR")} tokens).`,
          )
        }
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao gerar digest de reviews"),
    })
  }

  const completionPct =
    totalCount > 0 ? Math.round(((totalCount - pendingCount) / totalCount) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1 text-sm text-muted-foreground">
          <p>
            Destila as reviews num{" "}
            <strong className="font-semibold text-foreground">digest estruturado</strong> (consenso,
            divergências, traços, alertas) via Sonnet 4.6 (~$0.02–0.04 por obra). É o sinal
            qualitativo que o{" "}
            <strong className="font-semibold text-foreground">consultor IA</strong> consome (Recomendar
            / Veredito / Deep Dive / Chat).
          </p>
          <p className="text-xs">
            Custo único por obra — só re-roda quando a versão do digest muda. Cada clique processa até
            10 pendentes e roda em segundo plano (pode sair da página).
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void handleRun()}
          disabled={isPending || pendingCount === 0}
          className={ACCENT_BUTTON[accent]}
        >
          {isPending ? <Loader2 className="animate-spin" /> : <Layers />}
          {isPending ? "Gerando…" : "Gerar digests pendentes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Pendentes" value={pendingCount} hint="com reviews, sem digest" />
        <StatCard
          label="Gerados"
          value={`${totalCount - pendingCount} / ${totalCount}`}
          hint={`${completionPct}% das obras com reviews`}
        />
        <StatCard
          label="Modelo"
          value="claude-sonnet-4-6"
          valueClassName="text-xs"
          hint="~$0.02–0.04/obra"
        />
      </div>

      {lastResult && (
        <div className="space-y-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">Última execução</p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              Gerados: <span className="font-mono text-foreground">{lastResult.digested}</span> de{" "}
              {lastResult.attempted} tentativas
            </li>
            {lastResult.skipped > 0 && (
              <li>
                Pulados (sem review útil): <span className="font-mono">{lastResult.skipped}</span>
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
