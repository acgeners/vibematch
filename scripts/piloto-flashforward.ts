/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PILOTO: "a obra começa com FLASHFORWARD?" — cascata LOCAL → WEB.
 *
 * A pergunta é estrutural, não de enredo, e as três fontes falham de formas diferentes
 * (medido em 2026-08-12, ver [[project-flashforward-fonte-e-o-digest]]):
 *   - regex sobre reviews: acha 7 obras em 988 — o vocabulário do leitor é livre demais
 *     ("end at the beginning", "don't read the first chapter"), então regex é o instrumento errado
 *   - busca web: acerta em obra popular (10k+ votos = 6,4% do catálogo) e devolve SINOPSE na cauda
 *   - digest + reviews locais: acertou onde a web falhou, por 1/6 do custo
 *
 * Daí a cascata: pergunta ao dado local primeiro; só aciona `web_search` quando o local não
 * sustenta NEM "sim" NEM "não". O passo web custa ~5× o local (US$10/1.000 buscas + os tokens
 * dos resultados), então gastá-lo em toda obra é desperdício em ~metade dos casos.
 *
 * 🔴 A RÉGUA, e é ela que separa flashforward de setup isekai:
 *    **a narrativa principal REENCONTRA a cena de abertura?**
 *    - sim  → flashforward (viu o "depois" antes do "antes", e a história chega lá)
 *    - não  → prólogo de regressão (a cena é de uma linha que foi SUBSTITUÍDA, nunca alcançada)
 *    A tag `time-skip-in-first-chapter-prologue` NÃO distingue os dois: das 42 obras que a têm,
 *    22 (52,4%) também têm regressão/reencarnação.
 *
 * ⚠️ EVIDÊNCIA LITERAL OU NADA. Sem citação verificável o veredito é forçado a `indeterminado`
 * no código, não só pedido no prompt — com 320 obras de reencarnação no catálogo, "sim" é o
 * chute plausível, e um piloto que aceita palpite mede o tropo em vez da obra.
 *
 * ⚠️ Este script NÃO grava em `ai_api_calls` nem no catálogo — lê do LOCAL e imprime. É piloto
 * exploratório: o resultado é a tabela, e logar o custo num banco descartável não valeria o
 * acoplamento. O custo real sai calculado dos tokens de cada resposta.
 *
 * 🔴 DUAS ETAPAS, e a web é OPT-IN POR OBRA — não é fallback automático. Medido no 1º piloto
 * (2026-08-12, 9 obras): a etapa local decidiu 4 a US$0,02 cada; a etapa web rodou nas 5
 * restantes a **US$0,13–0,41 cada** e resgatou **1**. Ou seja **~US$1,06 por obra adicional
 * decidida** — 6,7× o custo médio projetado. O culpado não são as buscas (US$0,01 cada) e sim
 * os RESULTADOS delas voltando pro input a cada volta do loop: ~100k tokens de input por obra.
 * Encadear web automaticamente transforma um artefato de US$0,02 num de US$0,14 para ganhar
 * 12 pontos de cobertura. Por isso ela virou um segundo disparo, explícito, com o custo à vista.
 *
 *   # ETAPA 1 — busca local (barata, em lote). Grava em .pilot/flashforward.json
 *   npx tsx … scripts/piloto-flashforward.ts --limit=20
 *
 *   # ETAPA 2 — web, só para uma obra que ficou indeterminada (~US$0,20, ~20% de resgate)
 *   npx tsx … scripts/piloto-flashforward.ts --web="The Viridescent Tiara"
 *
 *   # utilitários: --refazer (ignora o estado) · --max-cost-usd=1.00 · --listar
 *
 * ALVO: LOCAL — só LÊ, então o `.env.analysis` (que vem DEPOIS e vence) o manda pro clone
 * local e o egress fica em zero. Sem ele, roda contra a NUVEM em silêncio.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/piloto-flashforward.ts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"

/** Estado entre as duas etapas. `.pilot/` é gitignored — ver `.e1/` pelo mesmo motivo. */
const STATE_DIR = ".pilot"
const STATE_FILE = `${STATE_DIR}/flashforward.json`

/**
 * Custo típico de UMA passada web, medido nas 5 do 1º piloto (US$0,13 / 0,19 / 0,20 / 0,22 /
 * 0,41). Usado como RESERVA: o teto precisa saber o preço do próximo passo antes de dá-lo,
 * senão ele só descobre que estourou depois de pagar — que foi o bug do 1º piloto (US$1,24
 * contra teto de US$1,00).
 */
