import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface Props {
  title: ReactNode
  subtitle?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  bodyClassName?: string
}

/**
 * Seção recolhível baseada em <details> nativo — sem estado de cliente. Usada
 * pras seções especializadas do painel (glossário, confiabilidade, fix de capas)
 * que são ruído no fluxo principal mas úteis sob demanda.
 */
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
  bodyClassName,
}: Props) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-transparent px-4 py-3 group-open:border-border/60 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className={cn("px-4 py-3 sm:px-5", bodyClassName)}>{children}</div>
    </details>
  )
}
