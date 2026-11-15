"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { resolveAgeRatingConflict } from "@/server/actions/age-rating"
import { Button } from "@/components/ui/button"
import { AGE_RATINGS, AGE_RATING_LABEL } from "@/lib/age-rating/age-rating"
import type { AgeRating } from "@/lib/age-rating/age-rating"
import type { AgeRatingConflict } from "@/server/queries/age-rating"

const VERSAO_LABEL = { obra: "obra", normal: "versão normal" } as const

/**
 * Fila "Conflitos de classificação" (/curation/settings). A decisão vai por `resolveAgeRatingConflict`;
 * o 18+ da obra (override, versões) continua sendo decidido na página da obra — o link abre nela.
 */
export function AgeRatingConflictsTool({ initialQueue }: { initialQueue: AgeRatingConflict[] }) {
  const [queue, setQueue] = useState(initialQueue)
  const [pending, setPending] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const decide = (item: AgeRatingConflict, faixa: AgeRating | null) => {
    const key = `${item.workId}:${item.versao}`
    setPending(key)
    startTransition(async () => {
      const res = await resolveAgeRatingConflict(item.workId, item.versao, faixa)
      setPending(null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setQueue((q) => q.filter((c) => !(c.workId === item.workId && c.versao === item.versao)))
      toast.success(`“${item.title}”: ${faixa == null ? "sem classificação" : `classificação ${AGE_RATING_LABEL[faixa].toLowerCase()}`}.`)
    })
  }

  if (queue.length === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Nenhum conflito de classificação aberto.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {queue.length} {queue.length === 1 ? "conflito" : "conflitos"}. Defina a faixa ou deixe sem classificação; faixa 18
        liga o 18+ da obra. Para mudar o 18+ ou registrar duas versões, abra a obra.
      </p>
      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {queue.map((item) => {
          const key = `${item.workId}:${item.versao}`
          const busy = pending === key
          return (
            <li key={key} className="space-y-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/catalog/${item.workId}`}
                  target="_blank"
                  className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
                >
                  <span className="truncate">{item.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Link>
                <span className="text-xs text-muted-foreground">
                  {VERSAO_LABEL[item.versao]}
                  {item.isAdult ? " · 18+ hoje" : " · fora do 18+ hoje"}
                  {item.adultOverride != null ? ` · decisão manual: ${item.adultOverride ? "é 18+" : "não é 18+"}` : ""}
                  {item.editionState ? ` · edição ${item.editionState}` : ""}
                  {item.faixa != null ? ` · provisória: ${AGE_RATING_LABEL[item.faixa]}` : ""}
                </span>
              </div>
              <p className="text-xs text-foreground/90">{item.conflito}</p>
              {item.rotulos.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {item.rotulos.map((r, i) => (
                    <span key={i} className="rounded-full border border-border/60 px-2 py-0.5">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {r.fonte}: {r.rotulo}
                        </a>
                      ) : (
                        `${r.fonte}: ${r.rotulo}`
                      )}
                    </span>
                  ))}
                </div>
              )}
              {item.sinais.length > 0 && <p className="text-xs text-muted-foreground">Sinais: {item.sinais.join(" · ")}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {AGE_RATINGS.map((f) => (
                  <Button key={f} size="xs" variant="outline" disabled={busy} onClick={() => decide(item, f)}>
                    {AGE_RATING_LABEL[f]}
                  </Button>
                ))}
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => decide(item, null)}>
                  Sem classificação
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
