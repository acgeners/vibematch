/**
 * LABORATÓRIO do prompt da sinopse canônica: gera variantes com prompts/modelos
 * diferentes sobre as MESMAS obras e pontua o resultado com detectores objetivos.
 *
 *   npm run synopsis:lab                          # 10 obras com defeito medido, 3 modelos
 *   npm run synopsis:lab -- --works=6             # amostra menor
 *   npm run synopsis:lab -- --models=haiku        # só um braço
 *   npm run synopsis:lab -- --work=<uuid>         # uma obra específica
 *   npm run synopsis:lab -- --dry                 # só mostra a seleção, não chama a IA
 *
 * NÃO ESCREVE NO BANCO e NÃO registra em `ai_api_calls` — são experimentos, não uso
 * de produção; poluir o ledger falsearia o /ai-usage e entraria no push da curadoria.
 * O baseline (v2) NÃO é regerado: ele já está em `works.canonical_synopsis`, então o
 * laboratório só paga as variantes novas.
 *
 * Por que importar `splitSynopsesFromText` em vez de reimplementar: o input tem de ser
 * byte a byte o mesmo que a produção monta (separador `-{10,}` + dedup), senão a
 * comparação mede a diferença do harness, não a do prompt.
 */
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"
import fs from "node:fs"
import path from "node:path"
import { splitSynopsesFromText } from "../lib/work-derived"
import { SYSTEM_PROMPT } from "../lib/ai-recommendation/synopsis-consolidator"

config({ path: ".env.local" })

const args = process.argv.slice(2)
const N_WORKS = Number(args.find((a) => a.startsWith("--works="))?.split("=")[1] ?? "10")
const ONLY_WORK = args.find((a) => a.startsWith("--work="))?.split("=")[1] ?? null
const DRY = args.includes("--dry")
const MODELS_ARG = args.find((a) => a.startsWith("--models="))?.split("=")[1] ?? "haiku,sonnet5,sonnet46"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

// Mesmo gate da produção (`SYNOPSIS_MIN_BLOCK_CHARS`), replicado aqui para não
// importar o módulo `server-only` do consolidador dentro de um script.
const MIN_BLOCK_CHARS = 40

// ── o prompt em teste ───────────────────────────────────────────────────────────────────
// Por padrão testa o prompt DE PRODUÇÃO — importado, não copiado: uma cópia aqui
// divergiria em silêncio do que o app usa, e o laboratório passaria a medir outra
// coisa. Para testar um candidato (v4), troque `PROMPT_EM_TESTE` por um literal
// local; promova para a produção só depois que o placar justificar.
export const PROMPT_EM_TESTE = SYSTEM_PROMPT

// ── braços de teste ─────────────────────────────────────────────────────────────────────
// Sonnet 5 REJEITA `temperature` (HTTP 400) e liga thinking por default — mesma regra
// que `modelRejectsSampling` aplica no wrapper de produção. Desligamos o thinking para
// a comparação ficar tão determinística quanto o braço Haiku.
interface Arm {
  key: string
  model: string
  rejectsSampling: boolean
  usdIn: number // por MTok
  usdOut: number
}
const ALL_ARMS: Arm[] = [
  { key: "haiku", model: "claude-haiku-4-5-20251001", rejectsSampling: false, usdIn: 1, usdOut: 5 },
  { key: "sonnet5", model: "claude-sonnet-5", rejectsSampling: true, usdIn: 2, usdOut: 10 },
  { key: "sonnet46", model: "claude-sonnet-4-6", rejectsSampling: false, usdIn: 3, usdOut: 15 },
]
const ARMS = ALL_ARMS.filter((a) => MODELS_ARG.split(",").includes(a.key))

// ── detectores ──────────────────────────────────────────────────────────────────────────
// Inglês PERMITIDO por decisão de produto: honoríficos e termos de gênero ficam.
const EN_ALLOWED = new Set(
  `duke dukes duchess archduke archduchess lord lady ladies marquis marquess viscount baron baroness
   count countess emperor empress prince princess sir madam master mistress
   dungeon dungeons quest quests guild guilds maid maids butler knight knights mana skill status raid hunter`
    .split(/\s+/)
    .filter(Boolean),
)
// Inglês que NÃO deve sobrar: substantivo comum + palavra funcional (sinal de saída inteira em inglês).
const EN_FLAGGED = `crate manor estate servant curse beast witch wizard spell sword heir commoner noble mansion
  the and with that this they their there when where which while would could should about after before
  through from into over under between because than then these those other such even only`
  .split(/\s+/)
  .filter(Boolean)

const STOP = new Set(
  "para porque quando quanto enquanto sempre também depois antes entre sobre apenas ainda assim muito pouco todos todas outro outra mesmo mesma suas seus dele dela como mais menos onde essa esse esta este isso".split(
    " ",
  ),
)

const PLEO = [
  /\bsubir para cima\b/i, /\bdescer para baixo\b/i, /\bentrar (para )?dentro\b/i, /\bsair (para )?fora\b/i,
  /\belo de liga(ç|c)(ã|a)o\b/i, /\bcerteza absoluta\b/i, /\bplanejar (com )?anteced(ê|e)ncia\b/i,
  /\bh(á|a) \w+ atr(á|a)s\b/i, /\bencarar de frente\b/i, /\bprot(a|á)gonista principal\b/i,
  /\bsurpresa inesperada\b/i, /\bfato real\b/i, /\bconviver junto\b/i,
]

interface Findings {
  words: number
  enLeak: string[]
  verbEcho: string[]
  pleonasm: string[]
  longSentences: number
  format: string[]
  score: number
}

/**
 * Remove trechos ENTRE ASPAS antes de caçar inglês. Sem isto o detector acusa
 * `the`/`and`/`that` em toda obra que cita um título original ("The Tyrants Are
 * Divorcing Me") — que é uso correto, não vazamento de tradução. Medido: era a
 * causa da maioria dos 71 falsos positivos da primeira varredura.
 */
function stripQuoted(text: string): string {
  return text.replace(/"[^"]*"/g, " ").replace(/[“][^”]*[”]/g, " ")
}

function analyze(text: string): Findings {
  const low = text.toLowerCase()
  const lowNoQuotes = stripQuoted(low)

  const enLeak = EN_FLAGGED.filter(
    (w) => !EN_ALLOWED.has(w) && new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, "u").test(lowNoQuotes),
  )

  // Eco de verbo: forma conjugada + infinitivo do MESMO verbo a ≤6 palavras.
  const verbEcho: string[] = []
  const toks = low.match(/[\p{L}]{5,}/gu) ?? []
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < Math.min(i + 7, toks.length); j++) {
      const a = toks[i]!, b = toks[j]!
      if (a === b || STOP.has(a) || STOP.has(b)) continue
      const inf = (x: string, y: string) =>
        /(ar|er|ir)$/.test(y) && y.length > x.length && y.startsWith(x.slice(0, Math.max(5, x.length - 1)))
      if (inf(a, b) || inf(b, a)) {
        verbEcho.push(`${a}/${b}`)
        i = j
        break
      }
    }
  }

  const pleonasm = PLEO.map((re) => text.match(re)?.[0]).filter((m): m is string => !!m)

  const longSentences = text
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 45).length

  const format: string[] = []
  if (/(^|\n)\s*(#{1,6}\s|\*\*|[-*]\s)/.test(text)) format.push("markdown")
  if (/^\s*sinopse\s*:/i.test(text)) format.push('prefixo "Sinopse:"')
  if (/^\s*["“][\s\S]*["”]\s*$/.test(text)) format.push("aspas envolventes")
  if (/(^|\n)\s*-{3,}\s*(\n|$)/.test(text)) format.push("separador ---")
  if (/[^.!?…"”)]\s*$/.test(text)) format.push("sem pontuação final")
  if (/\[source\]|\(fonte|\[fonte/i.test(text)) format.push("marcador de fonte")

  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
  return {
    words,
    enLeak,
    verbEcho,
    pleonasm,
    longSentences,
    format,
    score: enLeak.length + verbEcho.length + pleonasm.length + longSentences + format.length,
  }
}

// ── seleção: obras com defeito MEDIDO na canônica atual ─────────────────────────────────
interface WorkRow {
  id: string
  title: string
  canonical_synopsis: string
}

async function pickWorks(): Promise<WorkRow[]> {
  const rows: WorkRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("works")
      .select("id, title, canonical_synopsis")
      .not("canonical_synopsis", "is", null)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...(data as WorkRow[]))
    if (data.length < 1000) break
  }
  console.log(`catálogo: ${rows.length} obras com sinopse canônica`)

  if (ONLY_WORK) return rows.filter((w) => w.id === ONLY_WORK)

  // Ordena pelo score do detector: teste em cima de defeito conhecido, não amostra aleatória.
  return rows
    .map((w) => ({ w, f: analyze(w.canonical_synopsis) }))
    .filter((x) => x.f.score > 0)
    .sort((a, b) => b.f.score - a.f.score)
    .slice(0, N_WORKS)
    .map((x) => x.w)
}

// ── input idêntico ao da produção ───────────────────────────────────────────────────────
async function buildUserPrompt(workId: string): Promise<{ prompt: string; nBlocks: number } | null> {
  const { data } = await supabase.from("work_synopses").select("text").eq("work_id", workId)
  const raw = (data ?? []).map((r) => (r.text as string | null) ?? "").filter((t) => t.trim().length > 0)
  if (!raw.length) return null
  const expanded = raw.flatMap((t) => {
    const blocks = splitSynopsesFromText(t)
    return blocks.length > 0 ? blocks : [t]
  })
  const cleaned = expanded.map((b) => b.trim()).filter((b) => b.length >= MIN_BLOCK_CHARS)
  if (!cleaned.length) return null
  const numbered = cleaned.map((b, i) => `[V${i + 1}]\n${b}`).join("\n\n---\n\n")
  return {
    prompt: `Consolide as ${cleaned.length} versão(ões) abaixo em uma única sinopse canônica em PT-BR.\n\n${numbered}`,
    nBlocks: cleaned.length,
  }
}

// ── geração ─────────────────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

async function generate(arm: Arm, userPrompt: string): Promise<{ text: string; usd: number; ms: number }> {
  const body: Record<string, unknown> = {
    model: arm.model,
    max_tokens: 800,
    system: PROMPT_EM_TESTE,
    messages: [{ role: "user", content: userPrompt }],
  }
  if (arm.rejectsSampling) body.thinking = { type: "disabled" }
  else body.temperature = 0.1

  const t0 = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg: any = await anthropic.messages.create(body as any)
  const ms = Date.now() - t0
  const text = (msg.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim()
  const usd = (msg.usage.input_tokens * arm.usdIn + msg.usage.output_tokens * arm.usdOut) / 1_000_000
  return { text, usd, ms }
}

// ── main ────────────────────────────────────────────────────────────────────────────────
async function main() {
  const works = await pickWorks()
  console.log(`\namostra: ${works.length} obra(s) — as de MAIOR score de defeito na canônica atual\n`)
  for (const w of works) {
    const f = analyze(w.canonical_synopsis)
    const bits = [
      f.enLeak.length ? `inglês: ${f.enLeak.join(",")}` : "",
      f.verbEcho.length ? `eco: ${f.verbEcho.join(",")}` : "",
      f.pleonasm.length ? `pleonasmo: ${f.pleonasm.join(",")}` : "",
      f.longSentences ? `${f.longSentences} frase(s) longa(s)` : "",
      f.format.length ? `formato: ${f.format.join(",")}` : "",
    ].filter(Boolean)
    console.log(`  [${String(f.score).padStart(2)}] ${w.title.slice(0, 46).padEnd(48)} ${bits.join(" · ")}`)
  }
  if (DRY) return

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outDir = path.join(process.cwd(), ".backups", `synopsis-lab-${stamp}`)
  fs.mkdirSync(outDir, { recursive: true })

  const md: string[] = [`# Laboratório do prompt da sinopse — ${stamp}`, ""]
  const totals = new Map<string, { score: number; usd: number; ms: number; words: number; n: number }>()
  for (const a of ARMS) totals.set(a.key, { score: 0, usd: 0, ms: 0, words: 0, n: 0 })
  const baseline = { score: 0, words: 0, n: 0 }

  for (const w of works) {
    const built = await buildUserPrompt(w.id)
    if (!built) {
      console.log(`\n⚠️  ${w.title}: sem blocos consolidáveis — pulando`)
      continue
    }
    const fv2 = analyze(w.canonical_synopsis)
    baseline.score += fv2.score
    baseline.words += fv2.words
    baseline.n++

    console.log(`\n${w.title}  (${built.nBlocks} bloco(s) de fonte)`)
    console.log(`  v2 atual        score ${String(fv2.score).padStart(2)}  ${fv2.words} palavras`)

    md.push(`## ${w.title}`, "", `**v2 (atual, no banco)** — score ${fv2.score}, ${fv2.words} palavras`, "", w.canonical_synopsis, "")

    for (const arm of ARMS) {
      try {
        const { text, usd, ms } = await generate(arm, built.prompt)
        const f = analyze(text)
        const t = totals.get(arm.key)!
        t.score += f.score
        t.usd += usd
        t.ms += ms
        t.words += f.words
        t.n++
        console.log(
          `  v3 ${arm.key.padEnd(9)}   score ${String(f.score).padStart(2)}  ${String(f.words).padStart(3)} palavras  ${(ms / 1000).toFixed(1)}s  $${usd.toFixed(4)}`,
        )
        md.push(`**v3 · ${arm.key}** — score ${f.score}, ${f.words} palavras, ${(ms / 1000).toFixed(1)}s, $${usd.toFixed(4)}`, "", text, "")
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err)
        console.log(`  v3 ${arm.key.padEnd(9)}   ✗ ${m.slice(0, 90)}`)
        md.push(`**v3 · ${arm.key}** — FALHOU: ${m}`, "")
      }
    }
    md.push("---", "")
  }

  console.log(`\n${"─".repeat(72)}\nPLACAR (score menor = melhor; soma sobre ${baseline.n} obra(s))\n`)
  console.log(`  ${"braço".padEnd(12)} ${"score".padStart(6)} ${"palavras".padStart(9)} ${"latência".padStart(9)} ${"custo".padStart(9)}`)
  console.log(`  ${"v2 (atual)".padEnd(12)} ${String(baseline.score).padStart(6)} ${String(Math.round(baseline.words / Math.max(1, baseline.n))).padStart(9)} ${"—".padStart(9)} ${"—".padStart(9)}`)
  for (const arm of ARMS) {
    const t = totals.get(arm.key)!
    if (!t.n) continue
    console.log(
      `  ${("v3 " + arm.key).padEnd(12)} ${String(t.score).padStart(6)} ${String(Math.round(t.words / t.n)).padStart(9)} ${((t.ms / t.n / 1000).toFixed(1) + "s").padStart(9)} ${("$" + t.usd.toFixed(3)).padStart(9)}`,
    )
  }

  const mdPath = path.join(outDir, "comparacao.md")
  fs.writeFileSync(mdPath, md.join("\n"))
  console.log(`\n✓ lado a lado: ${path.relative(process.cwd(), mdPath)}`)
  console.log(`  O placar mede o que é AUTOMATIZÁVEL. Erro de concordância ("quer que ela fingia")`)
  console.log(`  não aparece nele — leia o arquivo antes de decidir.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
