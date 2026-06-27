/**
 * DIAGNÓSTICO de blast radius do recalc global (Frente 1, $0, 0 escrita).
 *
 * Read-only. Carrega os dados como o recalculateAll, roda o núcleo PURO
 * `computeRecalc` em memória e mede:
 *   1. PARITY  — baseline recomputado vs calculated_scores stored (base fresca ⇒ ~0).
 *   2. TIMING  — custo de 1 recalc completo (com e sem a nested-CV cara).
 *   3. BLAST RADIUS (leave-one-out) — perturba 1 obra, recomputa, mede Δ nas OUTRAS
 *      obras (nota + ranking). Por classe de edição: rótulo / atributo IA / capítulos.
 *
 * NÃO escreve nada. NÃO chama LLM. Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-recalc.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getCurrentUserId } from "@/server/queries/current-user"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

// ---- deterministic RNG (seeded) ----
function mkRand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}
function sample<T>(arr: T[], n: number, rand: () => number): T[] {
  const idx = arr.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, n).map((i) => arr[i])
}
function pctl(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

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

type Row = Record<string, unknown> & { work_id: string; expected_score: number | null; calc_score: number | null; tag_overlap_net: number | null; personal_fit: number | null }

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
  const includeQuality = false
  const aiQualityByWork = new Map<string, Record<string, number>>()

  const baseInput = () => ({
    works: rawWorks.map((r) => buildWork(r, biasMap)),
    weights, config, tasteProfile, declaredTagPrefs, includeQuality, aiQualityByWork,
  })

  // ---------- 1) PARITY + 2) TIMING ----------
  const t0 = Date.now()
  const baseline = computeRecalc({ ...baseInput(), fast: false })
  const tFull = Date.now() - t0
  const t1 = Date.now()
  computeRecalc({ ...baseInput(), fast: true })
  const tFast = Date.now() - t1

  const baseRows = baseline.rows as unknown as Row[]
  const baseById = new Map(baseRows.map((r) => [r.work_id, r]))

  const { data: storedData } = await supabase
    .from("calculated_scores")
    .select("work_id, expected_score, calc_score, tag_overlap_net, personal_fit")
    .limit(2000)
  const stored = (storedData ?? []) as Row[]
  const storedById = new Map(stored.map((r) => [r.work_id, r]))

  const parity: Record<string, number[]> = { expected_score: [], calc_score: [], tag_overlap_net: [], personal_fit: [] }
  for (const r of baseRows) {
    const s = storedById.get(r.work_id)
    if (!s) continue
    for (const k of Object.keys(parity)) {
      const a = r[k as keyof Row] as number | null
      const b = s[k as keyof Row] as number | null
      if (a == null || b == null) continue
      parity[k].push(Math.abs(a - b))
    }
  }

  console.log("\n===== 1) PARITY (baseline recomputado vs stored — base fresca ⇒ deve ser ~0) =====")
  for (const [k, ds] of Object.entries(parity)) {
    console.log(`  ${k}: n=${ds.length} max|Δ|=${Math.max(...ds).toExponential(2)} mediana=${pctl(ds, 0.5).toExponential(2)}`)
  }
  console.log("\n===== 2) TIMING (1 recalc completo, em memória, sem I/O de escrita) =====")
  console.log(`  computeRecalc fast=false (com nested-CV honesta): ${tFull} ms`)
  console.log(`  computeRecalc fast=true  (sem nested-CV):          ${tFast} ms`)
  console.log(`  obras=${rawWorks.length} · rotuladas=${rawWorks.filter((r) => r.user_score != null).length} · calcBlendWeight=${baseline.calcBlendWeight} · gptMean=${baseline.gptMean.toFixed(4)}`)

  // ---------- 3) BLAST RADIUS (leave-one-out) ----------
  // Ranking-proxy: ordena por (expected_score desc, tag_overlap_net desc). Mede a
  // mudança de ordem das OUTRAS obras (exclui a perturbada k de ambos os rankings).
  function rankExcept(rowsArr: Row[], excludeId: string): Map<string, number> {
    const others = rowsArr.filter((r) => r.work_id !== excludeId)
    others.sort((a, b) => (b.expected_score ?? -1) - (a.expected_score ?? -1) || (b.tag_overlap_net ?? -1e9) - (a.tag_overlap_net ?? -1e9))
    return new Map(others.map((r, i) => [r.work_id, i]))
  }

  function perturbAndMeasure(label: string, k: string, mutate: (raw: RawWork) => RawWork) {
    const perturbed = rawWorks.map((r) => (r.id === k ? mutate(structuredClone(r)) : r))
    const res = computeRecalc({
      works: perturbed.map((r) => buildWork(r, biasMap)),
      weights, config, tasteProfile, declaredTagPrefs, includeQuality, aiQualityByWork, fast: true,
    })
    const pRows = res.rows as unknown as Row[]
    const pById = new Map(pRows.map((r) => [r.work_id, r]))

    // Δ nas OUTRAS obras (exclui k)
    const dExp: number[] = []
    const dTag: number[] = []
    for (const r of baseRows) {
      if (r.work_id === k) continue
      const p = pById.get(r.work_id)
      if (!p) continue
      if (r.expected_score != null && p.expected_score != null) dExp.push(Math.abs(p.expected_score - r.expected_score))
      if (r.tag_overlap_net != null && p.tag_overlap_net != null) dTag.push(Math.abs(p.tag_overlap_net - r.tag_overlap_net))
    }
    // Ranking churn entre as outras obras
    const rb = rankExcept(baseRows, k)
    const rp = rankExcept(pRows, k)
    let moved1 = 0, moved5 = 0, maxMove = 0
    for (const [id, rbi] of rb) {
      const rpi = rp.get(id)
      if (rpi == null) continue
      const d = Math.abs(rpi - rbi)
      if (d >= 1) moved1++
      if (d >= 5) moved5++
      if (d > maxMove) maxMove = d
    }
    // top-20 churn
    const top = (m: Map<string, number>) => new Set([...m.entries()].filter(([, i]) => i < 20).map(([id]) => id))
    const tb = top(rb), tp = top(rp)
    let churn = 0
    for (const id of tb) if (!tp.has(id)) churn++

    return {
      label,
      blendJump: res.calcBlendWeight !== baseline.calcBlendWeight ? `${baseline.calcBlendWeight}→${res.calcBlendWeight}` : "—",
      gptMeanDelta: Math.abs(res.gptMean - baseline.gptMean),
      medExp: pctl(dExp, 0.5), p90Exp: pctl(dExp, 0.9), maxExp: Math.max(0, ...dExp),
      nExp01: dExp.filter((d) => d >= 0.01).length, nExp05: dExp.filter((d) => d >= 0.05).length, nExp10: dExp.filter((d) => d >= 0.1).length,
      maxTag: Math.max(0, ...dTag),
      moved1, moved5, maxMove, top20churn: churn,
    }
  }

  const rand = mkRand(20260627)
  const labeled = rawWorks.filter((r) => r.user_score != null)
  const unlabeled = rawWorks.filter((r) => r.user_score == null)

  const classes: Array<{ name: string; picks: RawWork[]; mutate: (r: RawWork) => RawWork }> = [
    {
      name: "A) rótulo user_score ±2 (obra lida)",
      picks: sample(labeled, 15, rand),
      mutate: (r) => { const v = Number(r.user_score); r.user_score = Math.max(0, Math.min(10, v + (v >= 7 ? -2 : 2))); return r },
    },
    {
      name: "B) atributo IA +2 (1 critério, qualquer obra)",
      picks: sample(rawWorks, 15, rand),
      mutate: (r) => { const cs = r.category_scores as Array<{ score: number }>; if (cs?.[0]) cs[0].score = Math.min(10, Number(cs[0].score) + 2); return r },
    },
    {
      name: "C) capítulos ×2 (obra NÃO-lida) — piso, esperado ~0",
      picks: sample(unlabeled, 10, rand),
      mutate: (r) => { r.total_chapters = (r.total_chapters ?? 50) * 2; return r },
    },
  ]

  for (const cls of classes) {
    console.log(`\n===== 3) BLAST RADIUS — ${cls.name} · n=${cls.picks.length} edições =====`)
    const rows = cls.picks.map((r) => perturbAndMeasure(cls.name, r.id, cls.mutate))
    const agg = (f: (x: typeof rows[number]) => number) => rows.map(f)
    const med = (xs: number[]) => pctl(xs, 0.5)
    console.log(`  Δexpected nas OUTRAS obras:  mediana(med|Δ|)=${med(agg((x) => x.medExp)).toFixed(4)}  pior p90=${Math.max(...agg((x) => x.p90Exp)).toFixed(4)}  pior max=${Math.max(...agg((x) => x.maxExp)).toFixed(4)}`)
    console.log(`  obras movidas ≥0.01: med=${med(agg((x) => x.nExp01))} · ≥0.05: med=${med(agg((x) => x.nExp05))} · ≥0.1: med=${med(agg((x) => x.nExp10))} (de ${rawWorks.length - 1})`)
    console.log(`  RANKING (outras): med(obras c/ rank mudado ≥1)=${med(agg((x) => x.moved1))} · ≥5 posições=${med(agg((x) => x.moved5))} · pior maxMove=${Math.max(...agg((x) => x.maxMove))} · pior top-20 churn=${Math.max(...agg((x) => x.top20churn))}`)
    const jumps = rows.filter((x) => x.blendJump !== "—")
    console.log(`  calcBlendWeight pulou em ${jumps.length}/${rows.length} edições${jumps.length ? " (" + jumps.map((x) => x.blendJump).join(", ") + ")" : ""} · pior |ΔgptMean|=${Math.max(...agg((x) => x.gptMeanDelta)).toExponential(2)} · pior Δtag_overlap nas outras=${Math.max(...agg((x) => x.maxTag)).toFixed(4)}`)
  }

  console.log("\n(diagnóstico read-only concluído — 0 escrita, 0 LLM)")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })
