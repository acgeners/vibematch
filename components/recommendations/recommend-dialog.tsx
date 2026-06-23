"use client"

import { useState } from "react"
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
import { useRefresh } from "@/lib/use-refresh"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { runRecommendationAction } from "@/server/actions/recommendations"
import {
  ALLOWED_CANDIDATE_COUNTS,
  type AllowedCandidateCount,
} from "@/lib/ai-recommendation/limits"
import {
  describeRankingFilters,
  parseFiltersFromSearchParams,
} from "@/lib/ranking-filters-from-params"
import { MOOD_PRESETS } from "@/lib/constants/mood-presets"
import type { RecommendationMode } from "@/lib/ai-recommendation/types"

/**
 * Entrada ÚNICA de recomendação por IA (consultor LLM via `runRecommendationAction`).
 * Funde os antigos `RunCreatorForm` (/recommendations) e `RecommendWithAiButton`
 * (×2: /favorites, /ranking). Os antigos "modos" viram **escopo de candidatos**:
 *   - `nao_lidos`      → mode next_read     (só favoritos não avaliados — descoberta)
 *   - `todos`          → mode full_analysis (re-ranqueia a biblioteca inteira)
 *   - `filtro_ranking` → mode ranking       (usa os filtros aplicados na /ranking)
 * O `context` controla quais escopos aparecem; "Filtro do ranking" só na /ranking
 * (lê os filtros via useSearchParams). Gate único: `smart_shortlist` (Pago).
 */
type RecommendContext = "favorites" | "ranking" | "standalone"

type Scope = "nao_lidos" | "todos" | "filtro_ranking"

const SCOPE_TO_MODE: Record<Scope, RecommendationMode> = {
  nao_lidos: "next_read",
  todos: "full_analysis",
  filtro_ranking: "ranking",
}

const SCOPE_LABELS: Record<Scope, string> = {
  nao_lidos: "Não-lidos — só favoritos ainda não avaliados (descoberta)",
  todos: "Todos os favoritos — re-ranqueia a biblioteca inteira",
  filtro_ranking: "Filtro do ranking — usa os filtros aplicados agora",
}

const SCOPES_BY_CONTEXT: Record<RecommendContext, Scope[]> = {
  favorites: ["nao_lidos", "todos"],
  standalone: ["nao_lidos", "todos"],
  ranking: ["filtro_ranking", "nao_lidos", "todos"],
}

const DEFAULT_LABEL: Record<RecommendContext, string> = {
  favorites: "Recomendar com IA",
  ranking: "Recomendar do ranking",
  standalone: "Recomendar com IA",
}

interface RecommendDialogProps {
  context: RecommendContext
  /** Aparência do gatilho. */
  variant?: "default" | "secondary" | "outline"
  size?: "sm" | "default" | "lg"
  /** Override do label do gatilho. */
  label?: string
  /** Gate de plano: re-rank por IA é feature Pago (`smart_shortlist`). */
  isPaid?: boolean
  /** Gate não-plano (perfil insuficiente / stub). Só vale quando `isPaid`. */
  disabled?: boolean
  disabledReason?: string | null
}

