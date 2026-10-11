"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Portão de conteúdo adulto (18+) na página da obra. Só entra em ação quando o
 * usuário ligou "ocultar conteúdo 18+" nas preferências E a obra é 18+
 * (`works.is_adult`, decidido no server: tag forte, override e estado de edição — a nota
 * adult_content não entra no gate). Não some a obra (link direto não
 * quebra): desfoca a capa + o conteúdo e pede confirmação pra revelar (só nesta
 * sessão). Quando `gated` é false, é um passthrough sem custo de layout.
 */
export function AdultGate({
  gated,
  children,
  variant = "work",
  normalHref,
}: {
  gated: boolean
  children: ReactNode
  /**
   * `r18-edition`: obra `mixed` aberta na versão R18 por quem oculta 18+ (fase 2). O texto diz que é
   * a EDIÇÃO R18 e oferece voltar à normal; revelar vale só nesta visita e não muda a preferência.
   */
  variant?: "work" | "r18-edition"
  normalHref?: string
}) {
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
          <p className="text-base font-bold text-foreground">
            {variant === "r18-edition" ? "Versão R18 desta obra" : "Conteúdo adulto (18+)"}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            {variant === "r18-edition"
              ? "Você optou por ocultar conteúdo 18+. Esta é a versão R18 — mostrar vale só agora e não muda a sua preferência."
              : "Você optou por ocultar obras 18+ nas preferências. A capa e o conteúdo desta obra ficam desfocados até você revelar."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={() => setRevealed(true)}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Mostrar assim mesmo
            </Button>
            {variant === "r18-edition" && normalHref ? (
              <Button asChild variant="ghost" size="sm">
                <a href={normalHref}>Voltar à versão normal</a>
              </Button>
            ) : (
              <Button asChild variant="ghost" size="sm">
                <a href="/preferences?g=conteudo">Ajustar preferências</a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
