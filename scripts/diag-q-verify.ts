/**
 * Verifica o quick-win Q (cache da nested-CV via assinatura). $0, 0 escrita.
 * 1) recalc COLD (config sem cvSig) → computa a nested-CV (~lento).
 * 2) recalc WARM (config com o cvSig do passo 1) → reusa a MAE → pula a CV (~rápido),
 *    e a MAE tem que ser IDÊNTICA.
 * 3) recalc WARM mas com 1 obra ROTULADA perturbada → assinatura muda → recomputa.
 *
 * ALVO: LOCAL — só LÊ, então o `.env.analysis` (que vem DEPOIS e vence) o manda pro clone
 * local e o egress fica em zero. Sem ele, roda contra a NUVEM em silêncio.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-q-verify.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getCurrentUserId } from "@/server/queries/current-user"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SELECT = `id, publication_status_id, total_chapters, synopsis_quality,
  observation_adjustment, user_score, is_archived, year, year_end, original_title,
  post_story_score, post_fl_score, post_ml_score, post_character_development_score,
  post_pacing_score, post_art_visual_score, post_impact_immersion_score, post_originality_score,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

async function main() {
  const supabase = createAdminClient()
  const userId = await getCurrentUserId(supabase)
  const biasMap = await getBiasMap(userId, supabase)
  const [worksRes, weightsRes, configRes, tasteProfile, declaredTagPrefs] = await Promise.all([
    supabase.from("works").select(SELECT).eq("is_archived", false).limit(2000),
    supabase.from("score_weights").select("*").eq("is_active", true),
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    loadCurrentTasteProfile(),
    getDeclaredTagPreferences(supabase, { headless: true }),
  ])
  const rawWorks = worksRes.data as RawWork[]
  const weights = weightsRes.data as ScoreWeight[]
  const config = configRes.data?.[0] as FormulaConfig
  const common = { weights, tasteProfile, declaredTagPrefs, includeQuality: false, aiQualityByWork: new Map<string, Record<string, number>>() }
  const mk = () => rawWorks.map((r) => buildWork(r, biasMap))

  // 1) COLD: força miss (zera cvSig do config)
  const cfgCold = { ...config, expected_ridge_coefficients: { ...(config.expected_ridge_coefficients ?? { featureNames: [], coefficients: [] }), cvSig: "FORCE_MISS" }, cv_mae_expected_stage1: null }
  let t = Date.now()
  const cold = computeRecalc({ works: mk(), config: cfgCold as FormulaConfig, ...common })
  const tCold = Date.now() - t

  // 2) WARM: injeta o cvSig + MAE do COLD no config → deve reusar
  const cfgWarm = { ...config, expected_ridge_coefficients: { ...(config.expected_ridge_coefficients ?? { featureNames: [], coefficients: [] }), cvSig: cold.cvSig ?? undefined }, cv_mae_expected_stage1: cold.cvMaeExpected }
  t = Date.now()
  const warm = computeRecalc({ works: mk(), config: cfgWarm as FormulaConfig, ...common })
  const tWarm = Date.now() - t

  // 3) WARM + perturba 1 obra ROTULADA → assinatura deve mudar → recomputa
  const labeledId = rawWorks.find((r) => r.user_score != null)!.id
  const perturbed = rawWorks.map((r) => {
    if (r.id !== labeledId) return r
    const c = structuredClone(r); c.user_score = Math.max(0, Math.min(10, Number(c.user_score) + 1)); return c
  })
  const warm3 = computeRecalc({ works: perturbed.map((r) => buildWork(r, biasMap)), config: cfgWarm as FormulaConfig, ...common })

  console.log("== Q (cache da nested-CV) ==")
  console.log(`COLD: ${tCold}ms · cvSig=${cold.cvSig} · MAE=${cold.cvMaeExpected?.toFixed(4)}`)
  console.log(`WARM: ${tWarm}ms · cvSig=${warm.cvSig} · MAE=${warm.cvMaeExpected?.toFixed(4)}  (deve = COLD, e bem mais rápido)`)
  console.log(`  → cache HIT? sig igual=${cold.cvSig === warm.cvSig} · MAE igual=${cold.cvMaeExpected === warm.cvMaeExpected} · speedup=${(tCold / Math.max(1, tWarm)).toFixed(1)}x`)
  console.log(`PERTURB rótulo: cvSig mudou=${warm3.cvSig !== cold.cvSig} · MAE=${warm3.cvMaeExpected?.toFixed(4)} (recomputou)`)
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })
