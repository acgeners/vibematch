/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A grade que decide o "O que a separa": MÉDIA × LIMIAR, juntos — read-only, US$0.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-separador-grade.ts
 *
 * 🔴 Rode isto ANTES de mexer em `SEPARATOR_MIN_SIGMA` ou na banda do tier. Os dois eixos
 * se movem juntos: a banda muda o tamanho do tier, o tamanho do tier muda o quanto a média
 * pesa, e a média muda onde o limiar corta. Foi varrer um eixo só que deixou a coluna
 * calibrada contra uma configuração que não existia mais.
 *
 * A calibração original (why-this-work.ts) varreu só o LIMIAR, com a média fixa em
 * inclusiva e a banda em 0,5 — e escolheu 1σ por dar 73% no topo-45, "o joelho da
 * curva". Com a banda em 0,25 (migration 190) os dois eixos mudaram de lugar, e variar
 * um só de novo repetiria o erro: a média inclusiva encolhe o desvio por `(k−1)/k`,
 * onde k é quantas obras do tier TÊM aquela força — ×0,50 num empate de duas.
 *
 * Régua da escolha, herdada da calibração: cobertura ALTA é o defeito (rotular todo
 * mundo não diferencia nada). Cobertura baixa não é defeito por si — "nada a separa
 * daqui" é resposta. O alvo declarado era ~73%.
 */
import { createClient } from "@supabase/supabase-js"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"
import { roundToDisplayScore } from "@/lib/score-rounding"
import { forceMomentsOf } from "@/lib/ranking/why-this-work"
import { computeWorkForces } from "@/lib/calculations/forces"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type Item = {
  expectedScore: number
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number
}
const forcasDe = (i: Item) =>
  computeWorkForces({ chanceScore: i.chanceScore, platformAvg: i.platformAvg, totalVotes: i.totalVotes })

async function carregar(): Promise<Item[]> {
  const out: Item[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("calculated_scores")
      .select("expected_score, chance_score, platform_avg, total_votes")
      .not("expected_score", "is", null)
      .order("expected_score", { ascending: false })
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    out.push(
      ...data.map((r: any) => ({
        expectedScore: Number(r.expected_score),
        chanceScore: r.chance_score == null ? null : Number(r.chance_score),
        platformAvg: r.platform_avg == null ? null : Number(r.platform_avg),
        totalVotes: Number(r.total_votes ?? 0),
      })),
    )
    if (data.length < 1000) break
  }
  return out
}

function tiersDe(entries: Item[], band: number): Item[][] {
  const tiered = buildRankingTiers(entries, (e) => roundToDisplayScore(e.expectedScore), band)
  const grupos: Item[][] = []
  let i = 0
  while (i < entries.length) {
    let j = i
    while (j + 1 < entries.length && tiered[j + 1].tier === tiered[i].tier) j++
    grupos.push(entries.slice(i, j + 1))
    i = j + 1
  }
  return grupos
}

/** Cobertura (% com separador) para uma combinação de média × limiar. */
function cobertura(entries: Item[], band: number, loo: boolean, limiar: number): number {
  const moments = forceMomentsOf(entries as any)
  let n = 0
  for (const g of tiersDe(entries, band)) {
    if (g.length < 2) continue
    for (const item of g) {
      const f = forcasDe(item)
      let achou = false
      for (const key of ["chance", "avaliacao", "alcance"] as const) {
        const value = (f as any)[key]
        const sd = (moments as any)[key]?.sd
        if (value == null || !Number.isFinite(value) || !sd || sd < 1e-6) continue
        const base = loo ? g.filter((x) => x !== item) : g
        const vals = base.map(forcasDe).map((x: any) => x[key]).filter((v: any) => v != null && Number.isFinite(v))
        if (!vals.length || (!loo && vals.length < 2)) continue
        const mean = vals.reduce((a: number, b: number) => a + b, 0) / vals.length
        if (Math.abs((value - mean) / sd) >= limiar) { achou = true; break }
      }
      if (achou) n++
    }
  }
  return +((n / entries.length) * 100).toFixed(1)
}

async function main() {
  const todas = await carregar()
  const LIMIARES = [0.75, 1, 1.25, 1.5, 1.75]

  for (const [rotulo, entries, band] of [
    ["topo-40 · banda 0,25 (o que a pessoa vê hoje)", todas.slice(0, 40), 0.25],
    ["topo-45 · banda 0,25", todas.slice(0, 45), 0.25],
    ["topo-40 · banda 0,5 (a calibração original)", todas.slice(0, 40), 0.5],
    ["catálogo · banda 0,25", todas, 0.25],
  ] as const) {
    console.log(`\n── ${rotulo} — ${entries.length} obras`)
    console.table(
      LIMIARES.map((l) => ({
        "limiar σ": l,
        "média inclusiva %": cobertura(entries as Item[], band, false, l),
        "média das outras (LOO) %": cobertura(entries as Item[], band, true, l),
      })),
    )
  }
  console.log("\nAlvo declarado na calibração original: ~73%. Cobertura ALTA é o defeito.\n")
}

main()
