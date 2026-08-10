/**
 * Piloto medido do prompt de avaliação (v25) — roda a avaliação de IA numa amostra
 * ESTRATIFICADA e compara nota-a-nota com a que está persistida em `category_scores`.
 *
 * Por quê: as mudanças da v23→v25 são todas de TEXTO. A suíte prova que o prompt está
 * coerente; não prova que o modelo pontua melhor. Rodar o catálogo inteiro (~US$33) sem
 * uma medição antes é repetir o processo que produziu os vieses originais.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/pilot-prompt-v25.ts --list           # só imprime a amostra ($0)
 *   ... scripts/pilot-prompt-v25.ts --execute      # roda de verdade
 *   ... --execute --only=A,B                       # roda só alguns estratos
 *
 * 🔴 NÃO grava nada em `category_scores` nem em `ai_evaluations`. A única escrita é o
 * log de custo em `ai_api_calls`, que é o que torna a medição de custo REAL em vez de
 * estimada. O resultado vai pra um JSON no diretório de saída.
 *
 * ⚠️ CONFOUND CONHECIDO, não escondido: a nota "antes" foi produzida meses atrás, com o
 * pool de reviews da época e por um caminho de contexto (`resolveEvaluationContext`) que
 * mora numa função privada de um arquivo "use server" e não é importável daqui. Este
 * script remonta o contexto com os helpers públicos. Então o delta mistura DUAS causas:
 * a mudança de prompt e a deriva das fontes externas. Ele mede a direção do movimento
 * do catálogo — não isola o efeito do prompt. Pra isolar seria preciso rodar as duas
 * versões do prompt sobre o MESMO contexto na mesma execução (~2× o custo).
 */
import { createClient } from "@supabase/supabase-js"
import { requestAiEvaluation, MODEL, PROMPT_VERSION } from "@/lib/ai-evaluation/service"
import { fetchExternalEvaluationContextForWork } from "@/lib/external/index"
import { splitSynopsesForEvaluation, pickPrimaryCover } from "@/lib/work-derived"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { CRITERION_SLUGS } from "@/types/domain"
import { bandForScore } from "@/lib/criteria/justification"
import fs from "node:fs"
import path from "node:path"

// ── Amostra ────────────────────────────────────────────────────────────────────
// IDs fixos, não uma query: a amostra tem que ser a MESMA entre execuções pra o
// antes/depois ser comparável, e uma query com `order by md5()` sobre um catálogo
// que muda não garante isso. A SQL que a gerou está no comentário de cada estrato.
interface Alvo { id: string; title: string; grupo: string }

const AMOSTRA: Alvo[] = [
  // A — as 4 obras que originaram a auditoria (uma por imagem).
  { grupo: "A-imagem", id: "ca52474d-b56d-4e68-a8ad-b2b36c515d1f", title: "The Dying Villainess Denies Adoption" },
  { grupo: "A-imagem", id: "df466ead-4e02-46fc-a7a9-fb8cb09d9d84", title: "I'm the Villainess, but I Imprinted with the Male Lead" },
  { grupo: "A-imagem", id: "73fd2ee5-74f8-470e-8996-07c66355a8be", title: "The Siren: Becoming the Villain's Family" },
  { grupo: "A-imagem", id: "12d8fd23-98e2-4dfc-af93-f9acf1816e1d", title: "The Villainess Is Retiring" },

  // B — tag de regressão/reencarnação + prosa citando posse/ciúme + couple_dynamics ≤ 6.
  // Exercita: item (d) da linha do tempo, tolerar × querer, os dois tetos.
  { grupo: "B-regressao+posse", id: "15818020-77cc-4430-a25b-0bc9f403ffa0", title: "Growing the Seed of Evil" },
  { grupo: "B-regressao+posse", id: "161e5582-e440-43fd-8e31-7941b50be13b", title: "A Foxy Affair" },
  { grupo: "B-regressao+posse", id: "0f26cd5b-8885-443a-9baf-b3757b791eaf", title: "A Tender Heart: The Story of How I Became a Duke's Maid" },
  { grupo: "B-regressao+posse", id: "04d015be-eaf0-498f-90af-dacf11f8e6c2", title: "I Failed to Oust the Villain!" },
  { grupo: "B-regressao+posse", id: "1c81e6f3-ad1f-4a95-9e4a-828513244ad9", title: "Living With the Dangerous Beast" },
  { grupo: "B-regressao+posse", id: "0951a89a-14bd-4fae-9c5b-00288b98785f", title: "One Husband Is Enough" },
  { grupo: "B-regressao+posse", id: "02be7427-d739-4b54-9098-b4d05fcd5033", title: "The Little Lady Behind the Scenes" },
  { grupo: "B-regressao+posse", id: "04d30ade-6087-404e-a51f-c06f5bf419dd", title: "The Majesty Makeover" },

  // C — tags de circunstância 18+ (migration 182) com adult_content hoje em 7–8,5.
  { grupo: "C-18+circunstancia", id: "13790b32-d3ce-4ba9-a600-2ed25d040467", title: "Absolute Praise" },
  { grupo: "C-18+circunstancia", id: "25007e9b-9105-429e-9557-eb35a1322bfa", title: "His Majesty's Secret Heroine" },
  { grupo: "C-18+circunstancia", id: "272d0e28-2a75-41e7-81c0-218bbf7408e0", title: "My Insatiable Duke in a Three-Year Marriage" },
  { grupo: "C-18+circunstancia", id: "2a30c0bd-d0a8-4a5f-ae66-2acb15dce0dc", title: "The Male Lead Won't Let Me Be!" },
  { grupo: "C-18+circunstancia", id: "01d906b3-1906-4176-9315-177b544e5f76", title: "The Newlywed Life of a Witch and a Dragon" },

  // D — action_adventure em 4-6 com prosa afirmando AUSÊNCIA (slice of life, uneventful).
  // Exercita: piso condicional + posição dentro da faixa.
  { grupo: "D-acao-slicelife", id: "05de6004-7103-4fc7-a0ca-534307196ad3", title: "Don't Fall for the Villainess" },
  { grupo: "D-acao-slicelife", id: "0d217b26-542e-492c-816b-c95e7d3210c5", title: "I Became the Squirrel That Saves the Villain" },
  { grupo: "D-acao-slicelife", id: "01a765c5-ea1f-4f72-9f12-4954955dc7f3", title: "Saving the Villain from the Heroine" },
  { grupo: "D-acao-slicelife", id: "0c321cc1-6418-4987-b446-0df5bfbe9f54", title: "The Fantasie of a Stepmother" },
  { grupo: "D-acao-slicelife", id: "03a55403-893e-46fb-a49c-e2d990470afd", title: "The World's Strongest Are Obsessed With Me" },
  { grupo: "D-acao-slicelife", id: "0e0466fd-ebbd-4d1f-92bb-095b3582c9ab", title: "Why the Villainess Wields the Sword" },

  // E — protagonist ≥ 7 com prosa chamando o protagonista de passivo/sem agência.
  { grupo: "E-protag-passivo", id: "2d28c709-8117-41a7-b94e-97dc25add815", title: "I Want My First Time With a Handsome Knight" },
  { grupo: "E-protag-passivo", id: "18f9fd16-c85b-4358-b8e6-eb2355fea7fc", title: "The Tyrant's Guardian Is an Evil Witch" },
  { grupo: "E-protag-passivo", id: "09dc3ba1-0698-4a27-87a2-e534dbbf4175", title: "What It Means to Be You" },

  // F — CONTROLE. Nenhum critério de seleção ligado às mudanças: se estas se moverem
  // tanto quanto os estratos-alvo, o que mediu foi ruído, não a correção.
  { grupo: "F-controle", id: "930a32e4-193f-4ec2-9f95-3638a828385f", title: "Behind His Kind Mask" },
  { grupo: "F-controle", id: "ebe86455-dbf0-4961-9406-7c08d18bb0f5", title: "Lips Upon a Sword's Edge" },
  { grupo: "F-controle", id: "a99961ee-cc2a-4f69-b803-4bb380d504c1", title: "My Ray of Hope" },
  { grupo: "F-controle", id: "a23b47c0-366d-4620-a51f-97cf7718f043", title: "The Devilishly Trash Duke" },
]

const EXECUTE = process.argv.includes("--execute")
const onlyArg = process.argv.find((a) => a.startsWith("--only="))
const ONLY = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim().toUpperCase()) : null
const OUT_DIR = process.env.PILOT_OUT_DIR ?? ".pilot"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
if (EXECUTE && !process.env.ANTHROPIC_API_KEY) throw new Error("falta ANTHROPIC_API_KEY")

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Carga da obra ──────────────────────────────────────────────────────────────

interface WorkInput {
  id: string
  title: string
  synopsis?: string
  synopsisIsManual: boolean
  additionalSynopses: Array<{ text: string; source: string | null; isManual: boolean }>
  genres: string[]
  tags: Array<{ name: string; group: string | null }>
  coverUrl?: string
  ctx: Awaited<ReturnType<typeof fetchExternalEvaluationContextForWork>>
}

async function carregar(alvo: Alvo): Promise<WorkInput | null> {
  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, original_title, alternative_titles,
      work_covers(url, is_primary, position),
      work_tags(tags(name, tag_group_id)),
      work_genres(genres(name)),
      work_synopses(text, source, is_primary, position)
    `)
    .eq("id", alvo.id)
    .maybeSingle()

  if (error || !data) {
    console.error(`  ✗ não carregou: ${error?.message ?? "obra não encontrada"}`)
    return null
  }

  type Row = {
    id: string
    title: string
    original_title?: string | null
    alternative_titles?: string[] | null
    work_covers?: Array<{ url?: string | null; is_primary?: boolean | null; position?: number | null }>
    work_tags?: Array<{ tags?: { name?: string; tag_group_id?: string | null } | null }>
    work_genres?: Array<{ genres?: { name?: string } | null }>
    work_synopses?: Array<{ text?: string | null; source?: string | null; is_primary?: boolean | null; position?: number | null }>
  }
  const w = data as Row

  const tags = (w.work_tags ?? [])
    .map((wt) => wt.tags)
    .filter((t): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name))
    .map((t) => ({
      name: t.name!,
      group: t.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null) : null,
    }))

  const genres = (w.work_genres ?? []).map((g) => g.genres?.name).filter((n): n is string => Boolean(n))

  // Mesma separação primária/adicionais que a action usa — a rubrica de sinopse
  // MANUAL ("autoridade máxima") só existe se as adicionais forem passadas.
  // Passa as linhas CRUAS: o helper ordena (primária primeiro), deduplica e separa.
  // Remapear os campos aqui quebraria a ordenação, que depende de `is_primary`.
  const split = splitSynopsesForEvaluation(w.work_synopses ?? [])

  const ctx = await fetchExternalEvaluationContextForWork({
    title: w.title,
    originalTitle: w.original_title,
    alternativeTitles: w.alternative_titles,
  })

  return {
    id: w.id,
    title: w.title,
    synopsis: split.primary ?? undefined,
    synopsisIsManual: split.primaryIsManual,
    additionalSynopses: split.additional,
    genres,
    tags,
    coverUrl: pickPrimaryCover(w.work_covers ?? []) ?? undefined,
    ctx,
  }
}

async function notasAtuais(workIds: string[]): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>()
  const { data, error } = await supabase
    .from("category_scores")
    .select("work_id, criterion_slug, score")
    .in("work_id", workIds)
  if (error) throw new Error(error.message)
  for (const row of (data ?? []) as Array<{ work_id: string; criterion_slug: string; score: string }>) {
    const rec = out.get(row.work_id) ?? {}
    rec[row.criterion_slug] = Number(row.score)
    out.set(row.work_id, rec)
  }
  return out
}

/** Custo REAL da rodada, lido do ledger — não estimado a partir de tokens. */
async function custoDesde(iso: string): Promise<{ usd: number; chamadas: number }> {
  const { data, error } = await supabase
    .from("ai_api_calls")
    .select("cost_total_usd")
    .eq("operation", "ai_evaluation")
    .gte("created_at", iso)
  if (error) return { usd: 0, chamadas: 0 }
  const rows = (data ?? []) as Array<{ cost_total_usd: number | null }>
  return { usd: rows.reduce((a, r) => a + (r.cost_total_usd ?? 0), 0), chamadas: rows.length }
}

// ── Relatório ──────────────────────────────────────────────────────────────────

interface Resultado {
  grupo: string
  workId: string
  title: string
  reviews: number
  latencyMs: number
  confidence: number
  antes: Record<string, number>
  depois: Record<string, number>
  justificativas: Record<string, string>
  erro?: string
}

function fmtDelta(d: number): string {
  if (d === 0) return "   ·  "
  const s = d > 0 ? "+" : "−"
  return ` ${s}${Math.abs(d).toFixed(1)}  `
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function relatorio(res: Resultado[]) {
  const ok = res.filter((r) => !r.erro)
  if (ok.length === 0) {
    console.log("\nnenhuma avaliação concluída.")
    return
  }

  console.log(`\n${"=".repeat(100)}\nDELTA POR OBRA (depois − antes)\n${"=".repeat(100)}`)
  console.log(pad("obra", 46) + CRITERION_SLUGS.map((s) => pad(s.slice(0, 6), 7)).join(""))
  for (const r of ok) {
    const linha = CRITERION_SLUGS.map((slug) => {
      const a = r.antes[slug]
      const d = r.depois[slug]
      if (a == null || d == null) return pad("  —", 7)
      return pad(fmtDelta(Math.round((d - a) * 10) / 10), 7)
    }).join("")
    console.log(pad(`[${r.grupo.slice(0, 3)}] ${r.title}`.slice(0, 45), 46) + linha)
  }

  // Movimento médio por critério, POR ESTRATO. O controle (F) é a régua: se ele
  // se mover tanto quanto os alvos, o que se mediu foi ruído do modelo.
  console.log(`\n${"=".repeat(100)}\nMOVIMENTO MÉDIO POR ESTRATO (|delta| médio · delta médio com sinal)\n${"=".repeat(100)}`)
  const grupos = [...new Set(ok.map((r) => r.grupo))].sort()
  console.log(pad("estrato", 22) + pad("n", 4) + CRITERION_SLUGS.map((s) => pad(s.slice(0, 6), 9)).join(""))
  for (const g of grupos) {
    const doGrupo = ok.filter((r) => r.grupo === g)
    const cells = CRITERION_SLUGS.map((slug) => {
      const ds = doGrupo
        .map((r) => (r.antes[slug] != null && r.depois[slug] != null ? r.depois[slug] - r.antes[slug] : null))
        .filter((d): d is number => d !== null)
      if (ds.length === 0) return pad("—", 9)
      const med = ds.reduce((a, b) => a + b, 0) / ds.length
      const abs = ds.reduce((a, b) => a + Math.abs(b), 0) / ds.length
      return pad(`${abs.toFixed(1)}·${med >= 0 ? "+" : "−"}${Math.abs(med).toFixed(1)}`, 9)
    }).join("")
    console.log(pad(g, 22) + pad(String(doGrupo.length), 4) + cells)
  }

  // Distribuição por faixa — é aqui que a descompressão da escala apareceria.
  console.log(`\n${"=".repeat(100)}\nDISTRIBUIÇÃO POR FAIXA — antes → depois (amostra inteira)\n${"=".repeat(100)}`)
  const FAIXAS = ["0-3", "4-6", "7-8", "9-10"]
  console.log(pad("critério", 20) + FAIXAS.map((f) => pad(f, 16)).join(""))
  for (const slug of CRITERION_SLUGS) {
    const cells = FAIXAS.map((faixa) => {
      const a = ok.filter((r) => r.antes[slug] != null && bandForScore(r.antes[slug]) === faixa).length
      const d = ok.filter((r) => r.depois[slug] != null && bandForScore(r.depois[slug]) === faixa).length
      const seta = d === a ? "=" : d > a ? "↑" : "↓"
      return pad(`${a} → ${d} ${seta}`, 16)
    }).join("")
    console.log(pad(slug, 20) + cells)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const alvos = ONLY ? AMOSTRA.filter((a) => ONLY.some((g) => a.grupo.toUpperCase().startsWith(g))) : AMOSTRA

  console.log(`prompt: ${PROMPT_VERSION} · modelo: ${MODEL}`)
  console.log(`alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`amostra: ${alvos.length} obra(s) em ${new Set(alvos.map((a) => a.grupo)).size} estrato(s)\n`)
  for (const g of [...new Set(alvos.map((a) => a.grupo))].sort()) {
    console.log(`  ${pad(g, 22)} ${alvos.filter((a) => a.grupo === g).length}`)
  }

  if (!EXECUTE) {
    console.log(`\n[--list] nada foi chamado ($0). Rode com --execute pra valer.`)
    console.log(`Custo estimado: ~US$ ${(0.079 + (alvos.length - 1) * 0.038).toFixed(2)} (1ª chamada paga escrita de cache).`)
    return
  }

  const inicio = new Date().toISOString()
  const antesTodos = await notasAtuais(alvos.map((a) => a.id))
  const resultados: Resultado[] = []

  for (const [i, alvo] of alvos.entries()) {
    console.log(`\n[${i + 1}/${alvos.length}] ${alvo.title}  (${alvo.grupo})`)
    const work = await carregar(alvo)
    if (!work) {
      resultados.push({ grupo: alvo.grupo, workId: alvo.id, title: alvo.title, reviews: 0, latencyMs: 0, confidence: 0, antes: {}, depois: {}, justificativas: {}, erro: "carga falhou" })
      continue
    }

    console.log(`  contexto: ${work.ctx.sourcedReviews.length} reviews · ${work.tags.length} tags · ${work.genres.length} gêneros`)
    const t0 = Date.now()
    try {
      const resp = await requestAiEvaluation({
        workId: work.id,
        title: work.title,
        synopsis: work.synopsis,
        synopsisIsManual: work.synopsisIsManual,
        additionalSynopses: work.additionalSynopses,
        genres: work.genres,
        tags: work.tags,
        sourcedReviews: work.ctx.sourcedReviews,
        externalContext: work.ctx.externalContext,
        platformRatings: work.ctx.platformRatings,
        similarWorks: work.ctx.similarWorks,
        contentRatings: work.ctx.contentRatings,
        coverUrl: work.coverUrl,
      })
      const depois: Record<string, number> = {}
      const justs: Record<string, string> = {}
      for (const s of resp.scores) {
        depois[s.criterionSlug] = s.suggestedScore
        justs[s.criterionSlug] = s.justification
      }
      const antes = antesTodos.get(alvo.id) ?? {}
      const mudou = CRITERION_SLUGS.filter((s) => antes[s] != null && depois[s] != null && antes[s] !== depois[s]).length
      console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s · conf ${resp.confidence.toFixed(2)} · ${mudou}/9 critérios mudaram${resp.fromCache ? ` (CACHE ${resp.fromCache})` : ""}`)
      resultados.push({
        grupo: alvo.grupo, workId: alvo.id, title: alvo.title,
        reviews: work.ctx.sourcedReviews.length, latencyMs: Date.now() - t0,
        confidence: resp.confidence, antes, depois, justificativas: justs,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ ${msg}`)
      resultados.push({ grupo: alvo.grupo, workId: alvo.id, title: alvo.title, reviews: work.ctx.sourcedReviews.length, latencyMs: Date.now() - t0, confidence: 0, antes: antesTodos.get(alvo.id) ?? {}, depois: {}, justificativas: {}, erro: msg })
    }
  }

  // 🔴 Persiste ANTES de formatar. O relatório é código que pode estourar (um critério
  // ausente, um título estranho); as chamadas já foram pagas. Perder a rodada por causa
  // de um `pad()` seria o erro mais caro possível neste script.
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, `piloto-${PROMPT_VERSION}-${inicio.replace(/[:.]/g, "-")}.json`)
  const custo = await custoDesde(inicio)
  fs.writeFileSync(out, JSON.stringify({ promptVersion: PROMPT_VERSION, model: MODEL, inicio, custo, resultados }, null, 2))
  console.log(`\nresultado bruto salvo: ${out}`)

  relatorio(resultados)
  console.log(`\n${"=".repeat(100)}`)
  console.log(`custo REAL da rodada (ai_api_calls): US$ ${custo.usd.toFixed(4)} em ${custo.chamadas} chamada(s)`)
  const okN = resultados.filter((r) => !r.erro).length
  if (okN > 0) console.log(`por obra: US$ ${(custo.usd / okN).toFixed(4)} · extrapolando pras ~880 do catálogo: US$ ${((custo.usd / okN) * 880).toFixed(0)}`)

  console.log(`\njustificativas novas, na íntegra: ${out}`)
  console.log(`🔴 nada foi gravado em category_scores nem em ai_evaluations.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
