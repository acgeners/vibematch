import Link from "next/link"
import { ShieldCheck, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PredictionHealth } from "@/server/queries/calibration-guards"

const HEALTH_META: Record<PredictionHealth["overall"], { label: string; dot: string; text: string }> = {
  ok: { label: "Saudável", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  warn: { label: "Atenção", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  alert: { label: "Alerta", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
}

export function HealthStrip({ health }: { health: PredictionHealth }) {
  const meta = HEALTH_META[health.overall]

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/65 bg-background/40 px-4 py-2.5 text-sm">
      <Link href="/settings" className="group flex items-center gap-2 text-muted-foreground hover:text-foreground">
        <ShieldCheck className="size-4" />
        <span>Saúde da previsão</span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden />
          <span className={meta.text}>{meta.label}</span>
        </span>
        <ArrowRight className="size-3.5 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
      </Link>
    </div>
  )
}
