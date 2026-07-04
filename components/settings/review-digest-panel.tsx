"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Layers } from "lucide-react"
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
}

/**
 * Item C, Passe 2 — backfill OPT-IN do digest estruturado (Sonnet). Diferente do
 * resumo-texto (Haiku, automático), o digest é gerado só sob demanda aqui pra o
 * user controlar o gasto Sonnet (~$0.02/obra, one-time). Sem badge de pendência:
 * a action filtra as pendentes (sem digest ou versão antiga) por conta própria.
 */
export function ReviewDigestPanel({ accent }: ReviewDigestPanelProps) {
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
        scale: 10,
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1 text-sm text-muted-foreground">
          <p>
            Destila as reviews de cada obra num <strong>digest estruturado</strong>{" "}
            (consenso, divergência, traços salientes, alertas, execução) via Sonnet 4.6
            (~$0.02–0.04 por obra, varia com o volume de reviews), com amostragem
            estratificada por fonte. É o sinal qualitativo
            que o <strong>consultor IA</strong> consome (Recomendar / Veredito IA / Deep Dive / Chat).
          </p>
          <p className="text-xs">
            Custo único por obra, amortizado — só re-roda quando a versão do digest muda.
            Cada clique processa até 10 obras pendentes; rode várias vezes até zerar.
            Requer a migration <code>103_works_review_digest</code> aplicada.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void handleRun()}
          disabled={isPending}
          className={ACCENT_BUTTON[accent]}
        >
          <Layers className={isPending ? "animate-pulse" : ""} />
          {isPending ? "Gerando…" : "Gerar digests pendentes"}
        </Button>
      </div>

      {lastResult && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Gerados" value={lastResult.digested} hint={`de ${lastResult.attempted} tentativas`} />
          <StatCard
            label="Pulados / falhas"
            value={`${lastResult.skipped} / ${lastResult.failed}`}
            hint="sem review útil / erro de API"
          />
          <StatCard
            label="Tokens"
            value={(lastResult.tokensIn + lastResult.tokensOut).toLocaleString("pt-BR")}
            valueClassName="text-sm"
            hint={`${lastResult.tokensIn.toLocaleString("pt-BR")} in / ${lastResult.tokensOut.toLocaleString("pt-BR")} out`}
          />
        </div>
      )}
    </div>
  )
}
