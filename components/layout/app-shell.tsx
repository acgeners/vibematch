"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { useCrossTabRefreshListener } from "@/lib/use-refresh"

// Rotas de auth, o onboarding /bem-vindo e a página pública /sobre renderizam full-bleed (sem
// sidebar/nav/fabs). Aditivo: todo o resto do app mantém o chrome idêntico.
const FULL_BLEED_PREFIXES = ["/login", "/signup", "/auth", "/bem-vindo", "/sobre"]

function isFullBleedRoute(pathname: string): boolean {
  return FULL_BLEED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function AppShell({
  topNav,
  overlays,
  children,
}: {
  topNav: ReactNode
  overlays: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname() ?? ""

  // Mantém esta aba em dia quando outra aba faz uma mutação. Chamado antes de
  // qualquer return pra o hook rodar em toda rota (inclusive auth).
  useCrossTabRefreshListener()

  if (isFullBleedRoute(pathname)) {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
  }

  // A barra passou de COLUNA (sidebar, irmã do main) para LINHA acima dele — por isso o
  // shell deixou de ser flex-row e o scroll saiu do <main> para o contêiner: com a barra
  // `sticky` no topo, rolar dentro do main a deixaria parada em cima de conteúdo rolando.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scroll-smooth">
      {topNav}
      <main className="relative z-10 mx-auto w-full max-w-[1560px] flex-1 px-4 pt-4 pb-24 md:px-7 md:pt-5 md:pb-7">
        {children}
      </main>
      {overlays}
    </div>
  )
}
