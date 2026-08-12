/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A NOTA DE ARTE é previsível a partir do que JÁ TEMOS? — read-only, US$0.
 *
 * A pergunta que decide se vale construir um estimador de arte pré-leitura: o sinal
 * disponível no banco (tags, digest, reviews, plataforma) explica a nota que a curadora
 * dá à arte DEPOIS de ler? Se não explicar, um critério/artefato de IA para arte nasce
 * morto — e a alternativa cara (10º critério + backfill de ~US$37 + reavaliação do
 * catálogo) fica descartada por US$0 em vez de por US$37.
 *
 * Rótulo: `pilot_taste_scores.like_art_score` (200 obras). É um dos 7 eixos que COMPÕEM o
 * `user_score` (`computeTasteUserScore`), logo 1/7 do alvo que o Ridge da Nota Prevista já
 * tenta prever — e nenhuma feature de hoje descreve arte.
 *
 * Método: blocos de feature INCREMENTAIS, cada um medido por OOF 5-fold honesto
 * (padronização e vocabulário TF-IDF fitados DENTRO do fold de treino — fitar fora vaza o
 * rótulo e infla o R² sem nada acusar). Baseline = prever sempre a média do treino.
 *
 * ⚠️ Mede PREVISIBILIDADE por sinal barato, não o teto de um LLM lendo as reviews. Um
 * resultado fraco aqui não prova que a IA falharia; prova que o caminho grátis falhou.
 * ⚠️ n=200 e 4 valores discretos dominam o rótulo (4/6,5/8/10) — R² alto exigiria muito
 * mais do que o dado sustenta. A leitura útil é COMPARATIVA entre blocos.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-arte-previsivel.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { fitRidge } from "@/lib/ml/ridge"
import { kFoldIndices } from "@/lib/ml/logistic"

const ALPHAS = [0.3, 1, 3, 10, 30, 100, 300]
const FOLDS = 5
const SEED = 42

/** Léxico de QUALIDADE de arte. Bilíngue: reviews são majoritariamente em inglês, o digest é em PT. */
const LEX_POS =
  /\b(gorgeous|beautiful|beautifully|stunning|amazing|lovely|pretty|masterpiece|detailed|expressive|polished|vibrant|breathtaking|aesthetic|crisp|clean|consistent|eye.?candy|art is (so |really |very )?(good|great|amazing|beautiful)|great art|good art|love the art|art style is (good|great|beautiful)|bela|linda|bonita|deslumbrante|elogiada|elogiado|excelente|caprichada|detalhada|expressiva)\b/gi
const LEX_NEG =
  /\b(bad art|poor art|mediocre|ugly|inconsistent|stiff|sloppy|rushed|generic|bland|amateur|amateurish|off.?model|cheap|art (is|gets) (bad|worse|weird|inconsistent)|anatomy is|weird anatomy|feia|fraca|fraco|inconsistente|criticada|criticado|ruim|pobre|tosca|simples demais)\b/gi
/** Onde a review fala de arte. A janela em torno disto é o que alimenta léxico e TF-IDF. */
const ART_TERM = /\b(art|artwork|art.?style|drawing|drawings|illustration|illustrations|visuals|arte|desenho)\b/gi

const ART_TAGS = ["elaborate-art-style", "art-style-change", "atypical-art-style", "full-color", "webtoon-webcomic"]
const WINDOW = 140
const TFIDF_MIN_DF = 8
const TFIDF_MAX_TERMS = 200
const STOP = new Set(
  ("the a an and or but of to in is are was were it its this that with for on at as be been has have had not no do does " +
    "i you he she they we my your his her their there here so very really just too much many more most some any all " +
    "de da do e o a que os as um uma para com por em no na se mais muito ja tem ser sao dos das ao aos").split(/\s+/),
)

interface Row {
  workId: string
  title: string
  y: number
  digestPos: number
  digestNeg: number
  digestArtText: string
  revN: number
  revMentions: number
  revArtText: string
  platformAvg: number | null
  logVotes: number
  year: number | null
  chapters: number | null
  tags: Set<string>
}

/** Paginação obrigatória: o select do PostgREST corta em 1000 linhas sem erro e sem aviso. */
async function pageAll<T>(
  sb: any,
  table: string,
  select: string,
  tune?: (q: any) => any,
): Promise<T[]> {
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

/** Recorta ±WINDOW chars em torno de cada menção a arte — o resto da review fala de outra coisa. */
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zà-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && t.length <= 20 && !STOP.has(t))
}

