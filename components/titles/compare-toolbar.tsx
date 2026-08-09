"use client"

import type { ReactNode } from "react"
import { ChevronDown, Compass, Loader2, MoreHorizontal, Rows3, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type CompareView = "table" | "bussola"

/**
 * Topo do drawer de comparação.
 *
 * DUAS FILAS DE PRIORIDADE, decididas em 2026-08-08 (antes eram oito controles em fila única,
 * disputando o header com os chips de "Onde diferenciam"):
 *
 *   à vista → Tabela/Bússola · Linhas · Desempatar com IA · Limpar · Fechar
 *   no `⋯`  → Só diferenças · Melhor/pior · Salvar o desempate
 *
 * O critério é AÇÃO vs. PREFERÊNCIA DE LEITURA: o que se decide uma vez e fica (esconder linhas
 * iguais, pintar melhor/pior, salvar a run) não precisa de vaga permanente — e dentro do menu
 * ainda ganha a frase que explica o que faz, que o rótulo sozinho nunca deu. O divisor separa o
 * grupo de exibição do grupo de ação.
 *
 * ⚠️ O menu lista SÓ o que se aplica ao estado atual: na Bússola não há linhas nem melhor/pior,
 * e sem plano pago não há desempate a salvar. Ficando vazio, o gatilho some — oferecer menu que
 * abre sem opção nenhuma é pior do que não ter menu.
 */
export interface CompareToolbarProps {
  /** O `SheetTitle` montado pelo pai (o Radix precisa dele dentro do header). */
  title: ReactNode
  /** Quantos critérios separam as obras. 0 esconde o disclosure. */
  differentialsCount: number
  differentialsOpen: boolean
  onToggleDifferentials: () => void
  view: CompareView
  onViewChange: (view: CompareView) => void
  /** Bússola exige ≥2 obras; abaixo disso o segmentado nem aparece. */
  canSwitchView: boolean
  /** A Bússola está de fato na tela (esconde tudo que é da tabela). */
  showBussola: boolean
  /** O `ColumnPicker` das linhas, montado pelo pai. */
  rowsPicker: ReactNode
  diffOnly: boolean
  onDiffOnlyChange: (next: boolean) => void
  bestWorst: boolean
  onBestWorstChange: (next: boolean) => void
  persistRun: boolean
  onPersistRunChange: (next: boolean) => void
  isPaid: boolean
  reranking: boolean
  /** Desempate exige ≥2 obras. */
  canRerank: boolean
  onRerank: () => void
  onClear: () => void
  onClose: () => void
}

export function CompareToolbar({
  title,
  differentialsCount,
  differentialsOpen,
  onToggleDifferentials,
  view,
  onViewChange,
  canSwitchView,
  showBussola,
  rowsPicker,
  diffOnly,
  onDiffOnlyChange,
  bestWorst,
  onBestWorstChange,
  persistRun,
  onPersistRunChange,
  isPaid,
  reranking,
  canRerank,
  onRerank,
  onClear,
  onClose,
}: CompareToolbarProps) {
  const showRowOptions = canRerank && !showBussola
  const showPersistOption = canRerank && isPaid
  const hasMenu = showRowOptions || showPersistOption
  const showDifferentials = differentialsCount > 0 && !showBussola

  return (
    <div className="flex flex-row items-center justify-between gap-2 border-b bg-card/80 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {title}
        {showDifferentials && (
          <button
            type="button"
            onClick={onToggleDifferentials}
            aria-expanded={differentialsOpen}
            aria-controls="compare-differentials"
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-amber-400/20 hover:text-foreground"
          >
            Onde diferenciam
            <span className="rounded-full bg-amber-400/25 px-1.5 font-mono text-[10px] font-bold tracking-normal text-amber-700 dark:text-amber-300">
              {differentialsCount}
            </span>
            <ChevronDown
              className={cn("size-3 transition-transform", differentialsOpen && "rotate-180")}
              aria-hidden
            />
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {canSwitchView && (
          <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => onViewChange("table")}
              aria-pressed={view === "table"}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                view === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Rows3 className="h-3.5 w-3.5" />
              Tabela
            </button>
            <button
              type="button"
              onClick={() => onViewChange("bussola")}
              aria-pressed={view === "bussola"}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                view === "bussola"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Compass className="h-3.5 w-3.5" />
              Bússola
            </button>
          </div>
        )}

        {!showBussola && rowsPicker}

        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                aria-label="Mais opções de exibição"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {showRowOptions && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={diffOnly}
                    onCheckedChange={(v) => onDiffOnlyChange(Boolean(v))}
                    // O item tem duas linhas; sem isto a marca de check fica na altura da
                    // descrição, e não do nome da opção.
                    className="items-start [&>span:first-child]:top-2"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span>Só diferenças</span>
                      <span className="text-xs text-muted-foreground">
                        Esconde as linhas em que as obras empatam.
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={bestWorst}
                    onCheckedChange={(v) => onBestWorstChange(Boolean(v))}
                    className="items-start [&>span:first-child]:top-2"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span>Melhor/pior</span>
                      <span className="text-xs text-muted-foreground">
                        Pinta o maior e o menor valor de cada linha.
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                </>
              )}
              {showPersistOption && (
                <>
                  {showRowOptions && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Desempate com IA
                  </DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={persistRun}
                    onCheckedChange={(v) => onPersistRunChange(Boolean(v))}
                    disabled={reranking}
                    className="items-start [&>span:first-child]:top-2"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span>Salvar o desempate</span>
                      <span className="text-xs text-muted-foreground">
                        Vira uma recomendação navegável (histórico + URL). Não custa nada a mais.
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

        {canRerank && (
          <Button
            variant="default"
            size="sm"
            onClick={onRerank}
            disabled={reranking || !isPaid}
            className="h-7 gap-1 text-xs"
            title={
              isPaid
                ? "Roda o IA re-rank comparando estas obras entre si e desempata por veredito (Veredito IA + justificativa). Conta uma execução do limite diário."
                : "Desempate por IA é uma feature do plano Pago."
            }
          >
            {reranking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {reranking ? "Desempatando…" : isPaid ? "Desempatar com IA" : "Desempatar com IA · Pago"}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
          Limpar
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7" aria-label="Fechar">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
