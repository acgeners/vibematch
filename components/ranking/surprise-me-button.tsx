"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ExternalLink, ImageOff, Shuffle } from "lucide-react"
import type { RankingEntry } from "@/server/queries/ranking"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { LABELS } from "@/lib/constants/ui-labels"
import { CoverImage } from "@/components/ui/cover-image"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { titleToSlug } from "@/lib/utils"

interface SurpriseMeButtonProps {
  entries: RankingEntry[]
  poolSize?: number
  /** Renderiza só o ícone (pro header enxuto do /ranking). */
  iconOnly?: boolean
}

// Hash determinístico FNV-1a 32-bit. Suficiente pra estabilidade dia-a-dia.
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Sorteia `count` obras distintas do pool, de forma determinística por dia
 * (seed = hoje:rerollOffset). Fisher-Yates seedado por um LCG simples — estável
 * ao longo do dia, re-sorteia ao incrementar o offset ("tentar outras").
 */
function pickEntries(entries: RankingEntry[], count: number, rerollOffset: number): RankingEntry[] {
  if (entries.length === 0) return []
  const today = new Date().toISOString().slice(0, 10)
  let state = hashString(`${today}:${rerollOffset}`)
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const idx = entries.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, Math.min(count, entries.length)).map((i) => entries[i])
}

const PICK_COUNT = 3

export function SurpriseMeButton({ entries, poolSize = 20, iconOnly = false }: SurpriseMeButtonProps) {
  const [open, setOpen] = useState(false)
  const [reroll, setReroll] = useState(0)

  const pool = useMemo(() => entries.slice(0, poolSize), [entries, poolSize])
  const picks = useMemo(() => pickEntries(pool, PICK_COUNT, reroll), [pool, reroll])

  if (pool.length === 0) return null

  const triggerTitle = "Escolhe por mim — sorteia leituras do topo do seu ranking (grátis, sem IA)."

  return (
    <>
      {iconOnly ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setOpen(true)}
                className="size-9"
                aria-label="Escolhe por mim"
              >
                <Shuffle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Escolhe por mim — sorteia obras do topo do ranking (sem IA)
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="h-9 gap-1.5"
          title={triggerTitle}
        >
          <Shuffle className="h-3.5 w-3.5" />
          Escolhe por mim
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-amber-500" />
              Suas leituras de hoje
            </DialogTitle>
            <DialogDescription>
              {picks.length} sugestões sorteadas do top {pool.length} do ranking atual. Estáveis ao longo do dia; clique &quot;tentar outras&quot; pra re-sortear.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2.5">
            {picks.map((entry) => (
              <SurprisePickCard key={entry.workId} entry={entry} onNavigate={() => setOpen(false)} />
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReroll((n) => n + 1)}>
              Tentar outras
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SurprisePickCard({ entry, onNavigate }: { entry: RankingEntry; onNavigate: () => void }) {
  const justification = entry.alignmentJustification ?? buildSyntheticJustification(entry)
  return (
    <Link
      href={`/titles/${titleToSlug(entry.title)}`}
      onClick={onNavigate}
      className="group flex gap-3 rounded-lg border bg-card/60 p-3 transition-colors hover:border-primary/40 hover:bg-card"
    >
      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded border bg-muted">
        {entry.coverUrl ? (
          <CoverImage
            url={entry.coverUrl}
            alt={entry.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="flex items-center gap-1 text-sm font-semibold leading-tight line-clamp-2">
          <span className="line-clamp-2 group-hover:underline">{entry.title}</span>
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </h3>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>#{entry.rank}</span>
          {entry.expectedScore != null && <span>{LABELS.expected_score.full} {entry.expectedScore.toFixed(1)}</span>}
          {entry.year != null && <span>{entry.year}</span>}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{justification}</p>
      </div>
    </Link>
  )
}

function buildSyntheticJustification(entry: RankingEntry): string {
  if (entry.differentiators.length > 0) {
    const parts = entry.differentiators.map((d) => {
      const info = CRITERIA_INFO[d.slug]
      return `${info?.emoji ?? ""} ${info?.name ?? d.slug} (+${d.diff.toFixed(1)})`.trim()
    })
    return `Destaque vs. vizinhos: ${parts.join(", ")}.`
  }
  const topScores = Object.entries(entry.scores)
    .filter(([, v]) => v != null && v >= 7)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 2)
  if (topScores.length === 0) {
    return "Obra bem-rankeada pelo seu perfil — sem destaque específico vs. vizinhos."
  }
  const parts = topScores.map(([slug, score]) => {
    const info = CRITERIA_INFO[slug]
    return `${info?.emoji ?? ""} ${info?.name ?? slug} ${(score as number).toFixed(1)}`.trim()
  })
  return `Pontos fortes: ${parts.join(", ")}.`
}
