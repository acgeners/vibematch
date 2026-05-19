"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"

function findScrollContainer(start: HTMLElement | null): HTMLElement | Window {
  let node: HTMLElement | null = start?.parentElement ?? null
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    const overflowY = style.overflowY
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return window
}

export function ScrollToTop({ threshold = 320 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLElement | Window | null>(null)

  useEffect(() => {
    const container = findScrollContainer(anchorRef.current)
    containerRef.current = container

    const getScrollTop = () =>
      container instanceof Window ? container.scrollY : container.scrollTop

    const onScroll = () => setVisible(getScrollTop() > threshold)
    onScroll()
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [threshold])

  const handleClick = () => {
    const container = containerRef.current
    if (!container) return
    if (container instanceof Window) {
      container.scrollTo({ top: 0, behavior: "smooth" })
    } else {
      container.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  return (
    <button
      ref={anchorRef}
      type="button"
      aria-label="Voltar ao topo"
      onClick={handleClick}
      className={cn(
        "fixed bottom-6 right-6 z-40 grid size-11 place-items-center rounded-full",
        "bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-1 ring-white/15",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        visible
          ? "pointer-events-auto opacity-100 translate-y-0"
          : "pointer-events-none opacity-0 translate-y-2"
      )}
    >
      <ArrowUp className="size-5" />
    </button>
  )
}