// ---------------------------------------------------------------- carga

async function load(): Promise<Row[]> {
  const sb = createAdminClient()

  const labels = await pageAll<any>(sb, "pilot_taste_scores", "work_id, like_art_score", (q) =>
    q.not("like_art_score", "is", null),
  )
  const yByWork = new Map<string, number>(labels.map((l) => [l.work_id, Number(l.like_art_score)]))
  const ids = [...yByWork.keys()]

  const works = await pageAll<any>(
    sb,
    "works",
    "id, title, year, total_chapters, review_digest, review_summary",
  )
  const workById = new Map<string, any>(works.filter((w) => yByWork.has(w.id)).map((w) => [w.id, w]))

  const ratings = await pageAll<any>(sb, "platform_ratings", "work_id, rating, vote_count")
  const ratingByWork = new Map<string, { sum: number; wsum: number; votes: number }>()
  for (const r of ratings) {
    if (!yByWork.has(r.work_id)) continue
    const rating = Number(r.rating)
    const votes = Number(r.vote_count ?? 0)
    if (!Number.isFinite(rating)) continue
    const cur = ratingByWork.get(r.work_id) ?? { sum: 0, wsum: 0, votes: 0 }
    cur.sum += rating * Math.max(1, votes)
    cur.wsum += Math.max(1, votes)
    cur.votes += votes
    ratingByWork.set(r.work_id, cur)
  }

  const reviews = await pageAll<any>(sb, "work_reviews", "work_id, text")
  const revByWork = new Map<string, { n: number; mentions: number; text: string }>()
  for (const r of reviews) {
    if (!yByWork.has(r.work_id)) continue
    const text = String(r.text ?? "")
    const cur = revByWork.get(r.work_id) ?? { n: 0, mentions: 0, text: "" }
    cur.n++
    const hits = countMatches(text, ART_TERM)
    cur.mentions += hits
    if (hits > 0 && cur.text.length < 20000) cur.text += " " + artWindows(text)
    revByWork.set(r.work_id, cur)
  }

  const tagRows = await pageAll<any>(sb, "work_tags", "work_id, tags(slug)")
  const tagsByWork = new Map<string, Set<string>>()
  for (const t of tagRows) {
    if (!yByWork.has(t.work_id)) continue
    const slug = t.tags?.slug
    if (!slug) continue
    const s = tagsByWork.get(t.work_id) ?? new Set<string>()
    s.add(slug)
    tagsByWork.set(t.work_id, s)
  }

  const rows: Row[] = []
  for (const id of ids) {
    const w = workById.get(id)
    if (!w) continue

    // eixo "arte" do digest: polaridade dos traços + a prosa de consenso/execução
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
      /* digest corrompido: trata como ausente, não aborta a linha */
    }

    const rev = revByWork.get(id) ?? { n: 0, mentions: 0, text: "" }
    const rt = ratingByWork.get(id)

    rows.push({
      workId: id,
      title: String(w.title ?? ""),
      y: yByWork.get(id)!,
      digestPos,
      digestNeg,
      digestArtText,
      revN: rev.n,
      revMentions: rev.mentions,
      revArtText: rev.text,
      platformAvg: rt && rt.wsum > 0 ? rt.sum / rt.wsum : null,
      logVotes: Math.log1p(rt?.votes ?? 0),
      year: w.year != null ? Number(w.year) : null,
      chapters: w.total_chapters != null ? Number(w.total_chapters) : null,
      tags: tagsByWork.get(id) ?? new Set<string>(),
    })
  }
  return rows
}

// ---------------------------------------------------------------- blocos de feature

type Block = { name: string; build: (r: Row) => number[]; labels: string[] }

const B_DIGEST: Block = {
  name: "digest (polaridade do eixo arte)",
  labels: ["digest_pos", "digest_neg", "digest_net", "tem_digest_arte"],
  build: (r) => [r.digestPos, r.digestNeg, r.digestPos - r.digestNeg, r.digestPos + r.digestNeg > 0 ? 1 : 0],
}

const B_TAGS: Block = {
  name: "+ tags de arte",
  labels: ART_TAGS,
  build: (r) => ART_TAGS.map((t) => (r.tags.has(t) ? 1 : 0)),
}

