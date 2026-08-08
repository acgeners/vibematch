"use client"

import { Coins } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatUsd, formatUsdApprox } from "@/lib/format/money"
import type { WorkAiCostSummary, FromScratchBaseline } from "@/server/queries/ai-usage"

/**
 * Badge DEV-ONLY (canto da aba Visão Geral): mostra só o custo de IA total
 * atribuído a esta obra; ao clicar, abre um popover com a quebra por operação.
 *
 * A visibilidade é decidida no servidor (page.tsx só busca/renderiza fora de
 * produção). Custo = soma de `cost_total_usd` de todas as chamadas com
 * `metadata.work_id` desta obra (avaliação IA, prever interesse, digest/resumo
 * de reviews, tags…), inclusive tentativas com erro.
 */
export function DevWorkAiCost({
  summary,
  baseline,
}: {
  summary: WorkAiCostSummary
  /** Custo típico de gerar uma obra do zero (só catálogo). null = sem histórico. */
  baseline?: FromScratchBaseline | null
}) {
  const { totalCostUsd, nCalls, byOperation } = summary
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Custo de IA acumulado desta obra (dev)"
          className="inline-flex h-8 items-center gap-2 rounded-full bg-amber-500/10 px-3 text-sm font-medium ring-1 ring-inset ring-amber-500/30 transition-colors hover:bg-amber-500/20"
        >
          <Coins className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {formatUsd(totalCostUsd)}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            dev
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 max-w-[92vw] p-0">
        <div className="flex items-center justify-between gap-4 border-b border-border/50 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-bold text-foreground">Custo IA desta obra</span>
          </div>
          <div className="text-right">
            <div className="font-mono text-base font-bold tabular-nums text-foreground">
              {formatUsd(totalCostUsd)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {nCalls} {nCalls === 1 ? "chamada" : "chamadas"}
            </div>
          </div>
        </div>

        <div className="px-3.5 py-3">
          {byOperation.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma chamada de IA atribuída a esta obra ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {byOperation.map((op) => (
                <li key={op.operation} className="flex items-center justify-between gap-4 py-1.5">
                  <span className="min-w-0 truncate text-foreground/85">{op.label}</span>
                  <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                    <span className="text-muted-foreground">{op.nCalls}×</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatUsd(op.totalCostUsd)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-4 text-muted-foreground/80">
            Soma de todas as chamadas de IA atribuídas a esta obra (via
            {" "}
            <code className="font-mono">metadata.work_id</code>), inclusive tentativas com erro.
            Visível apenas em desenvolvimento.
          </p>
        </div>

        {baseline?.totalUsd != null && (
          <div className="border-t border-border/50 bg-muted/30 px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-semibold text-foreground/85">Criar do zero</span>
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                {formatUsdApprox(baseline.totalUsd)}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground/80">
              Custo típico (mediana das obras já geradas) das {baseline.byOperation.length}{" "}
              operações de catálogo que uma criação do zero roda uma vez cada:{" "}
              {/* Sem `toLowerCase()`: ele transformava "Avaliação IA" em "avaliação ia". */}
              {baseline.byOperation.map((op) => op.label).join(", ")}.{" "}
              <strong className="font-semibold">Exclui o que é por usuário</strong> — Interesse
              previsto e Veredito IA dependem do perfil de quem pergunta.
              {baseline.missingOperations.length > 0 && (
                <>
                  {" "}
                  Sem histórico ainda (fora da conta): {baseline.missingOperations.join(", ")}.
                </>
              )}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
