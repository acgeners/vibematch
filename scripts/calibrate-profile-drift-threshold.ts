/**
 * ONE-OFF (análise) — Calibração empírica do θ de staleness do TasteProfile.
 *
 * Objetivo: substituir o gate binário `input_hash` por um limiar de MATERIALIDADE
 * (`driftPct` heurístico, já calculado por getProfileDrift). Este script mede, com
 * dado real, ONDE colocar o corte — enviesado LIBERAL (regenerar menos), já que o
 * catálogo é pré-filtrado (baixa dispersão ⇒ poucas edições quase nunca movem o
 * gosto destilado).
 *
 * Fase 0 — inventário do histórico de perfis.
 * Fase 1 — FIDELIDADE: nos pares de versão consecutivos, o driftPct heurístico
 *          (proxy grátis) prevê a mudança REAL do output LLM? Onde regens foram
 *          "desperdiçadas" (output ~igual)?
 * Fase 2 — SENSIBILIDADE: na biblioteca atual, quanto cada edição acumulada move
 *          o driftPct (leave-k-out + re-rating). Dá o knob humano ("N obras até θ").
 *
 * Rodar: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis \
 *        scripts/calibrate-profile-drift-threshold.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import {
  computeHeuristicFingerprint,
  compareFingerprints,
  type HeuristicFingerprint,
} from "@/lib/ai-recommendation/profile-drift"
import type { RatedWorkInput, TasteProfilePayload, ProfileTag } from "@/lib/ai-recommendation/types"

// ---------- helpers de estatística ----------
function pct(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
function summarize(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b)
  return { n: s.length, mean: mean(s), p50: pct(s, 0.5), p90: pct(s, 0.9), max: s[s.length - 1] ?? NaN }
}
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "  -  ")

// ---------- delta de OUTPUT real (ground truth) ----------
// Mede o quanto DOIS outputs LLM diferem. Duas granularidades:
//  - namesDrift: só nomes de tags amadas/evitadas (apples-to-apples com driftPct heurístico)
//  - fullDrift: + temas + narrative_patterns + prefs de critério (o que o preditor consome)
function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 1 : inter / union
}
const nameSet = (ts: ProfileTag[] | undefined) => new Set((ts ?? []).map((t) => t.name.toLowerCase().trim()))
const strSet = (ss: string[] | undefined) => new Set((ss ?? []).map((s) => s.toLowerCase().trim()))

function outputDelta(a: TasteProfilePayload, b: TasteProfilePayload) {
  const jLoved = jaccardSets(nameSet(a.loved_tags), nameSet(b.loved_tags))
  const jAvoided = jaccardSets(nameSet(a.avoided_tags), nameSet(b.avoided_tags))
  const namesDrift = 1 - (jLoved + jAvoided) / 2

  const jLovedThemes = jaccardSets(strSet(a.loved_themes), strSet(b.loved_themes))
  const jAvoidedThemes = jaccardSets(strSet(a.avoided_themes), strSet(b.avoided_themes))
  const jNarr = jaccardSets(strSet(a.narrative_patterns), strSet(b.narrative_patterns))

  // prefs de critério: L1 médio normalizado sobre ideal_min/max/weight (escala 0-10 → /10).
  const slugs = new Set([
    ...Object.keys(a.criterion_preferences ?? {}),
    ...Object.keys(b.criterion_preferences ?? {}),
  ])
  let critL1 = 0, critN = 0
  for (const s of slugs) {
    const pa = (a.criterion_preferences as Record<string, { ideal_min: number; ideal_max: number; weight: number } | undefined>)?.[s]
    const pb = (b.criterion_preferences as Record<string, { ideal_min: number; ideal_max: number; weight: number } | undefined>)?.[s]
    const va = pa ?? { ideal_min: 0, ideal_max: 0, weight: 0 }
    const vb = pb ?? { ideal_min: 0, ideal_max: 0, weight: 0 }
    critL1 += (Math.abs(va.ideal_min - vb.ideal_min) + Math.abs(va.ideal_max - vb.ideal_max)) / 20 + Math.abs(va.weight - vb.weight)
    critN += 1
  }
  const critDrift = critN ? critL1 / critN : 0

  // fullDrift: média das 6 dimensões de mudança (tudo em 0-1, maior = mudou mais).
  const fullDrift = (namesDrift + (1 - jLovedThemes) + (1 - jAvoidedThemes) + (1 - jNarr) + critDrift) / 5
  return { namesDrift, fullDrift }
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return NaN
  const mx = mean(xs), my = mean(ys)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    dx += (xs[i] - mx) ** 2
    dy += (ys[i] - my) ** 2
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy)
}

// ---------- PRNG determinístico (mulberry32) para reprodutibilidade ----------
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function sampleIndices(n: number, k: number, rnd: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, k)
}

// ============================================================
async function main() {
  const supabase = createAdminClient()

  // ---------- Fase 0: inventário ----------
  console.log("═══ FASE 0 — inventário do histórico de perfis ═══\n")
  const { data: rows, error } = await supabase
    .from("taste_profile")
    .select("id, version, is_stub, n_works_used, input_hash, heuristic_fingerprint, profile, model_name, prompt_version, created_at")
    .order("created_at", { ascending: true })
  if (error) throw new Error(`taste_profile read: ${error.message}`)
  const all = rows ?? []
  const withFp = all.filter((r) => r.heuristic_fingerprint != null)
  const fullNonStub = all.filter((r) => !r.is_stub)
  console.log(`versões totais:        ${all.length}`)
  console.log(`  não-stub:            ${fullNonStub.length}`)
  console.log(`  com fingerprint:     ${withFp.length}`)
  if (all.length) {
    console.log(`  span:                ${all[0].created_at}  →  ${all[all.length - 1].created_at}`)
    console.log(`  n_works progressão:  ${all.map((r) => r.n_works_used).join(" → ")}`)
    console.log(`  prompt versions:     ${[...new Set(all.map((r) => r.prompt_version))].join(", ")}`)
  }

  // ---------- Fase 1: fidelidade (pares de versão consecutivos) ----------
  console.log("\n\n═══ FASE 1 — FIDELIDADE: driftPct heurístico × mudança REAL do output ═══\n")
  const pairs: Array<{
    from: number; to: number; driftHeur: number; changedTags: number
    namesDrift: number; fullDrift: number; dWorks: number
  }> = []
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1], cur = all[i]
    if (prev.is_stub || cur.is_stub) continue
    const fpPrev = prev.heuristic_fingerprint as HeuristicFingerprint | null
    const fpCur = cur.heuristic_fingerprint as HeuristicFingerprint | null
    if (!fpPrev || !fpCur) continue
    const cmp = compareFingerprints(fpPrev, fpCur)
    const od = outputDelta(prev.profile as TasteProfilePayload, cur.profile as TasteProfilePayload)
    pairs.push({
      from: prev.version, to: cur.version,
      driftHeur: cmp.driftPct, changedTags: cmp.changedTags,
      namesDrift: od.namesDrift, fullDrift: od.fullDrift,
      dWorks: (cur.n_works_used ?? 0) - (prev.n_works_used ?? 0),
    })
  }
  if (pairs.length === 0) {
    console.log("⚠ Sem pares de versão com fingerprint em ambos os lados — fidelidade não calculável.")
    console.log("  (fingerprint só existe desde a migration 118; pares pré-migration não contam.)")
  } else {
    console.log(`pares analisáveis: ${pairs.length}\n`)
    console.log("  v→v   ΔobrasN  driftHeur  chgTags | namesDrift(real)  fullDrift(real)")
    for (const p of pairs) {
      console.log(
        `  ${String(p.from).padStart(2)}→${String(p.to).padStart(2)}   ${String(p.dWorks).padStart(6)}   ${f3(p.driftHeur)}     ${String(p.changedTags).padStart(4)}   |   ${f3(p.namesDrift)}            ${f3(p.fullDrift)}`,
      )
    }
    const rNames = pearson(pairs.map((p) => p.driftHeur), pairs.map((p) => p.namesDrift))
    const rFull = pearson(pairs.map((p) => p.driftHeur), pairs.map((p) => p.fullDrift))
    console.log(`\n  Pearson(driftHeur, namesDrift real) = ${f3(rNames)}`)
    console.log(`  Pearson(driftHeur, fullDrift  real) = ${f3(rFull)}`)
    const wasted = pairs.filter((p) => p.fullDrift < 0.05)
    console.log(`  regens com fullDrift<0.05 (~desperdício): ${wasted.length}/${pairs.length}`)
    // heurística tende a super- ou subestimar? (viés = driftHeur - namesDrift)
    const bias = mean(pairs.map((p) => p.driftHeur - p.namesDrift))
    console.log(`  viés médio (driftHeur − namesDrift): ${f3(bias)}  ${bias > 0 ? "→ heurística SUPERESTIMA (seguro p/ liberal)" : "→ heurística SUBESTIMA (cuidado)"}`)
  }

  // ---------- Fase 2: sensibilidade sintética (biblioteca atual) ----------
  console.log("\n\n═══ FASE 2 — SENSIBILIDADE: quanto cada edição acumulada move o driftPct ═══\n")
  const rated: RatedWorkInput[] = await getRatedWorksForProfile()
  console.log(`biblioteca atual: ${rated.length} obras avaliadas\n`)
  const baseFp = computeHeuristicFingerprint(rated)
  const rnd = mulberry32(20260705)
  const R = 400

  // 2a — leave-k-out (simula "as últimas k obras adicionadas causaram esse drift")
  console.log("── 2a. leave-k-out (remover k obras ≈ acumular k obras novas) ──")
  console.log("   k    mean   p50    p90    max   | %≥0.05  %≥0.10  %≥0.15  %≥0.20")
  const KS = [1, 2, 3, 5, 8, 12]
  const driftByK: Record<number, number[]> = {}
  for (const k of KS) {
    if (k >= rated.length) continue
    const drifts: number[] = []
    const reps = k === 1 ? Math.min(rated.length, R) : R
    for (let r = 0; r < reps; r++) {
      const drop = k === 1 ? [r % rated.length] : sampleIndices(rated.length, k, rnd)
      const dropSet = new Set(drop)
      const subset = rated.filter((_, i) => !dropSet.has(i))
      const fp = computeHeuristicFingerprint(subset)
      drifts.push(compareFingerprints(baseFp, fp).driftPct)
    }
    driftByK[k] = drifts
    const s = summarize(drifts)
    const frac = (th: number) => (drifts.filter((d) => d >= th).length / drifts.length)
    console.log(
      `   ${String(k).padStart(2)}   ${f3(s.mean)}  ${f3(s.p50)}  ${f3(s.p90)}  ${f3(s.max)}  |  ${(frac(0.05) * 100).toFixed(0).padStart(3)}%    ${(frac(0.10) * 100).toFixed(0).padStart(3)}%    ${(frac(0.15) * 100).toFixed(0).padStart(3)}%    ${(frac(0.20) * 100).toFixed(0).padStart(3)}%`,
    )
  }

  // 2b — re-rating: perturbar o user_score de k obras por ±δ (simula reavaliar notas)
  console.log("\n── 2b. re-rating (perturbar user_score de k obras por ±2) ──")
  console.log("   k    mean   p50    p90    max")
  for (const k of [1, 2, 3, 5]) {
    if (k >= rated.length) continue
    const drifts: number[] = []
    for (let r = 0; r < R; r++) {
      const targets = sampleIndices(rated.length, k, rnd)
      const tset = new Set(targets)
      const perturbed = rated.map((w, i) => {
        if (!tset.has(i) || w.userScore == null) return w
        const delta = rnd() < 0.5 ? -2 : 2
        const ns = Math.max(0, Math.min(10, w.userScore + delta))
        return { ...w, userScore: ns }
      })
      const fp = computeHeuristicFingerprint(perturbed)
      drifts.push(compareFingerprints(baseFp, fp).driftPct)
    }
    const s = summarize(drifts)
    console.log(`   ${String(k).padStart(2)}   ${f3(s.mean)}  ${f3(s.p50)}  ${f3(s.p90)}  ${f3(s.max)}`)
  }

  // ---------- Recomendação de θ (dados-guiados) ----------
  console.log("\n\n═══ LEITURA / RECOMENDAÇÃO ═══\n")
  const d1 = driftByK[1] ? summarize(driftByK[1]) : null
  const d3 = driftByK[3] ? summarize(driftByK[3]) : null
  const d5 = driftByK[5] ? summarize(driftByK[5]) : null
  if (d1) console.log(`1 obra:  p90=${f3(d1.p90)}  max=${f3(d1.max)}  (hoje input_hash trata QUALQUER uma como stale)`)
  if (d3) console.log(`3 obras: p90=${f3(d3.p90)}  max=${f3(d3.max)}`)
  if (d5) console.log(`5 obras: p90=${f3(d5.p90)}  max=${f3(d5.max)}`)
  for (const th of [0.08, 0.10, 0.12, 0.15, 0.20]) {
    const cross = KS.filter((k) => driftByK[k]).map((k) => {
      const frac = driftByK[k].filter((d) => d >= th).length / driftByK[k].length
      return `k=${k}:${(frac * 100).toFixed(0)}%`
    })
    console.log(`θ=${th.toFixed(2)} → P(trip) por nº de obras acumuladas: ${cross.join("  ")}`)
  }
  console.log("\n(θ liberal = deixar várias obras acumularem antes de P(trip) subir.)")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
