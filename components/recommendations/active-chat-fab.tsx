"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSyncExternalStore } from "react"
import { MessageCircle, X } from "lucide-react"
import {
  clearActiveChat,
  readActiveChat,
  subscribeActiveChat,
} from "@/lib/active-chat"

/**
 * Ícone flutuante (canto inferior direito) que aparece em qualquer página
 * quando há uma conversa de chat em andamento e o usuário NÃO está na página do
 * chat. Clicar volta direto pra conversa; o "x" fecha (dispensa o indicador).
 */
export function ActiveChatFab() {
  const pathname = usePathname()
  const active = useSyncExternalStore(subscribeActiveChat, readActiveChat, () => null)

  // Não aparece na própria página do chat nem na /recommendations (onde o chat
  // já fica embutido).
  const path = pathname ?? ""
  const hideHere = path === "/recommendations" || path.startsWith("/recommendations/chat")
  if (!active || hideHere) return null

  return (
    <div className="group fixed bottom-20 right-4 z-50 md:bottom-6 md:right-6">
      <div className="flex items-center rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-lg shadow-primary/30">
        <Link
          href={`/recommendations/chat/${active.slug}`}
          className="flex items-center rounded-l-full py-2.5 pl-3 pr-1 transition hover:brightness-110"
          title={active.title ? `Conversa: ${active.title}` : "Voltar pra conversa com a IA"}
          aria-label="Voltar pra conversa com a IA"
        >
          <MessageCircle className="h-5 w-5 shrink-0" />
          {/* Título só no hover — expande pra esquerda. */}
          <span className="flex max-w-0 flex-col overflow-hidden pl-0 leading-tight opacity-0 transition-all duration-200 group-hover:max-w-[12rem] group-hover:pl-2 group-hover:opacity-100">
            <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide opacity-80">
              Conversa
            </span>
            {active.title && (
              <span className="truncate whitespace-nowrap text-xs font-medium">
                {active.title}
              </span>
            )}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => clearActiveChat()}
          className="mr-1 flex h-7 w-7 items-center justify-center rounded-full text-primary-foreground/80 transition hover:bg-black/15 hover:text-primary-foreground"
          title="Encerrar conversa"
          aria-label="Encerrar conversa"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
