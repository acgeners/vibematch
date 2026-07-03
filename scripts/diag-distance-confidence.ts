/**
 * DIAGNÓSTICO: a distância ao centróide (sinal "do todo") prevê o erro da Nota Prevista?
 *
 * Read-only, $0, 0 escrita, 0 LLM. Carrega as obras como o recalculateAll, roda
 * computeRecalc (que MUTA os works: seta w.expectedScore e, sob a instrumentação
 * [DIAG-DISTANCE], w.__expectedDistance) e mede, sobre as obras ROTULADAS:
 *   - MAE global (piso).
 *   - MAE por QUINTIL de distância (sinal do todo) e por QUINTIL de votos (1 feature).
 *   - Correlação de Spearman |erro| × distância e |erro| × votos.
 *   - Buckets fixos <3 / 3–6 / ≥6 (continuidade com calibration.ts).
 *
 * Decide: distância→erro monotônico ⇒ confiança per-obra defensável (Opção B′).
 *
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-distance-confidence.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getCurrentUserId } from "@/server/queries/current-user"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SELECT = `id, publication_status_id, total_chapters, synopsis_quality,
  observation_adjustment, user_score, is_archived,
  year, year_end, original_title,
  post_story_score, post_fl_score, post_ml_score,
  post_character_development_score, post_pacing_score,
  post_art_visual_score, post_impact_immersion_score,
  post_originality_score,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

interface Point { dist: number; votes: number; absErr: number }

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

/** MAE + n + faixa da variável por QUANTIL (q buckets de tamanho ~igual). */
function byQuantile(points: Point[], key: "dist" | "votes", q: number) {
  const sorted = [...points].sort((a, b) => a[key] - b[key])
  const out: Array<{ label: string; n: number; mae: number; lo: number; hi: number }> = []
  for (let b = 0; b < q; b++) {
    const start = Math.floor((b * sorted.length) / q)
    const end = Math.floor(((b + 1) * sorted.length) / q)
    const slice = sorted.slice(start, end)
    if (slice.length === 0) continue
    out.push({
      label: `Q${b + 1}`,
      n: slice.length,
      mae: mean(slice.map((p) => p.absErr)),
      lo: slice[0][key],
      hi: slice[slice.length - 1][key],
    })
  }
  return out
}

/** Spearman ρ: Pearson dos ranks. Positivo = variável maior ⇒ erro maior. */
function spearman(points: Point[], key: "dist" | "votes"): number {
  const n = points.length
  if (n < 3) return NaN
  const rank = (vals: number[]): number[] => {
    const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
    const r = new Array<number>(n)
    for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i
    return r
  }
  const rx = rank(points.map((p) => p[key]))
  const ry = rank(points.map((p) => p.absErr))
  const mx = mean(rx), my = mean(ry)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my)
    dx += (rx[i] - mx) ** 2
    dy += (ry[i] - my) ** 2
  }
  return num / Math.sqrt(dx * dy)
}

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
  if (worksRes.error) throw new Error(worksRes.error.message)
  const rawWorks = worksRes.data as RawWork[]
  const weights = weightsRes.data as ScoreWeight[]
  const config = configRes.data?.[0] as FormulaConfig

  // computeRecalc MUTA os works (expectedScore + __expectedDistance via instrumentação).
  const works = rawWorks.map((r) => buildWork(r, biasMap))
  const res = computeRecalc({
    works, weights, config, tasteProfile, declaredTagPrefs,
    includeQuality: false, aiQualityByWork: new Map(), fast: true,
  })

  type W = {
    userScore: number | null; expectedScore: number | null; totalVotes: number
    expectedIsStub: boolean; __expectedDistance?: number
  }
  const labeled = (works as unknown as W[]).filter(
    (w) => w.userScore != null && w.expectedScore != null && w.__expectedDistance != null && !w.expectedIsStub,
  )

  const points: Point[] = labeled.map((w) => ({
    dist: w.__expectedDistance as number,
    votes: w.totalVotes,
    absErr: Math.abs((w.expectedScore as number) - (w.userScore as number)),
  }))

  console.log("\n============ VERIFICAÇÃO: distância (do todo) prevê o erro? ============")
  console.log(`obras totais=${works.length} · rotuladas usáveis=${points.length} · isStub=${res.rows ? "" : ""}predictor stub? ${(works as unknown as W[]).some((w) => w.expectedIsStub)}`)
  console.log(`MAE global (piso) = ${mean(points.map((p) => p.absErr)).toFixed(4)}`)
  console.log(`distância: min=${Math.min(...points.map((p) => p.dist)).toFixed(2)} · mediana=${[...points].sort((a, b) => a.dist - b.dist)[Math.floor(points.length / 2)].dist.toFixed(2)} · max=${Math.max(...points.map((p) => p.dist)).toFixed(2)}`)

  console.log("\n----- MAE por QUINTIL de DISTÂNCIA (sinal do todo) -----")
  console.log("  bucket   n    faixa-dist       MAE")
  for (const b of byQuantile(points, "dist", 5)) {
    console.log(`  ${b.label}   ${String(b.n).padStart(3)}   ${b.lo.toFixed(2)}–${b.hi.toFixed(2).padEnd(6)}   ${b.mae.toFixed(4)}`)
  }
  console.log(`  Spearman ρ(distância, |erro|) = ${spearman(points, "dist").toFixed(3)}   (positivo+alto = distância prevê erro)`)

  console.log("\n----- MAE por QUINTIL de VOTOS (1 feature — comparação) -----")
  console.log("  bucket   n    faixa-votos      MAE")
  for (const b of byQuantile(points, "votes", 5)) {
    console.log(`  ${b.label}   ${String(b.n).padStart(3)}   ${b.lo.toFixed(0)}–${String(b.hi.toFixed(0)).padEnd(6)}   ${b.mae.toFixed(4)}`)
  }
  console.log(`  Spearman ρ(votos, |erro|) = ${spearman(points, "votes").toFixed(3)}`)

  console.log("\n----- Buckets FIXOS de distância (continuidade com calibration.ts) -----")
  for (const bk of [{ label: "< 3", lo: 0, hi: 3 }, { label: "3–6", lo: 3, hi: 6 }, { label: "≥ 6", lo: 6, hi: Infinity }]) {
    const slice = points.filter((p) => p.dist >= bk.lo && p.dist < bk.hi)
    const mae = slice.length >= 10 ? mean(slice.map((p) => p.absErr)).toFixed(4) : "n<10"
    console.log(`  ${bk.label.padEnd(4)} n=${String(slice.length).padStart(3)}   MAE=${mae}`)
  }

  console.log("\n(read-only concluído — 0 escrita, 0 LLM)")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })
