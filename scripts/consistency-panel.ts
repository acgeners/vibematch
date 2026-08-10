/**
 * PAINEL DE CONSISTÊNCIA das notas de atributo.
 *
 * A régua que faltava — e a razão de ela faltar é instrutiva. O gold
 * (`scripts/gold-mae.ts`) mede PRECISÃO: distância até o julgamento da curadora, n=30, piso
 * de detecção **0,10**. As tentativas v23/v24/v25 foram reprovadas por ele, mas o que elas
 * mudavam era majoritariamente COERÊNCIA e CONSISTÊNCIA — e o ganho de precisão disponível
 * (~0,05) está ABAIXO do que aquele instrumento enxerga. Foi medir a coisa certa com a régua
 * errada, quatro vezes.
 *
 * 🔴 O número que fecha o argumento: o ruído entre DUAS RODADAS IDÊNTICAS é **0,289**
 * (151 pares). Nenhuma diferença de prompt menor que isso é distinguível de ruído por
 * comparação direta. Consistência, ao contrário, é medível sobre o catálogo inteiro — 8.757
 * notas vigentes, sem rótulo humano, sem custo de IA, sem falso positivo de regex.
 *
 * As quatro dimensões:
 *
 *   1. DISPERSÃO      — share por faixa e σ dos 9 critérios (4 estão colapsados)
 *   2. RÉGUAS VIVAS   — quantas versões de prompt × modelo coexistem no catálogo
 *   3. REPRODUTIBILIDADE — amplitude entre reavaliações da mesma obra, com e sem controle
 *   4. COERÊNCIA prosa×nota — delegada a `scripts/coherence-audit.ts` (checagem A, estrutural)
 *
 * ⚠️ Este painel NÃO mede acurácia e não substitui o gold. Uma régua pode ficar perfeitamente
 * consistente e estar consistentemente errada. Os dois instrumentos respondem perguntas
 * diferentes e nenhum dos dois sozinho autoriza trocar a régua do catálogo.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/consistency-panel.ts
 *   ... --save=.consistency/v26.json          # grava o retrato de hoje
 *   ... --baseline=.consistency/v26.json      # compara com um retrato anterior
 *
 * 🔴 Só o modo --baseline responde "melhorou?". Um número solto não diz nada: `protagonist`
 * com σ 0,89 é ruim, mas se o retrato anterior tinha 0,71 então a mudança FUNCIONOU. Medir
 * movimento é justamente o que a empreitada v23–v25 não conseguiu fazer.
 */
import { createClient } from "@supabase/supabase-js"
import { CRITERION_SLUGS } from "@/types/domain"
import { bandForScore } from "@/lib/criteria/justification"
import fs from "node:fs"
import path from "node:path"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const sb = createClient(url, key, { auth: { persistSession: false } })

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=")

