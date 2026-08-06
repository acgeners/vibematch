import { scoreToSigma } from "@/lib/ranking/criterion-unit"
import type { CriterionMoments } from "@/lib/ranking/criterion-unit"

/**
 * ATRIBUTOS EM DESTAQUE de uma obra: em que ela foge do normal do catálogo, em σ.
 *
 * 🔴 **Não elege um atributo dominante.** Isso já foi tentado e removido: o
 * `work-signature.ts` rotulava a obra pelo ARGMAX do z-score e saiu em 2026-08-05
 * porque o campeão vencia por margem < 0,25σ em 47% do catálogo — um rótulo que era
 * cara-ou-coroa em metade do acervo. Remedido em 2026-08-06 sobre as 973 obras com
 * os 9 atributos: **46,9%**. O mesmo número.
 *
 * O que funciona é LIMIAR, não ranking: com `|z| ≥ 1`, 93,5% das obras têm pelo
 * menos um destaque e a mediana é 3 (p90 = 5). E o σ vai IMPRESSO no chip, então a
 * margem entre o 1º e o 2º fica visível em vez de virar uma afirmação que o dado
 * não sustenta. O corte em `max` é de exibição, e por isso a ordem por |z| é só
 * para escolher quais cabem — nunca para dizer "o principal é este".
 */
export interface CriterionHighlight {
  slug: string
  /** Nota 0–10 do atributo nesta obra. */
  score: number
  /** Desvios-padrão contra a média DAQUELE atributo no catálogo. */
  z: number
  /**
   * O desvio joga a favor ou contra o gosto, segundo os pesos:
   *  - `favor`  — mais de algo que os pesos premiam, ou menos de algo que penalizam
   *  - `contra` — o inverso
   *  - `neutro` — sem peso ativo, peso zero, ou critério negativo AINDA abaixo do
   *    seu `threshold` (aí ele não penaliza nada; ver `calculateGPTWithDiagnostics`,
   *    onde só o excedente acima do threshold entra no numerador).
   */
  favor: "favor" | "contra" | "neutro"
}

/** O que este cálculo precisa saber de um peso — subconjunto de `ScoreWeight`. */
export interface HighlightWeight {
  slug: string
  weight: number
  threshold: number | null
  is_active: boolean
}

export const HIGHLIGHT_SIGMA_THRESHOLD = 1
export const HIGHLIGHT_MAX = 3

function favorOf(
  z: number,
  score: number,
  weight: HighlightWeight | undefined,
): CriterionHighlight["favor"] {
  if (!weight || !weight.is_active || weight.weight === 0) return "neutro"
  if (weight.weight > 0) return z > 0 ? "favor" : "contra"
  // Peso NEGATIVO (drama, tragédia): só penaliza o que passa do threshold. Abaixo
  // dele, "acima da média do catálogo" não custa nada — marcar ▼ ali seria dizer
  // que pesa contra uma obra que o cálculo não penalizou.
  if (score > (weight.threshold ?? 0)) return "contra"
  return z < 0 ? "favor" : "neutro"
}

export function criterionHighlights(
  scores: Record<string, number | null | undefined>,
  moments: CriterionMoments | null | undefined,
  weights: readonly HighlightWeight[] | null | undefined,
  options?: { threshold?: number; max?: number },
): CriterionHighlight[] {
  if (!moments) return []
  const threshold = options?.threshold ?? HIGHLIGHT_SIGMA_THRESHOLD
  const max = options?.max ?? HIGHLIGHT_MAX
  const bySlug = new Map((weights ?? []).map((w) => [w.slug, w]))

  const out: CriterionHighlight[] = []
  for (const [slug, raw] of Object.entries(scores)) {
    if (raw == null || !Number.isFinite(raw)) continue
    const z = scoreToSigma(raw, moments[slug])
    if (z == null || Math.abs(z) < threshold) continue
    out.push({ slug, score: raw, z, favor: favorOf(z, raw, bySlug.get(slug)) })
  }
  // Ordem por |z| desc; empate resolvido pelo slug para a saída ser determinística
  // (sem isso a ordem herdaria a das chaves do objeto, que varia por caminho).
  out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z) || a.slug.localeCompare(b.slug))
  return out.slice(0, max)
}
