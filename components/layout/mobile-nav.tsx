"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, BookOpen, BookMarked, Trophy, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsSignedIn } from "@/components/layout/admin-context"

// Espelha a barra de cima, que no mobile fica só com logo e ícones. "Import" saiu daqui
// quando virou item do menu do usuário (é ação sobre a SUA lista, não navegação de catálogo);
// no lugar entrou Acompanhamento, que é o destino nº 1 de quem já usa o app.
const MOBILE_NAV = [
  { href: "/", icon: Home, label: "Início" },
  { href: "/titles", icon: BookOpen, label: "Catálogo" },
  { href: "/leitura", icon: BookMarked, label: "Lendo", requiresSignedIn: true },
  { href: "/ranking", icon: Trophy, label: "Ranking" },
  { href: "/recommendations", icon: Wand2, label: "Recom." },
]

export function MobileNav() {
  const pathname = usePathname()
  const signedIn = useIsSignedIn()
  const items = MOBILE_NAV.filter((i) => !i.requiresSignedIn || signedIn)
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border/80 bg-background/92 px-1.5 py-1.5 shadow-[0_-16px_30px_hsl(220_30%_5%/0.18)] backdrop-blur md:hidden">
      {items.map(({ href, icon: Icon, label }) => {
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
