"use client"

import { useState } from "react"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Expande/colapsa de uma vez todos os <details> de subgrupo dentro de `targetId`.
 * Opera direto no atributo `open` dos elementos nativos (server-rendered) — não
 * precisa içar o estado das tags pro cliente.
 */
export function TagsExpandAll({ targetId }: { targetId: string }) {
  const [allOpen, setAllOpen] = useState(false)

  function toggle() {
    const next = !allOpen
    const root = document.getElementById(targetId)
    root?.querySelectorAll("details").forEach((d) => {
      ;(d as HTMLDetailsElement).open = next
    })
    setAllOpen(next)
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} className="h-7 gap-1.5 px-2 text-xs">
      {allOpen ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
      {allOpen ? "Colapsar todos" : "Expandir todos"}
    </Button>
  )
}
