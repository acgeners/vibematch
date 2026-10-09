import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Aba de topo compartilhada por /curation/works e /my-ai-scores. */
export function EvalTabLink({
  href,
  active,
  dot,
  dotLabel,
  children,
}: {
  href: string
  active: boolean
  /** Pontinho: a aba tem não-lidas que somam no badge da sidebar (some quando lida). */
  dot?: boolean
  /**
   * O que o ponto conta ("1 decisão esperando"). Vira o `title` da aba e o nome
   * acessível do ponto — o número da aba é OUTRA conta (o tamanho da lista), e um
   * ponto mudo ao lado dele não diz qual das duas está acesa.
   */
  dotLabel?: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      title={dot ? dotLabel : undefined}
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
          aria-label={dotLabel ?? "pendências não lidas"}
        />
      )}
      {children}
    </Link>
  )
}
