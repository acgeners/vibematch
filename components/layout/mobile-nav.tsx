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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-background">
      {MOBILE_NAV.map(({ href, icon: Icon, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
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
