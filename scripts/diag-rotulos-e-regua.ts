/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DUAS perguntas sobre a Nota Prevista, as duas read-only e US$0. Elas decidem entre os dois
 * caminhos caros que hoje competem sem número: **avaliar mais obras** ou **uniformizar o
 * catálogo**.
 *
 *   1. CURVA DE APRENDIZADO — o gargalo é a quantidade de RÓTULOS?
 *      O Ridge treina em ~211 obras com ~30 features (~7 linhas por feature), território
 *      clássico de teto por amostra. Se a curva ainda desce no n atual, avaliar mais obras
 *      melhora a nota; se está plana, rótulo não é o gargalo e o esforço tem que ir pras
 *      features. Nunca foi medido.
 *
 *   2. RESÍDUO × RÉGUA — a mistura de prompts custa quanto em MAE?
 *      68% da instabilidade das notas de atributo vem de o catálogo ter 11 réguas convivendo
 *      (`npm run consistency`). Essas notas são FEATURE do Ridge, então o ruído entra na
 *      previsão. Isto converte "68% de instabilidade" em pontos de MAE — que é a moeda que
 *      importa, e o que precifica os ~US$37 de uma reavaliação do catálogo ANTES de gastar.
 *
 * 🔴 Nada de OOF caseiro: usa `trainExpectedPredictor` e `expectedOutOfFoldPredictions`, as
 * funções REAIS do recalc. Um preditor reimplementado aqui mediria outro modelo.
 *
 * ⚠️ Na curva, o conjunto de TESTE é FIXO e disjunto do treino. A alternativa óbvia — OOF
 * dentro de cada subamostra — confunde duas coisas: menos treino E menos pontos de avaliação.
 * O teste fixo isola a variável que a pergunta é sobre.
 *
 * ⚠️ Os dois experimentos são de ASSOCIAÇÃO. A curva não prova que rótulo novo virá da mesma
 * distribuição; o resíduo×régua não prova causa (obra velha tem régua velha E outras coisas
 * velhas — cobertura de review, tags). Servem pra ordenar investimento, não pra fechar questão.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-rotulos-e-regua.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import {
  expectedOutOfFoldPredictions,
  trainExpectedPredictor,
  type ExpectedScoreInput,
} from "@/lib/calculations/expected"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source, ai_evaluation_id),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

function toInput(w: any): ExpectedScoreInput {
  return {
    categoryScores: w.categoryScoresCalibrated,
    iaEvalNormalized: w.iaEvalNormalizedCalibrated,
    platformAvg: w.platformAvg,
    totalVotes: w.totalVotes,
    totalChapters: w.totalChapters,
    synopsisQuality: w.synopsisQuality,
    observationAdjustment: w.observationAdjustment,
    publicationStatus: w.publicationStatus,
    lovedTagOverlap: w.lovedTagOverlap,
    avoidedTagOverlap: w.avoidedTagOverlap,
    criterionFitScore: w.criterionFitScore,
    releaseAge: w.releaseAge,
    runLength: w.runLength,
    origin: w.origin,
    postScores: w.postScores,
  }
}

const mae = (pred: number[], y: number[]) =>
  pred.reduce((s, p, i) => s + Math.abs(p - y[i]), 0) / pred.length
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const f3 = (n: number) => n.toFixed(3)

