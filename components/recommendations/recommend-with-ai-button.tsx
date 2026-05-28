"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { runRecommendationAction } from "@/server/actions/recommendations"
import {
  ALLOWED_CANDIDATE_COUNTS,
  type AllowedCandidateCount,
} from "@/lib/ai-recommendation/limits"
import {
  describeRankingFilters,
  parseFiltersFromSearchParams,
} from "@/lib/ranking-filters-from-params"
import type { RecommendationMode } from "@/lib/ai-recommendation/types"

type Source = "favorites" | "ranking"

interface RecommendWithAiButtonProps {
  source: Source
  /** Aparência do botão. */
  variant?: "default" | "secondary" | "outline"
  size?: "sm" | "default" | "lg"
  /** Override do label. Default depende do source. */
  label?: string
}

const MODE_LABELS: Record<Exclude<RecommendationMode, "ranking">, string> = {
  next_read: "Próxima leitura — só favoritos não-lidos",
  full_analysis: "Análise completa — todos os favoritos",
}

const CONTEXT_EXAMPLES = [
  "Algo leve, sem drama pesado",
  "No mood de drama denso",
  "Evitar tragédia",
  "Romance slow-burn",
  "Algo curto pra terminar rápido",
  "FL com agência forte",
]

const LOADING_STEPS = [
  "Carregando perfil…",
  "Avaliando candidatos…",
  "Gerando explicação…",
]

export function RecommendWithAiButton({
  source,
  variant = "default",
  size = "sm",
  label,
}: RecommendWithAiButtonProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Exclude<RecommendationMode, "ranking">>("next_read")
  const [n, setN] = useState<AllowedCandidateCount>(20)
  const [userContext, setUserContext] = useState("")
  const [isPending, startTransition] = useTransition()
  const [loadingStepIdx, setLoadingStepIdx] = useState(0)

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

  const appendExampleToContext = (example: string) => {
    setUserContext((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return example
      if (trimmed.toLowerCase().includes(example.toLowerCase())) return prev
      const sep = /[.!?…]$/.test(trimmed) ? " " : ". "
      return `${trimmed}${sep}${example}`
    })
  }

  const isRanking = source === "ranking"
  const buttonLabel =
    label ??
    (isRanking ? "Recomendar do ranking" : "Recomendar com IA")

  const handleConfirm = () => {
    const filters = isRanking
      ? parseFiltersFromSearchParams(new URLSearchParams(searchParams.toString()))
      : undefined

    startTransition(async () => {
      try {
        const result = await runRecommendationAction({
          mode: isRanking ? "ranking" : mode,
          n,
          userContext: userContext.trim() || null,
          filters,
        })
        if (result.error) {
          toast.error(result.error)
          return
        }
        if (result.data) {
          const dropped = result.data.candidatesAvailable - result.data.candidatesEvaluated
          if (dropped > 0) {
            toast.success(
              `${result.data.candidatesEvaluated} obras rankeadas (${dropped} não entraram nesta run).`,
            )
          } else {
            toast.success(`${result.data.candidatesEvaluated} obras rankeadas.`)
          }
          setOpen(false)
          router.push(`/recommendations/${result.data.runSlug}`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao gerar recomendação")
      }
    })
  }

  const filterSummary = isRanking
    ? describeRankingFilters(
        parseFiltersFromSearchParams(new URLSearchParams(searchParams.toString())),
      )
    : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recomendar com IA</DialogTitle>
          <DialogDescription>
            Cada execução chama a Claude API e conta no seu limite diário (20 runs/dia).
            {isRanking && (
              <>
                <br />
                <span className="text-xs">
                  Vai usar os filtros aplicados na /ranking agora:{" "}
                  <span className="font-mono">{filterSummary}</span>
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isRanking && (
            <div className="space-y-1.5">
              <Label htmlFor="rec-mode" className="text-xs uppercase tracking-wide text-muted-foreground">
                Modo
              </Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger id="rec-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABELS) as Array<keyof typeof MODE_LABELS>).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rec-n" className="text-xs uppercase tracking-wide text-muted-foreground">
              Quantas obras rankear
            </Label>
            <Select value={String(n)} onValueChange={(v) => setN(Number(v) as AllowedCandidateCount)}>
              <SelectTrigger id="rec-n">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALLOWED_CANDIDATE_COUNTS.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count} obras
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Mais obras = mais tokens. 20 é o sweet spot (~$0.05/run).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-context" className="text-xs uppercase tracking-wide text-muted-foreground">
              Contexto (opcional)
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {CONTEXT_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => appendExampleToContext(example)}
                  disabled={isPending}
                  className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + {example}
                </button>
              ))}
            </div>
            <Textarea
              id="rec-context"
              placeholder="Clique nos exemplos acima ou escreva o seu (ex: quero algo leve hoje, sem drama pesado)"
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              rows={2}
              className="text-sm"
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isPending} className="min-w-[200px]">
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {LOADING_STEPS[loadingStepIdx]}
              </>
            ) : (
              "Confirmar e rodar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
