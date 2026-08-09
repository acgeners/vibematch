import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface HeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /**
   * Só nomeia o TIPO do objeto quando o título é nome próprio ("Grupo" + "Shounen pesado")
   * ou avisa o teor da tela. Em rota fixa ele repete o item aceso da barra superior — que já
   * responde "onde eu estou" desde que a sidebar saiu — e vira a 3ª vez que a mesma palavra
   * aparece na dobra. Não tem default: kicker herdado é palavra que ninguém pediu.
   */
  kicker?: string
  icon?: ReactNode
  className?: string
}

/**
 * Acima disto a descrição não cabe ao lado do título sem truncar nas larguras que importam,
 * então desce pra linha de baixo. Medido nas descrições reais do app: as curtas ficam em
 * 22–66 caracteres e as explicativas passam de 79.
 */
const INLINE_DESCRIPTION_MAX_CHARS = 72

export function Header({ title, description, actions, kicker, icon, className }: HeaderProps) {
  // ReactNode não tem comprimento — só string entra no ramo inline. Descrição rica
  // (a de /recommendations/[slug] é um <span> com chips) sempre desce.
  const inlineDescription =
    typeof description === "string" && description.length <= INLINE_DESCRIPTION_MAX_CHARS

  return (
    <div
      className={cn(
        "relative mb-4 flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-border/60 after:via-primary/40 after:to-transparent",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/20 shadow-sm shadow-primary/10 [&_svg]:size-4">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {/* items-baseline alinha a descrição com o título; o wrap é o que faz ela cair
              pra linha de baixo sozinha no celular, sem truncar. */}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            {kicker && (
              <span className="inline-flex shrink-0 translate-y-px items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/90">
                <span aria-hidden className="h-1 w-1 rounded-full bg-primary/80" />
                {kicker}
              </span>
            )}
            <h1 className="min-w-0 text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-[1.625rem]">
              {title}
            </h1>
            {inlineDescription && (
              <span className="text-[13px] leading-snug text-muted-foreground">{description}</span>
            )}
          </div>
          {description && !inlineDescription && (
            <p className="mt-1.5 max-w-prose text-[13px] leading-snug text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
