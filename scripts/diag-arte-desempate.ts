/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A estimativa de arte serve pra ORDENAR e FILTRAR? — read-only, US$0.
 *
 * Pergunta DIFERENTE da de `diag-arte-na-nota-prevista.ts`, e por isso régua diferente. Lá o
 * alvo era o MAE da Nota Prevista, e a resposta foi zero (a arte entra no `user_score`
 * dividida por 7 ⇒ 3,2% da variância). Aqui o uso é outro: a arte como CRITÉRIO DE DECISÃO do
 * leitor — desempatar obras com a mesma Nota Prevista e filtrar por arte. Nesse uso o MAE não
 * decide nada; o que decide é a ORDEM e o que o filtro devolve.
 *
 *   A. ordena arte? — Spearman + AUC (a semântica real do filtro)
 *   B. desempata? — acurácia da direção entre obras com a MESMA Nota Prevista exibida
 *   C. o desempate serve ao gosto? — entre empatadas, arte maior ⇒ user_score maior?
 *   D. o filtro é honesto no catálogo? — compressão da estimativa e obras SEM sinal
 *
 * 🔴 Este script roda sobre `lib/art/*`, os módulos de produção — não sobre uma cópia. É
 * assim que ele serve de conferência: se o extrator ou o modelo divergirem do que foi medido
 * em 2026-08-12, os números abaixo mudam e o desenho inteiro volta à mesa. Retrato daquele
 * dia, a bater:
 *
 *   Spearman 0,531 · AUC "arte ≥ 9" 0,765 · desempate 67,7% (n=541) · gosto 55,8% (n=857)
 *   compressão 0,49× · 23 de 974 obras sem sinal
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-arte-desempate.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { auc } from "@/lib/ml/logistic"
import { roundToDisplayScore } from "@/lib/score-rounding"
import {
  artFeatureVector,
  extractArtSignal,
  hasArtEvidence,
  type ArtSignal,
} from "@/lib/art/signal"
import {
  ART_BAND_CUTOFFS,
  artBandFromPercentile,
  artOutOfFoldEstimates,
  computeArtPercentiles,
  trainArtPredictor,
  type ArtSample,
} from "@/lib/art/model"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

interface Entrada {
  signal: ArtSignal
  tagSlugs: Set<string>
  label: number | null
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

/**
 * Monta o que a Fase 2 vai persistir: o sinal de cada obra (de digest + reviews) e as tags de
 * agora. Aqui o digest é lido do banco a cada execução — em produção ele é lido UMA vez, na
 * escrita, e o recalc consome só os 6 números de `works.art_signal`.
 */
async function loadEntradas(wantedIds: Set<string>): Promise<Map<string, Entrada>> {
  const sb = createAdminClient()
  const labels = await pageAll<any>(sb, "pilot_taste_scores", "work_id, like_art_score", (q) =>
    q.not("like_art_score", "is", null),
  )
  const yByWork = new Map<string, number>(labels.map((l) => [l.work_id, Number(l.like_art_score)]))
  const works = await pageAll<any>(sb, "works", "id, review_digest")
  const reviews = await pageAll<any>(sb, "work_reviews", "work_id, text")
  const tagRows = await pageAll<any>(sb, "work_tags", "work_id, tags(slug)")

  const textosPorObra = new Map<string, string[]>()
  for (const r of reviews) {
    if (!wantedIds.has(r.work_id)) continue
    const arr = textosPorObra.get(r.work_id) ?? []
    arr.push(String(r.text ?? ""))
    textosPorObra.set(r.work_id, arr)
  }
  const tagsPorObra = new Map<string, Set<string>>()
  for (const t of tagRows) {
    if (!wantedIds.has(t.work_id)) continue
    const slug = t.tags?.slug
    if (!slug) continue
    const s = tagsPorObra.get(t.work_id) ?? new Set<string>()
    s.add(slug)
    tagsPorObra.set(t.work_id, s)
  }

  const out = new Map<string, Entrada>()
  for (const w of works) {
    if (!wantedIds.has(w.id)) continue
    out.set(w.id, {
      signal: extractArtSignal({
        reviewDigest: w.review_digest,
        reviewTexts: textosPorObra.get(w.id) ?? [],
      }),
      tagSlugs: tagsPorObra.get(w.id) ?? new Set<string>(),
      label: yByWork.get(w.id) ?? null,
    })
  }
  return out
}

const f3 = (n: number) => n.toFixed(3)
const pct = (n: number) => (100 * n).toFixed(1) + "%"

/** IC95% de proporção (Wilson) — o n de pares empatados manda no que dá pra afirmar. */
function wilson(hits: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const z = 1.96
  const p = hits / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [(c - s) / d, (c + s) / d]
}

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0])
    const r = new Array(xs.length).fill(0)
    let i = 0
    while (i < idx.length) {
      let j = i
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
      const mid = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[idx[k][1]] = mid
      i = j + 1
    }
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length
  const mb = rb.reduce((x, y) => x + y, 0) / rb.length
  const cov = ra.reduce((s, v, i) => s + (v - ma) * (rb[i] - mb), 0)
  const sa = Math.sqrt(ra.reduce((s, v) => s + (v - ma) ** 2, 0))
  const sb = Math.sqrt(rb.reduce((s, v) => s + (v - mb) ** 2, 0))
  return sa * sb > 0 ? cov / (sa * sb) : 0
}