const CUSTO_WEB_ESTIMADO = 0.25
const CUSTO_LOCAL_ESTIMADO = 0.025

// Sonnet 5 na promo introdutória ($2/$10 por MTok até 2026-08-31). Se `SONNET_MODEL` voltar
// pro 4.6 em setembro, estes números sobem — o script imprime o modelo junto do custo.
const PRICE_IN_PER_MTOK = 2.0
const PRICE_OUT_PER_MTOK = 10.0
const PRICE_PER_SEARCH = 0.01 // US$10 / 1.000 buscas

const MAX_REVIEWS = 40
const MAX_REVIEW_CHARS = 26_000

const VERDICT_TOOL: Anthropic.Tool = {
  name: "registrar_veredito",
  description: "Registra o veredito sobre a estrutura de abertura da obra.",
  input_schema: {
    type: "object",
    properties: {
      veredito: {
        type: "string",
        enum: ["flashforward", "linear", "indeterminado"],
        description:
          "flashforward = abre com cena que a narrativa depois ALCANÇA. linear = abertura é o começo cronológico (inclui prólogo de regressão/morte da vida anterior que a nova linha nunca reencontra). indeterminado = a evidência não sustenta nem um nem outro.",
      },
      evidencia: {
        type: "string",
        description:
          "CITAÇÃO LITERAL do material fornecido que sustenta o veredito, copiada palavra por palavra. Se não houver citação possível, deixe vazio e responda indeterminado.",
      },
      raciocinio: {
        type: "string",
        description:
          "Uma frase: a narrativa reencontra a cena de abertura, ou a cena pertence a uma linha substituída?",
      },
      confianca: { type: "number", description: "0 a 1." },
    },
    required: ["veredito", "evidencia", "raciocinio", "confianca"],
  },
}

const REGRA = `Você determina se uma obra (manhwa/manga) ABRE COM FLASHFORWARD.

A RÉGUA — uma pergunta só: a narrativa principal REENCONTRA a cena de abertura?
- SIM  → "flashforward". O leitor vê o "depois" antes do "antes", e a história chega naquela cena.
- NÃO  → "linear". Inclui o caso mais comum do gênero: a obra abre com a MORTE ou execução da
  protagonista e ela regride/reencarna. Essa cena pertence a uma linha do tempo que foi
  SUBSTITUÍDA — a nova linha existe justamente para evitá-la e nunca a alcança. Isso NÃO é
  flashforward, é prólogo de regressão.

⚠️ Reencarnação, regressão, transmigração e time travel NÃO são evidência de flashforward por si
sós. São o tropo mais comum deste catálogo; se você responder "sim" por causa deles, está
descrevendo o gênero, não a obra.

⚠️ EVIDÊNCIA LITERAL OBRIGATÓRIA. Cite palavra por palavra o trecho do material que sustenta o
veredito. Se o material só descreve o ENREDO (quem é a protagonista, qual o conflito) e não diz
nada sobre a ORDEM em que os eventos são apresentados, responda "indeterminado" com evidência
vazia. "Indeterminado" é a resposta certa e esperada na maioria dos casos — não é falha.`

