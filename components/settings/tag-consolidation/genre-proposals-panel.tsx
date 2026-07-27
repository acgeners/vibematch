"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ACCENT_BUTTON } from "@/lib/settings-accent"
import { useRefresh } from "@/lib/use-refresh"
import { approveGenreProposal, rejectGenreProposal, type GenreProposalRow } from "@/server/actions/tag-review"

const AFFIRM_BTN = ACCENT_BUTTON.slate

export function GenreProposalsPanel({ proposals }: { proposals: GenreProposalRow[] }) {
  const doRefresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const visible = proposals.filter((p) => !removed.has(p.id))

  const run = (id: string, action: "approve" | "reject") => {
    setRemoved((p) => new Set(p).add(id))
    startTransition(async () => {
      const res = action === "approve" ? await approveGenreProposal(id) : await rejectGenreProposal(id)
      if (!res.ok) {
        setRemoved((p) => {
          const n = new Set(p)
          n.delete(id)
          return n
        })
        toast.error((res as { error?: string }).error || "Falha na ação")
      } else {
        toast.success(action === "approve" ? "Promovido a gênero" : "Mantido como tag")
        doRefresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Strings que chegaram no <strong className="text-foreground">campo de gênero</strong> das fontes e
        ainda não são um gênero do catálogo. Já estão salvas <strong className="text-foreground">como tag</strong> nas
        obras (nada se perdeu). Aprovar cria o gênero e popula <span className="font-mono text-xs">work_genres</span>;
        manter deixa como tag comum.
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border/65 bg-background/40 p-8 text-center text-sm text-muted-foreground">
          Nenhum gênero proposto no momento.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((p) => (
            <div
              key={p.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[15px] font-semibold">{p.rawName}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.slug}</span>
                  <span className="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                    hoje: tag
                  </span>
                  {p.isAdultTag && (
                    <span className="rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      também é indicador 18+
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="tabular-nums font-medium text-foreground">{p.occurrences}</span> ocorrência
                  {p.occurrences === 1 ? "" : "s"}
                  {p.sampleTitles.length > 0 && <> · ex.: {p.sampleTitles.join(" · ")}</>}
                </div>
                {p.isAdultTag && (
                  <div className="text-xs text-muted-foreground">
                    Aprovar <strong className="text-foreground">não altera</strong> o sinal 18+ (vem da tag, que é
                    mantida) — só adiciona a faceta de gênero.
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className={`h-8 ${AFFIRM_BTN}`}
                  disabled={isPending}
                  onClick={() => run(p.id, "approve")}
                >
                  <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> Aprovar como gênero
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  disabled={isPending}
                  onClick={() => run(p.id, "reject")}
                >
                  Manter como tag
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
