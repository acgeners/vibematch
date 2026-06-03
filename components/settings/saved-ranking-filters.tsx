"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Bookmark, Check, Pencil, Trash2, X, ArrowUpRight } from "lucide-react"
import { renameFilterPreset, deleteFilterPreset } from "@/server/actions/filter-presets"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface SavedPreset {
  id: string
  name: string
  query: string
}

const BASE_PATH = "/ranking"

export function SavedRankingFilters({ presets: initial }: { presets: SavedPreset[] }) {
  const [presets, setPresets] = useState<SavedPreset[]>(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [pending, startTransition] = useTransition()

  const startRename = (preset: SavedPreset) => {
    setEditingId(preset.id)
    setEditingName(preset.name)
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingName("")
  }

  const commitRename = (preset: SavedPreset) => {
    const trimmed = editingName.trim()
    if (!trimmed || trimmed === preset.name) {
      cancelRename()
      return
    }
    startTransition(async () => {
      const res = await renameFilterPreset({ id: preset.id, basePath: BASE_PATH, name: trimmed })
      if (res.error !== null) {
        toast.error(res.error)
        return
      }
      setPresets((prev) =>
        prev.map((p) => (p.id === preset.id ? { ...p, name: res.preset.name } : p)),
      )
      cancelRename()
      toast.success(`Renomeado para "${res.preset.name}"`)
    })
  }

  const remove = (preset: SavedPreset) => {
    startTransition(async () => {
      const res = await deleteFilterPreset({ id: preset.id, basePath: BASE_PATH })
      if (res.error) {
        toast.error(res.error)
        return
      }
      setPresets((prev) => prev.filter((p) => p.id !== preset.id))
      toast.success(`Filtro "${preset.name}" removido`)
    })
  }

  return (
    <div className="rounded-lg border border-border/65 bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Filtros salvos</p>
        {presets.length > 0 && (
          <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {presets.length}
          </span>
        )}
      </div>

      {presets.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Nenhum filtro salvo ainda. Monte filtros no{" "}
          <Link href={BASE_PATH} className="font-medium text-primary hover:underline">
            Ranking
          </Link>{" "}
          e salve com um nome pra reusar aqui.
        </p>
      ) : (
        <div className="space-y-0.5">
          {presets.map((preset) =>
            editingId === preset.id ? (
              <div key={preset.id} className="flex items-center gap-1 rounded-md p-1">
                <Input
                  autoFocus
                  className="h-7 text-sm"
                  value={editingName}
                  maxLength={60}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      commitRename(preset)
                    } else if (e.key === "Escape") {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => commitRename(preset)}
                  disabled={pending || !editingName.trim()}
                  aria-label="Confirmar novo nome"
                  title="Confirmar"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-30"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={cancelRename}
                  aria-label="Cancelar"
                  title="Cancelar"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div
                key={preset.id}
                className="group flex items-center gap-1 rounded-md transition-colors hover:bg-muted/60"
              >
                <Link
                  href={`${BASE_PATH}?${preset.query}`}
                  title="Aplicar este conjunto de filtros no Ranking"
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                </Link>
                <button
                  type="button"
                  onClick={() => startRename(preset)}
                  disabled={pending}
                  aria-label={`Renomear ${preset.name}`}
                  title={`Renomear ${preset.name}`}
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors",
                    "hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30",
                  )}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(preset)}
                  disabled={pending}
                  aria-label={`Remover ${preset.name}`}
                  title={`Remover ${preset.name}`}
                  className={cn(
                    "mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors",
                    "hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30",
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
