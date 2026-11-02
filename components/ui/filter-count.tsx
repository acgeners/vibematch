import { cn } from "@/lib/utils"

/**
 * Quantas obras sobram numa opção de filtro. Tem fundo próprio porque o número fica colado em outros
 * dígitos (`🔞 32`, `≥ 5 23`) e, solto, lê como parte do rótulo. O fundo sai da cor do texto, então
 * acompanha a opção ligada e desligada sem uma segunda paleta.
 */
export function FilterCount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("rounded-[4px] bg-current/15 px-1 text-[10.5px] font-medium leading-4 tabular-nums", className)}>
      {value}
    </span>
  )
}
