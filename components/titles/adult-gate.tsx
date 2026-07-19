"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Portão de conteúdo adulto (18+) na página da obra. Só entra em ação quando o
 * usuário ligou "ocultar conteúdo 18+" nas preferências E a obra é 18+
 * (adult_content >= 7 — decidido no server). Não some a obra (link direto não
 * quebra): desfoca a capa + o conteúdo e pede confirmação pra revelar (só nesta
 * sessão). Quando `gated` é false, é um passthrough sem custo de layout.
 */
export function AdultGate({ gated, children }: { gated: boolean; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)

  if (!gated || revealed) return <>{children}</>

  return (
    <div className="relative">
      {/* Conteúdo desfocado e inerte (sem foco/clique) até revelar. */}
      <div aria-hidden="true" inert className="pointer-events-none select-none blur-xl">
        {children}
      </div>

      {/* Portão — clicável por cima do conteúdo bloqueado. */}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-4 pt-8 sm:pt-16">
        <div className="pointer-events-auto w-full max-w-md rounded-xl border border-red-500/40 bg-card/95 p-5 text-center shadow-xl backdrop-blur-sm">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-300">
            <ShieldAlert className="size-5" />
          </div>
          <p className="text-base font-bold text-foreground">Conteúdo adulto (18+)</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            Você optou por ocultar obras 18+ nas preferências. A capa e o conteúdo desta obra ficam
            desfocados até você revelar.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={() => setRevealed(true)}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Mostrar assim mesmo
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href="/preferencias?g=conteudo">Ajustar preferências</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
