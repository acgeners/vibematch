/**
 * ranking-baselines.ts — comparação READ-ONLY do ranking atual vs baselines simples.
 *
 * Objetivo (AUDIT_REPORT-2026-07-08, P1): antes de mexer na fórmula, medir se a
 * Nota Prevista (expected_score) ordena MELHOR que baselines triviais. Não escreve
 * nada — só SELECT. Reusa as métricas PURAS de lib/metrics/ranking-metrics.ts.
 *
 * Uso: npm run baselines:ranking
 *   (npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/ranking-baselines.ts)
 *
 * ⚠️ LEAKAGE: a avaliação "vs user_score" roda sobre as obras ROTULADAS, que são
 * o próprio conjunto de treino do Ridge/logística → é IN-SAMPLE (otimista). Serve
 * de sanity-check comparativo entre orderings (todos sofrem o mesmo viés), NÃO
 * como estimativa honesta de acurácia. A medição honesta virá dos
 * prediction_snapshots prospectivos quando resolverem (nota chega depois do snapshot).
 */
import { createClient } from "@supabase/supabase-js"
import {
  computeRankingMetrics,
  spearman,
  type RankedPair,
} from "@/lib/metrics/ranking-metrics"

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

type Row = {
  id: string
  user_score: number | null
  is_archived: boolean
  expected_score: number | null
  calc_score: number | null
  chance_score: number | null
  personal_fit: number | null
  tag_overlap_net: number | null
  platform_avg: number | null
  total_votes: number | null
}

type RawCS = {
  expected_score: number | null
  calc_score: number | null
  chance_score: number | null
  personal_fit: number | null
  tag_overlap_net: number | null
  platform_avg: number | null
  total_votes: number | null
}
type RawWork = {
  id: string
  user_score: number | null
  is_archived: boolean
  calculated_scores: RawCS | RawCS[] | null
}

async function fetchRows(): Promise<Row[]> {
  const out: Row[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from("works")
      .select(
        "id, user_score, is_archived, calculated_scores(expected_score, calc_score, chance_score, personal_fit, tag_overlap_net, platform_avg, total_votes)",
      )
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const w of (data ?? []) as unknown as RawWork[]) {
      const cs = Array.isArray(w.calculated_scores) ? w.calculated_scores[0] : w.calculated_scores
      out.push({
        id: w.id,
        user_score: w.user_score,
        is_archived: w.is_archived,
        expected_score: cs?.expected_score ?? null,
        calc_score: cs?.calc_score ?? null,
        chance_score: cs?.chance_score ?? null,
        personal_fit: cs?.personal_fit ?? null,
        tag_overlap_net: cs?.tag_overlap_net ?? null,
        platform_avg: cs?.platform_avg ?? null,
        total_votes: cs?.total_votes ?? null,
      })
    }
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}

/** z-score de um vetor (média 0, dp 1); constante → zeros. */
function zscore(xs: number[]): number[] {
  const n = xs.length
  if (n === 0) return []
  const m = xs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / n) || 1
  return xs.map((x) => (x - m) / sd)
}

/** Baselines = funções score(row) → number|null. Maior = melhor. */
const BASELINES: Record<string, (r: Row) => number | null> = {
  "expected (atual)": (r) => r.expected_score,
  "calc_score": (r) => r.calc_score,
  "tag_overlap_net": (r) => r.tag_overlap_net,
  "popularidade (log votos)": (r) => (r.total_votes != null ? Math.log1p(r.total_votes) : null),
  "platform_avg": (r) => r.platform_avg,
}

function topKIds(rows: Row[], score: (r: Row) => number | null, k: number): Set<string> {
  return new Set(
    rows
      .filter((r) => score(r) != null)
      .sort((a, b) => (score(b) as number) - (score(a) as number))
      .slice(0, k)
      .map((r) => r.id),
  )
}
function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length
  const uni = new Set([...a, ...b]).size
  return uni === 0 ? 0 : inter / uni
}

function tierSizes(scores: number[], band: number): number[] {
  const sorted = [...scores].sort((a, b) => b - a)
  const sizes: number[] = []
  let anchor: number | null = null
  let cur = 0
  for (const s of sorted) {
    if (anchor === null || anchor - s > band) {
      if (cur) sizes.push(cur)
      anchor = s
      cur = 1
    } else cur++
  }
  if (cur) sizes.push(cur)
  return sizes
}