/** PRNG com semente — a curva tem que ser reproduzível entre execuções. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
function embaralhar<T>(xs: T[], r: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function main() {
  const sb = createAdminClient()
  const ownerId = await getOwnerUserId(sb)
  const biasMap = await getBiasMap(ownerId, sb)
  const [worksRes, weightsRes, configRes, tasteProfile, declaredTagPrefs, ownerLabels] = await Promise.all([
    sb.from("works").select(SELECT).eq("is_archived", false).limit(2000),
    sb.from("score_weights").select("*").eq("is_active", true),
    sb.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    loadCurrentTasteProfile(ownerId),
    getDeclaredTagPreferences(sb, { headless: true }),
    loadOwnerLabels(),
  ])
  const rawWorks = withOwnerLabels(worksRes.data as (RawWork & { title: string })[], ownerLabels)
  const weights = weightsRes.data as ScoreWeight[]
  const config = configRes.data?.[0] as FormulaConfig

  const works = rawWorks.map((r) => buildWork(r, biasMap))
  computeRecalc({ works, weights, config, tasteProfile, declaredTagPrefs, includeQuality: false, aiQualityByWork: new Map(), fast: true })

  const rotuladas = (works as any[]).filter((w) => w.userScore != null)
  const inputs = rotuladas.map(toInput)
  const targets = rotuladas.map((w) => w.userScore as number)
  console.log(`\n══ RÓTULOS E RÉGUA — ${rotuladas.length} obras rotuladas de ${works.length} ativas ══`)

  // ── 1. CURVA DE APRENDIZADO ───────────────────────────────────────────────
  // Teste FIXO (30%), treino crescente sobre os 70% restantes. Repetido em várias
  // partições porque com n desta ordem uma partição só é ruído.
  const REPETICOES = 12
  const fracTeste = 0.3
  const nTeste = Math.round(rotuladas.length * fracTeste)
  const nMaxTreino = rotuladas.length - nTeste
  const degraus = [30, 50, 75, 100, 125, 150, nMaxTreino].filter((n, i, a) => n <= nMaxTreino && a.indexOf(n) === i)

  console.log(`\n1. CURVA DE APRENDIZADO — teste FIXO de ${nTeste} obras, ${REPETICOES} partições`)
  console.log(`   ⚠️ MAE aqui NÃO é comparável ao cv_mae_expected do painel: aquele é OOF sobre o`)
  console.log(`      conjunto todo; este é hold-out. O que interessa é a FORMA da curva.`)
  console.log(`   ${"n treino".padStart(9)}${"MAE teste".padStart(12)}${"Δ vs anterior".padStart(16)}`)

  const curva: { n: number; mae: number }[] = []
  for (const nTreino of degraus) {
    const maes: number[] = []
    for (let rep = 0; rep < REPETICOES; rep++) {
      const ordem = embaralhar([...inputs.keys()], rng(1000 + rep))
      const idxTeste = ordem.slice(0, nTeste)
      const idxTreino = ordem.slice(nTeste, nTeste + nTreino)
      const p = trainExpectedPredictor(idxTreino.map((i) => inputs[i]), idxTreino.map((i) => targets[i]), false)
      if (p.isStub) continue
      const pred = p.predict(idxTeste.map((i) => inputs[i])).map((r) => r.expected)
      maes.push(mae(pred, idxTeste.map((i) => targets[i])))
    }
    const m = media(maes)
    const ant = curva.at(-1)
    curva.push({ n: nTreino, mae: m })
    const delta = ant ? `${m - ant.mae >= 0 ? "+" : ""}${f3(m - ant.mae)}` : "—"
    console.log(`   ${String(nTreino).padStart(9)}${f3(m).padStart(12)}${delta.padStart(16)}`)
  }
  const ultimoGanho = curva.length >= 2 ? curva.at(-2)!.mae - curva.at(-1)!.mae : 0
  const passoFinal = curva.length >= 2 ? curva.at(-1)!.n - curva.at(-2)!.n : 1
  console.log(`\n   último trecho: ${f3(ultimoGanho)} de MAE por ${passoFinal} rótulos ⇒ ${f3((ultimoGanho / passoFinal) * 50)} por 50 rótulos novos`)
  console.log(
    ultimoGanho > 0.02
      ? `   ⇒ a curva AINDA DESCE: avaliar mais obras melhora a nota, e dá pra estimar quanto.`
      : `   ⇒ a curva ACHATOU: mais rótulo não é o gargalo. O esforço tem que ir pras FEATURES.`,
  )

  // ── 2. RESÍDUO × RÉGUA ────────────────────────────────────────────────────
  const avals = new Map<string, string>()
  for (let f = 0; ; f += 1000) {
    const { data } = await sb.from("ai_evaluations").select("id, prompt_version").range(f, f + 999)
    if (!data?.length) break
    for (const a of data) avals.set(a.id as string, (a.prompt_version as string) ?? "?")
    if (data.length < 1000) break
  }
  // ⚠️ A régua sai de uma query PRÓPRIA, não do `WorkComputed`: lá `categoryScores` já foi
  // transformado num mapa slug→nota e perdeu o `ai_evaluation_id` — a 1ª versão tentou ler
  // dele e estourou em `.map is not a function`.
  const reguasPorObra = new Map<string, Set<string>>()
  for (let f = 0; ; f += 1000) {
    const { data } = await sb.from("category_scores").select("work_id, ai_evaluation_id").range(f, f + 999)
    if (!data?.length) break
    for (const c of data) {
      const v = c.ai_evaluation_id ? (avals.get(c.ai_evaluation_id as string) ?? "?") : null
      if (!v) continue
      const k = c.work_id as string
      if (!reguasPorObra.has(k)) reguasPorObra.set(k, new Set())
      reguasPorObra.get(k)!.add(v)
    }
    if (data.length < 1000) break
  }
  /** Régua da obra = a versão da avaliação por trás das notas VIGENTES dela. */
  const reguaDe = (w: any): string => {
    const vs = [...(reguasPorObra.get(w.id) ?? [])]
    return vs.length === 0 ? "sem avaliação" : vs.length === 1 ? vs[0] : "MISTA"
  }

  const oof = expectedOutOfFoldPredictions(inputs, targets, false)
  console.log(`\n2. RESÍDUO × RÉGUA — erro OOF honesto, agrupado pela versão de prompt da obra`)
  if (!oof) {
    console.log(`   (preditor stub — amostra insuficiente)`)
  } else {
    const porRegua = new Map<string, number[]>()
    rotuladas.forEach((w, i) => {
      const k = reguaDe(w)
      if (!porRegua.has(k)) porRegua.set(k, [])
      porRegua.get(k)!.push(Math.abs(oof[i] - targets[i]))
    })
    const linhas = [...porRegua.entries()]
      .map(([regua, erros]) => ({ regua, n: erros.length, mae: media(erros) }))
      .filter((l) => l.n >= 5)
      .sort((a, b) => b.mae - a.mae)
    console.log(`   ⚠️ só réguas com n≥5; com menos, a média é ruído`)
    console.log(`   ${"régua".padEnd(16)}${"n".padStart(5)}${"MAE OOF".padStart(11)}`)
    for (const l of linhas) console.log(`   ${l.regua.padEnd(16)}${String(l.n).padStart(5)}${f3(l.mae).padStart(11)}`)
    const geral = media(oof.map((p, i) => Math.abs(p - targets[i])))
    console.log(`   ${"TODAS".padEnd(16)}${String(oof.length).padStart(5)}${f3(geral).padStart(11)}`)
    const amp = linhas.length >= 2 ? linhas[0].mae - linhas.at(-1)!.mae : 0
    console.log(`\n   amplitude entre a pior e a melhor régua: ${f3(amp)} de MAE`)

    // Prêmio MÁXIMO de uniformizar: as obras das réguas piores passarem à MELHOR observada.
    // ⚠️ É teto, não estimativa — supõe que a régua CAUSA a diferença inteira.
    const melhor = linhas.at(-1)!
    const erroAtual = linhas.reduce((s, l) => s + l.n * l.mae, 0)
    const erroIdeal = linhas.reduce((s, l) => s + l.n * Math.min(l.mae, melhor.mae), 0)
    const nTotal = linhas.reduce((s, l) => s + l.n, 0)
    console.log(`   teto do ganho, se a régua explicasse TUDO: ${f3((erroAtual - erroIdeal) / nTotal)} de MAE`)

    // 🔴 O confundidor: obra de régua velha também é obra ANTIGA no catálogo — menos review
    // raspada, tag menos madura. Se a contagem de reviews acompanhar o MAE, a régua pode
    // estar levando crédito (ou culpa) que é da EVIDÊNCIA.
    const revs = new Map<string, number>()
    for (let f = 0; ; f += 1000) {
      const { data } = await sb.from("work_reviews").select("work_id").range(f, f + 999)
      if (!data?.length) break
      for (const r of data) revs.set(r.work_id as string, (revs.get(r.work_id as string) ?? 0) + 1)
      if (data.length < 1000) break
    }
    const revPorRegua = new Map<string, number[]>()
    rotuladas.forEach((w) => {
      const k = reguaDe(w)
      if (!revPorRegua.has(k)) revPorRegua.set(k, [])
      revPorRegua.get(k)!.push(revs.get(w.id) ?? 0)
    })
    console.log(`\n   é a régua ou é a IDADE da obra? reviews por régua:`)
    console.log(`   ${"régua".padEnd(16)}${"MAE".padStart(8)}${"reviews (média)".padStart(18)}`)
    for (const l of linhas) {
      console.log(`   ${l.regua.padEnd(16)}${f3(l.mae).padStart(8)}${media(revPorRegua.get(l.regua) ?? []).toFixed(1).padStart(18)}`)
    }
    console.log(`   ⚠️ se reviews acompanharem o MAE, a régua leva crédito que é da EVIDÊNCIA —`)
    console.log(`      e reavaliar não conserta obra que simplesmente tem pouca review.`)
  }

  console.log("\n(read-only — 0 escrita)\n")
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
