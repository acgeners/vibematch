// @ts-check
/**
 * Batch resolver de hids da Comix (comix.to).
 *
 * PORQUÊ: desde ~2026-06 a API de busca da Comix (`/api/v1/manga?keyword=`) exige
 * um token de assinatura `_=` gerado no client por JS ofuscado — não dá pra buscar
 * por fetch direto. PORÉM o detalhe (SSR de /title/{hid}) e as reviews (/threads/*)
 * são TOKEN-FREE: uma vez que a obra tem o hid salvo em `work_external_ids`, o app
 * busca reviews normalmente. Este script roda OFFLINE um browser real (que executa
 * o JS e gera o token) só pra DESCOBRIR o hid de cada obra e persisti-lo. Depois
 * disso, as reviews da Comix voltam a funcionar pra essas obras sem browser nenhum.
 *
 * Rode periodicamente (ou após adicionar obras novas) pra cobrir o catálogo.
 *
 * Uso:
 *   node scripts/resolve-comix-hids.mjs                 # resolve obras sem linha comix
 *   node scripts/resolve-comix-hids.mjs --dry           # não grava no banco
 *   node scripts/resolve-comix-hids.mjs --limit 20      # só as 20 primeiras (teste)
 *   node scripts/resolve-comix-hids.mjs --variants 3    # tenta até 3 variantes de título (default 2)
 *   COMIX_HEADLESS=1 node scripts/resolve-comix-hids.mjs # headless (default: headful, mais confiável p/ Cloudflare)
 *   CHROME_PATH="/path/to/chrome" node scripts/resolve-comix-hids.mjs
 *
 * Requer no .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Limitação conhecida: a busca usa o filtro padrão da SPA (content_rating=suggestive),
 * então obras estritamente adultas (erotica/pornographic) podem não aparecer.
 *
 * NOTA: `normalizeText`/`titleSimilarityDetailed` abaixo são REPLICADOS de
 * lib/external/index.ts (threshold de aceite 0.72). Mantenha em sincronia se a
 * lógica de matching do app mudar.
 */