async function main() {
  const rows = await fetchRows()
  const active = rows.filter((r) => !r.is_archived)
  const labeled = active.filter((r) => r.user_score != null)
  console.log(`\n== DADOS == total=${rows.length} active=${active.length} labeled=${labeled.length}\n`)

  // ── 1) Redundância entre orderings (todo o acervo ativo) ──
  console.log("== 1) REDUNDÂNCIA: Spearman(expected, baseline) sobre o acervo ativo ==")
  console.log("   (1,0 = mesma ordem que a Nota Prevista → baseline não adiciona nada)")
  for (const [name, score] of Object.entries(BASELINES)) {
    if (name.startsWith("expected")) continue
    const pairs: RankedPair[] = active
      .map((r) => ({ predicted: r.expected_score, actual: score(r) }))
      .filter((p): p is RankedPair => p.predicted != null && p.actual != null)
    const s = spearman(pairs)
    console.log(`   expected × ${name.padEnd(26)} ρ=${s == null ? "n/a" : s.toFixed(3)}  (n=${pairs.length})`)
  }

  // ── 2) Overlap top-k entre expected e cada baseline ──
  console.log("\n== 2) OVERLAP top-k (Jaccard) — quão iguais são as listas do topo ==")
  const expScore = BASELINES["expected (atual)"]
  for (const [name, score] of Object.entries(BASELINES)) {
    if (name.startsWith("expected")) continue
    const parts = [10, 20, 40].map((k) => `top${k}=${jaccard(topKIds(active, expScore, k), topKIds(active, score, k)).toFixed(2)}`)
    console.log(`   expected × ${name.padEnd(26)} ${parts.join("  ")}`)
  }

  // ── 3) Distribuição por bandas (discriminação) ──
  console.log("\n== 3) BANDAS (band=0,5) — concentração da ordenação ==")
  for (const [name, score] of Object.entries(BASELINES)) {
    const vals = active.map(score).filter((v): v is number => v != null)
    if (vals.length === 0) continue
    const sizes = tierSizes(vals, 0.5)
    console.log(`   ${name.padEnd(26)} #tiers=${sizes.length}  maiorTier=${Math.max(...sizes)}  top3=[${sizes.slice(0, 3).join(",")}]`)
  }

  // ── 4) Acurácia vs user_score (IN-SAMPLE / com leakage) ──
  console.log("\n== 4) vs user_score (⚠️ IN-SAMPLE — rotuladas = treino; comparativo, não honesto) ==")
  console.log("   pairAcc  spearman  ndcg@10  regret@10  prec@10   (actual = user_score)")
  const baselinesWithCombo: Record<string, (r: Row) => number | null> = { ...BASELINES }
  // baseline combinado calc+tag (z-score somado) — precisa do vetor todo p/ padronizar.
  {
    const withBoth = labeled.filter((r) => r.calc_score != null && r.tag_overlap_net != null)
    const zc = zscore(withBoth.map((r) => r.calc_score as number))
    const zt = zscore(withBoth.map((r) => r.tag_overlap_net as number))
    const combo = new Map<string, number>()
    withBoth.forEach((r, i) => combo.set(r.id, zc[i] + zt[i]))
    baselinesWithCombo["calc + tag (z-sum)"] = (r) => combo.get(r.id) ?? null
  }
  for (const [name, score] of Object.entries(baselinesWithCombo)) {
    const pairs: RankedPair[] = labeled
      .map((r) => ({ predicted: score(r), actual: r.user_score }))
      .filter((p): p is RankedPair => p.predicted != null && p.actual != null)
    if (pairs.length < 3) {
      console.log(`   ${name.padEnd(26)} n<3`)
      continue
    }
    const m = computeRankingMetrics(pairs)
    const f = (v: number | null) => (v == null ? " n/a " : v.toFixed(3))
    console.log(
      `   ${name.padEnd(26)} ${f(m.pairwiseAccuracy)}  ${f(m.spearman)}   ${f(m.ndcgAt10)}   ${f(m.regretAt10)}    ${f(m.precisionAt10)}  (n=${pairs.length})`,
    )
  }

  console.log(
    "\nLeitura: se 'expected' NÃO supera 'calc_score'/'calc + tag' de forma clara (com IC),\n" +
      "a sofisticação não está pagando o custo. A prova honesta virá dos prediction_snapshots\n" +
      "prospectivos quando resolverem (nota registrada APÓS o snapshot).\n",
  )
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