const B_LEX: Block = {
  name: "+ léxico nas menções",
  labels: ["lex_pos", "lex_neg", "lex_net", "lex_rate", "mencoes", "mencoes_por_review"],
  build: (r) => {
    const text = r.revArtText + " " + r.digestArtText
    const pos = countMatches(text, LEX_POS)
    const neg = countMatches(text, LEX_NEG)
    return [
      pos,
      neg,
      pos - neg,
      pos + neg > 0 ? (pos - neg) / (pos + neg) : 0,
      r.revMentions,
      r.revN > 0 ? r.revMentions / r.revN : 0,
    ]
  },
}

const B_NUM: Block = {
  name: "+ plataforma e metadados",
  labels: ["platform_avg", "log_votos", "ano", "capitulos", "n_reviews"],
  build: (r) => [
    r.platformAvg ?? 0,
    r.logVotes,
    r.year ?? 0,
    Math.log1p(r.chapters ?? 0),
    Math.log1p(r.revN),
  ],
}

/**
 * CONTROLE — tags genéricas de gênero/formato, com QUALQUER referência a arte removida.
 *
 * Existe porque as tags que mais separam a nota de arte no catálogo são `school`, `seinen`,
 * `japan` e `big-breasts` (para baixo) contra `loving-family` e `redemption` (para cima):
 * isso descreve **manhwa coreano colorido × mangá japonês seinen**, não qualidade de traço.
 * Se este bloco sozinho empatar com o bloco de arte, o "sinal de arte" é confound de gênero
 * — e um estimador treinado nele estaria prevendo a preferência da curadora por um tipo de
 * obra, com o rótulo "arte" por cima.
 */
let CONTROL_TAGS: string[] = []
const B_CONTROL: Block = {
  name: "controle (gênero/formato, sem arte)",
  labels: [],
  build: (r) => CONTROL_TAGS.map((t) => (r.tags.has(t) ? 1 : 0)),
}

// ---------------------------------------------------------------- avaliação OOF

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

/** Vocabulário TF-IDF fitado SÓ no treino do fold — fora dele, o rótulo vaza pelo vocabulário. */
function buildVocab(texts: string[]): string[] {
  const df = new Map<string, number>()
  for (const t of texts) {
    for (const tok of new Set(tokenize(t))) df.set(tok, (df.get(tok) ?? 0) + 1)
  }
  return [...df.entries()]
    .filter(([, c]) => c >= TFIDF_MIN_DF && c <= texts.length * 0.9)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TFIDF_MAX_TERMS)
    .map(([t]) => t)
}

function tfidfRow(text: string, vocab: string[]): number[] {
  const toks = tokenize(text)
  const tf = new Map<string, number>()
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
  const norm = Math.sqrt(toks.length) || 1
  return vocab.map((v) => (tf.get(v) ?? 0) / norm)
}

interface Result {
  name: string
  nFeatures: number
  mae: number
  r2: number
  corr: number
  oof: number[]
}