interface Obra {
  id: string
  title: string
  synopsis: string
  digest: string
  reviews: string[]
  tags: string[]
  votos: number
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

/** Amostra: os Tipos 1 e 2 que a curadora leu + os 3 controles de veredito já conhecido. */
const CONTROLES = ["The Remarried Empress", "Into the Light Once Again", "I Tamed the Monster Prince"]

async function carregarAmostra(limit: number): Promise<Obra[]> {
  const sb = createAdminClient()

  const tagRows = await pageAll<any>(sb, "work_tags", "work_id, tags(slug)")
  const tagsByWork = new Map<string, Set<string>>()
  for (const t of tagRows) {
    const slug = t.tags?.slug
    if (!slug) continue
    const s = tagsByWork.get(t.work_id) ?? new Set<string>()
    s.add(slug)
    tagsByWork.set(t.work_id, s)
  }

  const comTagPrologo = [...tagsByWork.entries()]
    .filter(([, s]) => s.has("time-skip-in-first-chapter-prologue"))
    .map(([id]) => id)

  const estado = await pageAll<any>(sb, "user_work_state", "work_id, user_score, chapters_read")
  const lidas = new Set(
    estado.filter((e) => e.user_score != null || (e.chapters_read ?? 0) > 0).map((e) => e.work_id),
  )

  const works = await pageAll<any>(
    sb,
    "works",
    "id, title, canonical_synopsis, review_digest",
  )
  const byId = new Map<string, any>(works.map((w) => [w.id, w]))

  const alvo = new Set<string>(comTagPrologo.filter((id) => lidas.has(id)))
  for (const w of works) if (CONTROLES.includes(w.title)) alvo.add(w.id)

  const ratings = await pageAll<any>(sb, "platform_ratings", "work_id, vote_count")
  const votosByWork = new Map<string, number>()
  for (const r of ratings) {
    if (!alvo.has(r.work_id)) continue
    votosByWork.set(r.work_id, (votosByWork.get(r.work_id) ?? 0) + Number(r.vote_count ?? 0))
  }

  const reviews = await pageAll<any>(sb, "work_reviews", "work_id, text, source")
  const revByWork = new Map<string, string[]>()
  for (const r of reviews) {
    if (!alvo.has(r.work_id)) continue
    const arr = revByWork.get(r.work_id) ?? []
    arr.push(`[${r.source}] ${String(r.text ?? "").slice(0, 1200)}`)
    revByWork.set(r.work_id, arr)
  }

  const obras: Obra[] = []
  for (const id of alvo) {
    const w = byId.get(id)
    if (!w) continue
    // As reviews que falam da ABERTURA vêm primeiro: o teto de caracteres corta o fim da lista,
    // e cortar justamente a evidência relevante inverteria o resultado do piloto.
    const todas = revByWork.get(id) ?? []
    const relevantes = todas.filter((t) =>
      /first (chapter|ch|episode)|prologue|prolog|opening|beginning|starts?|begins?|flash|timeline|ending|spoil/i.test(t),
    )
    const resto = todas.filter((t) => !relevantes.includes(t))
    const ordenadas = [...relevantes, ...resto].slice(0, MAX_REVIEWS)

    let acc = 0
    const cortadas: string[] = []
    for (const r of ordenadas) {
      if (acc + r.length > MAX_REVIEW_CHARS) break
      cortadas.push(r)
      acc += r.length
    }

    obras.push({
      id,
      title: String(w.title ?? ""),
      synopsis: String(w.canonical_synopsis ?? "").slice(0, 1500),
      digest: w.review_digest ? JSON.stringify(w.review_digest).slice(0, 6000) : "",
      reviews: cortadas,
      tags: [...(tagsByWork.get(id) ?? [])].filter((t) =>
        /regress|reincarn|transmigrat|time|flash|prolog|skip/.test(t),
      ),
      votos: votosByWork.get(id) ?? 0,
    })
  }

  obras.sort((a, b) => (CONTROLES.includes(b.title) ? 1 : 0) - (CONTROLES.includes(a.title) ? 1 : 0))
  return obras.slice(0, limit)
}

function montarMaterial(o: Obra): string {
  const partes = [`OBRA: ${o.title}`]
  if (o.synopsis) partes.push(`\nSINOPSE (descreve o ENREDO, raramente a estrutura):\n${o.synopsis}`)
  if (o.tags.length) partes.push(`\nTAGS DE TROPO (não são evidência de estrutura):\n${o.tags.join(", ")}`)
  if (o.digest) partes.push(`\nSÍNTESE DAS REVIEWS (JSON):\n${o.digest}`)
  if (o.reviews.length) partes.push(`\nREVIEWS DE LEITORES (${o.reviews.length}):\n${o.reviews.join("\n---\n")}`)
  return partes.join("\n")
}

interface Resultado {
  obra: string
  veredito: string
  evidencia: string
  raciocinio: string
  confianca: number
  fonte: "local" | "web" | "nenhuma"
  custoUsd: number
  buscas: number
  votos: number
}

function extrairTool(msg: Anthropic.Message): any | null {
  for (const b of msg.content) {
    if (b.type === "tool_use" && b.name === "registrar_veredito") return b.input
  }
  return null
}

function custoDe(usage: any): number {
  const inTok = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
  return (inTok * PRICE_IN_PER_MTOK) / 1e6 + ((usage?.output_tokens ?? 0) * PRICE_OUT_PER_MTOK) / 1e6
}

async function passoLocal(client: Anthropic, o: Obra) {
  const msg = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1200,
    thinking: { type: "disabled" },
    system: REGRA,
    tools: [VERDICT_TOOL],
    tool_choice: { type: "tool", name: "registrar_veredito" },
    messages: [
      {
        role: "user",
        content: `${montarMaterial(o)}\n\nCom base APENAS no material acima, a obra abre com flashforward? Use a tool.`,
      },
    ],
  })
  return { payload: extrairTool(msg), custo: custoDe(msg.usage) }
}

