"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Brain, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { RunningStrip } from "@/components/settings/running-strip"
import { StatCard } from "@/components/settings/stat-card"
import { ConsoleSectionNote } from "@/components/console/console-section"
import { ACCENT_BUTTON, type SettingsAccent } from "@/lib/settings-accent"
import { useRefresh } from "@/lib/use-refresh"
import {
  refreshEmbeddings,
  type RefreshEmbeddingsResult,
} from "@/server/actions/embeddings"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { formatUsdApprox } from "@/lib/format/money"

const EMBEDDINGS_TASK_ID = "embeddings"

interface EmbeddingsPanelProps {
  accent: SettingsAccent
  /** Quantas obras já têm embedding cacheado (lido do DB no server). */
  initialCachedCount: number
  /**
   * Quantas obras NUNCA foram embedadas (sem linha em `work_embeddings`).
   *
   * ⚠️ Não inclui hash desatualizado — vem de `countMissingEmbeddings()`, que só checa
   * existência. Este doc-comment já dizia "OU com hash desatualizado" e era falso; foi essa
   * frase que sustentou o `disabled={pendingCount === 0}` no botão.
   */
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
  const tasks = useAppTasks()
  const isPending = tasks.some((t) => t.id === EMBEDDINGS_TASK_ID && t.status === "running")
  const [lastResult, setLastResult] = useState<RefreshEmbeddingsResult | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(initialLastRun)
  const [pendingCount, setPendingCount] = useState<number>(initialPendingCount)
  const refresh = useRefresh()

  const handleRefresh = () => {
    runTask({
      id: EMBEDDINGS_TASK_ID,
      kind: "embeddings",
      // Diferente das outras actions do app, esta LANÇA no gate — então não
      // precisa da conversão de `{ error }` em rejeição.
      run: () => refreshEmbeddings(),
      label: "Atualizando embeddings do catálogo",
      // Suprime o toast padrão: o desfecho aqui tem TRÊS tons (nada a fazer /
      // parcial / tudo certo), e achatar os três em "success" apagaria justamente
      // o caso em que algo falhou.
      successToast: () => null,
      onDone: (result) => {
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
            `${result.refreshed} embeddings atualizados (${formatTokens(result.tokensUsed)} tokens, ${formatUsdApprox(result.estimatedCostUsd)}).`,
          )
        }
      },
      // Sem `onError`: o `runTask` já emite o `toast.error` da rejeição.
    })
  }

  // `initialCachedCount` conta TODAS as linhas de work_embeddings (inclui obras
  // arquivadas), enquanto `totalWorks` é só o catálogo ativo — daí dava "937/931
  // = 101%". Clampa pro universo ativo: a cobertura é sobre o catálogo ativo.
  const cachedShown = Math.min(initialCachedCount, totalWorks)
  const completionPct = totalWorks > 0 ? Math.round((cachedShown / totalWorks) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1 text-sm text-muted-foreground">
          <p>
            Gera a representação vetorial (1536 dims) de cada obra via OpenAI{" "}
            <span className="font-mono">text-embedding-3-small</span> — fundação das &quot;obras
            parecidas&quot; e do kNN predictor. Cacheada em{" "}
            <span className="font-mono">work_embeddings</span>; só re-embeda quando o texto da obra
            muda — sinopse, tags, critérios ou a síntese das reviews.
          </p>
          <p className="text-xs">
            Custo ~2¢ por milhão de tokens (~$0,10–1,00 pra base inteira). Pode rodar a
            qualquer momento: só processa o que mudou, mesmo com &quot;Sem embedding&quot; em 0.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/*
            🔴 NÃO desabilitar por `pendingCount === 0`.

            O contador vem de `countMissingEmbeddings()`, que só olha se EXISTE linha em
            `work_embeddings` — ele nunca compara o `input_hash`. Já o botão chama
            `refreshEmbeddings()`, que re-embeda pelo hash. Ou seja: os dois usam critérios
            diferentes, e o mais cego estava trancando o mais completo.

            Medido em 2026-08-13: "Loved by the Villains" ganhou 37 reviews, o digest entrou
            no texto embedado e o hash mudou — mas o painel dizia "Pendentes 0 · 100% da
            base" e o botão ficava cinza. Não havia como re-embedar pela interface.

            O botão é idempotente e barato (re-embeda só o que mudou; ~2¢ por milhão de
            tokens), então deixá-lo sempre clicável não tem custo real — e a alternativa,
            usar `countStaleEmbeddings()` aqui, puxaria o catálogo inteiro com tags,
            sinopses e digest a cada visita ao /settings.
          */}
          <Button
            onClick={handleRefresh}
            disabled={isPending}
            className={ACCENT_BUTTON[accent]}
          >
            {isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Brain className="mr-1 h-4 w-4" />
            )}
            {isPending ? "Embedando…" : "Atualizar embeddings"}
          </Button>
          <LastRunHint iso={lastRun} label="Última atualização" />
        </div>
      </div>

      <RunningStrip accent={accent} label="Gerando embeddings das obras" running={isPending} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* ⚠️ "sem embedding", e NADA além disso: este número conta linha ausente em
            `work_embeddings`, não hash desatualizado. Dizia "ou com hash desatualizado" e
            era falso — obra re-embedável ficava fora da conta, com 0 na tela. Quem detecta
            hash é o botão. */}
        <StatCard
          label="Sem embedding"
          value={Math.max(0, pendingCount)}
          hint="obra que nunca foi embedada"
        />
        <StatCard
          label="Cacheados"
          value={`${cachedShown} / ${totalWorks}`}
          hint={`${completionPct}% da base`}
        />
        <StatCard
          label="Modelo"
          value="text-embedding-3-small"
          valueClassName="text-xs"
          hint="1536 dimensões · 2¢/M tokens"
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
              ({formatUsdApprox(lastResult.estimatedCostUsd)})
            </li>
          </ul>
        </div>
      )}

      {totalWorks > 0 && initialCachedCount === 0 && !lastResult && (
        <ConsoleSectionNote accent="amber">
          <span className="font-medium text-foreground">Nenhum embedding gerado ainda.</span>{" "}
          Configure <span className="font-mono">OPENAI_API_KEY</span> no{" "}
          <span className="font-mono">.env.local</span>, rode a migration 053 (habilita pgvector +
          cria tabela) e clique em &ldquo;Atualizar embeddings&rdquo;.
        </ConsoleSectionNote>
      )}
    </div>
  )
}
