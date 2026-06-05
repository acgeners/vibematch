import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowUpRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type StatCardAccent = "primary" | "violet" | "amber" | "slate" | "emerald"

interface StatCardProps {
  title: string
  value: string | number
  description?: string
  icon?: ReactNode
  href?: string
  className?: string
  accent?: StatCardAccent
}

const ACCENT_STYLES: Record<
  StatCardAccent,
  { iconBg: string; iconText: string; ring: string; glow: string }
> = {
  primary: {
    iconBg: "bg-primary/12 group-hover:bg-primary",
    iconText: "text-primary group-hover:text-primary-foreground",
    ring: "group-hover:border-primary/40",
    glow: "group-hover:shadow-primary/15",
  },
  violet: {
    iconBg: "bg-violet-500/12 group-hover:bg-violet-500",
    iconText: "text-violet-500 group-hover:text-white",
    ring: "group-hover:border-violet-500/40",
    glow: "group-hover:shadow-violet-500/15",
  },
  amber: {
    iconBg: "bg-amber-500/15 group-hover:bg-amber-500",
    iconText: "text-amber-600 group-hover:text-white dark:text-amber-400",
    ring: "group-hover:border-amber-500/40",
    glow: "group-hover:shadow-amber-500/15",
  },
  slate: {
    iconBg: "bg-slate-500/12 group-hover:bg-slate-500",
    iconText: "text-slate-500 group-hover:text-white dark:text-slate-300",
    ring: "group-hover:border-slate-500/40",
    glow: "group-hover:shadow-slate-500/15",
  },
  emerald: {
    iconBg: "bg-emerald-500/12 group-hover:bg-emerald-500",
    iconText: "text-emerald-600 group-hover:text-white dark:text-emerald-400",
    ring: "group-hover:border-emerald-500/40",
    glow: "group-hover:shadow-emerald-500/15",
  },
}

export function StatCard({
  title,
  value,
  description,
  icon,
  href,
  className,
  accent = "primary",
}: StatCardProps) {
  const accentStyle = ACCENT_STYLES[accent]
  const content = (
    <Card
      className={cn(
        "group relative h-full justify-center gap-3 overflow-hidden py-5 transition-all",
        href && "cursor-pointer hover:-translate-y-0.5 hover:bg-card hover:shadow-md",
        href && accentStyle.ring,
        href && accentStyle.glow,
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {icon && (
          <div
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg transition-colors [&_svg]:size-4",
              accentStyle.iconBg,
              accentStyle.iconText
            )}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 px-5">
        <div className="min-w-0">
          <div className="text-3xl font-bold tracking-tight tabular-nums leading-none">
            {value}
          </div>
          {description && (
            <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {href && (
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
        )}
      </div>
    </Card>
  )

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    )
  }

  return content
}
