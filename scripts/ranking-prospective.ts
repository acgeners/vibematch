/**
 * ranking-prospective.ts — relatório PROSPECTIVO read-only dos snapshots de RANKING.
 *
 * Lê `prediction_snapshots` com `prediction_context = 'ranking_snapshot'` e mede,
 * SEM leakage, se o ranking exibido acertou — usando SÓ os snapshots RESOLVIDOS
 * (obras que estavam sem nota no snapshot e foram avaliadas DEPOIS).
 *
 * READ-ONLY: apenas SELECT. Não altera fórmula, ranking, UI, dados nem snapshots.
 * Reusa as funções PURAS de lib/metrics/* (as mesmas do /admin/model-metrics).
 *
 * Uso: npm run prospective:ranking
 *   (contexto padrão = ranking_snapshot; `--context=recommendation` para o path pago,
 *    fora do escopo por padrão. ledger_backfill NUNCA entra.)
 *
 * ⚠️ VIÉS DE SELEÇÃO: só resolve o que você lê e avalia → o conjunto resolvido
 * NÃO é uma amostra aleatória (tende às obras que você escolheu ler). Tratar
 * diferenças como direcionais até haver n suficiente + IC que exclua 0.
 */
import { createClient } from "@supabase/supabase-js"
import {
  computeSnapshotStats,
  selectPrimaryPredictionPerWork,
  computeProspectiveSummary,
  errorStats,
  type ResolvedSnapshot,
} from "@/lib/metrics/prediction-metrics"
import { computeRankingMetrics, spearman, type RankedPair } from "@/lib/metrics/ranking-metrics"

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

// Contexto padrão = ranking_snapshot. Flag futura: --context=recommendation.
// ledger_backfill não é aceito (fora do escopo prospectivo de ranking).
const argContext = process.argv.find((a) => a.startsWith("--context="))?.split("=")[1]
const CONTEXT = argContext === "recommendation" ? "recommendation" : "ranking_snapshot"

// Limiares de confiança (por obra distinta resolvida).
const N_FACT = 30 // ≥ → FATO MEDIDO
const N_DIR = 10 // ≥ → DIRECIONAL
const MIN_GROUP = 5 // obras resolvidas por run p/ métricas de ordenação
const MIN_SEGMENT = 20 // obras resolvidas por filters_key p/ métricas do segmento

type Confidence = "FATO MEDIDO" | "DIRECIONAL" | "DADOS INSUFICIENTES"
function classify(n: number): Confidence {
  if (n >= N_FACT) return "FATO MEDIDO"
  if (n >= N_DIR) return "DIRECIONAL"
  return "DADOS INSUFICIENTES"
}

interface RawRow {
  work_id: string
  ranking_snapshot_id: string | null
  filters_key: string | null
  formula_version: string
  training_sample_size: number | string | null
  predicted_score: number | string | null
  calc_score: number | string | null
  personal_fit: number | string | null
  decision_score: number | string | null
  alignment_score: number | string | null
  rank_position: number | null
  tier: number | null
  actual_user_score: number | string | null
  resolved_at: string | null
  superseded: boolean
  predicted_is_stub: boolean
  captured_at: string
}

/** ResolvedSnapshot + campos ricos que as funções base não carregam. */
interface RichResolved extends ResolvedSnapshot {
  personalFit: number | null
  alignmentScore: number | null
  rankPosition: number | null
  filtersKey: string | null
  rankingSnapshotId: string | null
}

const num = (v: number | string | null): number | null =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v)

async function fetchAll(): Promise<RawRow[]> {
  const out: RawRow[] = []
  let from = 0
  const cols =
    "work_id, ranking_snapshot_id, filters_key, formula_version, training_sample_size, " +
    "predicted_score, calc_score, personal_fit, decision_score, alignment_score, rank_position, tier, " +
    "actual_user_score, resolved_at, superseded, predicted_is_stub, captured_at"
  for (;;) {
    const { data, error } = await db
      .from("prediction_snapshots")
      .select(cols)
      .eq("prediction_context", CONTEXT)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as unknown as RawRow[]))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}

function zscore(xs: number[]): number[] {
  const n = xs.length
  if (n === 0) return []
  const m = xs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / n) || 1
  return xs.map((x) => (x - m) / sd)
}

