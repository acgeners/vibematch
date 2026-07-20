"use client"

import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface SuggestionGroup {
  groupSlug: string
  label: string
  values: string[]
}

interface ChipInputProps {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Chips exibidos agrupados (por label) */
  groups?: Array<{ label: string; values: string[] }>
  /** Sugestões planas para autocomplete */
  suggestions?: string[]
  /** Sugestões agrupadas para autocomplete */
  suggestionGroups?: SuggestionGroup[]
  /** Se true, só aceita valores vindos das sugestões (sem free-text) */
  restrictToSuggestions?: boolean
  /** Se false, valida contra sugestões sem abrir lista visual. */
  showSuggestionMenu?: boolean
}

export function ChipInput({
  value,
  onChange,
  placeholder = "Adicionar...",
  className,
  disabled,
  groups,
  suggestions,
  suggestionGroups,
  restrictToSuggestions = false,
  showSuggestionMenu = true,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const hasSuggestions = (suggestions?.length ?? 0) > 0 || (suggestionGroups?.length ?? 0) > 0
  const groupedValues = groups?.filter((g) => g.values.length > 0) ?? []
  const allSuggestions = [
    ...(suggestions ?? []),
    ...(suggestionGroups ?? []).flatMap((group) => group.values),
  ]

  // Chips que não aparecem em nenhum grupo (free-text ou catálogo não sincronizado)
  const allGroupedChips = new Set(groupedValues.flatMap((g) => g.values))
  const ungroupedChips = groupedValues.length > 0
    ? value.filter((v) => !allGroupedChips.has(v))
    : []

  // Flatten all filtered suggestions for keyboard nav
  const flatFiltered: Array<{ name: string; groupLabel?: string }> = (() => {
    const q = inputValue.trim().toLowerCase()
    if (!q || !hasSuggestions) return []
    const result: Array<{ name: string; groupLabel?: string }> = []

    if (suggestions) {
      for (const s of suggestions) {
        if (value.includes(s)) continue
        if (s.toLowerCase().includes(q)) result.push({ name: s })
      }
    }
    if (suggestionGroups) {
      for (const grp of suggestionGroups) {
        for (const s of grp.values) {
          if (value.includes(s)) continue
          if (s.toLowerCase().includes(q)) result.push({ name: s, groupLabel: grp.label })
        }
      }
    }
    return result
  })()

  // Grouped dropdown items
  const dropdownGroups: Array<{ label?: string; items: string[] }> = (() => {
    const q = inputValue.trim().toLowerCase()
    if (!q || !hasSuggestions) return []

    if (suggestions) {
      const items = suggestions.filter((s) => !value.includes(s) && s.toLowerCase().includes(q))
      return items.length > 0 ? [{ items }] : []
    }
    if (suggestionGroups) {
      return suggestionGroups
        .map((grp) => ({
          label: grp.label,
          items: grp.values.filter((s) => !value.includes(s) && s.toLowerCase().includes(q)),
        }))
        .filter((g) => g.items.length > 0)
    }
    return []
  })()

  const isOpen = showSuggestionMenu && showDropdown && dropdownGroups.length > 0

  // Resolve UM token pra o valor final do chip (respeitando restrictToSuggestions),
  // deduplicando contra o que já existe e contra os que estão sendo adicionados agora.
  const resolveChip = (raw: string, taken: string[]): string | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const nextChip = restrictToSuggestions
      ? allSuggestions.find((item) => normalizeSuggestion(item) === normalizeSuggestion(trimmed))
      : trimmed
    if (!nextChip) return null
    if (value.includes(nextChip) || taken.includes(nextChip)) return null
    return nextChip
  }

  // Adiciona UM ou VÁRIOS chips: o texto é quebrado por vírgula / ponto-e-vírgula / nova linha,
  // então "Age Gap, Remarriage; Pregnancy" (digitado ou colado) vira três chips de uma vez.
  // Seleção do dropdown chama com um nome único (sem separador) → resolve exatamente um.
  const addChip = (raw: string) => {
    const additions: string[] = []
    for (const token of raw.split(/[,;\n]/)) {
      const chip = resolveChip(token, additions)
      if (chip) additions.push(chip)
    }
    if (additions.length > 0) onChange([...value, ...additions])
    setInputValue("")
    setShowDropdown(false)
    setActiveIndex(-1)
  }

  // Colar uma lista com separador cai direto no split (senão o texto colado vira um chip só).
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text")
    if (/[,;\n]/.test(text)) {
      e.preventDefault()
      addChip(text)
    }
  }

  const removeChip = (chip: string) => {
    onChange(value.filter((v) => v !== chip))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, flatFiltered.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, -1))
        return
      }
      if (e.key === "Escape") {
        setShowDropdown(false)
        setActiveIndex(-1)
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        if (activeIndex >= 0 && flatFiltered[activeIndex]) {
          addChip(flatFiltered[activeIndex].name)
        } else if (!restrictToSuggestions) {
          addChip(inputValue)
        }
        return
      }
    }

    if ((e.key === "Enter" || e.key === "," || e.key === ";") && (!restrictToSuggestions || !showSuggestionMenu)) {
      e.preventDefault()
      addChip(inputValue)
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      removeChip(value[value.length - 1])
    }
  }

  const handleBlur = () => {
    setTimeout(() => {
      setShowDropdown(false)
      setActiveIndex(-1)
      if (!restrictToSuggestions && inputValue.trim()) addChip(inputValue)
    }, 150)
  }

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "flex flex-wrap gap-1.5 min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {groupedValues.length > 0 ? (
          <div className="flex min-w-0 basis-full flex-col gap-2">
            {groupedValues.map((group) => (
              <div key={group.label} className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="mr-1 shrink-0 text-xs font-medium text-muted-foreground">
                  {group.label}
                </span>
                {group.values.map((chip) => (
                  <ChipBadge key={chip} chip={chip} disabled={disabled} onRemove={removeChip} />
                ))}
              </div>
            ))}
            {ungroupedChips.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {ungroupedChips.map((chip) => (
                  <ChipBadge key={chip} chip={chip} disabled={disabled} onRemove={removeChip} />
                ))}
              </div>
            )}
          </div>
        ) : (
          value.map((chip) => (
            <ChipBadge key={chip} chip={chip} disabled={disabled} onRemove={removeChip} />
          ))
        )}
        {!disabled && (
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value)
              setShowDropdown(true)
              setActiveIndex(-1)
            }}
            onFocus={() => { if (inputValue) setShowDropdown(true) }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={handleBlur}
            placeholder={value.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground"
          />
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {dropdownGroups.map((grp, gi) => (
            <div key={gi}>
              {grp.label && (
                <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {grp.label}
                </div>
              )}
              {grp.items.map((item) => {
                const flatIdx = flatFiltered.findIndex(
                  (f) => f.name === item && (grp.label == null || f.groupLabel === grp.label)
                )
                const isActive = flatIdx === activeIndex
                return (
                  <div
                    key={item}
                    className={cn(
                      "cursor-pointer px-3 py-1.5 text-sm",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addChip(item)
                    }}
                  >
                    {highlightMatch(item, inputValue)}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function highlightMatch(text: string, query: string) {
  if (!query) return <span>{text}</span>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-transparent font-semibold text-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </span>
  )
}

function normalizeSuggestion(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function ChipBadge({
  chip,
  disabled,
  onRemove,
}: {
  chip: string
  disabled?: boolean
  onRemove: (chip: string) => void
}) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {chip}
      {!disabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(chip) }}
          className="rounded-full p-0.5 hover:bg-muted-foreground/20"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  )
}
