"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, BookOpen, BookMarked, Heart, LogIn, Trophy, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsSignedIn } from "@/components/layout/admin-context"

/**
 * Espelha a barra de cima, que no mobile fica só com logo e ícones.
 *
 * ⚠️ **O gate de sessão é o MESMO do topo, de propósito.** `/ranking` e
 * `/recommendations` dependem de sessão pra dizer qualquer coisa; oferecê-las aqui
 * ao visitante seria prometer o que não se entrega — e a divergência entre as duas
 * barras é do tipo que ninguém nota até alguém reclamar de uma tela vazia.
 *
 * ⚠️ **"Leitura", não "Lendo".** O rótulo curto de `/reading` precisava de forma
 * curta (a bottom-nav tem ~76px por slot, e "Acompanhamento" não cabe), mas "Lendo"
 * é literalmente um `personal_status` do app — o mesmo nome pra um destino e pra um
 * estado de obra. "Leitura" é curto e tem a raiz da rota.
 */
const MOBILE_NAV = [
  { href: "/", icon: Home, label: "Início" },
  { href: "/reading", icon: BookMarked, label: "Leitura", requiresSignedIn: true },
  { href: "/favorites", icon: Heart, label: "Favoritos", requiresSignedIn: true },
  { href: "/catalog", icon: BookOpen, label: "Catálogo" },
  { href: "/ranking", icon: Trophy, label: "Ranking", requiresSignedIn: true },
  { href: "/recommendations", icon: Wand2, label: "Recom.", requiresSignedIn: true },
]

/** Visitante fica com 2 destinos — e sem isto a barra não teria a ação que ele precisa. */
const GUEST_CTA = { href: "/login", icon: LogIn, label: "Entrar" }

export function MobileNav() {
  const pathname = usePathname()
  const signedIn = useIsSignedIn()
  const items = MOBILE_NAV.filter((i) => !i.requiresSignedIn || signedIn)
  const entries = signedIn ? items : [...items, GUEST_CTA]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border/80 bg-background/92 px-1.5 py-1.5 shadow-[0_-16px_30px_hsl(220_30%_5%/0.18)] backdrop-blur md:hidden">
      {entries.map(({ href, icon: Icon, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-all",
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