function evaluate(rows: Row[], blocks: Block[], withTfidf: boolean, name: string): Result {
  const n = rows.length
  const y = rows.map((r) => r.y)
  const folds = kFoldIndices(n, FOLDS, SEED)
  const oof = new Array(n).fill(0)
  let nFeatures = 0

  for (let f = 0; f < folds.length; f++) {
    const testIdx = new Set(folds[f])
    const trainIdx = [...Array(n).keys()].filter((i) => !testIdx.has(i))

    // vocabulário do fold: só textos de treino
    const vocab = withTfidf ? buildVocab(trainIdx.map((i) => rows[i].revArtText + " " + rows[i].digestArtText)) : []

    const raw = rows.map((r) => {
      const base = blocks.flatMap((b) => b.build(r))
      return withTfidf ? [...base, ...tfidfRow(r.revArtText + " " + r.digestArtText, vocab)] : base
    })
    nFeatures = raw[0].length

    const X = standardize(
      trainIdx.map((i) => raw[i]),
      raw,
    )
    const Xtr = trainIdx.map((i) => X[i])
    const ytr = trainIdx.map((i) => y[i])

    // α por CV interna dentro do treino (nunca olha o fold de teste)
    let bestAlpha = ALPHAS[0]
    let bestErr = Infinity
    const inner = kFoldIndices(Xtr.length, 4, SEED + 1)
    for (const alpha of ALPHAS) {
      let err = 0
      let cnt = 0
      for (let g = 0; g < inner.length; g++) {
        const vSet = new Set(inner[g])
        const tIdx = [...Array(Xtr.length).keys()].filter((i) => !vSet.has(i))
        if (tIdx.length < 5) continue
        const m = fitRidge(
          tIdx.map((i) => Xtr[i]),
          tIdx.map((i) => ytr[i]),
          alpha,
        )
        for (const i of inner[g]) {
          const p = m.intercept + Xtr[i].reduce((a, x, j) => a + x * m.coefficients[j], 0)
          err += Math.abs(p - ytr[i])
          cnt++
        }
      }
      const mae = cnt > 0 ? err / cnt : Infinity
      if (mae < bestErr) {
        bestErr = mae
        bestAlpha = alpha
      }
    }

    const model = fitRidge(Xtr, ytr, bestAlpha)
    for (const i of folds[f]) {
      oof[i] = model.intercept + X[i].reduce((a, x, j) => a + x * model.coefficients[j], 0)
    }
  }

  const yMean = y.reduce((a, b) => a + b, 0) / n
  const mae = oof.reduce((a, p, i) => a + Math.abs(p - y[i]), 0) / n
  const ssRes = oof.reduce((a, p, i) => a + (p - y[i]) ** 2, 0)
  const ssTot = y.reduce((a, v) => a + (v - yMean) ** 2, 0)
  const pMean = oof.reduce((a, b) => a + b, 0) / n
  const cov = oof.reduce((a, p, i) => a + (p - pMean) * (y[i] - yMean), 0)
  const sp = Math.sqrt(oof.reduce((a, p) => a + (p - pMean) ** 2, 0))
  const sy = Math.sqrt(y.reduce((a, v) => a + (v - yMean) ** 2, 0))

  return { name, nFeatures, mae, r2: 1 - ssRes / ssTot, corr: sp * sy > 0 ? cov / (sp * sy) : 0, oof }
}

/**
 * O modelo funciona no CATÁLOGO ou só onde o sinal existe?
 *
 * `elaborate-art-style` cobre 18,5% das rotuladas e 13% do catálogo. Um MAE agregado bom
 * pode esconder "acerta nas 18% e chuta a média nas outras 82%" — que é o modo de falha
 * caro, porque a prateleira e o filtro operam justamente sobre o catálogo inteiro.
 */
function breakdown(rows: Row[], oof: number[], globalMean: number) {
  const grupos: Array<[string, (r: Row) => boolean]> = [
    ["tem elaborate-art-style", (r) => r.tags.has("elaborate-art-style")],
    ["SEM elaborate-art-style", (r) => !r.tags.has("elaborate-art-style")],
    ["tem traço de arte no digest", (r) => r.digestPos + r.digestNeg > 0],
    ["sem traço no digest", (r) => r.digestPos + r.digestNeg === 0],
    ["sem sinal nenhum de arte", (r) => r.digestPos + r.digestNeg === 0 && r.revMentions === 0 && !r.tags.has("elaborate-art-style")],
  ]
  console.log(`\n=== O MELHOR MODELO, POR SUBGRUPO ===`)
  console.log(`${"subgrupo".padEnd(30)} ${"n".padStart(4)} ${"MAE".padStart(7)} ${"vs base".padStart(9)}`)
  for (const [nome, pred] of grupos) {
    const idx = rows.map((r, i) => (pred(r) ? i : -1)).filter((i) => i >= 0)
    if (!idx.length) continue
    const mae = idx.reduce((a, i) => a + Math.abs(oof[i] - rows[i].y), 0) / idx.length
    // baseline JUSTO do subgrupo: prever a média global (é o que um modelo sem sinal faria)
    const maeBase = idx.reduce((a, i) => a + Math.abs(globalMean - rows[i].y), 0) / idx.length
    const delta = maeBase - mae
    console.log(
      `${nome.padEnd(30)} ${String(idx.length).padStart(4)} ${mae.toFixed(3).padStart(7)} ${((delta >= 0 ? "+" : "") + delta.toFixed(3)).padStart(9)}`,
    )
  }
}



// ---------------------------------------------------------------- main

