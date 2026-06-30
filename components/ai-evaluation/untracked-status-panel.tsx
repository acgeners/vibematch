"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { CoverThumb } from "@/components/ai-evaluation/cover-thumb"
import { setReadingStatusForWorks } from "@/server/actions/works"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { PERSONAL_STATUSES } from "@/types/domain"
import { cn } from "@/lib/utils"
import type { UntrackedWork } from "@/server/queries/recommendations"

// Opções de destino: todos os status menos "Untracked" (mover-se pra Untracked é no-op).
const STATUS_OPTIONS = (PERSONAL_STATUSES as readonly string[]).filter((s) => s !== "Untracked")
const STATUS_INFO = (s: string) => Object.values(PERSONAL_STATUSES_BY_ID).find((i) => i.status === s)

export function UntrackedStatusPanel({ works }: { works: UntrackedWork[] }) {
  const refresh = useRefresh()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<string>("")
  const [applying, setApplying] = useState(false)

  const allSelected = works.length > 0 && selected.size === works.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const selectAll = () => setSelected(new Set(works.map((w) => w.id)))
  const deselectAll = () => setSelected(new Set())

  const apply = async () => {
    if (selected.size === 0 || !status || applying) return
    setApplying(true)
    const res = await setReadingStatusForWorks([...selected], status)
    setApplying(false)
    if ("error" in res && res.error) {
      toast.error(typeof res.error === "string" ? res.error : "Falha ao aplicar status.")
      return
    }
    toast.success(`Status "${status}" aplicado a ${selected.size} obra(s).`)
    setSelected(new Set())
    refresh()
  }

  if (works.length === 0) {
    return (
      <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
        Nenhuma obra Untracked com os filtros atuais.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Barra de ação em lote */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/80 p-2 backdrop-blur">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(v) => (v ? selectAll() : deselectAll())}
          aria-label="Selecionar tudo"
        />
        <span className="text-sm text-muted-foreground">
          {selected.size > 0 ? `${selected.size} selecionada(s)` : "Selecionar tudo"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-48">
              <SelectValue placeholder="Status de leitura…" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => {
                const info = STATUS_INFO(s)
                return (
                  <SelectItem key={s} value={s}>
                    <span aria-hidden className="mr-1">{info?.symbol}</span>
                    {s}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={apply} disabled={applying || selected.size === 0 || !status}>
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Aplicar a {selected.size}
          </Button>
        </div>
      </div>

      {/* Cards (multi-seleção: clicar no card alterna). Sem ações por card (a ação é
          em lote, no topo), então adensamos as colunas em telas largas pra não
          sobrar metade do card vazia. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {works.map((w) => (
          <Card
            key={w.id}
            className={cn(
              "cursor-pointer transition-all hover:border-primary/30 hover:bg-card hover:shadow-md hover:shadow-primary/10",
              selected.has(w.id) && "border-primary/60 bg-primary/5",
            )}
            onClick={() => toggle(w.id)}
          >
            <CardContent className="py-2.5">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selected.has(w.id)}
                  onCheckedChange={() => toggle(w.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                />
                <CoverThumb urls={w.coverUrls} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span onClick={(e) => e.stopPropagation()} className="min-w-0">
                      <WorkTitleLink
                        title={w.title}
                        workId={w.id}
                        className="line-clamp-2 break-words text-sm font-semibold hover:underline"
                      />
                    </span>
                    {w.expectedScore != null && (
                      <span title="Nota prevista" className="inline-flex shrink-0">
                        <ScoreBadge score={w.expectedScore} size="sm" />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PublicationStatusBadge statusId={w.publicationStatusId} />
                    <PersonalStatusBadge statusId={w.personalStatusId} />
                    {w.synopsisQuality && (
                      <span
                        title="Interesse na sinopse"
                        className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300"
                      >
                        {w.synopsisQuality}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
