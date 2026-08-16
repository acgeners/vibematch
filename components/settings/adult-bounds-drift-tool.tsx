"use client"

import { useState, useTransition } from "react"
import { titleToSlug } from "@/lib/utils"
import Link from "next/link"
import { ExternalLink, Wrench } from "lucide-react"
import { toast } from "sonner"
import { applyAdultContentBoundsClamp } from "@/server/actions/works"
import { Button } from "@/components/ui/button"
import type { AdultBoundsDriftItem } from "@/server/queries/adult-audit"

export function AdultBoundsDriftTool({ initialQueue }: { initialQueue: AdultBoundsDriftItem[] }) {
  const [queue, setQueue] = useState(initialQueue)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const apply = (item: AdultBoundsDriftItem) => {
    setPendingId(item.id)
    startTransition(async () => {
      const res = await applyAdultContentBoundsClamp(item.id)
      setPendingId(null)
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao aplicar.")
        return
      }
      setQueue((q) => q.filter((w) => w.id !== item.id))
      const target = item.floor != null ? item.floor : item.ceiling
      toast.success(`"${item.title}": ${item.currentScore} → ${target?.toFixed(1)}.`)
    })
  }

  if (queue.length === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Nada pra corrigir. 🎉 Toda nota adult_content persistida respeita o piso/teto das tags atuais.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {queue.length} {queue.length === 1 ? "obra tem" : "obras têm"} nota <span className="font-mono">adult_content</span>{" "}
        fora do piso/teto que as tags de HOJE implicam — geralmente porque uma tag mudou (revisão nova, ou
        <span className="font-mono"> adult_score_tier</span> decidido depois da última avaliação IA) e a nota nunca foi
        reaplicada. Corrigir aqui é determinístico ($0 de IA) — ajusta a nota pro piso/teto atual.
      </p>

      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {queue.map((item) => {
          const busy = pendingId === item.id
          const target = item.floor != null ? item.floor : item.ceiling
          const kind = item.floor != null ? "piso" : "teto"
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/catalog/${titleToSlug(item.title)}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
                >
                  <span className="truncate">{item.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  nota atual <span className="font-mono text-foreground">{item.currentScore}</span> — {kind} atual{" "}
                  <span className="font-mono text-foreground">{target?.toFixed(1)}</span>
                  <span className="block truncate">{item.reasons}</span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button size="xs" variant="outline" disabled={busy} onClick={() => apply(item)}>
                  <Wrench className="h-3.5 w-3.5" />
                  Aplicar {kind}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
