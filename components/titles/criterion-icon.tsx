import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"

/**
 * Ícone de um critério: imagem personalizada quando `criteria.icon_url` estiver preenchido (via
 * sync-constants → `CRITERIA_INFO[slug].iconUrl`), senão cai no emoji. Centraliza a troca emoji→imagem
 * num lugar só — quando o `iconUrl` existir, todos os pontos que usam este componente passam a mostrar
 * a arte sem mais mudança de código. O cast tolera o campo antes do generator emitir `iconUrl`.
 */
export function CriterionIcon({ slug, className }: { slug: string; className?: string }) {
  const info = CRITERIA_INFO[slug] as { emoji?: string; iconUrl?: string } | undefined
  if (info?.iconUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={info.iconUrl} alt="" aria-hidden className={cn("h-full w-full object-contain", className)} />
  }
  return (
    <span aria-hidden className={cn("text-[30px] leading-none", className)}>
      {info?.emoji ?? "•"}
    </span>
  )
}
