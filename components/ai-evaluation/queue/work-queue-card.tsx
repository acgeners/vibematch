"use client"

import type { ReactNode } from "react"
import { Tag, MessageSquare, Check, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { CoverThumb } from "@/components/ai-evaluation/cover-thumb"
import { cn } from "@/lib/utils"

export type WorkQueueTone = "amber" | "sky" | "slate" | "emerald" | "orange" | "rose"

export interface WorkQueueState {
  label: string
  tone: WorkQueueTone
}

const TONE_CLASS: Record<WorkQueueTone, string> = {
  amber: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
  sky: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200",
  slate: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-200",
  orange: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-400/25 dark:bg-orange-400/12 dark:text-orange-200",
  rose: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300",
}

const DOT_CLASS: Record<WorkQueueTone, string> = {
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  slate: "bg-slate-400",
  emerald: "bg-emerald-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
}

export interface WorkQueueCardProps {
  // Núcleo (sempre visível) — comum a todas as abas.
  workId: string
  title: string
  coverUrl?: string | null
  coverUrls?: (string | null | undefined)[]
  expectedScore?: number | null
  publicationStatusId?: number | null
  personalStatusId?: number | null
  /** Interesse na sinopse (♥–♥♥♥♥), manual/efetivo. */
  interest?: string | null
  tagCount?: number | null
  reviewCount?: number | null
  /** Oculta 🏷/💬 quando a aba não hidrata contagens. */
  showCounts?: boolean

  // Tier 1 específico da aba.
  /** Destaque da aba (linha 2, esquerda): veredito / sugestão IA / alerta. */
  headline?: ReactNode
  /** 1 chip de estado (linha 2, direita). */
  state?: WorkQueueState | null
  /** Controle de rating do usuário (ex.: picker de Interesse) — na coluna de
   *  info, logo abaixo do destaque da IA, pareando "IA sugere" com "seu ♥". */
  rating?: ReactNode

  // Tier 3 (sob demanda).
  /** Conteúdo do "⋯ detalhes" (expandível). */
  details?: ReactNode
  showDetailsDirectly?: boolean

  // Ação(ões) da aba (coluna direita).
  actions?: ReactNode
  /** Trilho de ação mais largo (rótulos longos, ex.: "Buscar reviews"). */
  wideActions?: boolean

  // Seleção universal.
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void

  dimmed?: boolean

  /** Pendência marcada como "lida" (silenciada, mas ainda na fila). Esmaece o
   *  card e exibe um selo "Lida" clicável que desmarca via `onToggleRead`. */
  read?: boolean
  onToggleRead?: () => void
}

/**
 * Card unificado das filas de /ai-evaluation. Shell de 3 tiers: núcleo comum
 * sempre visível (capa · título · nota · status · interesse · contagens · 1 chip
 * de estado), destaque específico da aba na linha 2, e detalhes pesados sob
 * demanda ("⋯ detalhes"). Seleção via checkbox em todas as abas.
 */
export function WorkQueueCard({
  workId,
  title,
  coverUrl,
  coverUrls,
  expectedScore,
  publicationStatusId,
  personalStatusId,
  interest,
  tagCount,
  reviewCount,
  showCounts = true,
  headline,
  state,
  rating,
  details,
  showDetailsDirectly = false,
  actions,
  wideActions,
  selectable,
  selected,
  onToggleSelect,
  dimmed,
  read,
  onToggleRead,
}: WorkQueueCardProps) {
  return (
    <Card
      className={cn(
        "relative transition-all hover:border-primary/30 hover:bg-card hover:shadow-md hover:shadow-primary/10",
        selected && "border-primary/60 bg-primary/5",
        (dimmed || read) && "opacity-60",
      )}
    >
      <CardContent className="p-3.5">
        {/* Slot da nota (canto sup. dir.). Com nota → pílula colorida; sem nota
            (obra sem os 9 atributos IA → expected_score null) → o "—" cinza que o
            ScoreBadge já renderiza pra valor nulo, com tooltip do que a destrava.
            Sempre presente pra o slot não ficar vazio (o título reserva pr-14). */}
        <span
          title={
            expectedScore != null
              ? "Nota prevista"
              : "Sem Nota Prevista ainda — aparece após a avaliação IA dos atributos da obra"
          }
          className="absolute top-3.5 right-3.5 z-10"
        >
          <ScoreBadge score={expectedScore} size="lg" />
        </span>

        <div className="flex items-start gap-4">
          {selectable && (
            <div className="flex self-center items-center justify-center shrink-0">
              <Checkbox
                checked={!!selected}
                onCheckedChange={() => onToggleSelect?.()}
                onClick={(e) => e.stopPropagation()}
                className="size-5"
                aria-label={`Selecionar ${title}`}
              />
            </div>
          )}

          <CoverThumb url={coverUrl} urls={coverUrls} className="h-36 w-24 rounded-md" />

          {/* Coluna principal — preenche a largura, esquerda-alinhada */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch py-0.5">
            <WorkTitleLink
              title={title}
              workId={workId}
              className="line-clamp-2 break-words text-base font-semibold leading-snug hover:underline text-foreground pr-14"
            />

            {/* Meta comum — status (short code) · interesse · contagens */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <PublicationStatusBadge statusId={publicationStatusId ?? null} compact />
                <PersonalStatusBadge statusId={personalStatusId ?? null} iconOnly />
              </span>
              {interest && (
                <span title="Interesse na sinopse" className="font-semibold text-rose-600 dark:text-rose-300">
                  {interest}
                </span>
              )}
              {showCounts && (
                <>
                  <span
                    title="Tags da obra"
                    className={cn(
                      "inline-flex items-center gap-1 tabular-nums",
                      (tagCount ?? 0) === 0 && "font-medium text-amber-600 dark:text-amber-300",
                    )}
                  >
                    <Tag className="h-3.5 w-3.5" />
                    {tagCount ?? 0}
                  </span>
                  <span
                    title="Reviews úteis (≥40 caracteres)"
                    className={cn(
                      "inline-flex items-center gap-1 tabular-nums",
                      (reviewCount ?? 0) === 0 && "font-medium text-amber-600 dark:text-amber-300",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {reviewCount ?? 0}
                  </span>
                </>
              )}
              {/* Selo "Lida" — na linha de badges, logo abaixo do título. Largura
                  FIXA no hover (só troca cor + ícone ✓→✕), então não empurra nada. */}
              {read && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleRead?.()
                  }}
                  title="Marcada como lida — clique para desmarcar"
                  className="group inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-200 dark:hover:border-rose-400/30 dark:hover:bg-rose-400/10 dark:hover:text-rose-300"
                >
                  <Check className="h-3 w-3 group-hover:hidden" aria-hidden />
                  <X className="hidden h-3 w-3 group-hover:inline" aria-hidden />
                  Lida
                </button>
              )}
            </div>

            {/* Estado + destaque da aba (Avaliação IA) */}
            {(headline || state) && (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
                  !details && "mt-auto"
                )}
              >
                {state && (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                      TONE_CLASS[state.tone],
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[state.tone])} aria-hidden />
                    {state.label}
                  </span>
                )}
                {headline && <span className="min-w-0">{headline}</span>}
              </div>
            )}

            {/* Rating do usuário (ex.: picker de Interesse) — pareado com a
                sugestão da IA acima, na coluna de info. */}
            {rating && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {rating}
              </div>
            )}

            {/* Tier 3: detalhes sob demanda */}
            {details && (
              <div className="mt-auto">
                {showDetailsDirectly ? (
                  <div className="mt-1">{details}</div>
                ) : (
                  <details className="mt-1">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors [&::-webkit-details-marker]:hidden">
                      Ver contexto
                    </summary>
                    <div className="mt-2 space-y-1.5">{details}</div>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* Trilho direito — ações centradas verticalmente. `pt-9` reserva a
              faixa da pílula de nota (absoluta no canto sup-dir) pra os botões
              nunca passarem por baixo dela. */}
          {actions && (
            <div className="flex shrink-0 flex-col items-center justify-center gap-3 self-stretch min-h-[144px] pt-9">
              <div className={cn("flex flex-col items-stretch gap-2", wideActions ? "w-36" : "w-28")}>{actions}</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
