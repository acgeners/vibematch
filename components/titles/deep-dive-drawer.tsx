"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Loader2, Sparkles, RefreshCw, History } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { deepDiveWorkAction } from "@/server/actions/deep-dive"
import { DeepDiveResultView } from "./deep-dive/deep-dive-result-view"
import { CostSummary } from "@/components/cost/cost-summary"
import { previewCost } from "@/lib/cost-preview/catalog"
import type { DeepDiveResultRow } from "@/lib/ai-recommendation/types"

const LOADING_STEPS = [
  "Carregando perfil…",
  "Analisando obra alvo…",
  "Comparando com biblioteca…",
  "Sintetizando reviews…",
  "Pensando profundamente…",
  "Gerando recomendação…",
]

const MOOD_EXAMPLES = [
  "Quero algo curto pra fim de semana",
  "Tô no mood de drama denso",
  "Algo leve, sem tragédia",
  "Romance slow-burn",
  "Preciso de algo pra grudar agora",
]

interface DeepDiveDrawerProps {
  workId: string
  workTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDive: DeepDiveResultRow | null
  /** Modo ao abrir: "result" mostra a última análise (default); "form" abre direto
   *  no formulário de nova análise mesmo havendo análise anterior. */
  startView?: "result" | "form"
}

type DrawerState = "idle" | "loading" | "result" | "error"