async function main() {
  console.log("Carregando (banco local, US$0)...")
  const rows = await load()
  const y = rows.map((r) => r.y)
  const n = rows.length
  const yMean = y.reduce((a, b) => a + b, 0) / n
  const baselineMae = y.reduce((a, v) => a + Math.abs(v - yMean), 0) / n
  const sigma = Math.sqrt(y.reduce((a, v) => a + (v - yMean) ** 2, 0) / (n - 1))

  console.log(`\n=== RÓTULO: like_art_score ===`)
  console.log(`n=${n}  média=${yMean.toFixed(2)}  σ=${sigma.toFixed(2)}`)
  console.log(`Baseline (prever sempre a média): MAE ${baselineMae.toFixed(3)}, R² 0.000\n`)

  const cobertura = {
    "com traço de arte no digest": rows.filter((r) => r.digestPos + r.digestNeg > 0).length,
    "com menção a arte em review": rows.filter((r) => r.revMentions > 0).length,
    "com tag elaborate-art-style": rows.filter((r) => r.tags.has("elaborate-art-style")).length,
    "com nota de plataforma": rows.filter((r) => r.platformAvg != null).length,
    "SEM sinal nenhum de arte": rows.filter(
      (r) => r.digestPos + r.digestNeg === 0 && r.revMentions === 0 && !r.tags.has("elaborate-art-style"),
    ).length,
  }
  console.log("=== COBERTURA DO SINAL ===")
  for (const [k, v] of Object.entries(cobertura)) {
    console.log(`  ${k.padEnd(32)} ${String(v).padStart(4)}  (${((100 * v) / n).toFixed(1)}%)`)
  }

  // Controle: as K tags mais frequentes entre as rotuladas, EXCLUINDO qualquer uma que
  // mencione arte/cor/formato visual. Mesma ordem de grandeza de features que o bloco de arte.
  const freq = new Map<string, number>()
  for (const r of rows) for (const t of r.tags) freq.set(t, (freq.get(t) ?? 0) + 1)
  CONTROL_TAGS = [...freq.entries()]
    .filter(([t, c]) => c >= 8 && c <= rows.length * 0.9 && !/art|colou?r|webtoon|desenh|visual/i.test(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([t]) => t)

  const results: Result[] = [
    evaluate(rows, [B_DIGEST], false, "A. digest (polaridade)"),
    evaluate(rows, [B_TAGS], false, "B. tags de arte"),
    evaluate(rows, [B_DIGEST, B_TAGS], false, "C. A + B"),
    evaluate(rows, [B_DIGEST, B_TAGS, B_LEX], false, "D. C + léxico"),
    evaluate(rows, [B_DIGEST, B_TAGS, B_LEX, B_NUM], false, "E. D + plataforma/meta"),
    evaluate(rows, [B_DIGEST, B_TAGS, B_LEX, B_NUM], true, "F. E + TF-IDF das menções"),
    evaluate(rows, [B_CONTROL], false, `G. CONTROLE gênero (${CONTROL_TAGS.length} tags, sem arte)`),
    evaluate(rows, [B_CONTROL, B_TAGS, B_LEX], false, "H. controle + arte (o que arte SOMA)"),
  ]

  console.log(`\n=== OOF ${FOLDS}-fold honesto (padronização e vocabulário fitados no treino) ===`)
  console.log(`${"bloco".padEnd(30)} ${"feats".padStart(5)} ${"MAE".padStart(7)} ${"ΔMAE".padStart(8)} ${"R²".padStart(7)} ${"corr".padStart(7)}`)
  for (const r of results) {
    const delta = baselineMae - r.mae
    console.log(
      `${r.name.padEnd(30)} ${String(r.nFeatures).padStart(5)} ${r.mae.toFixed(3).padStart(7)} ${(delta >= 0 ? "+" : "") + delta.toFixed(3).padStart(7)} ${r.r2.toFixed(3).padStart(7)} ${r.corr.toFixed(3).padStart(7)}`,
    )
  }

  const best = results.reduce((a, b) => (b.mae < a.mae ? b : a))
  console.log(`\n=== VEREDITO ===`)
  console.log(`Melhor bloco: ${best.name}`)
  console.log(`MAE ${best.mae.toFixed(3)} contra baseline ${baselineMae.toFixed(3)} — ganho de ${(baselineMae - best.mae).toFixed(3)} (${((100 * (baselineMae - best.mae)) / baselineMae).toFixed(1)}%)`)
  console.log(`R² OOF ${best.r2.toFixed(3)} — o sinal barato explica ${(100 * Math.max(0, best.r2)).toFixed(1)}% da variância da nota de arte`)
  console.log(
    `\n⚠️ R² negativo significa PIOR que prever a média — com n=${n} e ${best.nFeatures} features isso é sobreajuste, não sinal.`,
  )


  breakdown(rows, best.oof, yMean)
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e)
  process.exit(1)
})
