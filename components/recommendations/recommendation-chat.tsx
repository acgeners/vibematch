"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ExternalLink, ImageOff, Loader2, LogOut, MessageCircle, Send, Sparkles, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { cn, titleToSlug } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { sendChatMessageAction, getChatAction } from "@/server/actions/recommendation-chat"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { setActiveChat, clearActiveChat, readActiveChat } from "@/lib/active-chat"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import type {
  ChatEvaluationSnapshot,
  ChatMessage,
  ChatRecommendationSnapshot,
} from "@/lib/ai-recommendation/types"

const STARTERS = [
  "Me recomenda uma próxima leitura",
  "Vale a pena ler uma obra específica?",
  "Me ajuda a desempatar entre algumas obras",
]

// Aberturas da IA (estáticas, sem custo de token): o chat já começa com a IA
// "falando" em vez de um placeholder vazio, apresentando as 3 capacidades.
// Variações pra não soar robótico — uma é sorteada no mount (ver useState +
// useEffect abaixo, que evita mismatch de hidratação). Texto puro, sem markdown.
const AI_GREETINGS = [
  "Oi! 👋 Posso te ajudar de três jeitos:\n\n📖 Recomendar uma próxima leitura do seu catálogo\n🔎 Avaliar se uma obra específica vale a pena pra você\n⚖️ Desempatar entre algumas obras que você está na dúvida\n\nO que rola hoje? Pode escrever do seu jeito ou clicar numa sugestão abaixo.",
  "E aí! 👋 Bora achar algo bom? Posso 📖 recomendar sua próxima leitura, 🔎 avaliar se uma obra específica vale a pena pro seu gosto, ou ⚖️ te ajudar a desempatar entre algumas que você tá na dúvida. Qual desses cai melhor agora?",
  "Oi! 👋 Tô aqui pra três coisas: garimpar sua próxima leitura 📖, dizer se uma obra vale a pena pra você 🔎, ou desempatar entre algumas que você não consegue decidir ⚖️. Por onde começamos?",
] as const

// Aviso imediato (client, 0 token) mostrado como balão da IA assim que o usuário
// envia, antes da resposta real chegar — feedback melhor que só um spinner.
const PENDING_ACKS = [
  "Beleza, deixa comigo! 👀 Já te respondo…",
  "Boa — já tô analisando isso pra você…",
  "Entendi! Deixa eu olhar com calma um segundo…",
  "Show, garimpando isso agora…",
] as const

