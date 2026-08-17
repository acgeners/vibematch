import { cn } from "@/lib/utils"
import { confidenceMarkClass } from "@/lib/ai-evaluation/confidence-tone"

/**
 * O TRAÇO de confiança — dono único da forma, irmão de `confidenceMarkClass` (que é dona da
 * cor). Ele aparece em dois lugares que precisam ser o MESMO desenho:
 *
 * 1. sob o número, na pílula do Veredito (`AlignmentScoreCell`);
 * 2. dentro do tooltip dessa pílula, ao lado de "Confiança: 62%".
 *
 * 🔴 **O 2º existe pra explicar o 1º, e é isso que exige um dono só.** Um traço de 2px é mudo:
 * quem varre a coluna vê barrinhas coloridas e não tem como saber do que elas falam. Pôr o
 * mesmo traço encostado no número que ele representa fecha o loop **sem uma linha de prosa** —
 * mas só enquanto os dois forem idênticos. Se o tooltip desenhasse um retângulo "parecido",
 * ele ensinaria a ler errado, que é pior do que não explicar.
 *
 * ⚠️ **Sem `"use client"` de propósito:** o `score-tooltip-content.tsx` renderiza tanto no
 * server component da página da obra quanto nas cells client do /ranking, e este componente
 * não tem estado nem handler.
 *
 * ⚠️ **A trilha neutra (`confidence == null`) é pra pílula, não pro tooltip** — lá dentro o
 * fundo é `bg-foreground` e `bg-foreground/10` sumiria. O tooltip só desenha o traço quando há
 * confiança, então o caso não chega a existir; se um dia chegar, precisa de tom próprio.
 */
export function ConfidenceMark({
  confidence,
  className,
}: {
  confidence: number | null
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-block h-0.5 w-[15px] shrink-0 rounded-full align-middle",
        // Sem confiança registrada é o caso COMUM (43% das obras com Veredito, medido em
        // 17/08/2026): a trilha neutra mantém o número na mesma altura em todas as linhas sem
        // fingir uma 4ª faixa de confiança.
        confidence != null ? confidenceMarkClass(confidence) : "bg-foreground/10",
        className,
      )}
      aria-hidden="true"
    />
  )
}