const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
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

  const catalogo = (works as any[]).filter((w) => w.expectedScore != null)
  const ids: string[] = catalogo.map((w) => w.id)
  const entradas = await loadEntradas(new Set(ids))
  const faltando = ids.filter((id) => !entradas.has(id))
  if (faltando.length) throw new Error(`sem sinal de arte para ${faltando.length} obra(s)`)

  // ── o pipeline exatamente como a Fase 2 vai rodar
  const feats = ids.map((id) => {
    const e = entradas.get(id)!
    return artFeatureVector(e.signal, e.tagSlugs)
  })
  const comEvidencia = ids.map((id) => {
    const e = entradas.get(id)!
    return hasArtEvidence(e.signal, e.tagSlugs)
  })
  const rotuladasIdx = ids
    .map((id, i) => (entradas.get(id)!.label != null ? i : -1))
    .filter((i) => i >= 0)
  const amostras: ArtSample[] = rotuladasIdx.map((i) => ({
    features: feats[i],
    label: entradas.get(ids[i])!.label as number,
  }))

  const oof = artOutOfFoldEstimates(amostras)
  const preditor = trainArtPredictor(amostras)
  if (!oof || !preditor) throw new Error("abaixo do piso de treino — sem estimativa")

  // Rotulada usa OOF; o resto usa o modelo cheio. Sem evidência ⇒ null, nunca a média.
  const estimativa = new Array<number | null>(ids.length).fill(null)
  const cheias = preditor.predict(feats)
  const posRotulada = new Map(rotuladasIdx.map((i, k) => [i, k]))
  ids.forEach((_, i) => {
    if (!comEvidencia[i]) return
    const k = posRotulada.get(i)
    estimativa[i] = k == null ? cheias[i] : oof[k]
  })
  const percentil = computeArtPercentiles(estimativa)

  console.log(`\n══ A ARTE COMO CRITÉRIO DE DECISÃO (ordenar / filtrar) ══`)
  console.log(`   catálogo ${catalogo.length} obras · ${amostras.length} com rótulo · treino ${preditor.trainSize}, α ${preditor.alpha}`)

  // ── A. ordena arte?
  const eLab = rotuladasIdx.map((i) => estimativa[i] ?? NaN)
  const yLab = amostras.map((s) => s.label)
  const paresValidos = eLab.map((v, k) => [v, yLab[k]] as const).filter(([v]) => Number.isFinite(v))
  const ev = paresValidos.map(([v]) => v)
  const yv = paresValidos.map(([, y]) => y)
  console.log(`\n─── A. ORDENA a arte? ───`)
  console.log(`   Spearman(estimativa, rótulo)   ${f3(spearman(ev, yv))}     ← retrato: 0,531`)
  for (const corte of [8, 9]) {
    const lab: number[] = yv.map((v) => (v >= corte ? 1 : 0))
    const base = lab.reduce((a, b) => a + b, 0) / lab.length
    console.log(`   AUC "arte ≥ ${corte}"            ${f3(auc(ev, lab))}   (taxa base ${pct(base)})`)
  }
  const ordem = [...ev.keys()].sort((a, b) => ev[b] - ev[a])
  for (const corte of [9]) {
    const baseTaxa = yv.filter((v) => v >= corte).length / yv.length
    const k = Math.max(1, Math.round(ev.length * 0.2))
    const bons = ordem.slice(0, k).filter((i) => yv[i] >= corte).length
    console.log(`   topo 20%: ${pct(bons / k)} com arte ≥ ${corte}  (base ${pct(baseTaxa)}, ${((bons / k) / baseTaxa).toFixed(2)}×)`)
  }
  for (const corte of [6.5]) {
    const baseTaxa = yv.filter((v) => v <= corte).length / yv.length
    const k = Math.max(1, Math.round(ev.length * 0.2))
    const ruins = ordem.slice(-k).filter((i) => yv[i] <= corte).length
    console.log(`   fundo 20%: ${pct(ruins / k)} com arte ≤ ${corte}  (base ${pct(baseTaxa)}, ${((ruins / k) / baseTaxa).toFixed(2)}×)`)
  }

  // ── B/C. desempate
  const porNota = new Map<number, number>()
  for (const w of catalogo) {
    const k = roundToDisplayScore(w.expectedScore)
    porNota.set(k, (porNota.get(k) ?? 0) + 1)
  }
  const tamanhos = catalogo.map((w) => porNota.get(roundToDisplayScore(w.expectedScore))!).sort((a, b) => a - b)
  const porId = new Map(catalogo.map((w) => [w.id, w]))
  const estById = new Map(ids.map((id, i) => [id, estimativa[i]]))
  const rot = rotuladasIdx.map((i) => ids[i]).filter((id) => estById.get(id) != null)

  let pares = 0
  let arteDif = 0
  let acertosArte = 0
  let gostoDif = 0
  let acertosGosto = 0
  for (let i = 0; i < rot.length; i++) {
    for (let j = i + 1; j < rot.length; j++) {
      const a = porId.get(rot[i])
      const b = porId.get(rot[j])
      if (roundToDisplayScore(a.expectedScore) !== roundToDisplayScore(b.expectedScore)) continue
      pares++
      const ya = entradas.get(a.id)!.label as number
      const yb = entradas.get(b.id)!.label as number
      const ea = estById.get(a.id) as number
      const eb = estById.get(b.id) as number
      if (ya !== yb) {
        arteDif++
        if (ya > yb === ea > eb) acertosArte++
      }
      if (a.userScore != null && b.userScore != null && a.userScore !== b.userScore) {
        gostoDif++
        if (a.userScore > b.userScore === ea > eb) acertosGosto++
      }
    }
  }
  const [loA, hiA] = wilson(acertosArte, arteDif)
  const [loG, hiG] = wilson(acertosGosto, gostoDif)
  console.log(`\n─── B/C. DESEMPATA obras com a MESMA Nota Prevista exibida? ───`)
  console.log(`   ${porNota.size} valores exibidos distintos · a obra mediana divide a nota com ${tamanhos[Math.floor(tamanhos.length / 2)] - 1} outras`)
  console.log(`   ${pct(tamanhos.filter((t) => t >= 10).length / tamanhos.length)} das obras estão num empate de 10+`)
  console.log(`   ${pares} pares empatados entre as ${rot.length} rotuladas com estimativa`)
  console.log(`   B. direção da ARTE  ${pct(arteDif ? acertosArte / arteDif : 0)} de ${arteDif} pares  IC95% [${pct(loA)}, ${pct(hiA)}]   ← retrato: 67,7%`)
  console.log(`   C. direção do GOSTO ${pct(gostoDif ? acertosGosto / gostoDif : 0)} de ${gostoDif} pares  IC95% [${pct(loG)}, ${pct(hiG)}]   ← retrato: 55,8%`)

  // ── D. honestidade no catálogo
  const semEstimativa = estimativa.filter((v) => v == null).length
  const vals = estimativa.filter((v): v is number => v != null)
  console.log(`\n─── D. O FILTRO é honesto no catálogo? ───`)
  console.log(`   sem estimativa (nenhum sinal de arte): ${semEstimativa} de ${ids.length} (${pct(semEstimativa / ids.length)})`)
  console.log(`   σ da estimativa ${f3(sd(vals))} contra σ do rótulo ${f3(sd(yLab))}  (compressão ${f3(sd(vals) / sd(yLab))}×)`)
  const acima8 = vals.filter((v) => v >= 8).length
  console.log(`   um corte "arte ≥ 8" em PONTOS pegaria ${pct(acima8 / vals.length)} do catálogo — no rótulo real são ${pct(yLab.filter((v) => v >= 8).length / yLab.length)}`)
  const bandas = percentil.map(artBandFromPercentile)
  const conta = (b: string | null) => bandas.filter((x) => x === b).length
  console.log(
    `   faixas (cortes ${ART_BAND_CUTOFFS.fraca}/${ART_BAND_CUTOFFS.forte}): forte ${conta("forte")} · media ${conta("media")} · fraca ${conta("fraca")} · sem estimativa ${conta(null)}`,
  )
  console.log(`\n(read-only — 0 escrita)\n`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
