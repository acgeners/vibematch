"use client"

import { useMemo, useState } from "react"
import { BookOpen, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { TagDictionaryDialog } from "@/components/titles/tag-dictionary-dialog"
import type { TagOption } from "@/server/queries/tags"

interface TagFilterProps {
  selected: string[]
  onChange: (slugs: string[]) => void
  availableTags: TagOption[]
}

interface ParsedTag {
  input: string
  slug: string | null
  name: string | null
}

function slugifyInput(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function parseTagText(text: string, availableTags: TagOption[]): ParsedTag[] {
  const bySlug = new Map(availableTags.map((t) => [t.slug, t]))
  const byNameLc = new Map(availableTags.map((t) => [t.name.toLowerCase(), t]))

  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((input): ParsedTag => {
      const lc = input.toLowerCase()
      const bySlugMatch = bySlug.get(lc)
      if (bySlugMatch) return { input, slug: bySlugMatch.slug, name: bySlugMatch.name }
      const byNameMatch = byNameLc.get(lc)
      if (byNameMatch) return { input, slug: byNameMatch.slug, name: byNameMatch.name }
      const slugified = slugifyInput(input)
      const fallback = bySlug.get(slugified)
      if (fallback) return { input, slug: fallback.slug, name: fallback.name }
      return { input, slug: null, name: null }
    })
}

function slugsToText(slugs: string[], availableTags: TagOption[]): string {
  const bySlug = new Map(availableTags.map((t) => [t.slug, t]))
  return slugs.map((slug) => bySlug.get(slug)?.name ?? slug).join(", ")
}

export function TagFilter({ selected, onChange, availableTags }: TagFilterProps) {
  const [text, setText] = useState(() => slugsToText(selected, availableTags))
  const [dictOpen, setDictOpen] = useState(false)

  const parsed = useMemo(() => parseTagText(text, availableTags), [text, availableTags])

  const validSlugs = useMemo(() => {
    const slugs: string[] = []
    const seen = new Set<string>()
    for (const p of parsed) {
      if (p.slug && !seen.has(p.slug)) {
        seen.add(p.slug)
        slugs.push(p.slug)
      }
    }
    return slugs
  }, [parsed])

  const validSlugsKey = [...validSlugs].sort().join("|")
  const selectedKey = [...selected].sort().join("|")

  const [lastSelectedKey, setLastSelectedKey] = useState(selectedKey)
  if (selectedKey !== lastSelectedKey) {
    setLastSelectedKey(selectedKey)
    if (validSlugsKey !== selectedKey) {
      setText(slugsToText(selected, availableTags))
    }
  }

  const [lastEmittedKey, setLastEmittedKey] = useState(selectedKey)
  if (validSlugsKey !== lastEmittedKey && validSlugsKey !== selectedKey) {
    setLastEmittedKey(validSlugsKey)
    onChange(validSlugs)
  }

  const invalidCount = parsed.filter((p) => !p.slug).length

  const appendTag = (name: string) => {
    const trimmed = text.trimEnd()
    if (!trimmed) {
      setText(name)
      return
    }
    const needsSeparator = !trimmed.endsWith(",") && !trimmed.endsWith(";")
    setText(`${trimmed}${needsSeparator ? ", " : " "}${name}`)
  }

  const removeChipAt = (index: number) => {
    const newParts = parsed
      .filter((_, i) => i !== index)
      .map((p) => p.name ?? p.input)
    setText(newParts.join(", "))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Separe por vírgula, ponto e vírgula ou quebra de linha
        </span>
        <button
          type="button"
          onClick={() => setDictOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          <BookOpen className="h-3 w-3" />
          Ver dicionário de tags
        </button>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ex: Romance, Drama, Magia"
        rows={2}
        className="min-h-[56px] text-sm"
      />
      {parsed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {parsed.map((p, i) => (
            <Badge
              key={`${p.input}-${i}`}
              variant="secondary"
              className={cn(
                "gap-1 pr-1 text-xs",
                !p.slug && "border-destructive/40 bg-destructive/10 text-destructive"
              )}
              title={p.slug ? `Slug: ${p.slug}` : "Tag não encontrada no dicionário"}
            >
              {!p.slug && <span aria-hidden>⚠</span>}
              {p.name ?? p.input}
              <button
                type="button"
                onClick={() => removeChipAt(i)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/15"
                aria-label={`Remover ${p.name ?? p.input}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {invalidCount > 0 && (
        <p className="text-[11px] text-destructive/80">
          {invalidCount === 1
            ? "1 tag não existe no dicionário e será ignorada"
            : `${invalidCount} tags não existem no dicionário e serão ignoradas`}
        </p>
      )}
      <TagDictionaryDialog
        open={dictOpen}
        onOpenChange={setDictOpen}
        availableTags={availableTags}
        selectedSlugs={validSlugs}
        onSelect={(tag) => appendTag(tag.name)}
      />
    </div>
  )
}
