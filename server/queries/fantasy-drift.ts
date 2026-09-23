import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import { LEGACY_SPLIT_COPY_SOURCE } from "@/lib/calculations/fantasy-drift"
import { fantasyDriftFrom, type FantasyDrift } from "@/lib/calculations/fantasy-drift"

/**
 * Quanto do slot 3 do cálculo já é Fantasia DE VERDADE — lido direto do banco, a cada recalc.
 *
 * 🔴 POR QUE ESTA MEDIÇÃO EXISTE. A troca do slot `fantasy_nobility` → `fantasy` foi medida e
 * não mostrou dano distinguível do nulo (z = 1,24 · p ≈ 0,10). Mas o teste que disse isso só
 * enxerga efeito a partir de ~0,014 de cvMAE, e foi feito com 60 de 1.026 obras migradas. Ou
 * seja: "não demonstrado" ali NÃO é "não existe" aqui. Sem contar o denominador, um dano que
 * apareça com a migração avançada seria indistinguível de zero — e é essa a diferença entre
 * observabilidade e torcida.
 *
 * ⚠️ Isto é OBSERVABILIDADE, não política: sem limiar, sem alarme e sem rollback automático.
 * Quem lê a série é uma pessoa, olhando `cv_mae_expected` contra `fantasy_real_ratio`.
 *
 * ⚠️ Duas contagens no SERVIDOR (`count: "exact", head: true`), zero linha trafegada. Somar no
 * cliente cairia no corte silencioso de 1.000 linhas do PostgREST — o catálogo já passou disso.
 */
export async function readFantasyDrift(supabase: SupabaseClient): Promise<FantasyDrift> {
  const conta = async (legado: boolean) => {
    const q = supabase
      .from("category_scores")
      .select("work_id, works!inner(is_archived)", { count: "exact", head: true })
      .eq("criterion_slug", "fantasy")
      .eq("works.is_archived", false)
    const { count, error } = await (legado
      ? q.eq("source", LEGACY_SPLIT_COPY_SOURCE)
      : q.neq("source", LEGACY_SPLIT_COPY_SOURCE))
    // 🔴 O erro do PostgREST NÃO pode ser engolido: sem isto uma coluna renomeada devolveria
    // `count = null` e a série registraria 0 real / 0 legado como se fosse medição.
    if (error) throw new Error(`fantasy-drift (${legado ? "legado" : "real"}): ${error.message}`)
    return count ?? 0
  }
  const [real, legacy] = await Promise.all([conta(false), conta(true)])
  return fantasyDriftFrom({ real, legacy })
}

/** Os slugs do vetor de cálculo, em ordem — a assinatura que datava faltava na série. */
export function scoringCriteriaSignature(): string {
  return SCORING_CRITERION_SLUGS.join(",")
}
