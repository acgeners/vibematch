#!/usr/bin/env node
/**
 * Corta o rodapé da página ("... Last updated N years agoWas this comment useful? Yes No") que a
 * raspagem antiga do MangaUpdates gravou no fim de reviews de comentários EDITADOS. A régua é
 * `scripts/lib/mu-sufixo-legado.mjs` — este script só a aplica, pagina e grava.
 *
 * 🔴 ALVO: NUVEM — GRAVA em `work_reviews`. O local é réplica descartável.
 *
 *   # ensaio (PADRÃO): lê, mostra o plano e não grava nada
 *   node --env-file=.env.local scripts/limpar-sufixo-legado-mangaupdates.mjs
 *   node --env-file=.env.local scripts/limpar-sufixo-legado-mangaupdates.mjs --listar   # todas as linhas
 *
 *   # aplica (salva antes o estado anterior em .backups/limpar-sufixo-mu-<stamp>/)
 *   node --env-file=.env.local scripts/limpar-sufixo-legado-mangaupdates.mjs --execute
 *
 * ⚠️ US$0 — nenhuma chamada de modelo nem de fonte externa. Não reavalia, não regera resumo nem
 * digest: o gate de materialidade deles olha a CONTAGEM do pool, e cortar um sufixo não muda
 * quantas reviews a obra tem.
 *
 * ## Por que existe
 *
 * Desde o PR #583 os comentários vêm da API, sem o rodapé. A persistência acumulativa
 * deduplica por texto exato, então a versão suja (antiga) e a limpa (nova) do MESMO comentário
 * não se reconhecem: sem esta limpeza, a próxima coleta de cada obra grava a limpa AO LADO da
 * suja. Medido no backup de 2026-11-01: 563 reviews em 265 obras; depois do corte, 49 de 50
 * das amostradas batem exatamente com o texto da API (a outra foi apagada no MU).
 *
 * ## As duas guardas da escrita
 *
 * - cada `update`/`delete` só pega a linha se o texto AINDA for o lido (`.eq("text", antes)`):
 *   se algo regravou a review no meio, ela fica de fora e o script avisa;
 * - quem conta o gravado é o `.select("id")` da própria escrita, nunca o tamanho do plano.
 *
 * ## O efeito colateral que ela evita
 *
 * `works.reviews_hash` é a impressão digital do pool, e o `saveWorkReviews` marca a avaliação
 * como desatualizada quando ela muda. Editar o texto por fora deixaria o hash velho, e a próxima
 * coleta de cada obra tocada a poria em "Reviews novas" sem review nova. Por isso o script
 * ressincroniza o hash — só onde ele estava em dia antes (ver `hashAposLimpeza`).
 *
 * O `plano.json` guarda a LINHA INTEIRA de cada review tocada (inclusive as apagadas) e o
 * `reviews_hash` anterior de cada obra: é o desfazer completo.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"
import { separarSufixoLegado } from "./lib/mu-sufixo-legado.mjs"
// A MESMA impressão digital que o `saveWorkReviews` grava — nunca uma cópia da fórmula.
import { reviewsFingerprint } from "../lib/reviews/fingerprint.ts"
// O dono da retenção de `.backups` é ÚNICO — ver scripts/lib/backups-retencao.mjs.
import { podar } from "./lib/backups-retencao.mjs"
import { criarFunil } from "./lib/funil.mjs"

const EXECUTAR = process.argv.includes("--execute")
const LISTAR = process.argv.includes("--listar")
const FONTE = "mangaupdates"
const PAGINA = 1000

const temRodape = (texto) => texto.includes("Last updated") || texto.includes("Was this comment useful")

/**
 * Plano puro (testável): o que fazer com cada review do MU. Duplicata = o texto limpo já existe
 * em outra review da MESMA obra (ou outra suja vira o mesmo texto) — aí a suja sai em vez de
 * virar a 2ª cópia.
 */
