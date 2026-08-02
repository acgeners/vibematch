import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Aba de topo compartilhada por /ai-evaluation e /fila-recomendacao. */
export function EvalTabLink({
  href,
  active,
  dot,
  children,
}: {
  href: string
  active: boolean
  /** Pontinho: a aba tem não-lidas que somam no badge da sidebar (some quando lida). */
  dot?: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative -mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 font-semibold text-primary"
          : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {dot && (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary/70"
          aria-label="pendências não lidas"
        />
      )}
      {children}
    </Link>
  )
}