// Helper de aleatoriedade fora do componente (mantém o corpo do componente puro
// pro lint react-hooks/purity; a impureza fica isolada aqui).
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Título curto da conversa (1ª mensagem do usuário) pro preview do FAB. */
function deriveChatTitle(messages: ChatMessage[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user")?.content?.trim()
  if (!firstUser) return undefined
  const oneLine = firstUser.replace(/\s+/g, " ")
  return oneLine.length > 60 ? `${oneLine.slice(0, 59).trimEnd()}…` : oneLine
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
}

export function RecommendationChat({
  initialSlug = null,
  initialMessages = [],
}: RecommendationChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [slug, setSlug] = useState<string | null>(initialSlug)
  const [input, setInput] = useState("")
  // Loading manual (em vez de useTransition) pra NÃO segurar a navegação atrás
  // da transition pendente — assim dá pra sair da página enquanto a IA "pensa".
  const [isPending, setIsPending] = useState(false)
  const [pendingAck, setPendingAck] = useState<string>(PENDING_ACKS[0])
  const [resuming, setResuming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Sorteia a saudação só no client (depois da hidratação) pra não dar mismatch
  // SSR vs client. Começa no índice 0 (igual ao SSR) e varia uma vez no mount —
  // é exatamente o caso de randomização pós-hidratação que justifica o setState
  // no effect.
  const [greetingIdx, setGreetingIdx] = useState(0)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- randomização única pós-hidratação
    setGreetingIdx(Math.floor(Math.random() * AI_GREETINGS.length))
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, isPending])

  // Marca a conversa como "ativa" (pro FAB de retomar em outras páginas) sempre
  // que ela já foi persistida e tem mensagens. clearActiveChat é feito no
  // "Encerrar" e no "x" do FAB.
  useEffect(() => {
    if (slug && slug !== "unsaved" && messages.length > 0) {
      setActiveChat({
        slug,
        updatedAt: new Date().toISOString(),
        title: deriveChatTitle(messages),
      })
    }
  }, [slug, messages])

  // Retoma a conversa ativa quando o chat é montado "limpo" (ex.: embutido em
  // /recommendations). Assim a conversa persiste ao sair e voltar — só some
  // quando o usuário encerra de propósito. Não roda na rota [slug] (já tem
  // initialSlug) nem quando já vieram mensagens.
  useEffect(() => {
    if (initialSlug || initialMessages.length > 0) return
    const active = readActiveChat()
    if (!active?.slug) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading de fetch pós-mount
    setResuming(true)
    getChatAction(active.slug)
      .then((chat) => {
        if (cancelled) return
        if (chat && chat.messages.length > 0) {
          setSlug(chat.slug)
          setMessages(chat.messages)
        } else {
          clearActiveChat()
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setResuming(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no mount
  }, [])

  const confirmCost = useCostConfirm()
  // Custo do chat: confirmado UMA vez por entrada na conversa (escolha do usuário),
  // porque um popup por mensagem mataria o fluxo e o custo por msg varia (a IA
  // decide se busca/compara obras). O ref reseta ao remontar = 1× por entrada.
  const costConfirmedRef = useRef(false)

  const runTurn = (opts: { userText?: string; forceRecommend?: boolean }) => {
    if (isPending) return
    const trimmed = opts.userText?.trim() ?? ""
    if (!trimmed && !opts.forceRecommend) return

    void (async () => {
      if (!costConfirmedRef.current) {
        const ok = await confirmCost({
          action: "chat_message",
          title: "Conversar com o consultor por IA?",
          description:
            "Cada mensagem chama a Claude (~$0,03) e conta no limite de 60/dia. Se eu buscar ou comparar obras, a mensagem custa um pouco mais. Confirmo só uma vez por conversa.",
          confirmLabel: "Começar a conversar",
        })
        if (!ok) return
        costConfirmedRef.current = true
      }

      if (trimmed) {
        setMessages((prev) => [...prev, { role: "user", content: trimmed }])
        setInput("")
      }

      // Feedback imediato: a IA "responde" na hora com uma frase de aviso antes de
      // ir pensar (em vez de só um spinner).
      setPendingAck(pickRandom(PENDING_ACKS))
      setIsPending(true)

      try {
        const res = await sendChatMessageAction({
          slug,
          userText: trimmed || undefined,
          forceRecommend: opts.forceRecommend,
        })
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
      } finally {
        setIsPending(false)
      }
    })()
  }

  const send = (text: string) => runTurn({ userText: text })
  const forceRecommend = () => runTurn({ forceRecommend: true })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const isEmpty = messages.length === 0
  // O botão de pular o briefing só faz sentido depois que já houve conversa.
  const canForceRecommend = !isEmpty && !isPending

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm shadow-primary/5">
      {/* Barra de título: deixa claro que é a janela de chat */}
      <div className="flex items-center gap-2.5 border-b bg-gradient-to-r from-primary/10 to-transparent px-4 py-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Conversar com a IA</p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Recomenda do seu catálogo de descoberta
          </p>
        </div>
        {!isEmpty && (
          <Link
            href="/recommendations"
            onClick={() => clearActiveChat()}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
            title="Encerrar esta conversa"
          >
            <LogOut className="h-3.5 w-3.5" />
            Encerrar
          </Link>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto bg-background/40 p-4"
      >
        {resuming ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Retomando sua conversa…
          </div>
        ) : isEmpty ? (
          <div className="space-y-3">
            <MessageBubble message={{ role: "assistant", content: AI_GREETINGS[greetingIdx] }} />
            <div className="flex flex-wrap gap-1.5 pl-1">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={isPending}
                  className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const isLast = i === messages.length - 1
            const showSuggestions =
              isLast &&
              m.role === "assistant" &&
              !isPending &&
              (m.suggestions?.length ?? 0) > 0
            return (
              <div key={i} className="space-y-2">
                <MessageBubble message={m} />
                {showSuggestions && (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {m.suggestions!.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        disabled={isPending}
                        className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}

        {isPending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] space-y-1.5">
              <div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm leading-relaxed text-foreground">
                {pendingAck}
              </div>
              <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>analisando…</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t bg-card/80 p-3">
        {canForceRecommend && (
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              onClick={forceRecommend}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Wand2 className="h-3 w-3" />
              Pode recomendar agora
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escreva sua mensagem… (Enter envia, Shift+Enter quebra linha)"
            rows={1}
            className="max-h-32 min-h-[40px] resize-none text-sm"
            disabled={isPending || resuming}
          />
          <Button
            onClick={() => send(input)}
            disabled={isPending || resuming || !input.trim()}
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
        {message.evaluation && <EvaluationCard snapshot={message.evaluation} />}
      </div>
    </div>
  )
}

function EvaluationCard({ snapshot }: { snapshot: ChatEvaluationSnapshot }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-tight">{snapshot.title}</p>
        {snapshot.confidence != null && (
          <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            confiança {Math.round(snapshot.confidence * 100)}%
          </span>
        )}
      </div>
      {snapshot.summary && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{snapshot.summary}</p>
      )}
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {snapshot.scores.map((s) => {
          const info = CRITERIA_INFO[s.criterionSlug]
          return (
            <div
              key={s.criterionSlug}
              className="flex items-center justify-between gap-2 rounded border bg-background/40 px-2 py-1"
              title={s.justification ?? undefined}
            >
              <span className="truncate text-[11px]">
                {info?.emoji} {info?.name ?? s.criterionSlug}
              </span>
              <span className="shrink-0 text-xs font-semibold tabular-nums">
                {s.score != null ? s.score.toFixed(1) : "—"}
              </span>
            </div>
          )
        })}
      </div>
      <Link
        href={snapshot.reviewHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        Revisar e salvar as notas
        <ExternalLink className="h-3 w-3" />
      </Link>
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
              <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                #{i + 1}
              </span>
              <div className="relative h-20 w-14 overflow-hidden rounded border bg-muted">
                {item.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getCoverImageSrc(item.coverUrl)}
                    alt={item.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
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
