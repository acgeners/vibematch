/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A ESTIMATIVA DE ARTE melhora a Nota Prevista? — read-only, US$0.
 *
 * Passo 1 do plano aberto em `diag-arte-previsivel.ts`, que mediu que a nota de arte é
 * previsível por sinal grátis (R² OOF 0,33, corr 0,58, confound de gênero descartado). Isto
 * responde a pergunta seguinte, que é a que decide se há o que construir: plugada como
 * feature no Ridge REAL (`expected.ts`), ela move o MAE da Nota Prevista?
 *
 * Régua de comparação: os 9 atributos de IA somam **0,002 de MAE** (`diag-ablate-criterios`).
 * Se a arte também somar ~0, o R² 0,33 vira nota de rodapé.
 *
 * 🔴 A ARMADILHA, e ela aqui é MÁXIMA. `user_score` é a média de 7 eixos de gosto
 * (`computeTasteUserScore`) e `like_art_score` é UM deles — literalmente 1/7 do alvo. E as
 * 200 obras com rótulo de arte são um SUBCONJUNTO das 211 com `user_score` (conferido no
 * banco): a sobreposição é total. Gerar a estimativa de arte com um modelo que já viu a obra
 * põe 1/7 do rótulo dentro das features, e o ganho aparece enorme sem significar nada.
 *
 * Por isso o OOF é ANINHADO: a estimativa de cada obra vem de um modelo de arte treinado nos
 * outros folds. Quatro variantes rodam lado a lado para que o número honesto seja legível
 * contra o que ele NÃO é:
 *
 *   base       — produção de hoje, sem a feature
 *   constante  — a feature existe mas é constante (custo de só adicionar uma coluna)
 *   embaralhada— estimativa OOF permutada entre obras (piso de ruído do harness)
 *   OOF        — ⭐ o número honesto
 *   in-sample  — a armadilha, para mostrar o tamanho da mentira que ela produz
 *   VERDADEIRA — o `like_art_score` real como feature: TETO teórico (vaza por construção,
 *                é 1/7 do alvo) — diz quanto um estimador PERFEITO compraria
 *
 * ⚠️ O modelo de arte é uma cópia do bloco D de `diag-arte-previsivel.ts` (digest + tags +
 * léxico, 15 features — o melhor lá). O script imprime o MAE/R² dele para conferir que
 * reproduz o 0,960 / 0,332 medido; se não reproduzir, a cópia divergiu e o resto não vale.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-arte-na-nota-prevista.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { expectedOutOfFoldPredictions, type ExpectedScoreInput } from "@/lib/calculations/expected"
import { fitRidge } from "@/lib/ml/ridge"
import { kFoldIndices } from "@/lib/ml/logistic"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

// ─────────────────────────────────────────────── modelo de arte (cópia do bloco D)

const LEX_POS =
  /\b(gorgeous|beautiful|beautifully|stunning|amazing|lovely|pretty|masterpiece|detailed|expressive|polished|vibrant|breathtaking|aesthetic|crisp|clean|consistent|eye.?candy|art is (so |really |very )?(good|great|amazing|beautiful)|great art|good art|love the art|art style is (good|great|beautiful)|bela|linda|bonita|deslumbrante|elogiada|elogiado|excelente|caprichada|detalhada|expressiva)\b/gi
const LEX_NEG =
  /\b(bad art|poor art|mediocre|ugly|inconsistent|stiff|sloppy|rushed|generic|bland|amateur|amateurish|off.?model|cheap|art (is|gets) (bad|worse|weird|inconsistent)|anatomy is|weird anatomy|feia|fraca|fraco|inconsistente|criticada|criticado|ruim|pobre|tosca|simples demais)\b/gi
const ART_TERM =
  /\b(art|artwork|art.?style|drawing|drawings|illustration|illustrations|visuals|arte|desenho)\b/gi
const ART_TAGS = [
  "elaborate-art-style",
  "art-style-change",
  "atypical-art-style",
  "full-color",
  "webtoon-webcomic",
]
const WINDOW = 140
const ALPHAS = [0.3, 1, 3, 10, 30, 100, 300]
const ART_FOLDS = 5
const SEED = 42

