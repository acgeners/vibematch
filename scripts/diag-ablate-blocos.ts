/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ABLAÇÃO dos blocos de feature NÃO-atributo da Nota Prevista — read-only, US$0.
 *
 * Irmão do `diag-ablate-criterios.ts`, que fechou a porta dos atributos: os 9 + o GPT.N
 * somam **0,002 de MAE** (medido 2026-08-11, base 0,687). A conclusão registrada foi
 * "o caminho para melhorar a nota NÃO passa pela régua de atributos" — e a pergunta que
 * ficou escrita e nunca foi respondida é o complemento dela:
 *
 *   "o que resta nas features é plataforma, votos, capítulos, qualidade de sinopse,
 *    overlap de tags, idade e status. Nada disso foi ablado ainda."
 *
 * Este script abla esses blocos e diz onde ainda há sinal — ou prova que o preditor está
 * no teto e o esforço tem de ir para outro lugar (mais rótulos, outra família de modelo,
 * ou aceitar o MAE atual).
 *
 * ── MÉTODO, e onde ele difere do irmão ──────────────────────────────────────────────────
 *
 * Ablar = zerar a VARIÂNCIA da feature mantendo o centro, e deixar as outras refitarem.
 * O `diag-ablate-criterios.ts` usa a constante 5 porque toda nota de atributo vive em 0–10
 * e 5 é o meio da escala. Aqui as features têm escalas incompatíveis (votos em milhares,
 * idade em anos, overlap em fração), então a constante é a **média da própria amostra** —
 * a única escolha uniforme que não desloca o centro de nenhuma delas.
 *
 * 🔴 Ablação por BLOCO, nunca uma por vez. Foi o que o irmão aprendeu do jeito caro:
 * `platformAvg` e `totalVotes` descrevem o mesmo fato (o que o público achou) e se cobrem
 * mutuamente no Ridge, então cada uma sozinha daria "não carrega nada" e as duas juntas
 * poderiam valer muito. Mesma redundância que fazia os 9 atributos parecerem inertes
 * enquanto o GPT.N segurava a informação deles.
 *
 * ⚠️ Isto mede CONTRIBUIÇÃO ATUAL, não POTENCIAL — a mesma ressalva do irmão. Δ ~0 quer
 * dizer "não carrega hoje", o que é compatível tanto com "é irrelevante" quanto com "está
 * sendo desperdiçada". O experimento não distingue os dois.
 *
 * ⚠️ `criterionFitScore` deriva dos ATRIBUTOS e por isso tem bloco próprio: ele é a via
 * pela qual a avaliação de IA ainda pode chegar na nota depois de os 9 terem dado 0,002.
 * Se ele carregar, "a régua de atributos não importa" fica mais estreito do que soa.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-ablate-blocos.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { expectedOutOfFoldPredictions, type ExpectedScoreInput } from "@/lib/calculations/expected"
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
const f3 = (n: number) => n.toFixed(3)
const sinal = (n: number) => (n >= 0 ? "+" : "") + f3(n)

