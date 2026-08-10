/**
 * Acurácia do prompt de avaliação contra o GOLD SET — a régua certa.
 *
 * O gold (`.gold/gold-FILLED.csv`) são 29 obras que a curadora leu e avaliou nos 9
 * critérios **às cegas**, sem ver a nota da IA (construído em 2026-07-28/29). Ele mede
 * ACURÁCIA (distância até o julgamento humano). Não confundir com o piloto
 * `pilot-prompt-v25.ts`, que mede MOVIMENTO (antes → depois) — a investigação de julho
 * registrou que consistência ≠ acurácia, e que a métrica de movimento já enganou uma vez:
 * a v23 "mudava no rumo pretendido" e mesmo assim ficava MAIS LONGE da curadora.
 *
 * Baseline a bater (medido em 2026-07-29, mesmas 29 obras):
 *   catálogo 0.77 geral / 0.64 ponderado  <  v24-pesada 0.82  <  v23 0.87  <  v24-cirúrgica 0.89
 *
 * O ponderado usa o peso de cada critério na Nota Prevista — é o número que importa pro
 * produto, porque errar `tragedy` (0.2% do peso) não move a previsão de gosto e errar
 * `protagonist` (31.8%) move muito.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/gold-mae.ts --list
 *   ... scripts/gold-mae.ts --execute
 *
 * 🔴 Não grava em `category_scores` nem em `ai_evaluations`. Só o log de custo.
 */
import { createClient } from "@supabase/supabase-js"
import { requestAiEvaluation, MODEL, PROMPT_VERSION, AI_EVAL_REVIEW_CAPS } from "@/lib/ai-evaluation/service"
import { fetchExternalEvaluationContextForWork, selectReviewsForEvaluation } from "@/lib/external/index"
import { mergeFreshWithPersistedReviews } from "@/lib/external/review-merge"
import { loadWorkReviewsAsSourced } from "@/lib/external/persist-reviews"
import { splitSynopsesForEvaluation, pickPrimaryCover } from "@/lib/work-derived"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { CRITERION_SLUGS } from "@/types/domain"
import type { SourcedReview } from "@/lib/external/types"
import fs from "node:fs"
import path from "node:path"

/** Peso de cada critério na Nota Prevista (|coef Ridge padronizado| / σ), medido 2026-07-29.
 *  Fonte: memória `nota_prevista_attribute_weights`, confirmada por `score_weights`. */
const PESO: Record<string, number> = {
  protagonist: 0.318,
  fantasy_nobility: 0.244,
  couple_dynamics: 0.148,
  action_adventure: 0.105,
  drama: 0.056,
  humor: 0.049,
  adult_content: 0.044,
  romance: 0.033,
  tragedy: 0.002,
}

const EXECUTE = process.argv.includes("--execute")
const OUT_DIR = process.env.PILOT_OUT_DIR ?? ".pilot"
const GOLD = ".gold/gold-FILLED.csv"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
if (EXECUTE && !process.env.ANTHROPIC_API_KEY) throw new Error("falta ANTHROPIC_API_KEY")
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Gold ───────────────────────────────────────────────────────────────────────

interface GoldRow { workId: string; titulo: string; gold: Record<string, number> }

/** Parser de CSV com aspas — os títulos têm vírgula ("Spring Amidst My Wintertide, ..."). */
function parseCsv(texto: string): string[][] {
  const linhas: string[][] = []
  let campo = ""
  let linha: string[] = []
  let dentroDeAspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (dentroDeAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') dentroDeAspas = false
      else campo += c
    } else if (c === '"') dentroDeAspas = true
    else if (c === ",") { linha.push(campo); campo = "" }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = "" }
    else if (c !== "\r") campo += c
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas.filter((l) => l.some((c) => c.trim()))
}

function lerGold(): GoldRow[] {
  const linhas = parseCsv(fs.readFileSync(GOLD, "utf8"))
  const head = linhas[0]
  return linhas.slice(1).map((cols) => {
    const rec = Object.fromEntries(head.map((h, i) => [h, cols[i] ?? ""]))
    const gold: Record<string, number> = {}
    for (const slug of CRITERION_SLUGS) {
      const v = rec[`gold_${slug}`]
      if (v != null && v !== "") gold[slug] = Number(v)
    }
    return { workId: rec.work_id, titulo: rec.titulo, gold }
  })
}

/**
 * 🔴 A UNIÃO fresco + persistido, igual à `triggerAiEvaluation`. Sem isto o harness
 * MEDE OUTRA COISA: quando o sidecar está saturado (503 busy) ou o Cloudflare bloqueia,
 * a busca fresca volta com 1–2 reviews, e o prompt sai faminto — enquanto a nota do
 * catálogo, com que estamos comparando, foi produzida com o pool cheio. O erro é
 * ASSIMÉTRICO: penaliza só a coluna nova. Medido nas 30 obras do gold: 61,7 reviews
 * persistidas em média (mín. 20, máx. 162).
 */
