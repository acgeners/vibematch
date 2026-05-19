"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  BookOpen,
  Trophy,
  Sparkles,
  Upload,
} from "lucide-react"
import { cn } from "@/lib/utils"

const MOBILE_NAV = [
  { href: "/", icon: LayoutDashboard, label: "Início" },
  { href: "/titles", icon: BookOpen, label: "Títulos" },
  { href: "/ranking", icon: Trophy, label: "Ranking" },
  { href: "/ai-evaluation", icon: Sparkles, label: "IA" },
  { href: "/import", icon: Upload, label: "Import" },
]

export function MobileNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border/80 bg-background/92 px-1.5 py-1.5 shadow-[0_-16px_30px_hsl(220_30%_5%/0.18)] backdrop-blur md:hidden">
      {MOBILE_NAV.map(({ href, icon: Icon, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium transition-all",
              active
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
