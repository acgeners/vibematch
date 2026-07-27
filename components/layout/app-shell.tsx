"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { useCrossTabRefreshListener } from "@/lib/use-refresh"

// Rotas de auth renderizam full-bleed (sem sidebar/nav/fabs). Aditivo: todo o
// resto do app mantém o chrome idêntico ao de antes.
const AUTH_PREFIXES = ["/login", "/signup", "/auth"]

function isAuthRoute(pathname: string): boolean {
  return AUTH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function AppShell({
  sidebar,
  overlays,
  children,
}: {
  sidebar: ReactNode
  overlays: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname() ?? ""

  // Mantém esta aba em dia quando outra aba faz uma mutação. Chamado antes de
  // qualquer return pra o hook rodar em toda rota (inclusive auth).
  useCrossTabRefreshListener()

  if (isAuthRoute(pathname)) {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
  }

  return (
    <>
      {sidebar}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <main className="relative z-10 min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 py-5 pb-24 md:px-7 md:py-7 md:pb-7">
          {children}
        </main>
      </div>
      {overlays}
    </>
  )
}
