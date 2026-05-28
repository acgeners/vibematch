"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ExternalLink, ImageOff, Sparkles } from "lucide-react"
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
import { getCoverImageSrc } from "@/lib/image-proxy"
import { titleToSlug } from "@/lib/utils"

interface SurpriseMeButtonProps {
  entries: RankingEntry[]
  poolSize?: number
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

function pickEntry(entries: RankingEntry[], rerollOffset: number): RankingEntry | null {
  if (entries.length === 0) return null
  const today = new Date().toISOString().slice(0, 10)
  const seed = hashString(`${today}:${rerollOffset}`)
  return entries[seed % entries.length]
}

export function SurpriseMeButton({ entries, poolSize = 20 }: SurpriseMeButtonProps) {
  const [open, setOpen] = useState(false)
  const [reroll, setReroll] = useState(0)

  const pool = useMemo(() => entries.slice(0, poolSize), [entries, poolSize])
  const pick = useMemo(() => pickEntry(pool, reroll), [pool, reroll])

  if (pool.length === 0) return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        Surpreenda-me
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Sua leitura de hoje
            </DialogTitle>
            <DialogDescription>
              Sorteada do top {pool.length} do ranking atual. Estável ao longo do dia; clique &quot;tentar outra&quot; pra re-sortear.
            </DialogDescription>
          </DialogHeader>

          {pick ? <SurprisePickCard entry={pick} /> : null}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" size="sm" onClick={() => setReroll((n) => n + 1)}>
              Tentar outra
            </Button>
            {pick ? (
              <Button asChild size="sm">
                <Link href={`/titles/${titleToSlug(pick.title)}`} onClick={() => setOpen(false)}>
                  Abrir <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SurprisePickCard({ entry }: { entry: RankingEntry }) {
  const justification = entry.alignmentJustification ?? buildSyntheticJustification(entry)
  return (
    <div className="flex gap-3 rounded-lg border bg-card/60 p-3">
      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded border bg-muted">
        {entry.coverUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={getCoverImageSrc(entry.coverUrl)}
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
        <h3 className="text-sm font-semibold leading-tight line-clamp-2">{entry.title}</h3>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>#{entry.rank}</span>
          {entry.finalScore != null && <span>Nota.Final {entry.finalScore.toFixed(1)}</span>}
          {entry.year != null && <span>{entry.year}</span>}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{justification}</p>
      </div>
    </div>
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
