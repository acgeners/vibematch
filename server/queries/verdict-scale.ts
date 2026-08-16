import "server-only"
import { cache } from "react"

import { createAdminClient } from "@/lib/supabase/admin"
import type { VerdictScale } from "@/lib/calculations/decision"

/**
 * Lê a régua do Veredito (migration 193) de `formula_config` — média/σ do
 * `alignment_score` no catálogo e σ da Nota Prevista.
 *
 * `select("*")` de propósito, mesmo padrão de `tier-band-width`: TOLERA a coluna
 * ainda não migrada, e nesse caso devolve `null` — o que faz o veredito não
 * ajustar nada e a Prioridade ser a Nota Prevista. Degradar para o lado seguro é
 * a escolha certa aqui: a alternativa (voltar ao `alignment/10`) é justamente a
 * fórmula que cobrava meio ponto de quem tinha veredito.
 *
 * ⚠️ `cache()` por REQUISIÇÃO, não em memória de módulo: a régua muda a cada
 * recalc, e uma cópia de processo serviria uma escala velha até o deploy seguinte.
 *
 * 🔴 Limitação conhecida e registrada: `formula_config` tem UMA linha, então a
 * régua é a do catálogo do dono. Para outra pessoa, o veredito dela é padronizado
 * pela dispersão dele. Isso desloca levemente a calibração do ajuste — não vaza
 * dado nenhum (são dois escalares agregados) e continua muito melhor que o
 * `alignment/10` que valia para todo mundo. Quando `user_calculated_scores` tiver
 * régua própria, este leitor passa a receber o `userId`.
 */
export const getVerdictScale = cache(async (): Promise<VerdictScale | null> => {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("formula_config")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return resolveVerdictScale(data)
  } catch {
    return null
  }
})

/**
 * Converte a linha de `formula_config` na régua. Exportada porque quem já leu o
 * config (o `/ranking` lê para os thresholds) não deve pagar uma segunda query —
 * e porque é onde a validação mora.
 *
 * ⚠️ `numeric` do PostgREST volta como STRING: sem o `Number()` a conta viraria
 * concatenação e o z sairia absurdo. É a mesma armadilha de `sameRecalcValue`.
 */
export function resolveVerdictScale(row: unknown): VerdictScale | null {
  if (!row || typeof row !== "object") return null
  const r = row as Record<string, unknown>
  const mean = num(r.verdict_mean)
  const sd = num(r.verdict_std)
  const expectedSd = num(r.expected_std)
  // σ zero ou ausente ⇒ sem régua. Dividir por zero daria Infinity e o clamp
  // empurraria a obra para 0 ou 10 — um "ajuste" que substitui a âncora.
  if (mean == null || sd == null || expectedSd == null) return null
  if (!(sd > 0) || !(expectedSd > 0)) return null
  return { mean, sd, expectedSd }
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? n : null
}
