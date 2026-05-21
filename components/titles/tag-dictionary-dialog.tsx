"use client"

import { useMemo, useState } from "react"
import { Check, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { TagOption } from "@/server/queries/tags"

interface TagDictionaryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableTags: TagOption[]
  selectedSlugs: string[]
  onSelect: (tag: TagOption) => void
}

export function TagDictionaryDialog({
  open,
  onOpenChange,
  availableTags,
  selectedSlugs,
  onSelect,
}: TagDictionaryDialogProps) {
  const [query, setQuery] = useState("")
  const selectedSet = useMemo(() => new Set(selectedSlugs), [selectedSlugs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return availableTags
    return availableTags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.groupName.toLowerCase().includes(q)
    )
  }, [availableTags, query])

  const grouped = useMemo(() => {
    const groups = new Map<string, TagOption[]>()
    for (const tag of filtered) {
      const list = groups.get(tag.groupName) ?? []
      list.push(tag)
      groups.set(tag.groupName, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dicionário de tags</DialogTitle>
          <DialogDescription>
            {availableTags.length} tags disponíveis. Clique para adicionar ao filtro.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, slug ou grupo..."
            className="h-9 pl-8 text-sm"
            autoFocus
          />
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {grouped.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma tag encontrada para &quot;{query}&quot;
            </p>
          )}
          {grouped.map(([groupName, tags]) => (
            <div key={groupName} className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {groupName}{" "}
                <span className="text-muted-foreground/60">({tags.length})</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => {
                  const isSelected = selectedSet.has(tag.slug)
                  return (
                    <button
                      key={tag.slug}
                      type="button"
                      onClick={() => {
                        if (!isSelected) onSelect(tag)
                      }}
                      disabled={isSelected}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                        isSelected
                          ? "cursor-default border-primary/40 bg-primary/15 text-primary"
                          : "border-border/70 bg-background/60 text-foreground/80 hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                      )}
                      title={isSelected ? "Já selecionada" : `Adicionar ${tag.name}`}
                    >
                      {tag.name}
                      {isSelected && <Check className="h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