export function RecommendDialog({
  context,
  variant = "default",
  size = "sm",
  label,
  isPaid = true,
  disabled = false,
  disabledReason = null,
}: RecommendDialogProps) {
  const router = useRouter()
  const refresh = useRefresh()
  const searchParams = useSearchParams()

  const scopes = SCOPES_BY_CONTEXT[context]
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>(scopes[0])
  const [n, setN] = useState<AllowedCandidateCount>(20)
  const [userContext, setUserContext] = useState("")
  // Roda em segundo plano via store: o diálogo fecha ao confirmar e a recomendação
  // aparece no indicador global (você pode navegar). `isPending` reflete a tarefa
  // "recommend" do store (impede reabrir e disparar de novo enquanto roda).
  const tasks = useAppTasks()
  const isPending = tasks.some((t) => t.id === "recommend" && t.status === "running")

  const appendPresetToContext = (snippet: string) => {
    setUserContext((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return snippet
      if (trimmed.toLowerCase().includes(snippet.toLowerCase())) return prev
      const sep = /[.!?…]$/.test(trimmed) ? " " : ". "
      return `${trimmed}${sep}${snippet}`
    })
  }

  const buttonLabel = label ?? DEFAULT_LABEL[context]

  // Selo "Pago" tem prioridade sobre o gate de perfil.
  if (!isPaid) {
    return (
      <Button
        variant={variant}
        size={size}
        className="gap-1.5"
        disabled
        title="Recomendação por IA é uma feature do plano Pago. No Free o ranking usa Nota Prevista × alinhamento."
      >
        <Sparkles className="h-3.5 w-3.5" />
        {buttonLabel}
        <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pago
        </span>
      </Button>
    )
  }

  if (disabled) {
    return (
      <Button
        variant={variant}
        size={size}
        className="gap-1.5"
        disabled
        title={disabledReason ?? undefined}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {buttonLabel}
      </Button>
    )
  }

  const isRanking = scope === "filtro_ranking"
  const filterSummary = isRanking
    ? describeRankingFilters(
        parseFiltersFromSearchParams(new URLSearchParams(searchParams.toString())),
      )
    : null

  const handleConfirm = () => {
    const filters = isRanking
      ? parseFiltersFromSearchParams(new URLSearchParams(searchParams.toString()))
      : undefined

    setOpen(false) // fecha o diálogo; a recomendação roda em segundo plano
    runTask({
      id: "recommend",
      kind: "recommend",
      label: "Gerando recomendação por IA",
      run: () =>
        runRecommendationAction({
          mode: SCOPE_TO_MODE[scope],
          n,
          userContext: userContext.trim() || null,
          filters,
        }),
      successToast: (result) => {
        if (!result.data) return null
        const dropped = result.data.candidatesAvailable - result.data.candidatesEvaluated
        return {
          message:
            dropped > 0
              ? `${result.data.candidatesEvaluated} obras rankeadas (${dropped} fora desta run)`
              : `${result.data.candidatesEvaluated} obras rankeadas`,
          action: { label: "Ver", href: `/recommendations/${result.data.runSlug}` },
        }
      },
      onDone: (result) => {
        if (result.error) {
          toast.error(result.error)
          return
        }
        if (result.data) {
          // Se ainda montado, leva direto pro resultado; o toast cobre o caso de
          // já ter navegado pra outro lugar.
          router.push(`/recommendations/${result.data.runSlug}`)
          refresh()
        }
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao gerar recomendação"),
    })
  }

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
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rec-scope" className="text-xs uppercase tracking-wide text-muted-foreground">
              Escopo de candidatos
            </Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger id="rec-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCOPE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isRanking && (
              <p className="text-[11px] text-muted-foreground">
                Filtros da /ranking agora:{" "}
                <span className="font-mono">{filterSummary}</span>
              </p>
            )}
          </div>

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
            <p className="text-[11px] text-muted-foreground">
              Mais obras = mais tokens. 20 é o sweet spot (~$0.05/run).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-context" className="text-xs uppercase tracking-wide text-muted-foreground">
              Contexto (opcional)
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {MOOD_PRESETS.filter((p) => p.userContextSnippet).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => appendPresetToContext(preset.userContextSnippet)}
                  disabled={isPending}
                  title={preset.description}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{preset.emoji}</span>
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
            <Textarea
              id="rec-context"
              placeholder="Clique nos moods acima ou escreva o seu (ex: quero algo leve hoje, sem drama pesado)"
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              rows={2}
              className="text-sm"
              maxLength={400}
              disabled={isPending}
            />
            <p className="text-[11px] text-muted-foreground">
              Ajusta a ordem sem mudar seu perfil de gosto cacheado.
            </p>
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
                Rodando…
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
