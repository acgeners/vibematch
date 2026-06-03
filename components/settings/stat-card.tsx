import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  /** Override the value typography (e.g. smaller mono for model names). */
  valueClassName?: string
}

/**
 * Shared stat card for the settings pipeline panels so every panel renders the
 * same `Pendentes → ok/total (%) → Modelo` triplet with identical styling.
 */
export function StatCard({ label, value, hint, valueClassName }: StatCardProps) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-base", valueClassName)}>{value}</p>
      {hint != null && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
