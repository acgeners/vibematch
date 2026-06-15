"use client"

import { useState, useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Heart, Loader2, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { setSynopsisQualityAction } from "@/server/actions/synopsis-quality"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"

/** Nível ordinal (1..4) de um valor ♥..♥♥♥♥; 0 se nulo/desconhecido. */
function levelOf(q: string | null): number {
  if (!q) return 0
  const i = (SYNOPSIS_QUALITIES as readonly string[]).indexOf(q)
  return i >= 0 ? i + 1 : 0
}

export interface SynopsisQualityPickerProps {
  workId: string
  /** Valor manual atual (works.synopsis_quality), ou null se não avaliado. */
  value: string | null
}

/**
 * Seletor rápido do Interesse Sinopse MANUAL (♥..♥♥♥♥) — 4 corações estilo
 * rating + limpar. É o caminho GRÁTIS de triagem: grava direto em
 * works.synopsis_quality via setSynopsisQualityAction (sem IA). Clicar no nível
 * atual limpa; o "x" também limpa. Usado nos cards da fila /ai-evaluation?tab=sinopse.
 */
export function SynopsisQualityPicker({ workId, value }: SynopsisQualityPickerProps) {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()
  const [hover, setHover] = useState(0)
  const current = levelOf(value)
  const shown = hover || current

  const save = (next: SynopsisQuality | null) => {
    startTransition(async () => {
      const res = await setSynopsisQualityAction(workId, next)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(next ? `Interesse: ${next} (${SYNOPSIS_QUALITY_LABELS[next]})` : "Interesse limpo.")
      refresh()
    })
  }

  return (
    <div className="flex items-center gap-1" aria-busy={pending}>
      <div className="flex items-center" onMouseLeave={() => setHover(0)}>
        {SYNOPSIS_QUALITIES.map((q, i) => {
          const level = i + 1
          const filled = shown >= level
          return (
            <button
              key={q}
              type="button"
              disabled={pending}
              title={`${q} — ${SYNOPSIS_QUALITY_LABELS[q]}`}
              aria-label={`Interesse ${q} (${SYNOPSIS_QUALITY_LABELS[q]})`}
              onMouseEnter={() => setHover(level)}
              onFocus={() => setHover(level)}
              onClick={() => save(current === level ? null : q)}
              className="p-0.5 disabled:opacity-50"
            >
              <Heart
                className={cn(
                  "h-4 w-4 transition-colors",
                  filled
                    ? "fill-rose-500 text-rose-500"
                    : "fill-transparent text-rose-300 dark:text-rose-400/40",
                )}
              />
            </button>
          )
        })}
      </div>
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : current > 0 ? (
        <button
          type="button"
          title="Limpar interesse"
          aria-label="Limpar interesse"
          onClick={() => save(null)}
          className="p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}
