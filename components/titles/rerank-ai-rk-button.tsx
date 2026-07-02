"use client"

import { useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { rerankSingleWorkAction } from "@/server/actions/recommendations"

interface RerankAiRkButtonProps {
  workId: string
  /** Já existe alignment_score persistido? Muda o label "Calcular" → "Recalcular". */
  hasScore: boolean
  /** Re-rank por IA é feature do plano Pago. Quando false, mostra selo "Pago". */
  isPaid?: boolean
}

/**
 * Dispara o re-rank por IA (match_score / "Veredito IA") de UMA obra sob demanda.
 * Chama `rerankSingleWorkAction`, que faz 1 chamada LLM (ranker), respeita o gate
 * Pago (`smart_shortlist`) + o limite diário, e persiste `alignment_score` em
 * `calculated_scores`. O servidor é a fonte da verdade do gate — este `isPaid` só
 * controla a aparência do botão.
 */
export function RerankAiRkButton({ workId, hasScore, isPaid = true }: RerankAiRkButtonProps) {
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()

  if (!isPaid) {
    return (
      <Button
        size="sm"
        className="gap-1.5"
        disabled
        title="Re-rank por IA é uma feature do plano Pago."
      >
        <Sparkles className="h-3.5 w-3.5" />
        Calcular
        <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pago
        </span>
      </Button>
    )
  }

  const run = () => {
    startTransition(async () => {
      const result = await rerankSingleWorkAction(workId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const score = result.data?.alignmentScore
      toast.success(
        score != null ? `Veredito IA calculado: ${Math.round(score)}` : "Veredito IA calculated.",
      )
      refresh()
    })
  }

  return (
    <Button size="sm" onClick={run} disabled={isPending} className="gap-1.5">
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      {isPending ? "Calculando…" : hasScore ? "Recalcular" : "Calcular"}
    </Button>
  )
}