interface ArtRow {
  workId: string
  y: number | null
  digestPos: number
  digestNeg: number
  digestArtText: string
  revN: number
  revMentions: number
  revArtText: string
  tags: Set<string>
}

async function pageAll<T>(sb: any, table: string, select: string, tune?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select).range(from, from + 999)
    if (tune) q = tune(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0
  let n = 0
  while (re.exec(text) !== null) n++
  return n
}

function artWindows(text: string): string {
  ART_TERM.lastIndex = 0
  const parts: string[] = []
  let m: RegExpExecArray | null
  while ((m = ART_TERM.exec(text)) !== null) {
    parts.push(text.slice(Math.max(0, m.index - WINDOW), Math.min(text.length, m.index + WINDOW)))
    if (parts.length >= 12) break
  }
  return parts.join(" ")
}

/** 15 features: 4 digest + 5 tags + 6 léxico. Mesma ordem do bloco D. */
function artFeatures(r: ArtRow): number[] {
  const text = r.revArtText + " " + r.digestArtText
  const pos = countMatches(text, LEX_POS)
  const neg = countMatches(text, LEX_NEG)
  return [
    r.digestPos,
    r.digestNeg,
    r.digestPos - r.digestNeg,
    r.digestPos + r.digestNeg > 0 ? 1 : 0,
    ...ART_TAGS.map((t) => (r.tags.has(t) ? 1 : 0)),
    pos,
    neg,
    pos - neg,
    pos + neg > 0 ? (pos - neg) / (pos + neg) : 0,
    r.revMentions,
    r.revN > 0 ? r.revMentions / r.revN : 0,
  ]
}

/** Carrega as features de arte de TODAS as obras pedidas (rótulo só onde existe). */
async function loadArtRows(wantedIds: Set<string>): Promise<Map<string, ArtRow>> {
  const sb = createAdminClient()

  const labels = await pageAll<any>(sb, "pilot_taste_scores", "work_id, like_art_score", (q) =>
    q.not("like_art_score", "is", null),
  )
  const yByWork = new Map<string, number>(labels.map((l) => [l.work_id, Number(l.like_art_score)]))

  const works = await pageAll<any>(sb, "works", "id, review_digest")
  const reviews = await pageAll<any>(sb, "work_reviews", "work_id, text")
  const tagRows = await pageAll<any>(sb, "work_tags", "work_id, tags(slug)")

  const revByWork = new Map<string, { n: number; mentions: number; text: string }>()
  for (const r of reviews) {
    if (!wantedIds.has(r.work_id)) continue
    const text = String(r.text ?? "")
    const cur = revByWork.get(r.work_id) ?? { n: 0, mentions: 0, text: "" }
    cur.n++
    const hits = countMatches(text, ART_TERM)
    cur.mentions += hits
    if (hits > 0 && cur.text.length < 20000) cur.text += " " + artWindows(text)
    revByWork.set(r.work_id, cur)
  }

  const tagsByWork = new Map<string, Set<string>>()
  for (const t of tagRows) {
    if (!wantedIds.has(t.work_id)) continue
    const slug = t.tags?.slug
    if (!slug) continue
    const s = tagsByWork.get(t.work_id) ?? new Set<string>()
    s.add(slug)
    tagsByWork.set(t.work_id, s)
  }

  const out = new Map<string, ArtRow>()
  for (const w of works) {
    if (!wantedIds.has(w.id)) continue
    let digestPos = 0
    let digestNeg = 0
    let digestArtText = ""
    try {
      const d = typeof w.review_digest === "string" ? JSON.parse(w.review_digest) : w.review_digest
      for (const tr of d?.salient_traits ?? []) {
        if (!/arte|art/i.test(String(tr?.axis ?? ""))) continue
        if (tr.polarity === "positive") digestPos++
        else if (tr.polarity === "negative") digestNeg++
        digestArtText += " " + String(tr?.trait ?? "")
      }
      for (const key of ["consensus", "execution"]) {
        const prose = String(d?.[key] ?? "")
        if (ART_TERM.test(prose)) digestArtText += " " + artWindows(prose)
        ART_TERM.lastIndex = 0
      }
    } catch {
      /* digest corrompido: trata como ausente */
    }
    const rev = revByWork.get(w.id) ?? { n: 0, mentions: 0, text: "" }
    out.set(w.id, {
      workId: w.id,
      y: yByWork.get(w.id) ?? null,
      digestPos,
      digestNeg,
      digestArtText,
      revN: rev.n,
      revMentions: rev.mentions,
      revArtText: rev.text,
      tags: tagsByWork.get(w.id) ?? new Set<string>(),
    })
  }
  return out
}