export function DeepDiveDrawer({
  workId,
  workTitle,
  open,
  onOpenChange,
  initialDive,
  startView = "result",
}: DeepDiveDrawerProps) {
  // Estado local sobrevive aos re-renders do parent. Após `revalidatePath`,
  // o parent passa um novo `initialDive` — mas a essa altura `current` já é
  // a run mais nova (a que disparou o revalidate), então sincronizar seria
  // redundante e causa o anti-pattern de "derived state from props".
  const [current, setCurrent] = useState<DeepDiveResultRow | null>(initialDive)
  const [state, setState] = useState<DrawerState>(initialDive ? "result" : "idle")
  const [mood, setMood] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loadingStepIdx, setLoadingStepIdx] = useState(0)
  const [isPending, startTransition] = useTransition()

  // Ao abrir (transição fechado→aberto), escolhe a tela inicial conforme `startView`.
  // Só age na abertura — não interfere quando `current` muda durante a sessão.
  const prevOpenRef = useRef(open)
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current
    prevOpenRef.current = open
    if (!justOpened) return
    setState(startView === "form" ? "idle" : current ? "result" : "idle")
  }, [open, startView, current])

  useEffect(() => {
    if (!isPending) return
    const interval = setInterval(() => {
      setLoadingStepIdx((i) => (i + 1) % LOADING_STEPS.length)
    }, 4000)
    return () => {
      clearInterval(interval)
      setLoadingStepIdx(0)
    }
  }, [isPending])

  const handleAnalyze = () => {
    setErrorMsg(null)
    setState("loading")
    startTransition(async () => {
      const result = await deepDiveWorkAction(workId, mood.trim() || null)
      if (result.error || !result.data) {
        setErrorMsg(result.error ?? "Falha ao gerar Deep Dive.")
        setState("error")
        toast.error(result.error ?? "Falha ao gerar Deep Dive.")
        return
      }
      setCurrent(result.data)
      setState("result")
      setMood("")
      toast.success(`Deep Dive concluído — match ${Math.round(result.data.match_score ?? 0)}/100.`)
    })
  }

  const handleNewAnalysis = () => {
    setState("idle")
    setErrorMsg(null)
  }

  const appendMoodExample = (example: string) => {
    setMood((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return example
      if (trimmed.toLowerCase().includes(example.toLowerCase())) return prev
      const sep = /[.!?…]$/.test(trimmed) ? " " : ". "
      return `${trimmed}${sep}${example}`
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" />
            Consultor IA — Deep Dive
          </DialogTitle>
          <DialogDescription className="text-xs">
            Análise profunda de <span className="font-medium text-foreground">{workTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {state === "idle" && (
            <IdleForm
              mood={mood}
              onMoodChange={setMood}
              onSubmit={handleAnalyze}
              onAppendExample={appendMoodExample}
              hasPrevious={Boolean(current)}
              previousOneLiner={current?.one_liner ?? null}
              onShowPrevious={() => setState("result")}
            />
          )}

          {state === "loading" && <LoadingView stepIdx={loadingStepIdx} />}

          {state === "error" && (
            <ErrorView
              message={errorMsg ?? "Erro desconhecido."}
              onRetry={() => setState("idle")}
            />
          )}

          {state === "result" && current && (
            <div className="space-y-4">
              <DeepDiveResultView dive={current} workId={workId} />
            </div>
          )}
        </div>

        {state === "result" && current && (
          <div className="flex items-center justify-between gap-2 border-t bg-card/30 px-4 py-3">
            <p className="text-[11px] text-muted-foreground">
              {current.input_tokens != null && current.output_tokens != null ? (
                <>
                  in {current.input_tokens.toLocaleString()} · out{" "}
                  {current.output_tokens.toLocaleString()}
                  {current.thinking_tokens
                    ? ` · thinking ~${current.thinking_tokens.toLocaleString()}`
                    : null}{" "}
                  · {current.model_name}
                </>
              ) : (
                <>tokens indisponíveis</>
              )}
            </p>
            <Button size="sm" variant="outline" onClick={handleNewAnalysis} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Fazer novo
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface IdleFormProps {
  mood: string
  onMoodChange: (v: string) => void
  onSubmit: () => void
  onAppendExample: (s: string) => void
  hasPrevious: boolean
  previousOneLiner: string | null
  onShowPrevious: () => void
}

function IdleForm({
  mood,
  onMoodChange,
  onSubmit,
  onAppendExample,
  hasPrevious,
  previousOneLiner,
  onShowPrevious,
}: IdleFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        <p>
          O Consultor IA usa <span className="font-medium text-foreground">extended thinking</span>{" "}
          (8K tokens) pra cruzar perfil de gosto, biblioteca, reviews externas e mood. Devolve um
          veredito (agora/guardar/evitar) com justificativa em cada eixo.
        </p>
        <CostSummary preview={previewCost("deep_dive")} />
        <p className="text-[11px] text-muted-foreground/80">cap diário de 10 análises</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deep-dive-mood" className="text-xs uppercase tracking-wide text-muted-foreground">
          Contexto/Mood (opcional)
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {MOOD_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onAppendExample(example)}
              className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-foreground"
            >
              + {example}
            </button>
          ))}
        </div>
        <Textarea
          id="deep-dive-mood"
          placeholder="Ex: quero algo curto pra fim de semana, sem drama denso"
          value={mood}
          onChange={(e) => onMoodChange(e.target.value)}
          rows={3}
          className="text-sm"
        />
      </div>

      <Button onClick={onSubmit} className="w-full gap-2">
        <Sparkles className="h-4 w-4" />
        Analisar agora
      </Button>

      {hasPrevious && (
        <>
          <Separator />
          <div className="space-y-2 rounded-md border bg-card/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <History className="h-3.5 w-3.5" />
              Análise anterior disponível
            </p>
            {previousOneLiner && (
              <p className="text-xs italic text-muted-foreground">
                &ldquo;{previousOneLiner}&rdquo;
              </p>
            )}
            <Button variant="ghost" size="sm" onClick={onShowPrevious} className="h-7 text-xs">
              Ver análise anterior
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function LoadingView({ stepIdx }: { stepIdx: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{LOADING_STEPS[stepIdx]}</p>
        <p className="text-xs text-muted-foreground">
          Extended thinking habilitado — pode levar 25-45s.
        </p>
      </div>
    </div>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <div>
        <p className="text-sm font-semibold text-destructive">Erro no Deep Dive</p>
        <p className="mt-1 text-xs text-foreground/80">{message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  )
}
