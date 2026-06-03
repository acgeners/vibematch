"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ExternalLink, ImageOff, Loader2, Send, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { sendChatMessageAction } from "@/server/actions/recommendation-chat"
import type { ChatMessage, ChatRecommendationSnapshot } from "@/lib/ai-recommendation/types"

const STARTERS = [
  "Quero algo leve hoje, sem drama pesado",
  "No mood de drama denso e político",
  "Romance slow-burn com FL de agência forte",
  "Algo curto pra terminar rápido",
  "Me surpreende com algo fora do meu padrão",
]

interface ChatOpener {
  greeting: string
  chips: string[]
}

function alignmentColor(score: number): string {
  if (score >= 90) return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
  if (score >= 70) return "bg-lime-500/15 text-lime-700 border-lime-500/40 dark:text-lime-300"
  if (score >= 50) return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
  if (score >= 30) return "bg-orange-500/15 text-orange-700 border-orange-500/40 dark:text-orange-300"
  return "bg-rose-500/15 text-rose-700 border-rose-500/40 dark:text-rose-300"
}

interface RecommendationChatProps {
  initialSlug?: string | null
  initialMessages?: ChatMessage[]
  /** Abertura proativa montada do perfil (estado vazio). Ausente → fallback estático. */
  opener?: ChatOpener
}

export function RecommendationChat({
  initialSlug = null,
  initialMessages = [],
  opener,
}: RecommendationChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [slug, setSlug] = useState<string | null>(initialSlug)
  const [input, setInput] = useState("")
  const [isPending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, isPending])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isPending) return
    const userMessage: ChatMessage = { role: "user", content: trimmed }
    setMessages((prev) => [...prev, userMessage])
    setInput("")

    startTransition(async () => {
      try {
        const res = await sendChatMessageAction({ slug, userText: trimmed })
        if (res.error) {
          toast.error(res.error)
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `⚠️ ${res.error}` },
          ])
          return
        }
        if (res.data) {
          if (!slug && res.data.slug !== "unsaved") {
            setSlug(res.data.slug)
            // Atualiza a URL sem remontar — reload cai na rota [slug] e
            // recarrega a conversa persistida.
            window.history.replaceState(null, "", `/recommendations/chat/${res.data.slug}`)
          }
          setMessages((prev) => [...prev, res.data!.assistantMessage])
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem")
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const isEmpty = messages.length === 0
  const chips = opener?.chips ?? STARTERS

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[420px] flex-col rounded-lg border bg-card/30">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {isEmpty ? (
          opener ? (
            // Abertura proativa: a IA "fala primeiro" com uma saudação ancorada no
            // perfil, seguida de chips personalizados pra destravar a conversa.
            <div className="space-y-4">
              <MessageBubble message={{ role: "assistant", content: opener.greeting }} />
              <div className="flex flex-wrap gap-1.5 pl-1">
                {chips.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={isPending}
                    className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-full bg-primary/10 p-3">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Bate um papo pra eu te recomendar</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Me conta o mood de hoje (tom, gênero, tamanho, o que evitar). Eu pergunto o que
                  faltar e garimpo obras do seu catálogo de descoberta.
                </p>
              </div>
              <div className="flex max-w-md flex-wrap justify-center gap-1.5">
                {chips.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={isPending}
                    className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          messages.map((m, i) => <MessageBubble key={i} message={m} />)
        )}

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Pensando…</span>
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escreva sua mensagem… (Enter envia, Shift+Enter quebra linha)"
            rows={1}
            className="max-h-32 min-h-[40px] resize-none text-sm"
            disabled={isPending}
          />
          <Button
            onClick={() => send(input)}
            disabled={isPending || !input.trim()}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser && "items-end")}>
        {message.content && (
          <div
            className={cn(
              "whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
              isUser
                ? "rounded-br-sm bg-primary text-primary-foreground"
                : "rounded-bl-sm bg-muted text-foreground",
            )}
          >
            {message.content}
          </div>
        )}
        {message.recommendation && <RecommendationCards snapshot={message.recommendation} />}
      </div>
    </div>
  )
}

function RecommendationCards({ snapshot }: { snapshot: ChatRecommendationSnapshot }) {
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {snapshot.items.map((item, i) => (
          <div
            key={item.work_id}
            className="flex gap-2.5 rounded-lg border bg-card/60 p-2.5 transition hover:bg-card"
          >
            <div className="flex flex-col items-center gap-1 pt-0.5">
              <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                #{i + 1}
              </span>
              <div className="relative h-20 w-14 overflow-hidden rounded border bg-muted">
                {item.coverUrl ? (
                  <CoverImage
                    url={item.coverUrl}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-4 w-4" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/titles/${titleToSlug(item.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-xs font-medium leading-tight hover:underline"
                >
                  {item.title}
                  <ExternalLink className="ml-1 inline h-3 w-3 text-muted-foreground" />
                </Link>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                    alignmentColor(item.alignment_score),
                  )}
                >
                  {Math.round(item.alignment_score)}
                </span>
              </div>
              <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                {item.justification}
              </p>
              {item.top_match_factors.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.top_match_factors.slice(0, 4).map((f) => (
                    <Badge key={f} variant="outline" className="text-[9px] font-normal">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {snapshot.runSlug && snapshot.runSlug !== "unsaved" && (
        <Link
          href={`/recommendations/${snapshot.runSlug}`}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Ver execução completa
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}
