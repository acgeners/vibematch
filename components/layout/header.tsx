import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface HeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  kicker?: string
  icon?: ReactNode
  className?: string
}

export function Header({
  title,
  description,
  actions,
  kicker = "Biblioteca",
  icon,
  className,
}: HeaderProps) {
  return (
    <div
      className={cn(
        "relative mb-6 flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-border/60 after:via-primary/40 after:to-transparent",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        {icon && (
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/20 shadow-sm shadow-primary/10 [&_svg]:size-5">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/85">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary/80 shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
            {kicker}
          </p>
          <h1 className="font-bold tracking-tight text-foreground text-3xl md:text-4xl xl:text-[2.5rem] xl:leading-[1.1]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground max-w-prose">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
