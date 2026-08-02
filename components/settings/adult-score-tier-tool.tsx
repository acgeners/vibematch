"use client"

import { useState, useTransition } from "react"
import { ShieldAlert, ShieldQuestion, ShieldOff } from "lucide-react"
import { toast } from "sonner"
import { setTagScoreTier, type AdultScoreTier, type AdultScoreTierBacklogRow } from "@/server/actions/tag-review"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { EDITION_NOTE_TAG_NAMES } from "@/lib/tags/edition-note-tags"

export function AdultScoreTierTool({ initialQueue }: { initialQueue: AdultScoreTierBacklogRow[] }) {
  const [queue, setQueue] = useState(initialQueue)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const decide = (item: AdultScoreTierBacklogRow, tier: AdultScoreTier) => {
    setPendingId(item.id)
    startTransition(async () => {
      const res = await setTagScoreTier(item.id, tier)
      setPendingId(null)
      if (!res.ok) {
        toast.error("Falha ao salvar.")
        return
      }
      setQueue((q) => q.filter((t) => t.id !== item.id))
      const label = tier === "explicit" ? "piso 9 (explícito)" : tier === "label" ? "piso 7 (rótulo)" : "sem piso"
      toast.success(`"${item.name}" → ${label}.`)
    })
  }

  if (queue.length === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Nada pra revisar. 🎉 Todas as tags 18+ já têm decisão de piso.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {queue.length} {queue.length === 1 ? "tag conta" : "tags contam"} para o flag 18+ (
        <span className="font-medium text-foreground">is_adult</span>) mas nunca foram avaliadas se também
        garantem um piso na NOTA <span className="font-mono">adult_content</span> — eixo independente
        (ver CLAUDE.md). Ordenado por nº de obras afetadas.
      </p>

      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {queue.map((item) => {
          const busy = pendingId === item.id
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                    {item.workCount} {item.workCount === 1 ? "obra" : "obras"}
                  </span>
                  {item.adultLevel === "explicit" && (
                    <span className="rounded-full px-2 py-0.5 text-xs text-red-700 ring-1 ring-inset ring-red-500/40 dark:text-red-300">
                      is_adult: strong
                    </span>
                  )}
                </div>
                {item.sampleTitles.length > 0 && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    ex.: {item.sampleTitles.join(", ")}
                  </p>
                )}
                {EDITION_NOTE_TAG_NAMES.has(item.name) && (
                  <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">
                    📎 Metadado de EDIÇÃO (&ldquo;existe uma versão R19 em outra fonte&rdquo;), não afirma que
                    a obra catalogada é explícita — o piso correto costuma ser &ldquo;Sem piso&rdquo;.
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => decide(item, "explicit")}
                  className="text-red-700 ring-1 ring-inset ring-red-500/40 hover:bg-red-500/10 dark:text-red-300"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Explícito (piso 9)
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => decide(item, "label")}
                  className={cn("text-amber-700 ring-1 ring-inset ring-amber-500/40 hover:bg-amber-500/10 dark:text-amber-300")}
                >
                  <ShieldQuestion className="h-3.5 w-3.5" />
                  Rótulo (piso 7)
                </Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => decide(item, "none")}>
                  <ShieldOff className="h-3.5 w-3.5" />
                  Sem piso
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
