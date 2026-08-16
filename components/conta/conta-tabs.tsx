"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserCircle, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/account", icon: UserCircle, label: "Conta" },
  { href: "/account/taste-profile", icon: Sparkles, label: "Perfil" },
]

export function ContaTabs() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Seções da conta"
      className="flex flex-wrap gap-1 rounded-xl border border-border/70 bg-card/60 p-1 shadow-sm shadow-black/5 backdrop-blur"
    >
      {TABS.map(({ href, icon: Icon, label }) => {
        // "/account" só ativa no path exato; as sub-rotas usam startsWith
        // (não se sobrepõem entre si).
        const active = href === "/account" ? pathname === "/account" : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors [&_svg]:size-4",
              active
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
