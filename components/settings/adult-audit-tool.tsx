"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { ExternalLink, ShieldAlert, ShieldOff } from "lucide-react"
import { toast } from "sonner"
import { setAdultOverride } from "@/server/actions/works"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AdultAuditItem } from "@/server/queries/adult-audit"

export function AdultAuditTool({ initialQueue }: { initialQueue: AdultAuditItem[] }) {
  const [queue, setQueue] = useState(initialQueue)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const decide = (item: AdultAuditItem, value: boolean) => {
    setPendingId(item.id)
    startTransition(async () => {
      const res = await setAdultOverride(item.id, value)
      setPendingId(null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setQueue((q) => q.filter((w) => w.id !== item.id))
      toast.success(value ? `“${item.title}” marcada como 18+.` : `“${item.title}” marcada como não-18+.`)
    })
  }

  if (queue.length === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Nada pra revisar. 🎉 As obras de sinal fraco já foram decididas.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {queue.length} {queue.length === 1 ? "obra" : "obras"} que a 2ª opinião da IA não conseguiu
        confirmar (sem evidência de cena explícita, mas sem descartar). Decida — sua escolha vira o{" "}
        <span className="font-medium text-foreground">override</span> e vence tudo.
      </p>

      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {queue.map((item) => {
          const busy = pendingId === item.id
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/titles/${item.id}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
                >
                  <span className="truncate">{item.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {item.score != null && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">nota {item.score}</span>
                  )}
                  {item.tags.map((t) => (
                    <span key={t} className="rounded-full border border-border/60 px-2 py-0.5">
                      {t}
                    </span>
                  ))}
                  {item.tags.length === 0 && item.score == null && <span>sem tags/nota</span>}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => decide(item, true)}
                  className={cn("border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-300")}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  É 18+
                </Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => decide(item, false)}>
                  <ShieldOff className="h-3.5 w-3.5" />
                  Não é
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
