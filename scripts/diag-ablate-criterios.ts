/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ABLAÇÃO dos 9 atributos como FEATURE da Nota Prevista — read-only, US$0.
 *
 * A pergunta: melhorar a régua de qual critério pagaria? Sabemos que 4 estão colapsados
 * (`action_adventure` σ 1,35 com 0% na faixa 9-10, `protagonist` σ 0,89, `romance` 1,16,
 * `fantasy_nobility` 1,66 — todos ≥69% numa faixa só) e que feature quase-constante não
 * contribui pro Ridge. O que NÃO sabemos é quanto cada um de fato carrega hoje.
 *
 * Método: zerar a variância de UM critério por vez (constante ⇒ contribuição zero, e as
 * outras features refitam) e medir o OOF honesto. Mesma técnica do `diag-ablate-runlength`,
 * reusando `expectedOutOfFoldPredictions`.
 *
 * ⚠️ Isto mede CONTRIBUIÇÃO ATUAL, não POTENCIAL. Um critério colapsado contribui pouco
 * PORQUE está colapsado — descolapsá-lo poderia fazê-lo contribuir muito. A leitura correta
 * é: contribuição alta ⇒ a régua dele já está fazendo trabalho e mexer é arriscado;
 * contribuição ~zero ⇒ ou o critério é irrelevante pra nota, ou está sendo desperdiçado.
 * O experimento não distingue os dois, e afirmar que distingue seria o erro de sempre.
 *
 * ⚠️ Ablação de UM por vez também não vê redundância: dois critérios correlacionados podem
 * dar "contribuição zero" cada um e valer muito juntos, porque o Ridge cobre a falta de um
 * com o outro.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-ablate-criterios.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { expectedOutOfFoldPredictions, type ExpectedScoreInput } from "@/lib/calculations/expected"
import { CRITERION_SLUGS } from "@/types/domain"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source),
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

const mae = (p: number[], y: number[]) => p.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / p.length
const sigma = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const f3 = (n: number) => n.toFixed(3)

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
  const works = rawWorks.map((r) => buildWork(r, weightsRes.data ? biasMap : biasMap))
  computeRecalc({
    works,
    weights: weightsRes.data as ScoreWeight[],
    config: configRes.data?.[0] as FormulaConfig,
    tasteProfile,
    declaredTagPrefs,
    includeQuality: false,
    aiQualityByWork: new Map(),
    fast: true,
  })

  const rot = (works as any[]).filter((w) => w.userScore != null)
  const inputs = rot.map(toInput)
  const targets = rot.map((w) => w.userScore as number)
  const base = expectedOutOfFoldPredictions(inputs, targets, false)
  if (!base) return console.log("preditor stub — amostra insuficiente")
  const maeBase = mae(base, targets)

  console.log(`\n══ ABLAÇÃO DOS 9 ATRIBUTOS — ${rot.length} rotuladas · MAE base ${f3(maeBase)} ══`)
  console.log(`   Δ POSITIVO = tirar PIORA ⇒ o critério contribui. Δ ~0 = não carrega nada hoje.`)
  console.log(`   ${"critério".padEnd(20)}${"σ na amostra".padStart(14)}${"Δ MAE ao tirar".padStart(17)}`)

  const linhas: { slug: string; sd: number; delta: number }[] = []
  for (const slug of CRITERION_SLUGS) {
    const vals = inputs.map((i) => Number((i.categoryScores as any)?.[slug] ?? NaN)).filter(Number.isFinite)
    // Constante = variância zero ⇒ o Ridge não consegue usar a coluna, e as demais refitam.
    const ablado = inputs.map((i) => ({ ...i, categoryScores: { ...(i.categoryScores as any), [slug]: 5 } }))
    const oof = expectedOutOfFoldPredictions(ablado as ExpectedScoreInput[], targets, false)
    if (!oof) continue
    linhas.push({ slug, sd: sigma(vals), delta: mae(oof, targets) - maeBase })
  }
  for (const l of linhas.sort((a, b) => b.delta - a.delta)) {
    const marca = l.delta < 0.002 ? "  ← não carrega" : ""
    console.log(`   ${l.slug.padEnd(20)}${f3(l.sd).padStart(14)}${((l.delta >= 0 ? "+" : "") + f3(l.delta)).padStart(17)}${marca}`)
  }

  const inertes = linhas.filter((l) => l.delta < 0.002)
  console.log(`\n   ${inertes.length} de 9 não carregam nada SOZINHOS: ${inertes.map((l) => l.slug).join(", ") || "—"}`)

  // 🔴 REDUNDÂNCIA ESTRUTURAL — sem isto o bloco acima MENTE.
  // `iaEvalNormalized` (GPT.N) é a soma PONDERADA dos 9 atributos e também é feature. Tirar
  // um atributo deixa a informação dele dentro do GPT.N, então "Δ ~0" pode significar
  // "redundante", não "inútil". Ablação de um por vez é cega pra isso por construção.
  const semTodos = inputs.map((i) => ({
    ...i,
    categoryScores: Object.fromEntries(CRITERION_SLUGS.map((s) => [s, 5])) as any,
  }))
  const semGpt = inputs.map((i) => ({ ...i, iaEvalNormalized: 5 }))
  const semAmbos = semTodos.map((i) => ({ ...i, iaEvalNormalized: 5 }))
  const d = (rows: ExpectedScoreInput[]) => {
    const o = expectedOutOfFoldPredictions(rows, targets, false)
    return o ? mae(o, targets) - maeBase : NaN
  }
  console.log(`\n   quem carrega de verdade (o GPT.N é a soma ponderada dos 9 e TAMBÉM é feature):`)
  console.log(`   ${"tirando os 9 atributos (GPT.N fica)".padEnd(42)}Δ ${(d(semTodos as ExpectedScoreInput[]) >= 0 ? "+" : "") + f3(d(semTodos as ExpectedScoreInput[]))}`)
  console.log(`   ${"tirando só o GPT.N (os 9 ficam)".padEnd(42)}Δ ${(d(semGpt) >= 0 ? "+" : "") + f3(d(semGpt))}`)
  console.log(`   ${"tirando os 9 E o GPT.N".padEnd(42)}Δ ${(d(semAmbos as ExpectedScoreInput[]) >= 0 ? "+" : "") + f3(d(semAmbos as ExpectedScoreInput[]))}`)
  console.log(`   ⚠️ Se só a última linha move, a avaliação de IA importa mas é INDIFERENTE à`)
  console.log(`      forma — 9 notas ou 1 resumo delas dá no mesmo pro Ridge.`)
  console.log(`\n(read-only — 0 escrita)\n`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
