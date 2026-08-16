"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Os dois gatilhos de colapso do cabeçalho de um painel: o ícone e o título.
 *
 * Eles existem em pares e a régua de acessibilidade entre eles é o que importa —
 * por isso moram aqui, e não copiados em cada painel:
 *
 * 🔴 **Só o TÍTULO entra na ordem de tabulação.** O ícone repete a mesma ação, logo ao
 * lado; se os dois fossem `<button>`, quem navega por teclado ouviria "ocultar filtros"
 * duas vezes seguidas antes de alcançar qualquer filtro. O ícone fica como alvo de
 * mouse (`role="presentation"`), e quem carrega `aria-expanded` é o título.
 *
 * O layout NÃO é prescrito aqui de propósito: os painéis têm anatomias diferentes (no
 * /ranking e no /catalog o ícone e o título são separados por um bloco de badges; no
 * /curation/works são irmãos diretos, num cabeçalho compacto). Cada um posiciona; o que
 * se compartilha é a regra.
 */
export function CollapseIconTrigger({
  onToggle,
  className,
  children,
}: {
  onToggle: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="presentation"
      onClick={onToggle}
      className={cn("cursor-pointer transition-colors", className)}
    >
      {children}
    </div>
  )
}

export function CollapseTitleTrigger({
  collapsed,
  onToggle,
  className,
  children,
}: {
  collapsed: boolean
  onToggle: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? "Mostrar filtros" : "Ocultar filtros"}
      className={cn(
        "rounded transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      {children}
    </button>
  )
}
