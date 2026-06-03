"use client"

import Link from "next/link"
import { useSyncExternalStore } from "react"
import { MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { readActiveChat, subscribeActiveChat } from "@/lib/active-chat"

interface ChatRecommendButtonProps {
  variant?: "default" | "secondary" | "outline"
  size?: "sm" | "default" | "lg"
  label?: string
  /** Quando false, o gatilho fica desabilitado com selo "Pago". */
  isPaid?: boolean
}

export function ChatRecommendButton({
  variant = "outline",
  size = "sm",
  label = "Conversar com a IA",
  isPaid = true,
}: ChatRecommendButtonProps) {
  if (!isPaid) {
    return (
      <Button
        variant={variant}
        size={size}
        className="gap-1.5"
        disabled
        title="Chat de recomendação é uma feature do plano Pago. No Free use o formulário 'Recomendar com IA'."
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {label}
        <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pago
        </span>
      </Button>
    )
  }

  return <ChatRecommendLink variant={variant} size={size} label={label} />
}

function ChatRecommendLink({
  variant,
  size,
  label,
}: Required<Pick<ChatRecommendButtonProps, "variant" | "size" | "label">>) {
  // Retoma a conversa ativa (se houver) em vez de sempre abrir uma nova.
  const active = useSyncExternalStore(subscribeActiveChat, readActiveChat, () => null)
  const href = active?.slug ? `/recommendations/chat/${active.slug}` : "/recommendations/chat"

  return (
    <Button variant={variant} size={size} className="gap-1.5" asChild>
      <Link href={href}>
        <MessageCircle className="h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  )
}
