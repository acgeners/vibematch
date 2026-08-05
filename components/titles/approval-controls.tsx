"use client"

import { useTransition } from "react"
import { Archive, Check, Loader2, ShieldQuestion } from "lucide-react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { useCan } from "@/components/layout/admin-context"
import { setWorkApproval } from "@/server/actions/works"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Aprovação de obra criada por não-curador (migration 178).
 *
 * ⚠️ Vocabulário: "aprovação", nunca "avaliação". Neste app "avaliação" já é a avaliação de IA
 * em cinco superfícies (`ai_eval_status`, "✨ Avaliar", "Pedir revisão da avaliação", "Resumo da
 * última avaliação IA", "Avaliação IA" nos cards) — um badge "Em avaliação" numa obra que exibe
 * "Avaliação IA: concluída" na mesma tela lê como contradição. O verbo do botão é "Aprovar" e a
 * coluna é `approved`, então "aprovação" é a única palavra consistente com os dois.
 *
 * E não repete "Ficha incompleta", que é a faixa do `ai_eval_status = 'pending'`: os dois estados
 * coincidem quase sempre no começo, mas dizem coisas diferentes — um é "falta dado", o outro é
 * "falta alguém olhar".
 */

/** Selo público. Aparece pra QUALQUER pessoa: a obra está no catálogo compartilhado. */
export function ApprovalBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-amber-50 px-3.5 py-1.5 text-base font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        className,
      )}
      title="Cadastrada por um leitor. O curador ainda não conferiu os dados desta obra."
    >
      <ShieldQuestion className="h-4 w-4" />
      Aguardando aprovação
    </span>
  )
}

/** Os dois botões — só pro curador, e só enquanto a obra não foi aprovada. */
export function ApprovalActions({ workId }: { workId: string }) {
  // `curate_work` é o verbo de "decidir pelos outros no catálogo compartilhado", que é
  // exatamente o que aprovar é. O servidor reexecuta o gate (`ensureAdmin` em setWorkApproval).
  const canCurate = useCan("curate_work")
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()

  if (!canCurate) return null

  const decidir = (aprovar: boolean) => {
    startTransition(async () => {
      const r = await setWorkApproval(workId, aprovar)
      if (r.error) {
        toast.error(r.error)
        return
      }
      toast.success(aprovar ? "Obra aprovada." : "Obra rejeitada e arquivada.")
      refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={isPending} onClick={() => decidir(true)}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Aprovar obra
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => decidir(false)}
        // Diz o efeito, não só o veredito: rejeitar ARQUIVA (reversível), não apaga.
        title="Arquiva a obra: sai do ranking, das recomendações e das estatísticas. Reversível."
      >
        <Archive className="h-4 w-4" />
        Rejeitar e arquivar
      </Button>
    </div>
  )
}