async function passoWeb(client: Anthropic, o: Obra) {
  let custo = 0
  let buscas = 0
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `A obra "${o.title}" (manhwa) abre com flashforward?

O material que eu já tenho é INCONCLUSIVO — ele descreve o enredo, não a ordem em que os eventos são apresentados. Busque na web discussões de leitores sobre o PRIMEIRO CAPÍTULO ou o PRÓLOGO desta obra especificamente.

Depois de buscar, registre o veredito pela tool. Se a busca também só devolver sinopse/premissa, o veredito é "indeterminado" — não infira do tropo.`,
    },
  ]

  // Server tools rodam num loop server-side que pode devolver `pause_turn`; reenviar a
  // conversa retoma de onde parou. Sem isto, uma busca longa devolveria veredito vazio.
  //
  // ⚠️ Cada volta REPROCESSA os resultados de busca já acumulados em `messages` — é daí que
  // vinha o custo de US$0,41 numa obra só. Duas voltas e 2 buscas é o teto: no 1º piloto
  // nenhuma resposta útil apareceu depois da 2ª, e a 3ª busca só engordava o input.
  for (let i = 0; i < 2; i++) {
    const msg: Anthropic.Message = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 2000,
      thinking: { type: "disabled" },
      system: REGRA,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 2 } as any,
        VERDICT_TOOL,
      ],
      messages,
    })
    custo += custoDe(msg.usage)
    buscas += (msg.usage as any)?.server_tool_use?.web_search_requests ?? 0

    const payload = extrairTool(msg)
    if (payload) return { payload, custo, buscas }

    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content })
      continue
    }
    // Sem tool call e sem pausa: cobra a tool explicitamente, uma vez.
    messages.push({ role: "assistant", content: msg.content })
    messages.push({ role: "user", content: "Registre o veredito usando a tool registrar_veredito." })
  }
  return { payload: null, custo, buscas }
}

function carregarEstado(): Record<string, Resultado> {
  if (!existsSync(STATE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch {
    return {}
  }
}

function salvarEstado(estado: Record<string, Resultado>) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(estado, null, 2))
}

/** A citação vazia força `indeterminado` AQUI, não no prompt: instrução é pedido, código é garantia. */
function normalizar(p: any, fonte: Resultado["fonte"]): { veredito: string; evidencia: string; fonte: Resultado["fonte"] } {
  const evidencia = String(p?.evidencia ?? "").trim()
  let veredito = String(p?.veredito ?? "indeterminado")
  if (veredito !== "indeterminado" && evidencia.length < 15) veredito = "indeterminado"
  return { veredito, evidencia, fonte: veredito === "indeterminado" ? "nenhuma" : fonte }
}

function linha(r: Resultado) {
  const marca = r.veredito === "flashforward" ? "◀FF" : r.veredito === "linear" ? " — " : " ? "
  console.log(
    `${marca} ${r.obra.slice(0, 40).padEnd(40)} ${r.fonte.padEnd(8)} ${r.buscas ? `${r.buscas}b ` : "   "}$${r.custoUsd.toFixed(4)}`,
  )
}