async function reviewsComoEmProducao(workId: string, ctx: { sourcedReviews: SourcedReview[]; allReviews?: SourcedReview[] }) {
  const persistidas = await loadWorkReviewsAsSourced(workId)
  const { merged, recovered } = mergeFreshWithPersistedReviews(ctx.allReviews ?? [], persistidas, [])
  if (recovered <= 0) return { reviews: ctx.sourcedReviews, recovered: 0 }
  return { reviews: selectReviewsForEvaluation(merged, AI_EVAL_REVIEW_CAPS), recovered }
}

// ── Carga (mesma do piloto) ────────────────────────────────────────────────────

async function carregar(workId: string) {
  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, original_title, alternative_titles,
      work_covers(url, is_primary, position),
      work_tags(tags(name, tag_group_id)),
      work_genres(genres(name)),
      work_synopses(text, source, is_primary, position)
    `)
    .eq("id", workId)
    .maybeSingle()
  if (error || !data) return null

  type Row = {
    id: string; title: string
    original_title?: string | null; alternative_titles?: string[] | null
    work_covers?: Array<{ url?: string | null; is_primary?: boolean | null; position?: number | null }>
    work_tags?: Array<{ tags?: { name?: string; tag_group_id?: string | null } | null }>
    work_genres?: Array<{ genres?: { name?: string } | null }>
    work_synopses?: Array<{ text?: string | null; source?: string | null; is_primary?: boolean | null; position?: number | null }>
  }
  const w = data as Row
  const split = splitSynopsesForEvaluation(w.work_synopses ?? [])
  const ctx = await fetchExternalEvaluationContextForWork({
    title: w.title, originalTitle: w.original_title, alternativeTitles: w.alternative_titles,
  })
  return {
    id: w.id,
    title: w.title,
    synopsis: split.primary ?? undefined,
    synopsisIsManual: split.primaryIsManual,
    additionalSynopses: split.additional,
    genres: (w.work_genres ?? []).map((g) => g.genres?.name).filter((n): n is string => Boolean(n)),
    tags: (w.work_tags ?? []).map((wt) => wt.tags)
      .filter((t): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name))
      .map((t) => ({ name: t.name!, group: t.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null) : null })),
    coverUrl: pickPrimaryCover(w.work_covers ?? []) ?? undefined,
    ctx,
  }
}

async function notasCatalogo(ids: string[]) {
  const out = new Map<string, Record<string, number>>()
  const { data } = await supabase.from("category_scores").select("work_id, criterion_slug, score").in("work_id", ids)
  for (const r of (data ?? []) as Array<{ work_id: string; criterion_slug: string; score: string }>) {
    const rec = out.get(r.work_id) ?? {}
    rec[r.criterion_slug] = Number(r.score)
    out.set(r.work_id, rec)
  }
  return out
}

async function custoDesde(iso: string) {
  const { data } = await supabase.from("ai_api_calls").select("cost_total_usd")
    .eq("operation", "ai_evaluation").gte("created_at", iso)
  const rows = (data ?? []) as Array<{ cost_total_usd: number | null }>
  return { usd: rows.reduce((a, r) => a + (r.cost_total_usd ?? 0), 0), chamadas: rows.length }
}

// ── MAE ────────────────────────────────────────────────────────────────────────

interface Amostra { gold: number; catalogo?: number; v: number }

function mae(pares: Array<{ ref: number; est: number | undefined }>) {
  const v = pares.filter((p) => p.est != null)
  return v.length ? v.reduce((a, p) => a + Math.abs(p.est! - p.ref), 0) / v.length : NaN
}

function pad(s: string, n: number) { return s.length >= n ? s : s + " ".repeat(n - s.length) }

function relatorio(dados: Map<string, Amostra[]>) {
  console.log(`\n${"=".repeat(84)}\nMAE POR CRITÉRIO — contra o gold (menor = mais perto do seu julgamento)\n${"=".repeat(84)}`)
  console.log(pad("critério", 20) + pad("peso", 8) + pad("catálogo", 11) + pad(PROMPT_VERSION, 11) + "veredito")

  let somaCat = 0, somaV = 0, n = 0
  let pondCat = 0, pondV = 0, pesoTotal = 0

  for (const slug of CRITERION_SLUGS) {
    const arr = dados.get(slug) ?? []
    if (!arr.length) continue
    const mCat = mae(arr.map((a) => ({ ref: a.gold, est: a.catalogo })))
    const mV = mae(arr.map((a) => ({ ref: a.gold, est: a.v })))
    const p = PESO[slug] ?? 0
    if (!Number.isNaN(mCat)) { somaCat += mCat; pondCat += mCat * p }
    if (!Number.isNaN(mV)) { somaV += mV; pondV += mV * p; }
    pesoTotal += p; n++
    const d = mV - mCat
    const verd = Math.abs(d) < 0.05 ? "empate" : d < 0 ? `MELHOROU ${Math.abs(d).toFixed(2)}` : `piorou ${d.toFixed(2)}`
    console.log(pad(slug, 20) + pad(`${(p * 100).toFixed(1)}%`, 8) + pad(mCat.toFixed(2), 11) + pad(mV.toFixed(2), 11) + verd)
  }

  const geralCat = somaCat / n, geralV = somaV / n
  const wCat = pondCat / pesoTotal, wV = pondV / pesoTotal
  console.log(`\n${"-".repeat(84)}`)
  console.log(pad("MAE GERAL", 28) + pad(geralCat.toFixed(2), 11) + pad(geralV.toFixed(2), 11) +
    (geralV < geralCat ? `✅ ${PROMPT_VERSION} mais perto` : `❌ catálogo mais perto`))
  console.log(pad("MAE PONDERADO (produto)", 28) + pad(wCat.toFixed(2), 11) + pad(wV.toFixed(2), 11) +
    (wV < wCat ? `✅ ${PROMPT_VERSION} mais perto` : `❌ catálogo mais perto`))
  console.log(`\nbaseline de 2026-07-29 nas mesmas obras: catálogo 0.77 geral / 0.64 ponderado`)
  console.log(`(v24-pesada 0.82 · v23 0.87 · v24-cirúrgica 0.89 — nenhuma bateu o catálogo)`)
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const gold = lerGold()
  console.log(`prompt: ${PROMPT_VERSION} · modelo: ${MODEL}`)
  console.log(`alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`gold set: ${gold.length} obras (${GOLD})`)

  if (!EXECUTE) {
    console.log(`\n[--list] nada foi chamado ($0).`)
    for (const g of gold.slice(0, 5)) console.log(`  ${g.titulo}`)
    console.log(`  … +${gold.length - 5}`)
    console.log(`\ncusto estimado: ~US$ ${(gold.length * 0.034).toFixed(2)}`)
    return
  }

  const inicio = new Date().toISOString()
  const catalogo = await notasCatalogo(gold.map((g) => g.workId))
  const dados = new Map<string, Amostra[]>()
  const bruto: unknown[] = []

  for (const [i, g] of gold.entries()) {
    console.log(`\n[${i + 1}/${gold.length}] ${g.titulo}`)
    const work = await carregar(g.workId)
    if (!work) { console.error("  ✗ obra não encontrada no catálogo local"); continue }
    const { reviews, recovered } = await reviewsComoEmProducao(work.id, work.ctx)
    if (recovered > 0) console.log(`  ↻ ${recovered} review(s) recuperadas do pool persistido (fresco trouxe ${work.ctx.sourcedReviews.length}, prompt usa ${reviews.length})`)
    try {
      const resp = await requestAiEvaluation({
        workId: work.id, title: work.title,
        synopsis: work.synopsis, synopsisIsManual: work.synopsisIsManual,
        additionalSynopses: work.additionalSynopses,
        genres: work.genres, tags: work.tags,
        sourcedReviews: reviews, externalContext: work.ctx.externalContext,
        platformRatings: work.ctx.platformRatings, similarWorks: work.ctx.similarWorks,
        contentRatings: work.ctx.contentRatings, coverUrl: work.coverUrl,
      })
      const novo: Record<string, number> = {}
      const justs: Record<string, string> = {}
      for (const s of resp.scores) { novo[s.criterionSlug] = s.suggestedScore; justs[s.criterionSlug] = s.justification }
      const cat = catalogo.get(g.workId) ?? {}
      let erroV = 0, erroC = 0, cnt = 0
      for (const slug of CRITERION_SLUGS) {
        if (g.gold[slug] == null || novo[slug] == null) continue
        const arr = dados.get(slug) ?? []
        arr.push({ gold: g.gold[slug], catalogo: cat[slug], v: novo[slug] })
        dados.set(slug, arr)
        erroV += Math.abs(novo[slug] - g.gold[slug])
        if (cat[slug] != null) { erroC += Math.abs(cat[slug] - g.gold[slug]); cnt++ }
      }
      const nSlugs = CRITERION_SLUGS.filter((s) => g.gold[s] != null && novo[s] != null).length
      console.log(`  ✓ MAE desta obra — catálogo ${cnt ? (erroC / cnt).toFixed(2) : "—"} · ${PROMPT_VERSION} ${(erroV / nSlugs).toFixed(2)}`)
      bruto.push({ workId: g.workId, titulo: g.titulo, gold: g.gold, catalogo: cat, novo, justificativas: justs })
    } catch (err) {
      console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Persiste ANTES de formatar — as chamadas já foram pagas.
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, `gold-${PROMPT_VERSION}-${inicio.replace(/[:.]/g, "-")}.json`)
  const custo = await custoDesde(inicio)
  fs.writeFileSync(out, JSON.stringify({ promptVersion: PROMPT_VERSION, model: MODEL, inicio, custo, resultados: bruto }, null, 2))
  console.log(`\nresultado bruto salvo: ${out}`)

  relatorio(dados)
  console.log(`\ncusto REAL: US$ ${custo.usd.toFixed(4)} em ${custo.chamadas} chamada(s)`)
  console.log(`🔴 nada foi gravado em category_scores nem em ai_evaluations.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