// Bootstrap determinístico (LCG semeado) — sem Math.random, reproduzível.
function makeRng(seed = 42): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}
function bootstrapCI(values: number[], stat: (xs: number[]) => number, B = 2000): [number, number] {
  const rng = makeRng(42)
  const n = values.length
  const acc: number[] = []
  for (let b = 0; b < B; b++) {
    const sample = new Array<number>(n)
    for (let i = 0; i < n; i++) sample[i] = values[Math.floor(rng() * n)]
    acc.push(stat(sample))
  }
  acc.sort((a, b) => a - b)
  return [acc[Math.floor(0.025 * B)], acc[Math.floor(0.975 * B)]]
}
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const f = (v: number | null | undefined, d = 3) => (v == null || !Number.isFinite(v) ? " n/a " : v.toFixed(d))

async function main() {
  console.log(`\n════ RELATÓRIO PROSPECTIVO DE RANKING · contexto = ${CONTEXT} ════`)
  console.log("READ-ONLY (só SELECT). Fora do escopo por padrão: ledger_backfill, recommendation.\n")

  const rows = await fetchAll()

  // ── COBERTURA (sempre) ──
  const stats = computeSnapshotStats(
    rows.map((r) => ({
      workId: r.work_id,
      rankingSnapshotId: r.ranking_snapshot_id,
      resolvedAt: r.resolved_at,
      superseded: r.superseded,
    })),
  )
  const stubCount = rows.filter((r) => r.predicted_is_stub).length

  // resolvidos por run (obras distintas) → runs com ≥5
  const resolvedByRun = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.resolved_at == null || r.superseded || r.actual_user_score == null || r.ranking_snapshot_id == null) continue
    const set = resolvedByRun.get(r.ranking_snapshot_id) ?? new Set<string>()
    set.add(r.work_id)
    resolvedByRun.set(r.ranking_snapshot_id, set)
  }
  const runsWith5 = [...resolvedByRun.values()].filter((s) => s.size >= MIN_GROUP).length

  console.log("── COBERTURA ──")
  console.log(`  snapshots registrados ......... ${stats.recorded}`)
  console.log(`  snapshots resolvidos .......... ${stats.resolved}`)
  console.log(`  snapshots pendentes ........... ${stats.pending}`)
  console.log(`  superseded (excluídos) ........ ${stats.superseded}`)
  console.log(`  stub (excluídos das métricas) . ${stubCount}`)
  console.log(`  obras distintas registradas ... ${stats.uniqueWorksPredicted}`)
  console.log(`  obras distintas resolvidas .... ${stats.uniqueWorksEvaluated}`)
  console.log(`  taxa de resolução (snapshots) . ${stats.resolutionRate == null ? "n/a" : (stats.resolutionRate * 100).toFixed(1) + "%"}`)
  console.log(`  taxa de resolução (por obra) .. ${stats.resolutionRateByWork == null ? "n/a" : (stats.resolutionRateByWork * 100).toFixed(1) + "%"}`)
  console.log(`  runs (ranking_snapshot_id) .... ${stats.rankingsRecorded}`)
  console.log(`  runs com ≥${MIN_GROUP} obras resolvidas .. ${runsWith5}`)

  // distribuição por filters_key
  console.log("\n── DISTRIBUIÇÃO POR filters_key ──")
  const byFk = new Map<string, { recorded: number; resolvedWorks: Set<string> }>()
  for (const r of rows) {
    const k = r.filters_key ?? "(sem filters_key / antigo)"
    const e = byFk.get(k) ?? { recorded: 0, resolvedWorks: new Set<string>() }
    e.recorded++
    if (r.resolved_at != null && !r.superseded && r.actual_user_score != null) e.resolvedWorks.add(r.work_id)
    byFk.set(k, e)
  }
  for (const [k, e] of [...byFk.entries()].sort((a, b) => b[1].recorded - a[1].recorded)) {
    const short = k.length > 70 ? k.slice(0, 67) + "…" : k
    console.log(`  registrados=${String(e.recorded).padStart(4)}  obras_resolvidas=${String(e.resolvedWorks.size).padStart(3)}  ${short}`)
  }

  console.log("\n  ⚠️ VIÉS DE SELEÇÃO: só resolve o que você leu e avaliou — o conjunto resolvido")
  console.log("     NÃO é aleatório. Interprete diferenças como direcionais até n + IC excluir 0.")

  // ── Conjunto resolvido (sem superseded, sem stub) ──
  const richAll: RichResolved[] = rows
    .filter((r) => r.resolved_at != null && !r.superseded && !r.predicted_is_stub && r.actual_user_score != null)
    .map((r) => ({
      workId: r.work_id,
      capturedAt: r.captured_at,
      resolvedAt: r.resolved_at as string,
      superseded: r.superseded,
      predictedIsStub: r.predicted_is_stub,
      actual: num(r.actual_user_score) as number,
      predictedScore: num(r.predicted_score),
      calcScore: num(r.calc_score),
      decisionScore: num(r.decision_score),
      formulaVersion: r.formula_version,
      trainingSampleSize: num(r.training_sample_size),
      personalFit: num(r.personal_fit),
      alignmentScore: num(r.alignment_score),
      rankPosition: r.rank_position,
      filtersKey: r.filters_key,
      rankingSnapshotId: r.ranking_snapshot_id,
    }))

  // 1 previsão por obra (sem pseudorreplicação). selectPrimary devolve os MESMOS
  // objetos → mantêm os campos ricos; recast seguro.
  const primary = selectPrimaryPredictionPerWork(richAll) as RichResolved[]
  const nWorks = primary.length

  // ── Guard: 0 resolvidos (estado atual esperado) ──
  if (nWorks === 0) {
    console.log("\n════════════════════════════════════════════════════════════")
    console.log("DADOS INSUFICIENTES para métricas prospectivas (0 obras resolvidas).")
    console.log("Isto é ESPERADO: as obras snapshotadas no /ranking são 'Quero ler'/'Sem status'")
    console.log("(não lidas). Elas só resolvem quando você as ler e der uma nota — aí")
    console.log("`resolvePredictionsForWork` casa a nota real com o snapshot pré-rótulo.")
    console.log("Sem resolvidos: NÃO calculo MAE, pairwise, NDCG, regret nem precision.")
    console.log("Volte a rodar conforme for avaliando obras que apareceram no ranking.")
    console.log("════════════════════════════════════════════════════════════\n")
    return
  }

  console.log(`\n════ MÉTRICAS PROSPECTIVAS · ${nWorks} obras resolvidas (1 por obra) ════`)
  console.log(`Classificação global: ${classify(nWorks)}  (FATO≥${N_FACT} · DIRECIONAL≥${N_DIR})\n`)

  // ── (A) MAE/RMSE — só scores na escala 0–10 (mean, expected, calc, decision) ──
  const actuals = primary.map((p) => p.actual)
  const meanY = meanOf(actuals)
  const pairsFor = (sel: (p: RichResolved) => number | null) =>
    primary.filter((p) => sel(p) != null).map((p) => ({ predicted: sel(p) as number, actual: p.actual }))
  const summaryExpected = computeProspectiveSummary(primary)
  const st = {
    mean: errorStats(actuals.map((a) => ({ predicted: meanY, actual: a }))),
    expected: errorStats(pairsFor((p) => p.predictedScore)),
    calc: errorStats(pairsFor((p) => p.calcScore)),
    decision: errorStats(pairsFor((p) => p.decisionScore)),
  }
  console.log("── (A) MAE/RMSE (escala 0–10; cada linha na sua própria cobertura) ──")
  console.log("   score            n     MAE     RMSE")
  console.log(`   média(baseline) ${String(st.mean.count).padStart(4)}  ${f(st.mean.mae)}  ${f(st.mean.rmse)}`)
  console.log(`   expected        ${String(st.expected.count).padStart(4)}  ${f(st.expected.mae)}  ${f(st.expected.rmse)}   (signed=${f(summaryExpected.meanSignedError)})`)
  console.log(`   calc            ${String(st.calc.count).padStart(4)}  ${f(st.calc.mae)}  ${f(st.calc.rmse)}`)
  console.log(`   decision        ${String(st.decision.count).padStart(4)}  ${f(st.decision.mae)}  ${f(st.decision.rmse)}`)

  // Common subset (expected & calc presentes) + diferença pareada + bootstrap IC.
  const sub = primary.filter((p) => p.predictedScore != null && p.calcScore != null)
  console.log(`\n── (A2) expected vs calc no MESMO subconjunto (n=${sub.length}) ──`)
  if (sub.length === 0) {
    console.log("   DADOS INSUFICIENTES (subconjunto vazio).")
  } else {
    const absExp = sub.map((p) => Math.abs(p.actual - (p.predictedScore as number)))
    const absCalc = sub.map((p) => Math.abs(p.actual - (p.calcScore as number)))
    const diff = sub.map((_, i) => absCalc[i] - absExp[i]) // >0 → expected melhor (erra menos)
    const maeExp = meanOf(absExp)
    const maeCalc = meanOf(absCalc)
    console.log(`   MAE expected = ${f(maeExp)} | MAE calc = ${f(maeCalc)} | Δ(calc−expected) = ${f(meanOf(diff))}`)
    // Bootstrap IC conforme n
    if (sub.length < 10) {
      console.log("   IC: não calculado (n<10). Classificação: DADOS INSUFICIENTES.")
    } else {
      const note = sub.length < N_FACT ? " (DIRECIONAL — n<30, cautela)" : " (FATO MEDIDO — mas ainda com cautela)"
      const ciMaeExp = bootstrapCI(absExp, meanOf)
      const ciDiff = bootstrapCI(diff, meanOf)
      console.log(`   IC95% MAE expected: [${f(ciMaeExp[0])}, ${f(ciMaeExp[1])}]${note}`)
      console.log(`   IC95% Δ(calc−expected): [${f(ciDiff[0])}, ${f(ciDiff[1])}]`)
      const excludesZero = ciDiff[0] > 0 || ciDiff[1] < 0
      if (!excludesZero) {
        console.log("   → CONCLUSÃO: superioridade NÃO demonstrada (IC da diferença inclui 0).")
      } else if (meanOf(diff) > 0) {
        console.log("   → CONCLUSÃO: expected supera calc (IC exclui 0, Δ>0).")
      } else {
        console.log("   → CONCLUSÃO: calc supera expected (IC exclui 0, Δ<0).")
      }
    }
  }

  // ── (B) ORDENAÇÃO POOLED (scale-invariant): inclui personal_fit e calc+fit(z) ──
  // Pooled = todos os resolvidos juntos (actual = user_score). Não é por-run;
  // é o teste "score maior → nota maior". calc+fit(z) e personal_fit só fazem
  // sentido em ordenação (escalas diferentes de 0–10), como no ranking-baselines.
  console.log(`\n── (B) ORDENAÇÃO POOLED (todos resolvidos, actual=user_score; n=${nWorks}) ──`)
  console.log(`   ${classify(nWorks)} — pairwise/spearman abaixo (ordenação é scale-invariant).`)
  const withBoth = primary.filter((p) => p.calcScore != null && p.personalFit != null)
  const zc = zscore(withBoth.map((p) => p.calcScore as number))
  const zf = zscore(withBoth.map((p) => p.personalFit as number))
  const comboByWork = new Map<string, number>()
  withBoth.forEach((p, i) => comboByWork.set(p.workId, zc[i] + zf[i]))
  const orderings: Array<[string, (p: RichResolved) => number | null]> = [
    ["expected", (p) => p.predictedScore],
    ["calc", (p) => p.calcScore],
    ["decision", (p) => p.decisionScore],
    ["personal_fit", (p) => p.personalFit],
    ["calc+fit(z)", (p) => comboByWork.get(p.workId) ?? null],
  ]
  console.log("   ordenação       n    pairAcc  spearman")
  for (const [name, sel] of orderings) {
    const pairs: RankedPair[] = primary.filter((p) => sel(p) != null).map((p) => ({ predicted: sel(p) as number, actual: p.actual }))
    if (pairs.length < 3) {
      console.log(`   ${name.padEnd(14)} ${String(pairs.length).padStart(3)}  DADOS INSUFICIENTES`)
      continue
    }
    const m = computeRankingMetrics(pairs)
    console.log(`   ${name.padEnd(14)} ${String(pairs.length).padStart(3)}  ${f(m.pairwiseAccuracy)}   ${f(spearman(pairs))}`)
  }

  // ── (C) ORDENAÇÃO POR RUN (ranking_snapshot_id, ≥5 resolvidos) ──
  console.log(`\n── (C) ORDENAÇÃO POR RUN (grupos com ≥${MIN_GROUP} obras resolvidas) ──`)
  const usableGroups: RichResolved[][] = []
  {
    const byRun = new Map<string, RichResolved[]>()
    for (const p of primary) {
      if (p.rankingSnapshotId == null || p.predictedScore == null) continue
      const arr = byRun.get(p.rankingSnapshotId) ?? []
      arr.push(p)
      byRun.set(p.rankingSnapshotId, arr)
    }
    for (const g of byRun.values()) if (g.length >= MIN_GROUP) usableGroups.push(g)
  }
  if (usableGroups.length === 0) {
    console.log(`   DADOS INSUFICIENTES: nenhum run com ≥${MIN_GROUP} obras resolvidas.`)
    console.log("   (Exige avaliar 5+ obras que apareceram JUNTAS num mesmo ranking.)")
  } else {
    const agg = (metric: (g: RichResolved[], byRank: boolean) => number | null, byRank: boolean) => {
      const vals = usableGroups.map((g) => metric(g, byRank)).filter((v): v is number => v != null && Number.isFinite(v))
      return vals.length ? meanOf(vals) : null
    }
    const rmByPred = (g: RichResolved[]) =>
      computeRankingMetrics(g.map((p) => ({ predicted: p.predictedScore as number, actual: p.actual })))
    // ordem EXIBIDA: rank_position asc = topo; -rank pra "maior = melhor".
    const rmByRank = (g: RichResolved[]) =>
      computeRankingMetrics(g.filter((p) => p.rankPosition != null).map((p) => ({ predicted: -(p.rankPosition as number), actual: p.actual })))
    console.log(`   runs úteis = ${usableGroups.length}  |  métrica = média entre runs`)
    console.log("   ordem            pairAcc  ndcg@5  ndcg@10  prec@5  regret@5")
    for (const [label, rm, br] of [["por expected_score", rmByPred, false], ["por rank_position (exibida)", rmByRank, true]] as const) {
      console.log(
        `   ${label.padEnd(28)} ${f(agg((g) => rm(g).pairwiseAccuracy, br))}  ${f(agg((g) => rm(g).ndcgAt5, br))}  ${f(agg((g) => rm(g).ndcgAt10, br))}  ${f(agg((g) => rm(g).precisionAt5, br))}  ${f(agg((g) => rm(g).regretAt5, br))}`,
      )
    }
  }

  // ── (D) SEGMENTAÇÃO POR filters_key (≥20 obras resolvidas por segmento) ──
  console.log(`\n── (D) SEGMENTAÇÃO POR filters_key (métricas só com ≥${MIN_SEGMENT} obras resolvidas) ──`)
  const segMap = new Map<string, RichResolved[]>()
  for (const p of primary) {
    const k = p.filtersKey ?? "(sem filters_key)"
    const arr = segMap.get(k) ?? []
    arr.push(p)
    segMap.set(k, arr)
  }
  for (const [k, seg] of [...segMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const short = k.length > 60 ? k.slice(0, 57) + "…" : k
    if (seg.length < MIN_SEGMENT) {
      console.log(`   [${String(seg.length).padStart(3)}] DADOS INSUFICIENTES · ${short}`)
      continue
    }
    const eMae = errorStats(seg.filter((p) => p.predictedScore != null).map((p) => ({ predicted: p.predictedScore as number, actual: p.actual }))).mae
    const cMae = errorStats(seg.filter((p) => p.calcScore != null).map((p) => ({ predicted: p.calcScore as number, actual: p.actual }))).mae
    const pairs = seg.filter((p) => p.predictedScore != null).map((p) => ({ predicted: p.predictedScore as number, actual: p.actual }))
    console.log(`   [${String(seg.length).padStart(3)}] ${classify(seg.length)} · MAE exp=${f(eMae)} calc=${f(cMae)} pairAcc=${f(computeRankingMetrics(pairs).pairwiseAccuracy)} · ${short}`)
  }

  console.log("\n── LEGENDA ──")
  console.log("   FATO MEDIDO = n≥30 + IC exclui 0 · DIRECIONAL = 10≤n<30 (indício) · DADOS INSUFICIENTES = n<10")
  console.log("   Só declare 'X supera Y' quando o IC da diferença pareada excluir 0.\n")
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
