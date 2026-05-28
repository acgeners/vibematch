"use client"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { cn } from "@/lib/utils"
import type {
  DeepDiveAlignmentBreakdown,
  DeepDiveCriterionItem,
  DeepDiveTagItem,
} from "@/lib/ai-recommendation/types"

interface DeepDiveAlignmentSectionProps {
  alignment: DeepDiveAlignmentBreakdown
}

function impactClass(impact: number): string {
  // Tags com impact alto ficam mais densas visualmente.
  if (impact >= 0.75) return "px-3 py-1 text-sm font-medium"
  if (impact >= 0.5) return "px-2.5 py-0.5 text-xs font-medium"
  return "px-2 py-0.5 text-[11px] font-normal"
}

function TagsCol({
  title,
  items,
  variant,
}: {
  title: string
  items: DeepDiveTagItem[]
  variant: "pro" | "con"
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs italic text-muted-foreground/70">(nenhum)</p>
      ) : (
        <TooltipProvider>
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <Tooltip key={item.tag}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={cn(
                      "cursor-help rounded-full",
                      impactClass(item.impact),
                      variant === "pro"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                    )}
                  >
                    {item.tag}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px]">
                  <p className="text-xs leading-relaxed">{item.why}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    impacto: {(item.impact * 100).toFixed(0)}%
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      )}
    </div>
  )
}

function CriteriaCol({
  title,
  items,
  variant,
}: {
  title: string
  items: DeepDiveCriterionItem[]
  variant: "pro" | "con"
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs italic text-muted-foreground/70">(nenhum)</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.criterion}
              className={cn(
                "rounded-md border p-2.5",
                variant === "pro"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-rose-500/30 bg-rose-500/5",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{item.criterion}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {item.score.toFixed(1)} ∈ [{item.ideal_range[0].toFixed(1)},{" "}
                  {item.ideal_range[1].toFixed(1)}]
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-foreground/80">{item.why}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function DeepDiveAlignmentSection({ alignment }: DeepDiveAlignmentSectionProps) {
  return (
    <CollapsibleCard
      title="Por que faz (ou não) sentido"
      description="Tags, critérios e padrões narrativos cruzados com seu perfil."
      defaultOpen
      contentClassName="space-y-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TagsCol title="Tags a favor" items={alignment.tags_pros} variant="pro" />
        <TagsCol title="Tags contra" items={alignment.tags_cons} variant="con" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CriteriaCol title="Critérios a favor" items={alignment.criteria_pros} variant="pro" />
        <CriteriaCol title="Critérios contra" items={alignment.criteria_cons} variant="con" />
      </div>

      {alignment.narrative_match.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Padrões narrativos
          </p>
          <div className="space-y-2">
            {alignment.narrative_match.map((item, idx) => (
              <div key={idx} className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-foreground">{item.pattern}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}