import { createClient } from "@supabase/supabase-js"
import puppeteer from "puppeteer-core"
import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const HEADLESS = process.env.COMIX_HEADLESS === "1"
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const args = process.argv.slice(2)
const DRY = args.includes("--dry")
const FORCE = args.includes("--force")
const numArg = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : def }
const strArg = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def }
const LIMIT = numArg("--limit", Infinity)
const VARIANTS = numArg("--variants", 2)
// --work <id>: resolve UMA obra específica (usado pela resolução na criação da
// obra). Sobrepõe o varrer-tudo; restringe os targets a esse id.
const WORK = strArg("--work", null)
// Threshold conservador: a busca casa a QUERY contra os títulos do candidato (title +
// altTitles que a própria comix expõe). Sem checagem de synopse (que o app usa), exijo
// score alto pra evitar falso-positivo (poluir o banco com hid errado). 0.78 aceita
// exato (1.0), forward-substring (0.9) e forward-substring-partial (0.78); rejeita
// reverse-substring fraco (0.75) e jaccard solto.
const ACCEPT = 0.78

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- matching (replicado de lib/external/index.ts) ----------
function normalizeText(value) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function titleSimilarity(a, b) {
  const na = normalizeText(a), nb = normalizeText(b)
  if (!na || !nb) return { score: 0, reason: "empty" }
  if (na === nb) return { score: 1, reason: "exact" }
  if (nb.includes(na)) {
    const naBoundary = new RegExp(`\\b${escapeRegExp(na)}\\b`)
    if (naBoundary.test(nb)) {
      const ratio = na.length / nb.length
      const naWordSet = new Set(na.split(" ").filter((w) => w.length > 2))
      const extra = nb.split(" ").filter((w) => w.length > 2 && !naWordSet.has(w)).length
      if (extra === 0 || ratio >= 0.85) return { score: 0.9, reason: "forward_substring" }
      if (extra <= 1 && ratio >= 0.55) return { score: 0.78, reason: "forward_substring_partial" }
    }
  }
  if (na.includes(nb)) {
    const ratio = nb.length / na.length
    const shortWords = nb.split(" ").filter((w) => w.length > 2).length
    if (ratio >= 0.6 || shortWords >= 4) return { score: 0.9, reason: "reverse_substring" }
    if (ratio >= 0.4 || shortWords >= 3) return { score: 0.75, reason: "reverse_substring" }
    if (ratio >= 0.25 && shortWords >= 2) return { score: 0.65, reason: "reverse_substring" }
  }
  const aw = new Set(na.split(" ").filter((w) => w.length > 2))
  const bw = new Set(nb.split(" ").filter((w) => w.length > 2))
  if (!aw.size || !bw.size) return { score: 0, reason: "no_words" }
  const intersection = [...aw].filter((w) => bw.has(w)).length
  return { score: intersection / new Set([...aw, ...bw]).size, reason: "jaccard" }
}
function uniqueStrings(values) {
  const seen = new Set(), out = []
  for (const v of values) {
    const item = v?.trim()
    if (!item) continue
    const key = normalizeText(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
/**
 * Melhor score entre a query buscada (qs) e os títulos do candidato. Exclui o tier
 * REVERSE-SUBSTRING (um título curto/genérico da comix contido no título mais longo da
 * obra) — gera falso-positivo sem checagem de synopse (ex.: comix "A Deal With the
 * Devil" ⊂ obra "I Made a Deal With the Devil", obras diferentes). Só aceitamos match
 * exato ou forward-substring (a query contida no título da comix).
 */
function matchScore(qs, cands) {
  let best = 0
  for (const q of qs) for (const c of cands) {
    const { score, reason } = titleSimilarity(q, c)
    if (reason === "reverse_substring") continue
    if (score > best) best = score
  }
  return best
}
const candTitles = (item) => uniqueStrings([
  item?.title,
  ...(Array.isArray(item?.altTitles) ? item.altTitles.map((t) => (typeof t === "string" ? t : t?.title)) : []),
])

// ---------- comix search via browser (nav autocomplete, ordenado por RELEVÂNCIA) ----------
// A busca da SPA exige o token `_=` assinado no client; a única forma de gerá-lo é num
// browser real. Dirigimos a caixa de busca do nav (digitação): ela usa
// /api/v1/manga?keyword=...&limit=6 por RELEVÂNCIA (a página /browse força
// order=chapter_updated_at, que soterra o match exato sob obras atualizadas recentes).
// Reusamos UMA página na home — digitar sobrescreve o keyword direto, sem o problema de
// localStorage stale dos deep-links /browse?keyword=.
let browser
let searchPage
const SEARCH_INPUT = '[data-comix-search="1"]'
async function ensureSearchPage() {
  if (searchPage && !searchPage.isClosed()) return searchPage
  searchPage = await browser.newPage()
  await searchPage.setUserAgent(UA)
  await searchPage.goto("https://comix.to/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
  await sleep(5000) // deixa o Cloudflare resolver + a SPA montar o nav
  return searchPage
}
async function comixSearch(query) {
  const page = await ensureSearchPage()
  // (re)marca o input de busca por placeholder — sobrevive a re-renders da SPA
  const tagged = await page.evaluate(() => {
    const i = [...document.querySelectorAll("input")].find((e) => /search any title|^search/i.test(e.placeholder || ""))
    if (i) { i.setAttribute("data-comix-search", "1"); return true }
    return false
  })
  if (!tagged) { if (process.env.COMIX_DEBUG) console.log(`    [debug] input de busca não encontrado`); return [] }
  const handle = await page.$(SEARCH_INPUT)
  if (!handle) return []
  await handle.click({ clickCount: 3 }).catch(() => {}) // seleciona o texto atual p/ sobrescrever
  const respP = page
    .waitForResponse((r) => {
      try {
        const u = new URL(r.url())
        return u.pathname === "/api/v1/manga" && normalizeText(u.searchParams.get("keyword") || "") === normalizeText(query)
      } catch { return false }
    }, { timeout: 15000 })
    .catch(() => null)
  await page.type(SEARCH_INPUT, query, { delay: 25 }).catch(() => {})
  const resp = await respP
  if (!resp) { if (process.env.COMIX_DEBUG) console.log(`    [debug] "${query}": sem resposta (CF/timeout?)`); return [] }
  const json = await resp.json().catch(() => null)
  const items = json?.result?.items
  if (process.env.COMIX_DEBUG) {
    console.log(`    [debug] "${query}": ${Array.isArray(items) ? items.length : "?"} itens`)
    if (process.env.COMIX_DEBUG === "2") console.log(`    [debug] top: ${(items || []).slice(0, 5).map((it) => it.title).join(" | ")}`)
  }
  return Array.isArray(items) ? items : []
}

// ---------- main ----------
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local")
    process.exit(1)
  }
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  const { data: works, error: e1 } = await supa.from("works").select("id, title, original_title, alternative_titles").order("created_at")
  if (e1) throw e1
  const { data: existing, error: e2 } = await supa.from("work_external_ids").select("work_id").eq("source", "comix")
  if (e2) throw e2
  const have = new Set((existing ?? []).map((r) => r.work_id))

  let targets = (works ?? []).filter((w) => FORCE || !have.has(w.id))
  // Escopo a uma obra (resolução na criação): só ela, ainda respeitando o skip
  // de quem já tem hid (a menos de --force).
  if (WORK) targets = targets.filter((w) => w.id === WORK)
  if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT)

  console.log(`Catálogo: ${works?.length ?? 0} obras | já com comix: ${have.size} | a resolver: ${targets.length}${DRY ? " (DRY-RUN)" : ""}`)
  if (!targets.length) return

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    userDataDir: path.resolve(__dirname, "../.cache/comix-chrome"),
    args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
  })
  await ensureSearchPage() // abre a home, resolve o Cloudflare e monta o nav antes do loop

  const stats = { matched: 0, noMatch: 0, error: 0 }
  for (let i = 0; i < targets.length; i++) {
    const w = targets[i]
    const tag = `[${i + 1}/${targets.length}] "${w.title}"`
    const variants = uniqueStrings([w.title, w.original_title, ...(w.alternative_titles ?? [])]).slice(0, VARIANTS)
    try {
      let best = null // { hid, title, score }
      let bestAny = null // melhor candidato mesmo abaixo do threshold (p/ debug)
      for (const q of variants) {
        const items = await comixSearch(q)
        for (const it of items) {
          if (!it?.hid) continue
          // Casa a QUERY buscada contra os títulos do candidato (mirror do app:
          // bestTitleMatchDetailed(query, result)) — NÃO o cross-product de todos os
          // títulos da obra, que gera 1.0 espúrio em obras de título parecido.
          const score = matchScore([q], candTitles(it))
          if (!bestAny || score > bestAny.score) bestAny = { hid: it.hid, title: it.title, score }
          if (score >= ACCEPT && (!best || score > best.score)) best = { hid: it.hid, title: it.title, score }
        }
        if (best && best.score >= 0.95) break // match exato: não precisa tentar mais variantes
      }
      if (process.env.COMIX_DEBUG && bestAny) console.log(`    [debug] melhor candidato: "${bestAny.title}" (${bestAny.score.toFixed(2)})`)
      if (best) {
        stats.matched++
        console.log(`${tag} → ✓ "${best.title}" hid=${best.hid} (${best.score.toFixed(2)})`)
        if (!DRY) {
          const { error } = await supa
            .from("work_external_ids")
            .upsert({ work_id: w.id, source: "comix", external_id: best.hid, is_rejected: false }, { onConflict: "work_id,source", ignoreDuplicates: true })
          if (error) console.log(`${tag}   ⚠ erro ao salvar: ${error.message}`)
        }
      } else {
        stats.noMatch++
        console.log(`${tag} → — sem match`)
      }
    } catch (err) {
      stats.error++
      console.log(`${tag} → ✗ erro: ${err instanceof Error ? err.message : String(err)}`)
    }
    await sleep(500) // polidez
  }

  console.log(`\nFim. matched=${stats.matched} noMatch=${stats.noMatch} error=${stats.error}${DRY ? " (nada gravado — DRY)" : ""}`)
}

main()
  .catch((e) => { console.error("FATAL", e); process.exitCode = 1 })
  .finally(async () => { if (browser) await browser.close().catch(() => {}) })