/** ⚠️ O `select` do PostgREST corta em 1000 linhas sem avisar — pagine sempre. */
async function todas<T>(tabela: string, cols: string, filtro?: (q: never) => unknown): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(tabela).select(cols).range(from, from + 999)
    if (filtro) q = filtro(q as never) as typeof q
    const { data, error } = await q
    if (error) throw new Error(`${tabela}: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

function sigma(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

const pct = (n: number, d: number) => (d ? (100 * n) / d : 0)
const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
/** Delta com sinal, ou vazio quando não há baseline. */
function delta(atual: number, antes: number | undefined, casas = 2, melhorSubindo = true): string {
  if (antes === undefined) return ""
  const d = atual - antes
  if (Math.abs(d) < 10 ** -casas / 2) return "  (=)"
  const seta = d > 0 === melhorSubindo ? "↑" : "↓"
  return `  (${seta}${d > 0 ? "+" : ""}${d.toFixed(casas)})`
}

interface Retrato {
  gerado_em: string
  dispersao: Record<string, { n: number; sigma: number; faixas: Record<string, number>; dominante: number }>
  reguas: { combinacoes: number; versoes: number; modelos: number; detalhe: Array<{ v: string; m: string; obras: number }> }
  reprodutibilidade: { pares_sem_controle: number; amplitude_sem_controle: number; pares_com_controle: number; amplitude_com_controle: number; por_criterio: Record<string, number> }
}

async function main() {
  const baselinePath = arg("baseline")
  const base: Retrato | undefined = baselinePath
    ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
    : undefined

  // ── 1. DISPERSÃO ────────────────────────────────────────────────────────────
  // As notas VIGENTES (category_scores), não as sugeridas: são elas que governam o
  // /ranking, os limiares min_/max_ e as features do Ridge.
  const vigentes = await todas<{ criterion_slug: string; score: number }>(
    "category_scores",
    "criterion_slug, score",
  )
  const dispersao: Retrato["dispersao"] = {}
  for (const slug of CRITERION_SLUGS) {
    const notas = vigentes.filter((r) => r.criterion_slug === slug).map((r) => Number(r.score))
    if (!notas.length) continue
    const faixas: Record<string, number> = {}
    for (const n of notas) faixas[bandForScore(n)] = (faixas[bandForScore(n)] ?? 0) + 1
    const dominante = Math.max(...Object.values(faixas))
    dispersao[slug] = {
      n: notas.length,
      sigma: sigma(notas),
      faixas: Object.fromEntries(Object.entries(faixas).map(([k, v]) => [k, pct(v, notas.length)])),
      dominante: pct(dominante, notas.length),
    }
  }

  // ── 2. RÉGUAS VIVAS ─────────────────────────────────────────────────────────
  const avals = await todas<{ id: string; work_id: string; prompt_version: string | null; model_name: string | null; status: string }>(
    "ai_evaluations",
    "id, work_id, prompt_version, model_name, status",
  )
  const avalPorId = new Map(avals.map((a) => [a.id, a]))
  const ligadas = await todas<{ work_id: string; ai_evaluation_id: string | null }>(
    "category_scores",
    "work_id, ai_evaluation_id",
  )
  const obrasPorRegua = new Map<string, Set<string>>()
  for (const cs of ligadas) {
    const a = cs.ai_evaluation_id ? avalPorId.get(cs.ai_evaluation_id) : undefined
    if (!a) continue
    const chave = `${a.prompt_version ?? "?"}|${a.model_name ?? "?"}`
    if (!obrasPorRegua.has(chave)) obrasPorRegua.set(chave, new Set())
    obrasPorRegua.get(chave)!.add(cs.work_id)
  }
  const detalhe = [...obrasPorRegua.entries()]
    .map(([k, s]) => ({ v: k.split("|")[0], m: k.split("|")[1], obras: s.size }))
    .sort((a, b) => b.obras - a.obras)
  const reguas: Retrato["reguas"] = {
    combinacoes: detalhe.length,
    versoes: new Set(detalhe.map((d) => d.v)).size,
    modelos: new Set(detalhe.map((d) => d.m)).size,
    detalhe,
  }

  // ── 3. REPRODUTIBILIDADE ────────────────────────────────────────────────────
  // 🔴 A comparação SEM controle mistura réguas diferentes e mede a deriva do prompt, não a
  // do modelo. A diferença entre as duas linhas é o tamanho do problema que este painel existe
  // para acompanhar: medido em 2026-08-10, 0,987 → 0,317 (68% vinha da mistura).
  const sugeridas = await todas<{ ai_evaluation_id: string; criterion_slug: string; suggested_score: number | null }>(
    "ai_evaluation_scores",
    "ai_evaluation_id, criterion_slug, suggested_score",
  )
  const semControle = new Map<string, number[]>()
  const comControle = new Map<string, number[]>()
  for (const s of sugeridas) {
    if (s.suggested_score == null) continue
    const a = avalPorId.get(s.ai_evaluation_id)
    if (!a || a.status !== "completed") continue
    const nota = Number(s.suggested_score)
    const k1 = `${a.work_id}|${s.criterion_slug}`
    const k2 = `${k1}|${a.prompt_version}|${a.model_name}`
    if (!semControle.has(k1)) semControle.set(k1, [])
    if (!comControle.has(k2)) comControle.set(k2, [])
    semControle.get(k1)!.push(nota)
    comControle.get(k2)!.push(nota)
  }
  const amplitudes = (m: Map<string, number[]>) =>
    [...m.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ k, amp: Math.max(...v) - Math.min(...v) }))
  const aSem = amplitudes(semControle)
  const aCom = amplitudes(comControle)
  const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const porCriterio: Record<string, number> = {}
  for (const slug of CRITERION_SLUGS) {
    const xs = aSem.filter((x) => x.k.split("|")[1] === slug).map((x) => x.amp)
    if (xs.length) porCriterio[slug] = media(xs)
  }
  const reprodutibilidade: Retrato["reprodutibilidade"] = {
    pares_sem_controle: aSem.length,
    amplitude_sem_controle: media(aSem.map((x) => x.amp)),
    pares_com_controle: aCom.length,
    amplitude_com_controle: media(aCom.map((x) => x.amp)),
    por_criterio: porCriterio,
  }

  // ── SAÍDA ───────────────────────────────────────────────────────────────────
  const retrato: Retrato = {
    gerado_em: new Date().toISOString(),
    dispersao,
    reguas,
    reprodutibilidade,
  }

  console.log("\n══ PAINEL DE CONSISTÊNCIA ══" + (base ? `  (baseline: ${path.basename(baselinePath!)} de ${base.gerado_em.slice(0, 10)})` : ""))

  console.log("\n1. DISPERSÃO — notas vigentes, por critério (ordenado por σ)")
  console.log("   ⚠️ o ⚠ marca faixa dominante ≥70%: convenção de LEITURA deste painel, não régua do domínio")
  const bandas = [...new Set(Object.values(dispersao).flatMap((d) => Object.keys(d.faixas)))].sort()
  console.log(`   ${"critério".padEnd(18)}${"n".padStart(5)}${"σ".padStart(8)}${"".padEnd(9)}${bandas.map((b) => b.padStart(7)).join("")}   dominante`)
  for (const [slug, d] of Object.entries(dispersao).sort((a, b) => a[1].sigma - b[1].sigma)) {
    const faixas = bandas.map((b) => f1(d.faixas[b] ?? 0).padStart(7)).join("")
    const marca = d.dominante >= 70 ? " ⚠" : "  "
    console.log(
      `   ${slug.padEnd(18)}${String(d.n).padStart(5)}${f2(d.sigma).padStart(8)}${delta(d.sigma, base?.dispersao[slug]?.sigma).padEnd(9)}${faixas}   ${f1(d.dominante)}%${marca}`,
    )
  }

  console.log(`\n2. RÉGUAS VIVAS no catálogo: ${reguas.combinacoes} combinações${delta(reguas.combinacoes, base?.reguas.combinacoes, 0, false)} (${reguas.versoes} versões de prompt × ${reguas.modelos} modelos)`)
  console.log("   🔴 toda comparação ENTRE obras — ordenação, limiar, Ridge, personal_fit — supõe uma régua só")
  for (const d of reguas.detalhe.slice(0, 12)) {
    console.log(`   ${d.v.padEnd(16)} ${d.m.padEnd(28)} ${String(d.obras).padStart(4)} obras`)
  }
  if (reguas.detalhe.length > 12) console.log(`   … e mais ${reguas.detalhe.length - 12}`)

  const r = reprodutibilidade
  console.log("\n3. REPRODUTIBILIDADE — amplitude entre reavaliações da mesma obra")
  console.log(`   sem controlar nada        ${f2(r.amplitude_sem_controle)} pt${delta(r.amplitude_sem_controle, base?.reprodutibilidade.amplitude_sem_controle, 2, false)}   (${r.pares_sem_controle} pares)`)
  console.log(`   controlando versão+modelo ${f2(r.amplitude_com_controle)} pt${delta(r.amplitude_com_controle, base?.reprodutibilidade.amplitude_com_controle, 2, false)}   (${r.pares_com_controle} pares)`)
  const atribuivel = r.amplitude_sem_controle ? pct(r.amplitude_sem_controle - r.amplitude_com_controle, r.amplitude_sem_controle) : 0
  console.log(`   ⇒ ${f1(atribuivel)}% da instabilidade vem da MISTURA de réguas, não do modelo`)
  console.log(`   ⚠️ o piso é o ruído entre rodadas idênticas (0,289 medido) — abaixo disso nada é distinguível`)
  const piores = Object.entries(r.por_criterio).sort((a, b) => b[1] - a[1]).slice(0, 3)
  console.log(`   piores: ${piores.map(([s, v]) => `${s} ${f2(v)}`).join(" · ")}`)

  console.log("\n4. COERÊNCIA prosa×nota — rode `scripts/coherence-audit.ts` (checagem A, estrutural)")
  console.log("   ⚠️ só a checagem A sobrevive à validação manual; as semânticas eram regex sobre prosa e deram 5/5 e 6/6 de falso positivo\n")

  const savePath = arg("save")
  if (savePath) {
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    fs.writeFileSync(savePath, JSON.stringify(retrato, null, 2))
    console.log(`retrato salvo em ${savePath}\n`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
