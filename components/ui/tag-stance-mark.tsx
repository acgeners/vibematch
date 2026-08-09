import { Ban, Heart } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TagStanceInfo } from "@/lib/tags/segment"
import type { TagStance } from "@/lib/tags/segment"

/**
 * Marcador de ÊNFASE FORTE dentro do chip de uma tag — ♥ preenchido pra amada,
 * ⊘ pra evitada. Aparece SÓ quando a declaração tem ênfase 2×
 * (`STRONG_TAG_WEIGHT`); tag que casou pelo perfil de gosto nunca o recebe.
 *
 * Existe como componente único de propósito: o marcador vive em TRÊS superfícies
 * (card de tags da obra, prévia do comparador, popover de inputs da obra) e uma
 * 4ª cópia é como uma delas passa a dizer outra coisa sobre o mesmo dado — foi
 * exatamente assim que o formato de dinheiro divergiu em seis arquivos.
 *
 * 🔴 Cor NÃO é o sinal aqui: os dois níveis dividem a mesma cor de stance
 * (verde/vermelho), então o que separa é a FORMA. Trocar isto por "um verde mais
 * escuro" desfaz a distinção pra quem enxerga cor com dificuldade — e, medido no
 * catálogo, 43% dos chips amados de uma obra são fortes: é um bloco inteiro, não
 * um caso raro.
 */
export function TagStanceMark({ stance, className }: { stance: TagStance; className?: string }) {
  const base = cn("h-2.5 w-2.5 shrink-0", className)
  return stance === "avoid" ? (
    <Ban aria-hidden className={base} strokeWidth={2.75} />
  ) : (
    <Heart aria-hidden className={base} fill="currentColor" stroke="none" />
  )
}

/**
 * Texto do tooltip/`title` de uma tag com stance. Diz o NÍVEL e de onde ele veio
 * — sem isso o segundo nível vira "um chip com um coraçãozinho" sem explicação,
 * e a pessoa não tem como ligar o marcador ao botão ✨ 2× de `/preferencias`.
 */
export function tagStanceTitle(info: TagStanceInfo): string {
  const isLove = info.stance === "love"
  if (info.strong) return isLove ? "Muito amada — você marcou com ênfase 2×" : "Muito evitada — você marcou com ênfase 2×"
  if (info.source === "declared") return isLove ? "Amada — você marcou nas preferências" : "Evitada — você marcou nas preferências"
  return isLove ? "Amada — pelo seu perfil de gosto" : "Evitada — pelo seu perfil de gosto"
}
