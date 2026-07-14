import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { loadLabelsFor, withOwnerLabels, mirrorOwnerScores } from "@/server/queries/owner-labels"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getOwnerUserId } from "@/server/queries/current-user"

// ═══════════════════════════════════════════════════════════════════════════════════════
// O MODELO DE CADA UM — Fatia 2b
//
// Roda a MESMA matemática do `recalculateAll` (o mesmo `computeRecalc`, que é uma função pura)
// com os dados de OUTRA pessoa: os rótulos dela, o viés de atributo dela, as tags que ela
// declarou, o perfil de gosto dela. O resultado vai para `user_calculated_scores`.
//
// ⚠️ Custo: ZERO de IA. É Ridge/logística em TypeScript puro — nenhuma chamada de LLM. Por isso
// um Leitor FREE tem direito a isto: o portão é DADO (20 rótulos), não plano. Ver o mockup da
// Fatia 2b.
//
// ⚠️ O que este recalc NÃO faz, de propósito:
//   · não escreve em `calculated_scores` — lá moram os fatos da OBRA (nota da comunidade, os 9
//     atributos com os pesos globais) e o espelho do dono. Uma pessoa avaliando uma obra não
//     pode mexer no número que todo mundo vê.
//   · não escreve em `formula_config` — o MAE/RMSE lá são a calibração do catálogo (do dono).
//   · não toca no ledger de previsões — aquilo mede o modelo do dono ao longo do tempo.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Abaixo disto o Ridge não treina — ele devolve a média (`isStub`). Espelha lib/calculations/expected.ts. */
const MIN_TRAIN = 20

export interface UserRecalcResult {
  userId: string
  labelledCount: number
  /** true quando ela tem rótulos suficientes e o modelo treinou de verdade. */
  hasModel: boolean
  scored: number
}

/**
 * Recalcula os scores derivados de UM usuário (que não é o dono).
 *
 * 🔴 A regra de honestidade desta fatia: **sem rótulos suficientes, sem Nota Prevista.**
 *
 * Hoje, quem tem menos de 20 rótulos recebe a média do treino — e o app a exibe como se fosse
 * uma previsão (`expected_is_stub`). É um chute com cara de número. Aqui, quando o modelo sai
 * stub, `expected_score` vira NULL: o que a pessoa vê é a nota da COMUNIDADE, que é um fato.
 *
 * Um número ausente é honesto. Um número inventado é pior que nenhum, porque ninguém desconfia.
 */
export async function recalculateForUser(userId: string): Promise<UserRecalcResult> {
  const ownerId = await getOwnerUserId()
  if (userId === ownerId) {
    // O dono tem o recalc dele (`recalculateAll`), que também escreve `calculated_scores` e o
    // `formula_config`. Rodar este aqui para ele seria escrever metade do trabalho.
    throw new Error("[user-recalc] o dono usa recalculateAll(), não este caminho.")
  }

  const supabase = createAdminClient()

  const [worksRes, weightsRes, configRes, labels, biasMap, declaredTagPrefs, tasteProfile] =
    await Promise.all([
      // Só CATÁLOGO. As colunas pessoais não vêm daqui: `withOwnerLabels` sobrescreve TODAS as
      // PERSONAL_COLUMNS com as DESTE usuário (`loadLabelsFor(userId)`), tenham vindo no select
      // ou não — pedi-las a `works` traria o dado do DONO e seria descartado do mesmo jeito.
      supabase
        .from("works")
        .select(
          `id, publication_status_id, total_chapters, is_archived,
           year, year_end, original_title,
           category_scores(criterion_slug, score, source),
           platform_ratings(id, platform, rating, vote_count),
           work_tags(tags(name, tag_group_id))`,
        )
        .eq("is_archived", false)
        .limit(2000),
      supabase.from("score_weights").select("*").eq("is_active", true),
      supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
      // Sem piso: 3 rótulos é normal pra quem chegou agora — não é falha.
      loadLabelsFor(userId, { minLabels: 0 }),
      getBiasMap(userId, supabase),
      // 🔴 EXPLÍCITOS os dois. Sem o `userId`, ambos caem em `getCurrentUserId()` — que em
      // background devolve o SINGLETON. O modelo DELA seria treinado com as tags amadas DELE e
      // com o perfil de gosto DELE. Exatamente o bug que a mig 147 fechou, reaberto pelo lado
      // do recalc.
      getDeclaredTagPreferences(supabase, { headless: true, userId }),
      loadCurrentTasteProfile(userId),
    ])

  if (worksRes.error) throw new Error(worksRes.error.message)
  if (weightsRes.error) throw new Error(weightsRes.error.message)
  if (configRes.error) throw new Error(configRes.error.message)

  // As colunas pessoais que vieram de `works` são as do DONO — trocadas pelas DELA.
  const rawWorks = withOwnerLabels(worksRes.data as unknown as RawWork[], labels)
  const works = rawWorks.map((raw) => buildWork(raw, biasMap))

  const { rows, expectedPredictor } = computeRecalc({
    works,
    weights: weightsRes.data ?? [],
    config: (configRes.data?.[0] ?? {}) as never,
    tasteProfile,
    declaredTagPrefs,
    includeQuality: false,
    aiQualityByWork: new Map(),
    effectiveInterestByWork: new Map(),
  })

  const hasModel = !expectedPredictor.isStub && labels.labelledCount >= MIN_TRAIN

  // 🔴 Sem modelo → sem Nota Prevista. Não é degradação: é parar de exibir a média do treino
  // como se fosse uma previsão sobre o gosto dela.
  const scored = rows.map((row: Record<string, unknown>) =>
    hasModel
      ? row
      : {
          ...row,
          expected_score: null,
          expected_baseline: null,
          expected_quality_adj: null,
          expected_is_stub: true,
          chance_score: null,
          chance_is_stub: true,
        },
  )

  const write = await mirrorOwnerScores(userId, scored)
  if (write.error) throw new Error(write.error)

  return {
    userId,
    labelledCount: labels.labelledCount,
    hasModel,
    scored: scored.length,
  }
}