/** Média das entradas numéricas finitas — a constante com que se abla sem mover o centro. */
function media(inputs: ExpectedScoreInput[], get: (i: ExpectedScoreInput) => number | null): number {
  const xs = inputs.map(get).filter((v): v is number => v != null && Number.isFinite(v))
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Categoria mais frequente — o análogo da média para one-hot. */
function moda(inputs: ExpectedScoreInput[], get: (i: ExpectedScoreInput) => string): string {
  const c = new Map<string, number>()
  for (const i of inputs) {
    const v = get(i) || "unknown"
    c.set(v, (c.get(v) ?? 0) + 1)
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown"
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
  const works = rawWorks.map((r) => buildWork(r, biasMap))
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

  // Constantes de ablação, medidas na própria amostra.
  const mPlat = media(inputs, (i) => i.platformAvg)
  const mVotes = media(inputs, (i) => i.totalVotes)
  const mChap = media(inputs, (i) => i.totalChapters)
  const mLoved = media(inputs, (i) => i.lovedTagOverlap)
  const mAvoid = media(inputs, (i) => i.avoidedTagOverlap)
  const mFit = media(inputs, (i) => i.criterionFitScore)
  const mAge = media(inputs, (i) => i.releaseAge)
  const mRun = media(inputs, (i) => i.runLength)
  const modaSyn = moda(inputs, (i) => i.synopsisQuality ?? "unknown")
  const modaStatus = moda(inputs, (i) => i.publicationStatus)
  const modaOrigin = moda(inputs, (i) => i.origin)

  type Bloco = { nome: string; o_que_e: string; abla: (i: ExpectedScoreInput) => ExpectedScoreInput }
  const BLOCOS: Bloco[] = [
    {
      nome: "plataforma",
      o_que_e: "platformAvg + totalVotes",
      abla: (i) => ({ ...i, platformAvg: mPlat, totalVotes: mVotes }),
    },
    {
      nome: "capítulos",
      o_que_e: "totalChapters",
      abla: (i) => ({ ...i, totalChapters: mChap }),
    },
    {
      nome: "sinopse",
      o_que_e: "synopsisQuality",
      abla: (i) => ({ ...i, synopsisQuality: modaSyn }),
    },
    {
      nome: "tags",
      o_que_e: "loved + avoided overlap",
      abla: (i) => ({ ...i, lovedTagOverlap: mLoved, avoidedTagOverlap: mAvoid }),
    },
    {
      nome: "critério-fit",
      o_que_e: "criterionFitScore (deriva dos 9)",
      abla: (i) => ({ ...i, criterionFitScore: mFit }),
    },
    {
      nome: "idade+duração",
      o_que_e: "releaseAge + runLength",
      abla: (i) => ({ ...i, releaseAge: mAge, runLength: mRun }),
    },
    {
      nome: "status+origem",
      o_que_e: "publicationStatus + origin (one-hot)",
      abla: (i) => ({ ...i, publicationStatus: modaStatus, origin: modaOrigin }),
    },
  ]

  const d = (rows: ExpectedScoreInput[]) => {
    const o = expectedOutOfFoldPredictions(rows, targets, false)
    return o ? mae(o, targets) - maeBase : NaN
  }

  console.log(`\n══ ABLAÇÃO DOS BLOCOS NÃO-ATRIBUTO — ${rot.length} rotuladas · MAE base ${f3(maeBase)} ══`)
  console.log(`   Δ POSITIVO = tirar PIORA ⇒ o bloco carrega. Δ ~0 = não carrega HOJE.`)
  console.log(`   referência: os 9 atributos + GPT.N juntos deram +0,002 (2026-08-11)\n`)
  console.log(`   ${"bloco".padEnd(16)}${"o que é".padEnd(34)}${"Δ MAE ao tirar".padStart(16)}`)

  const linhas: { nome: string; delta: number }[] = []
  for (const b of BLOCOS) {
    const delta = d(inputs.map(b.abla))
    linhas.push({ nome: b.nome, delta })
    const marca = delta < 0.002 ? "  ← não carrega" : ""
    console.log(`   ${b.nome.padEnd(16)}${b.o_que_e.padEnd(34)}${sinal(delta).padStart(16)}${marca}`)
  }

  // Tudo menos os atributos: mede o quanto o preditor depende do que NÃO é avaliação de IA.
  const semTudo = inputs.map((i) => BLOCOS.reduce((acc, b) => b.abla(acc), i))
  console.log(`\n   ${"TODOS os blocos acima juntos".padEnd(50)}Δ ${sinal(d(semTudo))}`)
  console.log(`   ⚠️ Se a soma das partes for MENOR que o conjunto, há redundância entre blocos —`)
  console.log(`      é o mesmo efeito que fazia cada atributo parecer inerte sozinho.`)

  const soma = linhas.reduce((s, l) => s + Math.max(0, l.delta), 0)
  console.log(`      soma das partes ${f3(soma)}  ·  conjunto ${f3(d(semTudo))}`)

  const inertes = linhas.filter((l) => l.delta < 0.002)
  console.log(`\n   ${inertes.length} de ${BLOCOS.length} não carregam nada: ${inertes.map((l) => l.nome).join(", ") || "—"}`)
  const top = [...linhas].sort((a, b) => b.delta - a.delta)[0]
  console.log(`   maior contribuinte: ${top.nome} (${sinal(top.delta)})`)

  // 🔴 O CONTROLE QUE IMPEDE A LEITURA ERRADA. Sem ele, "os atributos valem 0,002" e "as
  // não-atributo valem 0,046" parecem somar 0,048 — e aí sobra a pergunta de onde vem o
  // resto do acerto. Cada um daqueles números foi medido com o OUTRO bloco presente, então
  // os dois medem contribuição MARGINAL, não parcela. Ablar tudo junto é o que separa
  // "o modelo não usa os atributos" de "o modelo se vira sem eles porque tem o resto".
  const semNada = semTudo.map((i) => ({
    ...i,
    categoryScores: Object.fromEntries(Object.keys(i.categoryScores as any).map((s) => [s, 5])) as any,
    iaEvalNormalized: 5,
  }))
  const dTudo = d(semNada as ExpectedScoreInput[])
  console.log(`\n   ${"TUDO — blocos + 9 atributos + GPT.N".padEnd(50)}Δ ${sinal(dTudo)}`)
  console.log(`   ⚠️ Compare com os +0,002 dos atributos SOZINHOS: se este número for muito`)
  console.log(`      maior que 0,046 + 0,002, os dois lados são REDUNDANTES entre si — cada um`)
  console.log(`      parece dispensável só porque o outro está lá para cobrir a falta.`)
  console.log(`\n   🔴 LEITURA: nenhum bloco isolado é ALAVANCA — o maior vale ~1,5% do MAE base.`)
  console.log(`      Mas "não carrega" ≠ "é inútil": ablar TUDO custa muito mais que a soma das`)
  console.log(`      partes, então o preditor se vira sem qualquer bloco porque os outros cobrem.`)
  console.log(`      Consequência: mexer numa feature isolada não move a nota, e RETIRAR uma`)
  console.log(`      porque "deu Δ~0" quebraria a rede que faz as demais parecerem dispensáveis.`)
  console.log(`      O ganho que resta vem de mais RÓTULO (~0,004 por 50) — não de feature.`)
  console.log(`\n(read-only — 0 escrita)\n`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
