"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { rerankSingleWorkAction } from "@/server/actions/recommendations"
import { refreshSidebarBadges } from "@/lib/sidebar-badges"

interface RerankAiRkButtonProps {
  workId: string
  /** Já existe alignment_score persistido? Muda o label "Calcular" → "Recalcular". */
  hasScore: boolean
  /** Re-rank por IA é feature do plano Pago. Quando false, mostra selo "Pago". */
  isPaid?: boolean
}

/**
 * Dispara o re-rank por IA (match_score / "IA Rk") de UMA obra sob demanda.
 * Chama `rerankSingleWorkAction`, que faz 1 chamada LLM (ranker), respeita o gate
 * Pago (`smart_shortlist`) + o limite diário, e persiste `alignment_score` em
 * `calculated_scores`. O servidor é a fonte da verdade do gate — este `isPaid` só
 * controla a aparência do botão.
 */
export function RerankAiRkButton({ workId, hasScore, isPaid = true }: RerankAiRkButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!isPaid) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled
        title="Re-rank por IA é uma feature do plano Pago."
      >
        <Sparkles className="h-3.5 w-3.5" />
        Calcular IA Rk
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
        score != null ? `IA Rk calculado: ${Math.round(score)}` : "IA Rk calculado.",
      )
      router.refresh()
      refreshSidebarBadges() // tirou a obra da fila "IA Rk stale" → recontar badge
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={isPending} className="gap-1.5">
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      {isPending ? "Calculando…" : hasScore ? "Recalcular IA Rk" : "Calcular IA Rk"}
    </Button>
  )
}
