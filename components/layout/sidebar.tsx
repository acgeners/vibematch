"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  BookOpen,
  Upload,
  Trophy,
  Sparkles,
  Settings,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/titles", icon: BookOpen, label: "Títulos" },
  { href: "/ranking", icon: Trophy, label: "Ranking" },
  { href: "/ai-evaluation", icon: Sparkles, label: "Avaliação IA" },
  { href: "/import", icon: Upload, label: "Importar" },
  { href: "/settings", icon: Settings, label: "Configurações" },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex flex-col w-56 min-h-screen border-r border-border bg-sidebar shrink-0">
      <div className="flex items-center h-14 px-4 border-b border-border">
        <span className="font-bold text-foreground tracking-tight text-base">
          VibeMatch
        </span>
      </div>
      <nav className="flex flex-col gap-1 p-2 flex-1">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
