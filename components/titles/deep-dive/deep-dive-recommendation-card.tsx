"use client"

import Link from "next/link"
import { CheckCircle2, Clock, XCircle, ArrowRight } from "lucide-react"
import { cn, titleToSlug } from "@/lib/utils"
import type { DeepDivePayload } from "@/lib/ai-recommendation/types"

interface DeepDiveRecommendationCardProps {
  payload: DeepDivePayload
}

const STYLES = {
  agora: {
    container: "border-emerald-500/40 bg-emerald-500/10",
    icon: "text-emerald-600 dark:text-emerald-400",
    label: "Vai nessa, agora",
    description: "Match forte e mood favorável.",
    IconComp: CheckCircle2,
  },
  guardar: {
    container: "border-amber-500/40 bg-amber-500/10",
    icon: "text-amber-600 dark:text-amber-400",
    label: "Guardar pra depois",
    description: "Promissor, mas o timing não é agora.",
    IconComp: Clock,
  },
  evitar: {
    container: "border-rose-500/40 bg-rose-500/10",
    icon: "text-rose-600 dark:text-rose-400",
    label: "Pula essa",
    description: "Sinais conflitam com seu perfil.",
    IconComp: XCircle,
  },
} as const

export function DeepDiveRecommendationCard({ payload }: DeepDiveRecommendationCardProps) {
  const rec = payload.read_recommendation
  const style = STYLES[rec.when]
  const { IconComp } = style

  return (
    <div className={cn("space-y-3 rounded-lg border-2 p-4", style.container)}>
      <div className="flex items-start gap-3">
        <IconComp className={cn("mt-0.5 h-6 w-6 shrink-0", style.icon)} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("text-base font-bold", style.icon)}>{style.label}</p>
          <p className="text-xs text-muted-foreground">{style.description}</p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-foreground/90">{rec.reasoning}</p>

      {rec.suggested_alternative_id && rec.suggested_alternative_title && (
        <Link
          href={`/titles/${titleToSlug(rec.suggested_alternative_title)}`}
          className="flex items-center justify-between gap-2 rounded-md border bg-background/60 px-3 py-2 text-xs hover:bg-background"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Alternativa sugerida
            </span>
            <span className="block truncate font-medium text-foreground">
              {rec.suggested_alternative_title}
            </span>
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Link>
      )}
    </div>
  )
}
