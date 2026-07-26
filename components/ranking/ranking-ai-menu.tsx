"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { ChevronDown, MessageCircle, RotateCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RecommendDialog } from "@/components/recommendations/recommend-dialog"
import { readActiveChat, subscribeActiveChat } from "@/lib/active-chat"
import { useChromeRefresh } from "@/lib/use-refresh"
import { getStaleAlignmentCountAction } from "@/server/actions/recommendations"

interface RankingAiMenuProps {
  /** Gate de plano — Recomendar/Conversar são features Pago (`smart_shortlist`). */
  isPaid: boolean
  /** Nº de vereditos IA desatualizados; > 0 mostra o item + o pontinho âmbar no botão. */
  staleAlignmentCount: number
}

const PAID_HINT =
  "Feature do plano Pago. No Free o ranking usa Nota Prevista × alinhamento."

function PagoBadge() {
  return (
    <span className="ml-auto rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Pago
    </span>
  )
}

/**
 * Menu "IA" do topo do /ranking: agrupa tudo que usa LLM — Recomendar (diálogo),
 * Conversar (chat) e o alerta de Veredito desatualizado. O sorteio "Escolhe por
 * mim" NÃO entra aqui (não é LLM). O pontinho âmbar sinaliza veredito pendente sem
 * abrir o menu. Recomendar roda via RecommendDialog controlado (hideTrigger).
 */
export function RankingAiMenu({ isPaid, staleAlignmentCount }: RankingAiMenuProps) {
  const [recommendOpen, setRecommendOpen] = useState(false)
  const active = useSyncExternalStore(subscribeActiveChat, readActiveChat, () => null)
  const chatHref = active?.slug ? `/recommendations/chat/${active.slug}` : "/recommendations/chat"

  // Contador VIVO. A prop é a fonte na renderização do servidor; daí em diante o menu
  // se atualiza sozinho pra não exigir reload (era prop estática — resolveu o veredito
  // e o número só mudava recarregando). Dois gatilhos:
  //  • mesma aba → refreshChrome(null) de qualquer re-rank dispara o re-fetch;
  //  • outra aba (fluxo do link "abrir em nova aba") → o event-bus não cruza abas,
  //    então re-busca ao VOLTAR O FOCO pra esta aba.
  const [staleCount, setStaleCount] = useState(staleAlignmentCount)
  // Sincroniza a prop SEM effect (evita cascading-render): "ajuste durante o render",
  // semeado com o valor inicial pra não disparar na hidratação. Só sobrescreve quando a
  // prop REALMENTE muda; entre renders com a mesma prop, o valor re-buscado sobrevive.
  const [prevProp, setPrevProp] = useState(staleAlignmentCount)
  if (staleAlignmentCount !== prevProp) {
    setPrevProp(staleAlignmentCount)
    setStaleCount(staleAlignmentCount)
  }

  const lastFetch = useRef(0)
  const refetch = useCallback(() => {
    const now = Date.now()
    if (now - lastFetch.current < 3000) return // throttle: foco/blur pode disparar em rajada
    lastFetch.current = now
    void getStaleAlignmentCountAction()
      .then((n) => setStaleCount(n))
      .catch(() => {})
  }, [])

  useChromeRefresh(useCallback((patch) => { if (!patch) refetch() }, [refetch]))

  useEffect(() => {
    const onFocus = () => refetch()
    const onVisible = () => { if (document.visibilityState === "visible") refetch() }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refetch])

  const hasStale = staleCount > 0

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="relative h-9 gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            IA
            <ChevronDown className="h-3.5 w-3.5 opacity-80" />
            {hasStale && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-2.5 rounded-full bg-amber-500 ring-2 ring-background"
              />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {/* Recomendar — abre o RecommendDialog controlado abaixo */}
          <DropdownMenuItem
            disabled={!isPaid}
            title={!isPaid ? PAID_HINT : undefined}
            onSelect={() => {
              if (isPaid) setRecommendOpen(true)
            }}
            className="gap-2.5 py-2"
          >
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">Recomendar do ranking</span>
              <span className="text-xs text-muted-foreground">Monta uma shortlist a partir dos filtros.</span>
            </span>
            {!isPaid && <PagoBadge />}
          </DropdownMenuItem>

          {/* Conversar — link pro chat (retoma a conversa ativa se houver) */}
          {isPaid ? (
            <DropdownMenuItem asChild className="gap-2.5 py-2">
              <Link href={chatHref}>
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">Conversar com a IA</span>
                  <span className="text-xs text-muted-foreground">Refina a recomendação num chat.</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled title={PAID_HINT} className="gap-2.5 py-2">
              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Conversar com a IA</span>
                <span className="text-xs text-muted-foreground">Refina a recomendação num chat.</span>
              </span>
              <PagoBadge />
            </DropdownMenuItem>
          )}

          {/* Veredito IA desatualizado — só aparece quando há pendências.
              Abre em nova aba via window.open: um <Link target="_blank"> dentro do
              DropdownMenuItem não abre confiável, porque o Radix fecha/desmonta o menu
              no onSelect e cancela a navegação nativa da âncora. URL relativa de
              propósito — resolve na origem atual (não fixar host/porta). */}
          {hasStale && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  window.open("/ai-evaluation?tab=ia-rk", "_blank", "noopener,noreferrer")
                }
                className="gap-2.5 py-2"
              >
                <RotateCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Veredito IA · {staleCount} desatualizados
                  </span>
                  <span className="text-xs text-muted-foreground">Obras editadas depois da última análise.</span>
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RecommendDialog
        context="ranking"
        isPaid={isPaid}
        hideTrigger
        open={recommendOpen}
        onOpenChange={setRecommendOpen}
      />
    </>
  )
}
