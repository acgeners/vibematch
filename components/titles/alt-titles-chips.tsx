"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface AltTitlesChipsProps {
  /** Título principal (o que a página exibe) — entra como 1º chip, marcado "atual". */
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
}

type ChipKind = "current" | "original" | "alt"
interface Chip {
  text: string
  kind: ChipKind
}

/** Geometria calculada pra colapsar em 2 linhas: altura máxima do bloco e quantos chips sobram. */
interface CollapseState {
  maxHeight: number
  hidden: number
}

export function AltTitlesChips({
  title,
  originalTitle,
  alternativeTitles,
}: AltTitlesChipsProps) {
  const mainTitle = title.trim()
  const original = originalTitle?.trim()
  const hasOriginal = Boolean(original) && original !== mainTitle

  // Dedup mantendo a ordem: título atual (1º), depois o original, depois os alternativos.
  const seen = new Set<string>()
  const chips: Chip[] = []
  const add = (value: string | null | undefined, kind: ChipKind) => {
    const t = value?.trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    chips.push({ text: t, kind })
  }
  add(mainTitle, "current")
  if (hasOriginal) add(original, "original")
  for (const alt of alternativeTitles ?? []) add(alt, "alt")

  const containerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [collapse, setCollapse] = useState<CollapseState | null>(null)

  // Chave estável do conjunto de chips: re-mede quando os títulos mudam.
  const chipsKey = chips.map((c) => c.text).join("")

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => {
      // `overflow-hidden` clipa a visão mas PRESERVA o layout, então todo chip mantém o
      // `offsetTop` real mesmo colapsado — dá pra medir as linhas em qualquer estado.
      const kids = Array.from(el.children) as HTMLElement[]
      if (kids.length === 0) {
        setCollapse((prev) => (prev === null ? prev : null))
        return
      }
      const tops = kids.map((k) => k.offsetTop)
      const rows = Array.from(new Set(tops)).sort((a, b) => a - b)
      if (rows.length <= 2) {
        setCollapse((prev) => (prev === null ? prev : null))
        return
      }
      const thirdRowTop = rows[2]
      // Altura = fundo da 2ª linha (topo da 2ª linha + altura de um chip). Como a 3ª linha
      // começa em `thirdRowTop` (> maxHeight), nenhum chip fica cortado pela metade.
      const maxHeight = rows[1] - rows[0] + kids[0].offsetHeight
      const hidden = tops.filter((t) => t >= thirdRowTop).length
      setCollapse((prev) =>
        prev && prev.maxHeight === maxHeight && prev.hidden === hidden
          ? prev
          : { maxHeight, hidden },
      )
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [chipsKey])

  // Só há o que mostrar quando existe ao menos um título ALÉM do atual.
  if (!chips.some((c) => c.kind !== "current")) return null

  const isCollapsed = collapse != null && !expanded

  return (
    <div className="space-y-1.5">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Títulos alternativos
      </p>
      <div
        ref={containerRef}
        className="flex flex-wrap items-center gap-1.5 overflow-hidden"
        style={isCollapsed ? { maxHeight: collapse.maxHeight } : undefined}
      >
        {chips.map((chip) => {
          if (chip.kind === "current") {
            return (
              <Badge
                key={chip.text}
                title={`${chip.text} — título exibido`}
                className="max-w-full gap-1 bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground"
              >
                <Eye className="size-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{chip.text}</span>
              </Badge>
            )
          }
          const isOriginal = chip.kind === "original"
          return (
            <Badge
              key={chip.text}
              variant="secondary"
              title={isOriginal ? `${chip.text} — título original` : chip.text}
              className={cn(
                "max-w-full px-2.5 py-0.5 text-xs font-normal",
                isOriginal && "gap-1 bg-primary/10 font-medium text-primary",
              )}
            >
              {isOriginal && (
                <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
              )}
              <span className="min-w-0 truncate">{chip.text}</span>
            </Badge>
          )
        })}
      </div>
      {collapse != null && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-muted-foreground/80 ring-1 ring-inset ring-border transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded ? "Mostrar menos" : `+${collapse.hidden}`}
        </button>
      )}
    </div>
  )
}
