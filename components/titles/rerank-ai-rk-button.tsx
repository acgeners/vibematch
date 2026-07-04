"use client"

import { useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Loader2, RotateCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { rerankSingleWorkAction } from "@/server/actions/recommendations"
import { GenerationGate } from "@/components/generation/generation-gate"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import type { UiReadiness } from "@/lib/orchestration/ui-readiness"

interface RerankAiRkButtonProps {
  workId: string
  /** Já existe alignment_score persistido? Muda o label "Calcular" → "Recalcular". */
  hasScore: boolean
  /** Re-rank por IA é feature do plano Pago. Quando false, mostra selo "Pago". */
  isPaid?: boolean
  /**
   * Ícone do botão (default "sparkles"). Um DISCRIMINADOR string — não o componente
   * do ícone — porque este é um Client Component e um Server Component (page.tsx) não
   * pode passar funções/componentes como prop. "rotate" = ↻ num "Recalcular" stale.
   */
  icon?: "sparkles" | "rotate"
  /** Prontidão do Veredito (motor → UI). Quando presente, gate/selo no botão. */
  readiness?: UiReadiness | null
}

/**
 * Dispara o re-rank por IA (match_score / "Veredito IA") de UMA obra sob demanda.
 * Chama `rerankSingleWorkAction`, que faz 1 chamada LLM (ranker), respeita o gate
 * Pago (`smart_shortlist`) + o limite diário, e persiste `alignment_score` em
 * `calculated_scores`. O servidor é a fonte da verdade do gate — este `isPaid` só
 * controla a aparência do botão.
 */
export function RerankAiRkButton({ workId, hasScore, isPaid = true, icon = "sparkles", readiness }: RerankAiRkButtonProps) {
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const confirmCost = useCostConfirm()
  const Icon = icon === "rotate" ? RotateCw : Sparkles
  const gate = readiness ?? null
  const blocked = gate ? !gate.ready : false
  const blockTitle =
    gate && !gate.ready
      ? [`Falta ${gate.blocking.map((b) => b.label).join(", ")}`, gate.blocking[0]?.instruction]
          .filter(Boolean)
          .join(" — ")
      : undefined

  if (!isPaid) {
    return (
      <Button
        size="sm"
        className="gap-1.5"
        disabled
        title="Re-rank por IA é uma feature do plano Pago."
      >
        <Icon className="h-3.5 w-3.5" />
        Calcular
        <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pago
        </span>
      </Button>
    )
  }

  const run = async () => {
    if (!(await confirmCost({ action: "rerank_single" }))) return
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

  const button = (
    <Button size="sm" onClick={() => void run()} disabled={isPending || blocked} title={blockTitle} className={cn("gap-1.5", gate && "w-full")}>
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      {isPending ? "Calculando…" : hasScore ? "Recalcular" : "Calcular"}
    </Button>
  )

  return gate ? (
    <GenerationGate readiness={gate} stretch>
      {button}
    </GenerationGate>
  ) : (
    button
  )
}
