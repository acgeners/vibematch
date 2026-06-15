"use client"

import { useEffect, useState } from "react"
import { BookOpen, Heart, Minus, Plus, ScrollText, Sparkles, TrendingUp } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"
import type { AttributeWeight, MoodRefine } from "@/lib/calculations/mood-refine"
import { isMoodActive } from "@/lib/calculations/mood-refine"

const EMPTY_MOOD: MoodRefine = { attributes: {} }

// Escala de 5 níveis por atributo, estilo "equalizer": barras crescentes
// (evitar → priorizar), com altura e cor (verde → vermelho) codificando a
// intensidade. `null` = neutro (a barra do meio). Arrays paralelos, na ordem.
const SCALE: Array<{ value: AttributeWeight | null; title: string }> = [
  { value: -2, title: "Evitar muito" },
  { value: -1, title: "Evitar" },
  { value: null, title: "Neutro" },
  { value: 1, title: "Priorizar" },
  { value: 2, title: "Priorizar muito" },
]
const BAR_HEIGHT = ["h-2.5", "h-3.5", "h-4", "h-5", "h-6"]
// Vermelho (evitar, −) → verde (priorizar, +).
const BAR_COLOR = ["bg-red-500", "bg-orange-500", "bg-amber-400", "bg-lime-500", "bg-emerald-500"]
// Barras da legenda: mais baixas e um pouco mais largas que as do seletor.
const LEGEND_HEIGHT = ["h-1", "h-1.5", "h-2", "h-2.5", "h-3"]

/**
 * Popup de refino por mood. As obras do tier estão tecnicamente empatadas (dentro
 * do erro do modelo); aqui o user diz o que quer priorizar AGORA e a comparação
 * abre reordenada por uma Prioridade ajustada (limitada ao MAE). Ver
 * lib/calculations/mood-refine.ts.
 */
export function MoodRefineDialog({
  open,
  onOpenChange,
  workCount,
  onApply,
  onSkip,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workCount: number
  onApply: (mood: MoodRefine) => void
  onSkip: () => void
}) {
  const [mood, setMood] = useState<MoodRefine>(EMPTY_MOOD)

  // Reseta o estado a cada abertura (sync controlado prop→state, intencional).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setMood(EMPTY_MOOD)
  }, [open])

  const setAttr = (slug: CriterionSlug, weight: AttributeWeight | null) => {
    setMood((m) => {
      const attributes = { ...m.attributes }
      if (weight == null) delete attributes[slug]
      else attributes[slug] = weight
      return { ...m, attributes }
    })
  }

  const toggleChapters = (dir: "curto" | "longo") =>
    setMood((m) => ({ ...m, chapters: m.chapters === dir ? undefined : dir }))

  const active = isMoodActive(mood)
  const overflow = workCount > MAX_COMPARE_WORKS

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Refinar comparação
          </DialogTitle>
          <DialogDescription>
            Estas {workCount} obras estão tecnicamente empatadas em Prioridade (dentro do erro do
            modelo). Diga o que você quer priorizar agora — a comparação abre reordenada por isso
            {overflow ? `, mostrando as ${MAX_COMPARE_WORKS} melhores pro seu mood` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Dimensões práticas */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              O que importa agora
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Toggle active={mood.chapters === "curto"} onClick={() => toggleChapters("curto")}>
                <BookOpen className="h-3.5 w-3.5" /> Mais curto
              </Toggle>
              <Toggle active={mood.chapters === "longo"} onClick={() => toggleChapters("longo")}>
                <BookOpen className="h-3.5 w-3.5" /> Mais longo
              </Toggle>
              <Toggle
                active={mood.alignment === true}
                onClick={() => setMood((m) => ({ ...m, alignment: !m.alignment }))}
              >
                <Heart className="h-3.5 w-3.5" /> Mais alinhado
              </Toggle>
              <Toggle
                active={mood.synopsis === true}
                onClick={() => setMood((m) => ({ ...m, synopsis: !m.synopsis }))}
              >
                <ScrollText className="h-3.5 w-3.5" /> Sinopse interessante
              </Toggle>
              <Toggle
                active={mood.popularity === true}
                onClick={() => setMood((m) => ({ ...m, popularity: !m.popularity }))}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Mais popular
              </Toggle>
            </div>
          </div>

          {/* Atributos — escala "equalizer" de 5 níveis */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Atributos
              </p>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Minus className="h-2.5 w-2.5 text-red-500" />
                evitar
                <span className="inline-flex items-end gap-px" aria-hidden>
                  {LEGEND_HEIGHT.map((h, i) => (
                    <span key={i} className={cn("w-1 rounded-full", h, BAR_COLOR[i])} />
                  ))}
                </span>
                priorizar
                <Plus className="h-2.5 w-2.5 text-emerald-500" />
              </span>
            </div>
            <div className="space-y-1.5">
              {CRITERION_SLUGS.map((slug) => {
                const info = CRITERIA_INFO[slug]
                const cur = mood.attributes[slug] ?? null
                return (
                  <div key={slug} className="flex items-center gap-3">
                    <span className="flex w-40 shrink-0 items-center gap-1.5 text-sm" title={info.name}>
                      <span aria-hidden>{info.emoji}</span>
                      <span className="truncate">{info.name}</span>
                    </span>
                    <IntensityScale value={cur} onChange={(w) => setAttr(slug, w)} className="ml-auto" />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onSkip}>
            Comparar sem refinar
          </Button>
          <Button onClick={() => onApply(mood)} disabled={!active}>
            Aplicar e comparar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

/**
 * Seletor "equalizer" de 5 níveis, esticável (ocupa a largura disponível). O −
 * (verde) e o + (vermelho) são STEPPERS: descem/sobem um nível, passando pelo
 * neutro. As 5 barras crescentes também são clicáveis direto. A barra acesa é a
 * selecionada; a do meio (índice 2) é o neutro (value null).
 */
function IntensityScale({
  value,
  onChange,
  className,
}: {
  value: AttributeWeight | null
  onChange: (w: AttributeWeight | null) => void
  className?: string
}) {
  const num = value ?? 0
  const step = (delta: number) => {
    const next = Math.max(-2, Math.min(2, num + delta))
    onChange(next === 0 ? null : (next as AttributeWeight))
  }
  return (
    <div className={cn("flex items-end gap-2", className)}>
      <button
        type="button"
        aria-label="Diminuir (evitar mais)"
        title="Evitar mais"
        onClick={() => step(-1)}
        disabled={num <= -2}
        className="shrink-0 pb-0.5 text-red-500 transition-colors hover:text-red-600 disabled:opacity-40"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-end gap-1">
        {SCALE.map((seg, i) => {
          const selected = value === seg.value
          return (
            <button
              key={seg.title}
              type="button"
              title={seg.title}
              aria-label={seg.title}
              aria-pressed={selected}
              onClick={() => onChange(selected ? null : seg.value)}
              className="flex h-6 items-end px-0.5"
            >
              <span
                className={cn(
                  "w-2 rounded-full transition-all",
                  BAR_HEIGHT[i],
                  BAR_COLOR[i],
                  selected
                    ? "opacity-100 ring-2 ring-foreground/40 ring-offset-1 ring-offset-background"
                    : "opacity-25 hover:opacity-60",
                )}
              />
            </button>
          )
        })}
      </div>
      <button
        type="button"
        aria-label="Aumentar (priorizar mais)"
        title="Priorizar mais"
        onClick={() => step(1)}
        disabled={num >= 2}
        className="shrink-0 pb-0.5 text-emerald-500 transition-colors hover:text-emerald-600 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
