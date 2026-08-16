"use client"

// ── Cabeçalho de tabela responsivo (compartilhado) ──────────────────────────
// Cada coluna exibe o MAIOR nome que couber na sua largura: full → short →
// abbrev. As três formas já existem no LABELS (tabela ui_labels), chaveadas pelo
// nome da coluna no DB (col.key). Colunas sem entrada no LABELS (estruturais como
// "#"/select, e critérios `crit_*` que são emoji) usam o rótulo único e não trocam.
//
// Usado por ranking-table (/ranking) e work-table (/catalog, /favorites, /batch).

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { LABELS } from "@/lib/constants/ui-labels"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { WorkColumnDef } from "@/components/titles/work-table-config"

export type HeaderFormKey = "full" | "short" | "abbrev"
export type HeaderForms = { full: string; short: string; abbrev: string }

// Tipografia do cabeçalho, aplicada TANTO no texto renderizado QUANTO no medidor,
// pra a medição bater independentemente da fonte do <th> hospedeiro (ex.: o
// heatmap não aplica uppercase/tracking no th; aqui o span carrega os dois).
const HEADER_TEXT_CLASS = "text-xs font-semibold uppercase tracking-wide"

const LABELS_BY_KEY = LABELS as Record<string, HeaderForms | undefined>

/** As 3 formas do rótulo de uma coluna, ou null se ela não tem entrada no LABELS nem
 *  declara as suas (estruturais/critérios) — nesse caso o chamador mantém o rótulo
 *  estático.
 *
 *  ⚠️ A ordem importa: o LABELS (gerado da tabela `ui_labels`) VENCE o que a coluna
 *  declara. O `col.headerForms` é a saída para coluna que ainda não tem linha no banco —
 *  sem ele o cabeçalho dela é desenhado por outro caminho, com tipografia diferente da
 *  dos vizinhos (foi o que aconteceu com "Real" ao lado de "N. PREV.").
 */
export function headerFormsFor(col: WorkColumnDef): HeaderForms | null {
  const entry = LABELS_BY_KEY[col.key] ?? col.headerForms
  return entry ? { full: entry.full, short: entry.short, abbrev: entry.abbrev } : null
}

// Medidor compartilhado, fora de tela, com a MESMA tipografia do cabeçalho
// (text-xs font-semibold uppercase tracking-wide) para medir a largura de cada
// forma em px sem provocar reflow visível.
let headerTextSizer: HTMLSpanElement | null = null
function measureHeaderText(text: string): number {
  if (typeof document === "undefined") return 0
  if (!headerTextSizer) {
    headerTextSizer = document.createElement("span")
    headerTextSizer.setAttribute("aria-hidden", "true")
    headerTextSizer.className = HEADER_TEXT_CLASS
    headerTextSizer.style.cssText =
      "position:absolute;left:-9999px;top:-9999px;white-space:nowrap;visibility:hidden;pointer-events:none;"
    document.body.appendChild(headerTextSizer)
  }
  headerTextSizer.textContent = text
  return headerTextSizer.getBoundingClientRect().width
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

export function ResponsiveHeaderLabel({
  forms,
  description,
  align,
  sortable,
  isActive,
  sortDir,
  onSort,
}: {
  forms: HeaderForms
  description: string | null
  align: "left" | "center" | "right"
  sortable: boolean
  isActive: boolean
  sortDir: "asc" | "desc"
  onSort: () => void
}) {
  const cellRef = useRef<HTMLDivElement | null>(null)
  const [form, setForm] = useState<HeaderFormKey>("abbrev")

  useIsomorphicLayoutEffect(() => {
    const el = cellRef.current
    if (!el) return
    let cancelled = false
    const recompute = () => {
      if (cancelled) return
      // el preenche a área de conteúdo do <th> (que já tem px-3). Reserva só o
      // padding do próprio gatilho (~4px) + folga; +16 quando o caret de
      // ordenação está visível (só na coluna ativa — inativas o escondem).
      const reserve = 6 + (isActive ? 16 : 0)
      const avail = el.clientWidth - reserve
      let next: HeaderFormKey = "abbrev"
      if (measureHeaderText(forms.full) <= avail) next = "full"
      else if (measureHeaderText(forms.short) <= avail) next = "short"
      setForm((prev) => (prev === next ? prev : next))
    }
    recompute()
    // Remede quando a web font carrega: a 1ª medição na montagem usa a fallback
    // (métricas ~2-3px mais largas), que derrubaria formas no limite pro abbrev.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(recompute)
    }
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [forms.full, forms.short, forms.abbrev, sortable, isActive])

  const justify =
    align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start"
  const text = forms[form]
  // Tooltip mostra o nome completo sempre que o cabeçalho estiver encurtado.
  const showFullName = forms.full !== text

  const labelNode = sortable ? (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 transition-colors hover:bg-background/60 hover:text-foreground",
        isActive && "text-foreground",
      )}
      aria-label={`Ordenar por ${forms.full}`}
    >
      <span className={cn(HEADER_TEXT_CLASS, "truncate")}>{text}</span>
      {isActive ? (
        sortDir === "asc" ? (
          <ChevronUp className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )
      ) : (
        <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-40 group-hover/header:inline-block" />
      )}
    </button>
  ) : (
    <span className={cn(HEADER_TEXT_CLASS, "block truncate")}>{text}</span>
  )

  const content =
    showFullName || description ? (
      <Tooltip>
        <TooltipTrigger asChild>{labelNode}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left">
          {showFullName && <span className="font-semibold">{forms.full}</span>}
          {description && (
            <span className={cn("block text-xs text-muted-foreground", showFullName && "mt-1")}>
              {description}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    ) : (
      labelNode
    )

  return (
    <div ref={cellRef} className={cn("flex items-center", justify)}>
      {content}
    </div>
  )
}