function standardize(train: number[][], all: number[][]): number[][] {
  const p = train[0]?.length ?? 0
  const mean = new Array(p).fill(0)
  const sd = new Array(p).fill(1)
  for (let j = 0; j < p; j++) {
    const col = train.map((r) => r[j])
    const m = col.reduce((a, b) => a + b, 0) / col.length
    const v = col.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, col.length - 1)
    mean[j] = m
    sd[j] = Math.sqrt(v) || 1
  }
  return all.map((r) => r.map((x, j) => (x - mean[j]) / sd[j]))
}

/** α por CV interna dentro do treino — nunca olha o fold de teste. */
function pickAlpha(Xtr: number[][], ytr: number[]): number {
  let best = ALPHAS[0]
  let bestErr = Infinity
  const inner = kFoldIndices(Xtr.length, 4, SEED + 1)
  for (const alpha of ALPHAS) {
    let err = 0
    let cnt = 0
    for (let g = 0; g < inner.length; g++) {
      const vSet = new Set(inner[g])
      const tIdx = [...Array(Xtr.length).keys()].filter((i) => !vSet.has(i))
      if (tIdx.length < 5) continue
      const m = fitRidge(tIdx.map((i) => Xtr[i]), tIdx.map((i) => ytr[i]), alpha)
      for (const i of inner[g]) {
        err += Math.abs(m.intercept + Xtr[i].reduce((a, x, j) => a + x * m.coefficients[j], 0) - ytr[i])
        cnt++
      }
    }
    const mae = cnt > 0 ? err / cnt : Infinity
    if (mae < bestErr) {
      bestErr = mae
      best = alpha
    }
  }
  return best
}

/**
 * Estimativas de arte, nas DUAS formas que o experimento precisa distinguir:
 *   `oof`      — para obra COM rótulo, vinda de um modelo que não a viu (honesta)
 *   `inSample` — de um modelo treinado em TODAS as rotuladas (a armadilha)
 * Obra SEM rótulo de arte recebe a estimativa do modelo cheio nas duas — não há o que vazar.
 */
