"use client"

import { useEffect, useState } from "react"
import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Colapso de UM card (item) dentro de um tópico. O cabeçalho (ícone + título + ⓘ
// + chips + descrição) é renderizado no servidor e chega como `headerInner`;
// aqui só somamos a seta de expandir/colapsar e animamos o corpo. Estado
// lembrado por card (localStorage). Começa expandido. O ⓘ do cabeçalho é um
// botão à parte da seta, então continua funcionando sem disparar o colapso.
export function CollapsibleCardInner({
  storageKey,
  defaultOpen = true,
  forceOpen = false,
  headerInner,
  children,
}: {
  /** Chave do localStorage — estado lembrado por card e por console. */
  storageKey: string
  defaultOpen?: boolean
  /** Deep-link `?open=` — força o card aberto, ignorando o estado lembrado. */
  forceOpen?: boolean
  headerInner: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen)
  // Anima só depois do 1º commit, pra a sincronização inicial (localStorage) não
  // disparar animação de abre/fecha no carregamento.
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (forceOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true)
    } else {
      try {
        // Hidratação a partir do localStorage no mount — intencional.
        const stored = window.localStorage.getItem(storageKey)
        if (stored === "1") setOpen(true)
        else if (stored === "0") setOpen(false)
      } catch {}
    }
    const raf = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(raf)
  }, [storageKey, forceOpen])

  const toggle = () =>
    setOpen((o) => {
      const next = !o
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0")
      } catch {}
      return next
    })

  // O cabeçalho INTEIRO expande/recolhe — só a setinha era pequena demais pra
  // mirar. `data-no-toggle` (no ⓘ e nos botões Desfazer/Lida, marcados em
  // settings-card) blinda os controles interativos: clique neles não colapsa.
  const onHeaderClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) return
    toggle()
  }
  const onHeaderKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) return
    e.preventDefault() // Space rolaria a página
    toggle()
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onHeaderClick}
        onKeyDown={onHeaderKey}
        className="group/hd flex cursor-pointer items-start gap-3.5 rounded-xl transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {headerInner}
        <span
          aria-hidden
          className="grid size-8 shrink-0 self-start place-items-center rounded-lg border border-border/60 bg-card/60 text-muted-foreground transition-colors group-hover/hd:bg-muted/60 group-hover/hd:text-foreground"
        >
          <ChevronDown
            className={cn(
              "size-4",
              animate && "transition-transform duration-300",
              open ? "" : "-rotate-90",
            )}
          />
        </span>
      </div>
      <div
        className={cn(
          "grid",
          animate && "transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="pt-4">{children}</div>
        </div>
      </div>
    </>
  )
}
