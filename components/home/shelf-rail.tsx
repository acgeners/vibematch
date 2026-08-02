"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * O trilho da prateleira: rola por PÁGINAS, com setas, sem barra de rolagem à vista.
 *
 * A barra horizontal foi trocada por setas porque numa vitrine ela é ruído — aparece por cima
 * das capas no macOS e some no Windows quando o mouse não está sobre a área, então a lista
 * parece cortada sem explicação. As setas dizem que há mais coisa e como chegar lá.
 *
 * A rolagem continua existindo (trackpad e swipe seguem funcionando, e o teclado navega pelos
 * links normalmente) — o que sumiu foi só a barra. `scroll-snap` alinha o começo do card
 * depois de cada salto, então nunca sobra meio card na borda esquerda.
 */
export function ShelfRail({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    // 2px de folga: larguras fracionárias fazem scrollLeft nunca bater exatamente no limite.
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    sync()
    const el = ref.current
    if (!el) return
    // ResizeObserver e não só window.resize: a largura do trilho muda quando a sidebar
    // recolhe, sem a janela mudar de tamanho.
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sync])

  const page = (dir: -1 | 1) => {
    const el = ref.current
    if (!el) return
    // Uma "página" é quase a largura visível — os ~12% que sobram mantêm um card de âncora
    // à vista, senão o salto desorienta.
    el.scrollBy({ left: dir * el.clientWidth * 0.88, behavior: "smooth" })
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={sync}
        aria-label={ariaLabel}
        className="[-ms-overflow-style:none] [scrollbar-width:none] -mx-1 overflow-x-auto scroll-smooth px-1 pb-1 [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {children}
      </div>

      <RailButton side="left" disabled={!canLeft} onClick={() => page(-1)} />
      <RailButton side="right" disabled={!canRight} onClick={() => page(1)} />
    </div>
  )
}

function RailButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right"
  disabled: boolean
  onClick: () => void
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Anteriores" : "Próximas"}
      // `hidden` no mobile: lá o swipe é o gesto natural e as setas roubariam área de capa.
      className={cn(
        "absolute top-[38%] hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-border/80 bg-background/90 text-foreground shadow-lg backdrop-blur transition-opacity md:grid",
        side === "left" ? "-left-3" : "-right-3",
        disabled ? "pointer-events-none opacity-0" : "opacity-100 hover:bg-accent",
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}