function artEstimates(rows: ArtRow[]): {
  oof: Map<string, number>
  inSample: Map<string, number>
  selfMae: number
  selfR2: number
} {
  const labeled = rows.filter((r) => r.y != null)
  const X = new Map(rows.map((r) => [r.workId, artFeatures(r)]))
  const rawLab = labeled.map((r) => X.get(r.workId)!)
  const yLab = labeled.map((r) => r.y as number)

  // ---- OOF sobre as rotuladas
  const folds = kFoldIndices(labeled.length, ART_FOLDS, SEED)
  const oofPred = new Array<number>(labeled.length).fill(0)
  for (const fold of folds) {
    const testIdx = new Set(fold)
    const trainIdx = [...Array(labeled.length).keys()].filter((i) => !testIdx.has(i))
    const Z = standardize(trainIdx.map((i) => rawLab[i]), rawLab)
    const Xtr = trainIdx.map((i) => Z[i])
    const ytr = trainIdx.map((i) => yLab[i])
    const m = fitRidge(Xtr, ytr, pickAlpha(Xtr, ytr))
    for (const i of fold) {
      oofPred[i] = m.intercept + Z[i].reduce((a, x, j) => a + x * m.coefficients[j], 0)
    }
  }

  // ---- modelo cheio (todas as rotuladas), aplicado a TODAS as obras
  const allRaw = rows.map((r) => X.get(r.workId)!)
  const Zall = standardize(rawLab, allRaw) // escala fitada só nas rotuladas
  const labPos = new Map(labeled.map((r, i) => [r.workId, i]))
  const ZlabScaled = rows.filter((r) => r.y != null).map((r) => Zall[rows.indexOf(r)])
  const full = fitRidge(ZlabScaled, yLab, pickAlpha(ZlabScaled, yLab))

  const oof = new Map<string, number>()
  const inSample = new Map<string, number>()
  rows.forEach((r, i) => {
    const cheio = full.intercept + Zall[i].reduce((a, x, j) => a + x * full.coefficients[j], 0)
    inSample.set(r.workId, cheio)
    const pos = labPos.get(r.workId)
    oof.set(r.workId, pos == null ? cheio : oofPred[pos])
  })

  const yMean = yLab.reduce((a, b) => a + b, 0) / yLab.length
  const selfMae = oofPred.reduce((a, p, i) => a + Math.abs(p - yLab[i]), 0) / yLab.length
  const ssRes = oofPred.reduce((a, p, i) => a + (p - yLab[i]) ** 2, 0)
  const ssTot = yLab.reduce((a, v) => a + (v - yMean) ** 2, 0)
  return { oof, inSample, selfMae, selfR2: 1 - ssRes / ssTot }
}

// ─────────────────────────────────────────────── estatística

const mae = (p: number[], y: number[]) => p.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / p.length
const f3 = (n: number) => n.toFixed(3)
const sgn = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(3)

