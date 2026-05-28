"use client"

import { AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import type { DeepDiveReviewSynthesis } from "@/lib/ai-recommendation/types"

interface DeepDiveReviewsSectionProps {
  synthesis: DeepDiveReviewSynthesis
}

export function DeepDiveReviewsSection({ synthesis }: DeepDiveReviewsSectionProps) {
  return (
    <CollapsibleCard
      title="O que reviews dizem"
      description="Síntese das opiniões externas (MangaUpdates, AniList, etc)."
      defaultOpen={false}
      contentClassName="space-y-4"
    >
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          Consenso
        </p>
        <p className="text-sm leading-relaxed text-foreground/90">{synthesis.consensus}</p>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          Divergências
        </p>
        <p className="text-sm leading-relaxed text-foreground/90">{synthesis.divergence}</p>
      </div>

      {synthesis.flags.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Alertas
          </p>
          <div className="flex flex-wrap gap-1.5">
            {synthesis.flags.map((flag) => (
              <Badge
                key={flag}
                variant="outline"
                className="gap-1 border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="h-3 w-3" />
                {flag}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}
