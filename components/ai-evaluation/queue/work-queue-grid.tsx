import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Grid padrão das filas de /ai-evaluation. `dense` (Untracked, sem ação por
 * card) adensa as colunas em telas largas; o default é 2 colunas.
 */
export function WorkQueueGrid({ dense, children }: { dense?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 md:grid-cols-2",
        dense && "lg:grid-cols-3",
      )}
    >
      {children}
    </div>
  )
}
