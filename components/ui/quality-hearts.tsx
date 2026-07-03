import { cn } from "@/lib/utils"

/**
 * Corações de Interesse na obra — mesmas cores do /ranking (`heartSet` em
 * ranking-table.tsx): manual em vermelho, previsão da IA em laranja, corações
 * vazios a 25%. `quality` é a string de corações (ex.: "♥♥♥"); rende sempre a
 * escala cheia de 4 (n preenchidos + resto vazio).
 */
export function QualityHearts({
  quality,
  variant = "manual",
  showEmpty = true,
  className,
}: {
  quality: string
  variant?: "manual" | "pred"
  /** Mostra a escala cheia de 4 (n preenchidos + resto a 25%). Em `false` mostra
   *  só o número EXATO de corações, todos coloridos (chips de filtro). */
  showEmpty?: boolean
  className?: string
}) {
  const filled = Math.min(4, Math.max(0, [...quality].length))
  const empty = showEmpty ? 4 - filled : 0
  return (
    <span
      className={cn(
        "leading-none tracking-[0.12em]",
        variant === "manual" ? "text-red-500" : "text-orange-500",
        className,
      )}
    >
      {"♥".repeat(filled)}
      {empty > 0 && <span className="opacity-25">{"♥".repeat(empty)}</span>}
    </span>
  )
}