function imprimirResumo(rs: Resultado[], gasto: number) {
  console.log(`\n${"=".repeat(78)}\nRESULTADO\n${"=".repeat(78)}`)
  for (const r of rs) {
    console.log(`\n■ ${r.obra}  [${r.veredito}]  fonte=${r.fonte}  conf=${r.confianca.toFixed(2)}  ${r.votos} votos`)
    if (r.raciocinio) console.log(`  razão: ${r.raciocinio}`)
    if (r.evidencia) console.log(`  cita:  "${r.evidencia.slice(0, 220)}"`)
  }
  const ff = rs.filter((r) => r.veredito === "flashforward").length
  const lin = rs.filter((r) => r.veredito === "linear").length
  const ind = rs.filter((r) => r.veredito === "indeterminado").length
  const porWeb = rs.filter((r) => r.fonte === "web").length

  console.log(`\n${"=".repeat(78)}`)
  console.log(`flashforward ${ff} · linear ${lin} · indeterminado ${ind}  (de ${rs.length})`)
  console.log(`decididas: ${ff + lin} (${((100 * (ff + lin)) / Math.max(1, rs.length)).toFixed(0)}%) — ${ff + lin - porWeb} pelo LOCAL, ${porWeb} pela WEB`)
  if (gasto > 0) console.log(`gasto nesta execução: US$${gasto.toFixed(4)}`)
  console.log(
    `\n⚠️ "indeterminado" alto é o resultado ESPERADO. O que reprovaria o desenho é o oposto:` +
      ` veredito confiante em obra cuja evidência só fala de enredo.`,
  )
  if (ind > 0) {
    console.log(`\nETAPA 2 (opt-in, ~US$${CUSTO_WEB_ESTIMADO.toFixed(2)} e ~20% de resgate) para uma indeterminada:`)
    const alvo = rs.find((r) => r.veredito === "indeterminado")!
    console.log(`  npx tsx … scripts/piloto-flashforward.ts --web="${alvo.obra}"`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20)
  const maxCost = Number(args.find((a) => a.startsWith("--max-cost-usd="))?.split("=")[1] ?? 1.0)
  const alvoWeb = args.find((a) => a.startsWith("--web="))?.split("=").slice(1).join("=")
  const refazer = args.includes("--refazer")
  const estado = refazer ? {} : carregarEstado()

  if (args.includes("--listar")) {
    const rs = Object.values(estado)
    if (!rs.length) return console.log("Sem estado ainda — rode a etapa 1 primeiro.")
    return imprimirResumo(rs, 0)
  }

  const client = getAnthropicClient({ maxRetries: 4 })

  // ---------------- ETAPA 2: web para UMA obra, disparo explícito ----------------
  if (alvoWeb) {
    const obras = await carregarAmostra(999)
    const o = obras.find((x) => x.title.toLowerCase().includes(alvoWeb.toLowerCase()))
    if (!o) return console.log(`Obra não encontrada na amostra: "${alvoWeb}"`)

    console.log(`ETAPA 2 (web) · ${o.title} · ~US$${CUSTO_WEB_ESTIMADO.toFixed(2)} estimado\n`)
    const web = await passoWeb(client, o)
    const custo = web.custo + web.buscas * PRICE_PER_SEARCH
    const n = normalizar(web.payload, "web")
    const r: Resultado = {
      obra: o.title,
      veredito: n.veredito,
      evidencia: n.evidencia,
      raciocinio: String(web.payload?.raciocinio ?? ""),
      confianca: Number(web.payload?.confianca ?? 0),
      fonte: n.fonte,
      custoUsd: (estado[o.id]?.custoUsd ?? 0) + custo,
      buscas: web.buscas,
      votos: o.votos,
    }
    estado[o.id] = r
    salvarEstado(estado)
    linha(r)
    imprimirResumo([r], custo)
    return
  }

  // ---------------- ETAPA 1: local, em lote ----------------
  const todas = await carregarAmostra(limit)
  const pendentes = todas.filter((o) => !estado[o.id])
  console.log(`ETAPA 1 (local) · modelo ${SONNET_MODEL} · teto US$${maxCost.toFixed(2)}`)
  console.log(`${todas.length} na amostra · ${todas.length - pendentes.length} já no estado · ${pendentes.length} a processar\n`)

  let gasto = 0
  for (const o of pendentes) {
    // Reserva ANTES de gastar — o 1º piloto verificava depois e estourou o teto em 24%.
    if (gasto + CUSTO_LOCAL_ESTIMADO > maxCost) {
      console.log(`\n⛔ teto de US$${maxCost.toFixed(2)} — parando antes de gastar (gasto: US$${gasto.toFixed(4)}).`)
      break
    }
    const local = await passoLocal(client, o)
    const n = normalizar(local.payload, "local")
    const r: Resultado = {
      obra: o.title,
      veredito: n.veredito,
      evidencia: n.evidencia,
      raciocinio: String(local.payload?.raciocinio ?? ""),
      confianca: Number(local.payload?.confianca ?? 0),
      fonte: n.fonte,
      custoUsd: local.custo,
      buscas: 0,
      votos: o.votos,
    }
    gasto += local.custo
    estado[o.id] = r
    salvarEstado(estado) // grava a cada obra: interromper não perde o que já foi pago
    linha(r)
  }

  imprimirResumo(Object.values(estado), gasto)
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e)
  process.exit(1)
})
