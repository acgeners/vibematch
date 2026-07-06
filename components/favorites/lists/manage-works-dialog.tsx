"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Heart, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"
import { addWorksToList, removeWorksFromList } from "@/server/actions/lists"
import type { WorkLiteForPicker } from "@/server/queries/lists"

interface ManageWorksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  listId: string
  listName: string
  memberIds: string[]
  catalog: WorkLiteForPicker[]
}

export function ManageWorksDialog({
  open,
  onOpenChange,
  listId,
  listName,
  memberIds,
  catalog,
}: ManageWorksDialogProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")

  // Reidrata a seleção na transição fechado→aberto (sem effect).
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setSelected(new Set(memberIds))
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((w) => w.title.toLowerCase().includes(q))
  }, [catalog, search])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave() {
    const memberSet = new Set(memberIds)
    const toAdd = [...selected].filter((id) => !memberSet.has(id))
    const toRemove = memberIds.filter((id) => !selected.has(id))
    if (toAdd.length === 0 && toRemove.length === 0) {
      onOpenChange(false)
      return
    }
    startTransition(async () => {
      if (toAdd.length > 0) {
        const res = await addWorksToList(listId, toAdd)
        if ("error" in res) {
          toast.error(res.error)
          return
        }
      }
      if (toRemove.length > 0) {
        const res = await removeWorksFromList(listId, toRemove)
        if ("error" in res) {
          toast.error(res.error)
          return
        }
      }
      const parts: string[] = []
      if (toAdd.length) parts.push(`${toAdd.length} adicionada${toAdd.length !== 1 ? "s" : ""}`)
      if (toRemove.length) parts.push(`${toRemove.length} removida${toRemove.length !== 1 ? "s" : ""}`)
      toast.success(`${listName}: ${parts.join(" · ")}.`)
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Obras de “{listName}”</DialogTitle>
          <DialogDescription>
            Marque as obras do grupo. Adicionar uma obra também a marca como favorita.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Buscar por título…"
            className="pl-9"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma obra encontrada.</p>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((w) => {
                const checked = selected.has(w.id)
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => toggle(w.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60",
                        checked && "bg-accent/40",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input",
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      <CoverImage
                        url={w.coverUrl}
                        alt={w.title}
                        className="h-11 w-8 shrink-0 rounded object-cover"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{w.title}</span>
                      {!w.isFavorite && (
                        <span
                          title="Não é favorita ainda — será marcada ao adicionar"
                          className="text-muted-foreground/60"
                        >
                          <Heart className="size-3.5" />
                        </span>
                      )}
                      {w.expectedScore != null && (
                        <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {w.expectedScore.toFixed(1)}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="self-center text-xs text-muted-foreground">
            {selected.size} selecionada{selected.size !== 1 ? "s" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
