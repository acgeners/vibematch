"use client"

import { useState, useCallback, useTransition, useRef } from "react"
import { X, Tag, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover"
import { searchTags } from "@/server/actions/external"
import type { TagSuggestion } from "@/lib/external/types"

interface TagFilterProps {
  selected: TagSuggestion[]
  onAdd: (tag: TagSuggestion) => void
  onRemove: (slug: string) => void
}

export function TagFilter({ selected, onAdd, onRemove }: TagFilterProps) {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleInput = useCallback((value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setSuggestions([])
      setOpen(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const results = await searchTags(value)
        const selectedSlugs = new Set(selected.map(t => t.slug))
        setSuggestions(results.filter(r => !selectedSlugs.has(r.slug)))
        setOpen(results.length > 0)
        setSearching(false)
      })
    }, 250)
  }, [selected])

  const handleSelect = (tag: TagSuggestion) => {
    onAdd(tag)
    setQuery("")
    setSuggestions([])
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Tag className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar tag..."
              className="h-8 text-sm pl-7 pr-7"
              value={query}
              onChange={e => handleInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setOpen(true)}
            />
            {searching && (
              <Loader2 className="absolute right-2.5 top-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="p-0 w-64 max-h-52 overflow-y-auto"
          align="start"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          {suggestions.map(tag => (
            <button
              key={tag.slug}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
              onMouseDown={e => {
                e.preventDefault()
                handleSelect(tag)
              }}
            >
              {tag.name}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(tag => (
            <Badge key={tag.slug} variant="secondary" className="text-xs gap-1 pr-1">
              {tag.name}
              <button
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                onClick={() => onRemove(tag.slug)}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
