"use client"

import { Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export interface DetailBlockData {
  label: string
  /** Explicação dos campos deste grupo — vira tooltip no ⓘ do título. */
  hint?: string
  entries: Array<[string, string]>
}

/**
 * Grade de blocos de detalhe usada nas linhas expandidas (tabela de operações e
 * log de chamadas). Cada bloco é um card DELIMITADO (borda + título separado) pra
 * amarrar visualmente cada valor ao seu grupo — em vez de números soltos.
 */
export function DetailGrid({ blocks }: { blocks: DetailBlockData[] }) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {blocks.map((b, i) => (
          <DetailBlock key={`${b.label}-${i}`} block={b} />
        ))}
      </div>
    </TooltipProvider>
  )
}

function DetailBlock({ block }: { block: DetailBlockData }) {
  const { label, hint, entries } = block
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 border-b border-border/40 pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
                aria-label={`O que é ${label}`}
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px] font-normal normal-case leading-relaxed tracking-normal">
              {hint}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="space-y-1">
        {entries.map(([k, v], i) => (
          <div
            key={`${k}-${i}`}
            className="flex items-baseline justify-between gap-3 text-[11.5px]"
          >
            <span className="min-w-0 truncate text-muted-foreground">{k}</span>
            <span className="shrink-0 font-mono tabular-nums text-foreground/90">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
