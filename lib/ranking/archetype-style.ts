import type { ForceArchetype } from "@/lib/calculations/forces"

/**
 * Cor de cada arquétipo, em UM lugar só.
 *
 * Os NOMES e as descrições moram em `lib/ranking/tier-composition.ts` (que é puro
 * e roda no server); aqui fica só a camada de apresentação, que é Tailwind e por
 * isso não cabe lá. Três consumidores compartilham este mapa: os cantos da
 * Bússola, as prateleiras dos Cards e os chips de composição do divisor de tier.
 *
 * ⚠️ As classes precisam ser strings COMPLETAS e literais — o Tailwind varre o
 * source por texto, e `bg-${cor}-500` não sobrevive à varredura.
 */
export interface ArchetypeStyle {
  /** Preenchimento do ponto/bolinha. */
  dot: string
  /** Texto na cor do arquétipo (título da prateleira, nome do canto). */
  text: string
  /** Borda — régua da prateleira, contorno do canto selecionado. */
  border: string
  /** Fundo tênue para o chip de contagem. */
  chipBg: string
  /** Sombra/halo do ponto no plano. `rgba` porque vai em `style`, não em classe. */
  glow: string
  /** Degradê do quadrante no plano. */
  tint: string
}

export const ARCHETYPE_STYLE: Record<ForceArchetype, ArchetypeStyle> = {
  safe: {
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500",
    chipBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    glow: "rgba(16,185,129,0.5)",
    tint: "from-emerald-500/10",
  },
  upside: {
    dot: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    border: "border-rose-500",
    chipBg: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    glow: "rgba(244,63,94,0.5)",
    tint: "from-rose-500/10",
  },
  niche: {
    dot: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    border: "border-violet-500",
    chipBg: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    glow: "rgba(139,92,246,0.5)",
    tint: "from-violet-500/10",
  },
  skip: {
    dot: "bg-slate-400 dark:bg-slate-500",
    text: "text-slate-500 dark:text-slate-400",
    border: "border-slate-400",
    chipBg: "bg-slate-500/15 text-slate-500 dark:text-slate-400",
    glow: "rgba(100,116,139,0.4)",
    tint: "from-slate-500/10",
  },
}

/**
 * Canto do plano → arquétipo. A Bússola desenha Chance no eixo X e Avaliação no
 * Y, então o canto superior-direito é "os dois acima da mediana".
 */
export const CORNER_ARCHETYPE = {
  tr: "safe",
  tl: "upside",
  br: "niche",
  bl: "skip",
} as const satisfies Record<"tr" | "tl" | "br" | "bl", ForceArchetype>