export function planejarLimpeza(linhas) {
  const textosPorObra = new Map()
  for (const l of linhas) {
    if (!textosPorObra.has(l.work_id)) textosPorObra.set(l.work_id, new Set())
    if (!separarSufixoLegado(l.text) || !temRodape(l.text)) textosPorObra.get(l.work_id).add(l.text)
  }
  // Entre cópias do mesmo comentário, fica a MAIS ANTIGA (a captura original); a ordem por id
  // seria arbitrária. Medido em 2026-11-05: os 2 pares só diferem nos carimbos de tempo.
  const comRodape = linhas
    .filter((l) => temRodape(l.text))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)))
  const naoReconhecidas = []
  const acoes = []
  for (const l of comRodape) {
    const s = separarSufixoLegado(l.text)
    if (!s) {
      naoReconhecidas.push(l)
      continue
    }
    const vistos = textosPorObra.get(l.work_id)
    const duplicata = vistos.has(s.limpo)
    vistos.add(s.limpo)
    acoes.push({
      id: l.id,
      work_id: l.work_id,
      // A linha INTEIRA, para o desfazer ser completo — inclusive das que forem apagadas.
      linha: l,
      acao: duplicata ? "apagar" : "atualizar",
      antes: l.text,
      depois: duplicata ? null : s.limpo,
      text_length_antes: l.text_length,
      text_length_depois: duplicata ? null : s.limpo.length,
      sufixo: s.sufixo,
      cortado: s.cortado,
    })
  }
  return { comRodape, naoReconhecidas, acoes }
}

/**
 * `works.reviews_hash` é a impressão digital do pool (`lib/reviews/fingerprint.ts`): quando a
 * próxima coleta a vê mudar, marca a avaliação da obra como desatualizada
 * (`ai_eval_reviews_stale`). Esta limpeza edita o texto POR FORA do `saveWorkReviews`, então,
 * sem ressincronizar, 265 avaliações virariam "Reviews novas" sem review nova nenhuma.
 *
 * Só ressincroniza onde o hash ESTAVA em dia antes da limpeza: se ele já divergia, há mudança de
 * conteúdo anterior a esta, e escondê-la seria apagar um sinal real.
 */
export function hashAposLimpeza(armazenado, antes, depois) {
  return armazenado === antes ? depois : null
}

const LOTE_OBRAS = 20

async function lerPools(sb, workIds) {
  const pools = new Map(workIds.map((w) => [w, []]))
  for (let i = 0; i < workIds.length; i += LOTE_OBRAS) {
    const lote = workIds.slice(i, i + LOTE_OBRAS)
    for (let from = 0; ; from += PAGINA) {
      const { data, error } = await sb
        .from("work_reviews")
        .select("id, work_id, text, user_rating, source")
        .in("work_id", lote)
        .order("id")
        .range(from, from + PAGINA - 1)
      if (error) throw new Error(`pool de work_reviews: ${error.message}`)
      if (!data?.length) break
      for (const r of data) pools.get(r.work_id).push(r)
      if (data.length < PAGINA) break
    }
  }
  return pools
}

async function lerHashes(sb, workIds) {
  const hashes = new Map()
  for (let i = 0; i < workIds.length; i += 200) {
    const { data, error } = await sb.from("works").select("id, reviews_hash").in("id", workIds.slice(i, i + 200))
    if (error) throw new Error(`works.reviews_hash: ${error.message}`)
    for (const w of data ?? []) hashes.set(w.id, w.reviews_hash ?? null)
  }
  return hashes
}

const fingerprintDoPool = (pool) =>
  reviewsFingerprint(pool.map((r) => ({ text: r.text, source: r.source, userRating: r.user_rating })))

async function lerReviewsDoMU(sb) {
  const { count, error: countError } = await sb
    .from("work_reviews")
    .select("id", { count: "exact", head: true })
    .eq("source", FONTE)
  if (countError) throw new Error(`contagem de work_reviews: ${countError.message}`)

  // ⚠️ Paginado e ORDENADO por id (chave única): sem `order`, páginas do PostgREST não são
  // estáveis — linha repetida e linha sumida, sem erro.
  const linhas = []
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await sb
      .from("work_reviews")
      .select("id, work_id, source, source_title, text, text_length, user_rating, match_score, fetched_at, created_at")
      .eq("source", FONTE)
      .order("id")
      .range(from, from + PAGINA - 1)
    if (error) throw new Error(`work_reviews: ${error.message}`)
    if (!data?.length) break
    linhas.push(...data)
    if (data.length < PAGINA) break
  }
  // Leitura truncada diria "nada a fazer" sobre o que sobrou: o erro que produz resultado.
  if (linhas.length !== count) throw new Error(`li ${linhas.length} reviews do MU, o banco conta ${count} — abortado`)
  return linhas
}

