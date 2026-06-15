"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Brain, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { StatCard } from "@/components/settings/stat-card"
import { ACCENT_BUTTON, type SettingsAccent } from "@/lib/settings-accent"
import { useRefresh } from "@/lib/use-refresh"
import {
  refreshEmbeddings,
  type RefreshEmbeddingsResult,
} from "@/server/actions/embeddings"

interface EmbeddingsPanelProps {
  accent: SettingsAccent
  /** Quantas obras já têm embedding cacheado (lido do DB no server). */
  initialCachedCount: number
  /** Quantas obras precisam re-embedar (sem linha OU com hash desatualizado). */
  initialPendingCount: number
  totalWorks: number
  initialLastRun: string | null
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function EmbeddingsPanel({ accent, initialCachedCount, initialPendingCount, totalWorks, initialLastRun }: EmbeddingsPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [lastResult, setLastResult] = useState<RefreshEmbeddingsResult | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(initialLastRun)
  const [pendingCount, setPendingCount] = useState<number>(initialPendingCount)
  const refresh = useRefresh()

  const handleRefresh = () => {
    startTransition(async () => {
      try {
        const result = await refreshEmbeddings()
        setLastResult(result)
        setLastRun(new Date().toISOString())
        setPendingCount(result.failed)
        // Atualiza o badge "Configurações" da sidebar em tempo real (re-fetch sem
        // patch, que ignora o TTL) quando o pool de pendências de fato mudou.
        if (result.refreshed > 0) refresh()
        if (result.refreshed === 0 && result.failed === 0) {
          toast.info("Tudo em dia — nenhum embedding precisava ser atualizado.")
        } else if (result.failed > 0) {
          toast.warning(
            `${result.refreshed} embedados, ${result.failed} falharam. Veja os logs do servidor.`,
          )
        } else {
          toast.success(
            `${result.refreshed} embeddings atualizados (${formatTokens(result.tokensUsed)} tokens, ~$${result.estimatedCostUsd.toFixed(4)}).`,
          )
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao gerar embeddings")
      }
    })
  }

  const completionPct = totalWorks > 0 ? Math.round((initialCachedCount / totalWorks) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Gera representação vetorial (1536 dims) de cada obra usando OpenAI{" "}
          <span className="font-mono">text-embedding-3-small</span>. Cacheado eternamente em{" "}
          <span className="font-mono">work_embeddings</span> — só re-embeda quando sinopse, tags ou
          critérios mudam. Fundação pras features &quot;obras parecidas&quot; (Passo 4) e kNN
          predictor (Passo 5). Custo: ~$0.02 por milhão de tokens (~$0.10–1.00 pra base inteira).
        </p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button
            onClick={handleRefresh}
            disabled={isPending || pendingCount === 0}
            className={ACCENT_BUTTON[accent]}
          >
            <Brain className="mr-1 h-4 w-4" />
            {isPending ? "Embedando..." : "Atualizar embeddings"}
          </Button>
          <LastRunHint iso={lastRun} label="Última atualização" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Pendentes"
          value={Math.max(0, pendingCount)}
          hint="obras sem embedding ou com hash desatualizado"
        />
        <StatCard
          label="Cacheados"
          value={`${initialCachedCount} / ${totalWorks}`}
          hint={`${completionPct}% da base`}
        />
        <StatCard
          label="Modelo"
          value="text-embedding-3-small"
          valueClassName="text-xs"
          hint="1536 dimensões · $0.02/M tokens"
        />
      </div>

      {lastResult && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">Última execução</p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              Pulados (já em dia):{" "}
              <span className="font-mono text-foreground">{lastResult.skipped}</span>
            </li>
            <li>
              Embedados nesta run:{" "}
              <span className="font-mono text-foreground">{lastResult.refreshed}</span>
            </li>
            {lastResult.failed > 0 && (
              <li className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" /> Falharam:{" "}
                <span className="font-mono">{lastResult.failed}</span>
              </li>
            )}
            <li>
              Tokens consumidos:{" "}
              <span className="font-mono text-foreground">
                {formatTokens(lastResult.tokensUsed)}
              </span>{" "}
              (~${lastResult.estimatedCostUsd.toFixed(4)})
            </li>
          </ul>
        </div>
      )}

      {totalWorks > 0 && initialCachedCount === 0 && !lastResult && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">Nenhum embedding gerado ainda.</p>
            <p>
              Configure <span className="font-mono">OPENAI_API_KEY</span> no{" "}
              <span className="font-mono">.env.local</span>, rode a migration 053 (habilita
              pgvector + cria tabela) e clique em &quot;Atualizar embeddings&quot;.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
