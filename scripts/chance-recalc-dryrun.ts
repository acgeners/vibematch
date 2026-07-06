/**
 * Dry-run da integração do Chance no recalc — prova que `computeRecalc` roda com
 * o bloco novo e produz `chance_score` sãos, SEM escrever no banco (não depende
 * da migration 132). Espelha o carregamento de `recalculateAll`, chama
 * computeRecalc com fast:true (pula a nested-CV cara) e inspeciona os rows.
 *
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/chance-recalc-dryrun.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "@/lib/supabase/admin"
import { buildWork, computeRecalc } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getCurrentUserId } from "@/server/queries/current-user"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

async function main() {
  const sb = createAdminClient()
  const userId = await getCurrentUserId(sb)
  const biasMap = await getBiasMap(userId, sb)

  const [worksRes, weightsRes, configRes, tasteProfile, declaredTagPrefs] = await Promise.all([
    sb.from("works").select(
      `id, title, publication_status_id, total_chapters, synopsis_quality,
       observation_adjustment, user_score, is_archived, year, year_end, original_title,
       post_story_score, post_fl_score, post_ml_score, post_character_development_score,
       post_pacing_score, post_art_visual_score, post_impact_immersion_score, post_originality_score,
       category_scores(criterion_slug, score, source),
       platform_ratings(id, platform, rating, vote_count),
       work_tags(tags(name, tag_group_id))`,
    ).eq("is_archived", false).limit(2000),
    sb.from("score_weights").select("*").eq("is_active", true),
    sb.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    loadCurrentTasteProfile(),
    getDeclaredTagPreferences(sb, { headless: true }),
  ])
  if (worksRes.error) throw new Error(worksRes.error.message)

  const works = (worksRes.data as any[]).map((raw) => buildWork(raw, biasMap))
  const weights = weightsRes.data as any[]
  const config = (configRes.data?.[0] ?? { formula_version: "v1", score_weights_auto: true }) as any

  // effectiveInterestByWork (manual ⊕ previsto) — igual ao recalc
  const effectiveInterestByWork = new Map<string, string | null>()
  {
    const bestPred = new Map<string, { ver: number; q: string | null }>()
    const ids = works.map((w) => w.id)
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150))
    const res = await Promise.all(chunks.map((c) =>
      sb.from("synopsis_quality_predictions").select("work_id, predicted_quality, prompt_version").in("work_id", c)))
    for (const r of res) for (const row of (r.data ?? []) as any[]) {
      const m = (row.prompt_version ?? "").match(/(\d+)/)
      const ver = m ? parseInt(m[1], 10) : -1
      const prev = bestPred.get(row.work_id)
      if (!prev || ver > prev.ver) bestPred.set(row.work_id, { ver, q: row.predicted_quality ?? null })
    }
    for (const w of works) effectiveInterestByWork.set(w.id, w.synopsisQuality ?? bestPred.get(w.id)?.q ?? null)
  }

  console.log(`obras=${works.length} · rotuladas=${works.filter((w) => w.userScore != null).length}`)
  const t0 = Date.now()
  const out = computeRecalc({
    works, weights, config, tasteProfile, declaredTagPrefs,
    includeQuality: false, aiQualityByWork: new Map(), effectiveInterestByWork, fast: true,
  })
  console.log(`computeRecalc rodou em ${Date.now() - t0}ms, sem erro ✓`)

  const rows = out.rows as any[]
  const withChance = rows.filter((r) => r.chance_score != null)
  const vals = withChance.map((r) => r.chance_score)
  console.log(`\nchance_score: preenchidos=${withChance.length}/${rows.length}  stub=${rows.filter((r) => r.chance_is_stub).length}`)
  if (vals.length) {
    console.log(`  min=${Math.min(...vals).toFixed(1)}  max=${Math.max(...vals).toFixed(1)}  média=${mean(vals).toFixed(1)}`)
  }

  // amostra: junta título + nota real pra sanity-check
  const nmeta = new Map((worksRes.data as any[]).map((w) => [w.id, { title: w.title ?? w.id, user: w.user_score }]))
  const ranked = withChance.map((r) => ({ s: r.chance_score, w: nmeta.get(r.work_id)! })).filter((x) => x.w).sort((a, b) => b.s - a.s)
  console.log("\n— maior chance —")
  ranked.slice(0, 5).forEach((r) => console.log(`  ${r.s.toFixed(0).padStart(3)}%  ${String(r.w.title).slice(0, 42).padEnd(42)} (nota ${r.w.user ?? "—"})`))
  console.log("— menor chance —")
  ranked.slice(-5).forEach((r) => console.log(`  ${r.s.toFixed(0).padStart(3)}%  ${String(r.w.title).slice(0, 42).padEnd(42)} (nota ${r.w.user ?? "—"})`))

  console.log("\n✓ dry-run concluído (nada escrito no banco).\n")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : String(e)); process.exit(1) })