function mostrar(acao) {
  const corpo = acao.antes.slice(0, acao.antes.length - acao.sufixo.length)
  console.log(`  [${acao.acao}] work=${acao.work_id.slice(0, 8)} review=${String(acao.id).slice(0, 8)}${acao.cortado ? " (cortada em 900)" : ""}`)
  console.log(`      …${JSON.stringify(corpo.slice(-70))}`)
  console.log(`      − ${JSON.stringify(acao.sufixo)}`)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) {
    console.error("FATAL: sem NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — use --env-file=.env.local")
    process.exit(1)
  }
  const ehLocal = /127\.0\.0\.1|localhost/.test(url)
  console.log(`alvo: ${url}${ehLocal ? "  ⚠️  LOCAL — este script quer a NUVEM" : ""}`)
  if (ehLocal && EXECUTAR) {
    console.error("FATAL: --execute contra o banco LOCAL perderia a limpeza no próximo db:pull. Use a nuvem.")
    process.exit(1)
  }
  const sb = createClient(url, chave)

  const funil = criarFunil("limpar rodapé legado do MangaUpdates")
  const linhas = await lerReviewsDoMU(sb)
  funil.passo("reviews do MU lidas (= count exato)", linhas.length)

  const { comRodape, naoReconhecidas, acoes } = planejarLimpeza(linhas)
  funil.passo("com rodapé da página no texto", comRodape.length)
  // Medido no backup de 2026-11-01: 563 de 563. Abaixo disso, a régua deixou de ver alguma forma.
  funil.passo("rodapé na forma reconhecida", acoes.length, { reterAoMenos: 0.99 })

  if (acoes.length === 0) {
    funil.nadaAFazer("nenhuma review com o rodapé legado.")
    return
  }
  const confiavel = funil.relatar()
  console.log("")

  const atualizar = acoes.filter((a) => a.acao === "atualizar")
  const apagar = acoes.filter((a) => a.acao === "apagar")
  const obras = new Set(acoes.map((a) => a.work_id)).size
  console.log(`${acoes.length} review(s) em ${obras} obra(s): ${atualizar.length} a atualizar · ${apagar.length} duplicata(s) a apagar`)
  console.log(`  das quais ${acoes.filter((a) => a.cortado).length} cortadas no teto de 900 (o corte caiu dentro do rodapé)\n`)

  if (naoReconhecidas.length > 0) {
    console.log(`⚠️  ${naoReconhecidas.length} com rodapé fora da régua — ficam INTOCADAS:`)
    for (const l of naoReconhecidas) console.log(`  review=${l.id} …${JSON.stringify(l.text.slice(-80))}`)
    console.log("")
  }

  const amostra = LISTAR ? acoes : [...apagar, ...atualizar.filter((a) => a.cortado).slice(0, 3), ...atualizar.filter((a) => !a.cortado).slice(0, 5)]
  console.log(LISTAR ? "todas as linhas:" : "amostra (use --listar para ver todas):")
  for (const a of amostra) mostrar(a)
  console.log("")

  // A impressão digital de cada obra tocada, ANTES — e a que ela terá depois, simulada no plano.
  const obrasTocadas = [...new Set(acoes.map((a) => a.work_id))]
  const pools = await lerPools(sb, obrasTocadas)
  const hashes = await lerHashes(sb, obrasTocadas)
  const porId = new Map(acoes.map((a) => [a.id, a]))
  const hashAntes = new Map()
  let emDia = 0
  for (const w of obrasTocadas) {
    const antes = fingerprintDoPool(pools.get(w))
    hashAntes.set(w, antes)
    if (hashes.get(w) === antes) emDia++
  }
  const simulado = (w) =>
    fingerprintDoPool(
      pools
        .get(w)
        .filter((r) => porId.get(r.id)?.acao !== "apagar")
        .map((r) => (porId.has(r.id) ? { ...r, text: porId.get(r.id).depois } : r)),
    )
  console.log(`reviews_hash: ${emDia} de ${obrasTocadas.length} obra(s) em dia antes da limpeza — essas são ressincronizadas;`)
  console.log(`  as outras ${obrasTocadas.length - emDia} já divergiam por outra mudança e ficam como estão (a próxima coleta as marca, como faria de qualquer jeito)\n`)

  if (!EXECUTAR) {
    console.log("ENSAIO — nada gravado. Repita com --execute para aplicar.")
    return
  }
  if (!confiavel) {
    console.error("FATAL: o funil furou o esperado (ver acima) — nada gravado.")
    process.exit(1)
  }

  // Poda ANTES de gravar: ensaio interrompido deixa lixo igual ao de execução completa.
  podar("limpar-sufixo-mu")
  // Snapshot ANTES de escrever: é a única rede pra desfazer (o banco não tem PITR).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.resolve(process.cwd(), ".backups", `limpar-sufixo-mu-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, "plano.json"),
    JSON.stringify({ alvo: url, acoes, reviewsHashAntes: Object.fromEntries(hashes) }, null, 2),
  )
  console.log(`estado anterior salvo em ${path.relative(process.cwd(), dir)}/plano.json\n`)

  let atualizadas = 0
  let apagadas = 0
  const fora = []
  const gravadasPorObra = new Set()
  for (const a of acoes) {
    const q =
      a.acao === "atualizar"
        ? sb.from("work_reviews").update({ text: a.depois, text_length: a.text_length_depois })
        : sb.from("work_reviews").delete()
    const { data, error } = await q.eq("id", a.id).eq("text", a.antes).select("id")
    if (error) {
      console.error(`  ✗ review=${a.id} — ${error.message}`)
      fora.push(a.id)
      continue
    }
    if (!data?.length) {
      fora.push(a.id) // o texto mudou desde a leitura: não é desta limpeza mexer
      continue
    }
    if (a.acao === "atualizar") atualizadas++
    else apagadas++
    gravadasPorObra.add(a.work_id)
  }
  console.log(`✅ ${atualizadas}/${atualizar.length} atualizada(s) · ${apagadas}/${apagar.length} apagada(s)`)

  // Ressincroniza o hash com o pool REAL de depois (relido, não o simulado), e só onde ele
  // estava em dia e ninguém o mudou no meio (`.eq` no valor lido).
  const relidos = await lerPools(sb, [...gravadasPorObra])
  let ressincronizadas = 0
  let divergiram = 0
  for (const w of gravadasPorObra) {
    const depois = fingerprintDoPool(relidos.get(w))
    if (depois !== simulado(w)) divergiram++
    const novo = hashAposLimpeza(hashes.get(w), hashAntes.get(w), depois)
    if (!novo) continue
    const { data, error } = await sb
      .from("works")
      .update({ reviews_hash: novo })
      .eq("id", w)
      .eq("reviews_hash", hashes.get(w))
      .select("id")
    if (error) console.error(`  ✗ reviews_hash work=${w} — ${error.message}`)
    else if (data?.length) ressincronizadas++
  }
  console.log(`✅ reviews_hash ressincronizado em ${ressincronizadas} obra(s)`)
  if (divergiram > 0) console.log(`  ⚠️  em ${divergiram} obra(s) o pool relido difere do previsto (algo gravou no meio) — o hash usado é o do pool real`)
  if (fora.length > 0) {
    console.error(`⚠️  ${fora.length} ficaram de fora (erro ou texto mudou desde a leitura) — o script é idempotente, pode repetir.`)
    process.exitCode = 1
  }
}

const chamadoDireto = (() => {
  try {
    // `realpath` nos DOIS lados: no macOS o caminho digitado e o real divergem por symlink
    // (/var → /private/var), e sem isto o script terminaria com código 0 sem rodar nada.
    return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (chamadoDireto) {
  main().catch((e) => {
    console.error("FATAL:", e)
    process.exit(1)
  })
}
