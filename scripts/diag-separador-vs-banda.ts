/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "O que a separa" ainda cobre o que foi calibrado, com a banda em 0,25? — read-only, US$0.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-separador-vs-banda.ts
 *
 * Companheiro do `diag-separador-grade.ts`: lá o eixo varrido é o LIMIAR (com a banda fixa),
 * aqui é a BANDA (com o limiar fixo em 1σ). São as duas metades da mesma pergunta.
 *
 * `SEPARATOR_MIN_SIGMA = 1` foi calibrado (why-this-work.ts) sobre os tiers REAIS do topo-45
 * construídos com banda **0,5** — T1=7 · T2=38, dando 73% das obras com separador, "o joelho
 * da curva". A banda virou 0,25 (migration 190). Tier menor ⇒ mais grupos pequenos, e grupo de
 * 1 devolve `null` por construção: a cobertura pode ter mudado sem ninguém mexer no limiar.
 *
 * Este script roda os módulos de PRODUÇÃO (buildRankingTiers + forceMomentsOf + whyThisWork),
 * não uma cópia.
 */
import { createClient } from "@supabase/supabase-js"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"
import { roundToDisplayScore } from "@/lib/score-rounding"
import { whyThisWork, forceMomentsOf } from "@/lib/ranking/why-this-work"
import { computeWorkForces as cwf } from "@/lib/calculations/forces"
const computeWorkForces = (i: Item) => cwf({ chanceScore: i.chanceScore, platformAvg: i.platformAvg, totalVotes: i.totalVotes })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Item = {
  workId: string
  expectedScore: number
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number
}

async function carregar(): Promise<Item[]> {
  const out: Item[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("calculated_scores")
      .select("work_id, expected_score, chance_score, platform_avg, total_votes")
      .not("expected_score", "is", null)
      .order("expected_score", { ascending: false })
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    out.push(
      ...data.map((r: any) => ({
        workId: r.work_id as string,
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

/** Réplica exata do que a RankingTable faz: mesma chave, mesmos momentos, mesmo agrupamento. */
function medir(entries: Item[], band: number) {
  const tiered = buildRankingTiers(entries, (e) => roundToDisplayScore(e.expectedScore), band)
  const grupos: Item[][] = []
  let i = 0
  while (i < entries.length) {
    let j = i
    while (j + 1 < entries.length && tiered[j + 1].tier === tiered[i].tier) j++
    grupos.push(entries.slice(i, j + 1))
    i = j + 1
  }
  const moments = forceMomentsOf(entries)
  let comSeparador = 0
  let comSeparadorLoo = 0
  let emTierUnitario = 0
  for (const g of grupos) {
    if (g.length < 2) emTierUnitario += g.length
    for (const item of g) {
      if (whyThisWork(item, g, moments)) comSeparador++
      if (temSeparadorLoo(item, g, moments)) comSeparadorLoo++
    }
  }
  return {
    band,
    tiers: grupos.length,
    maior: Math.max(...grupos.map((g) => g.length)),
    unitarios: grupos.filter((g) => g.length === 1).length,
    obrasEmTierUnitario: emTierUnitario,
    "cobertura %": +((comSeparador / entries.length) * 100).toFixed(1),
    "cobertura LOO %": +((comSeparadorLoo / entries.length) * 100).toFixed(1),
  }
}

/**
 * A mesma conta do `whyThisWork`, com UMA diferença: a média é a das OUTRAS obras do
 * tier, não a do grupo inteiro.
 *
 * 🔴 A hipótese que isto testa. Com média INCLUSIVA, a própria obra puxa a média na
 * direção dela — o desvio sai encolhido pelo fator exato `(1 − 1/n)`: ×0,50 num tier
 * de 2, ×0,67 em 3, ×0,96 em 23. Estreitar a banda cria tiers menores, então parte da
 * queda de cobertura não é sinal que sumiu, é o encolhimento mecânico ficando maior.
 */
function temSeparadorLoo(item: Item, group: Item[], moments: any): boolean {
  if (group.length < 2) return false
  const f = computeWorkForces(item)
  for (const key of ["chance", "avaliacao", "alcance"] as const) {
    const value = (f as any)[key]
    if (value == null || !Number.isFinite(value)) continue
    const sd = moments?.[key]?.sd
    if (!sd || !Number.isFinite(sd) || sd < 1e-6) continue
    const outros = group
      .filter((x) => x !== item)
      .map((x) => (computeWorkForces(x) as any)[key])
      .filter((v: any): v is number => v != null && Number.isFinite(v))
    if (!outros.length) continue
    const mean = outros.reduce((a: number, b: number) => a + b, 0) / outros.length
    if (Math.abs((value - mean) / sd) >= 1) return true
  }
  return false
}

async function main() {
  const todas = await carregar()
  console.log(`catálogo com Nota Prevista: ${todas.length} obras\n`)

  for (const [rotulo, entries] of [
    ["topo-45 (o recorte da calibração)", todas.slice(0, 45)],
    ["topo-40 (o default de Obras exibidas)", todas.slice(0, 40)],
    ["catálogo inteiro", todas],
  ] as const) {
    console.log(`── ${rotulo} — ${entries.length} obras`)
    console.table([medir(entries as Item[], 0.5), medir(entries as Item[], 0.25)])
  }
}

main()