/** IC95% bootstrap PAREADO sobre o ganho por obra — sem ele, ΔMAE de 0,01 é indistinguível de 0. */
function bootCI(diffs: number[], reps = 4000): [number, number] {
  let state = 20260812
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  const means: number[] = []
  const n = diffs.length
  for (let b = 0; b < reps; b++) {
    let s = 0
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rand() * n)]
    means.push(s / n)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(reps * 0.025)], means[Math.floor(reps * 0.975)]]
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
  const ids: string[] = rot.map((w) => w.id)
  const targets: number[] = rot.map((w) => w.userScore as number)
  const baseInputs: ExpectedScoreInput[] = rot.map((w) => ({
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
  }))

  const artRows = await loadArtRows(new Set(ids))
  // Alinhamento por POSIÇÃO com `ids`/`targets`: um `filter(Boolean)` aqui deslocaria a
  // feature de arte para a obra errada, em silêncio, e o experimento inteiro mediria ruído.
  const faltando = ids.filter((id) => !artRows.has(id))
  if (faltando.length) throw new Error(`sem features de arte para ${faltando.length} obra(s)`)
  const rowsInOrder = ids.map((id) => artRows.get(id)!) as ArtRow[]
  const comRotulo = rowsInOrder.filter((r) => r.y != null).length
  const { oof, inSample, selfMae, selfR2 } = artEstimates(rowsInOrder)

  console.log(`\n══ A ARTE COMO FEATURE DA NOTA PREVISTA ══`)
  console.log(`   ${rot.length} obras com user_score · ${comRotulo} delas com like_art_score`)
  console.log(`   ⚠️ sobreposição ${((100 * comRotulo) / rot.length).toFixed(0)}% — o rótulo de arte é 1/7 do user_score NAS MESMAS obras`)
  console.log(`\n   modelo de arte (bloco D: digest+tags+léxico, 15 feats), OOF próprio:`)
  console.log(`   MAE ${f3(selfMae)} · R² ${f3(selfR2)}   ← tem que reproduzir 0,960 / 0,332 do diag-arte-previsivel`)

  // Permutação determinística das estimativas OOF: piso de ruído do harness.
  let st = 987654321
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0), st / 0x100000000)
  const shuffled = ids.map((id) => oof.get(id) ?? 0)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const variantes: Array<{ nome: string; art: (i: number) => number }> = [
    { nome: "constante (só a coluna)", art: () => 5 },
    { nome: "embaralhada (ruído)", art: (i) => shuffled[i] },
    { nome: "⭐ OOF aninhado (HONESTA)", art: (i) => oof.get(ids[i]) ?? 0 },
    { nome: "in-sample (a ARMADILHA)", art: (i) => inSample.get(ids[i]) ?? 0 },
    { nome: "like_art_score REAL (teto)", art: (i) => rowsInOrder[i]?.y ?? inSample.get(ids[i]) ?? 0 },
  ]

  for (const k of [5, 10]) {
    const base = expectedOutOfFoldPredictions(baseInputs, targets, false, k)
    if (!base) return console.log("preditor stub — amostra insuficiente")
    const maeBase = mae(base, targets)
    const errBase = base.map((p, i) => Math.abs(p - targets[i]))

    console.log(`\n─── OOF ${k}-fold · MAE base ${f3(maeBase)} ───`)
    console.log(`   ${"variante".padEnd(28)}${"MAE".padStart(8)}${"ΔMAE".padStart(9)}${"IC95% do ganho".padStart(22)}`)
    for (const v of variantes) {
      const inputs = baseInputs.map((inp, i) => ({ ...inp, artEstimate: v.art(i) }))
      const pred = expectedOutOfFoldPredictions(inputs, targets, false, k, true)
      if (!pred) continue
      const m = mae(pred, targets)
      const diffs = pred.map((p, i) => errBase[i] - Math.abs(p - targets[i])) // + = melhorou
      const [lo, hi] = bootCI(diffs)
      const distinguivel = lo > 0 || hi < 0 ? "" : "   (inclui 0)"
      console.log(
        `   ${v.nome.padEnd(28)}${f3(m).padStart(8)}${sgn(maeBase - m).padStart(9)}${`[${sgn(lo)}, ${sgn(hi)}]`.padStart(22)}${distinguivel}`,
      )
    }
  }

  console.log(`\n   ΔMAE POSITIVO = a feature MELHORA. Régua: os 9 atributos de IA somam +0,002.`)
  console.log(`   IC que inclui 0 ⇒ indistinguível de não ter a feature.`)

  // ─── POR QUE o teto é baixo. Sem isto o resultado parece contradizer "arte é 1/7 do alvo".
  const comArte = ids.map((id, i) => ({ i, y: artRows.get(id)!.y })).filter((r) => r.y != null)
  const sd = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
  }
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((x, y) => x + y, 0) / a.length
    const mb = b.reduce((x, y) => x + y, 0) / b.length
    const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
    const sa = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0))
    const sbb = Math.sqrt(b.reduce((s, v) => s + (v - mb) ** 2, 0))
    return sa * sbb > 0 ? cov / (sa * sbb) : 0
  }
  const arteReal = comArte.map((r) => r.y as number)
  const alvo = comArte.map((r) => targets[r.i])
  const sdArte = sd(arteReal)
  const sdAlvo = sd(alvo)
  // O eixo entra no rótulo dividido por 7 ⇒ a variância que ele injeta cai por 49.
  const shareVar = sdArte ** 2 / 49 / sdAlvo ** 2

  const base5 = expectedOutOfFoldPredictions(baseInputs, targets, false, 5)!
  const resid = comArte.map((r) => targets[r.i] - base5[r.i])
  const estOof = comArte.map((r) => oof.get(ids[r.i]) ?? 0)

  console.log(`\n─── POR QUE o teto é só +0,04, se a arte é 1/7 do rótulo ───`)
  console.log(`   σ(like_art_score) ${f3(sdArte)} · σ(user_score) ${f3(sdAlvo)} · corr entre eles ${f3(corr(arteReal, alvo))}`)
  console.log(`   o eixo entra dividido por 7 ⇒ injeta σ²/49 = ${(100 * shareVar).toFixed(1)}% da variância do rótulo`)
  console.log(`   corr(arte REAL, resíduo do modelo base)      ${f3(corr(arteReal, resid))}`)
  console.log(`   corr(estimativa OOF, resíduo do modelo base) ${f3(corr(estOof, resid))}  ← o que sobraria pra explicar`)
  console.log(`\n(read-only — 0 escrita)\n`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
