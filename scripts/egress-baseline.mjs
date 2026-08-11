/**
 * Mede o EGRESS real do PostgREST sem gastar egress.
 *
 * Por que existe: o acumulado do ciclo só aparece no painel (Reports → Usage), e o painel
 * **não é acessível por token de API** — `/platform/**` devolve 401 "JWT could not be decoded"
 * e a Management API pública não tem rota de usage. Sem isto, a única resposta para "quanto
 * estamos gastando?" é alguém abrir o navegador, o que na prática significa descobrir depois
 * do 402 ([[project-supabase-egress-quota-402]]).
 *
 * Como funciona, em três passos:
 *   1. lê `edge_logs` pela Management API e agrupa por (path, query, status)
 *   2. **replica cada payload contra o banco LOCAL**, que é réplica — custo zero de quota
 *   3. mede os bytes crus e os comprimidos, e decompõe por família de consumidor
 *
 * 🔴 O número que importa é o COMPRIMIDO. O `fetch` do Node (que o `supabase-js` usa) manda
 * `accept-encoding: gzip, deflate` por padrão e o gateway responde `content-encoding: gzip` —
 * os dois elos foram medidos em 2026-08-10, e o fator entre cru e comprimido deu **4,0×**.
 * As tabelas de custo do CLAUDE.md estão em bytes crus e superestimam a quota na mesma razão.
 *
 * ⚠️ NÃO some o `content_length` dos logs. O PostgREST responde chunked e o campo vem NULL em
 * quase toda resposta grande: somá-lo dava **1,75 MB** para o que eram 374 MB — um erro que
 * produz resultado, a classe mais cara deste projeto.
 *
 * ⚠️ A retenção de log no plano free é de **1 dia**. Isto mede a janela recente, nunca o
 * ciclo; para o acumulado não há substituto para o painel.
 *
 * Uso:
 *   node scripts/egress-baseline.mjs             # últimas 24h
 *   node scripts/egress-baseline.mjs --horas=6
 *   node scripts/egress-baseline.mjs --top=25    # detalha os N maiores grupos
 *   node scripts/egress-baseline.mjs --horas=0.35 --fim-ha=0.77   # janela que NÃO termina agora
 *
 * ⚠️ `--fim-ha` existe porque "últimas N horas" não consegue isolar um silêncio que teve
 * rajada DEPOIS dele. Medido em 2026-08-11: o `next dev` foi fechado às 23:14 e religado às
 * 23:47, deixando 21 minutos limpos no meio — a única janela do dia capaz de separar o custo
 * do app do custo do resto, e inalcançável por qualquer `--horas`. Sem isto, a saída seria
 * uma média que descreve nenhum dos dois regimes ([[gotcha-dev-server-contra-a-nuvem-fatura-egress]]).
 */
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const ROOT = path.resolve(import.meta.dirname, "..")
const ARGS = process.argv.slice(2)
const opt = (n, d) => Number(ARGS.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d)
const HORAS = opt("horas", 24)
/** Quantas horas atrás a janela TERMINA. 0 = agora. */
const FIM_HA = opt("fim-ha", 0)
const TOP = opt("top", 15)

function env(file) {
  const out = {}
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

// ⚠️ O ref da NUVEM sai de `.env.supabase-cloud` (o `.env.local` alterna e carrega uma URL
// comentada de projeto morto). O alvo de MEDIÇÃO sai de `.env.analysis`, que é o local.
const TOKEN = env(".env.local").SUPABASE_ACCESS_TOKEN
const REF = (env(".env.supabase-cloud").NEXT_PUBLIC_SUPABASE_URL ?? "").match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/,
)?.[1]
const ANALYSIS = env(".env.analysis")
const LOCAL_URL = ANALYSIS.NEXT_PUBLIC_SUPABASE_URL
const LOCAL_KEY = ANALYSIS.SUPABASE_SERVICE_ROLE_KEY

if (!TOKEN || !REF) {
  console.error("faltam SUPABASE_ACCESS_TOKEN (.env.local) ou a URL da nuvem (.env.supabase-cloud)")
  process.exit(1)
}
if (!LOCAL_URL || !/127\.0\.0\.1|localhost/.test(LOCAL_URL)) {
  // 🔴 Sem esta trava, a medição rodaria CONTRA A NUVEM — um script que existe para medir
  // egress passaria a ser um dos maiores consumidores dele.
  console.error("`.env.analysis` ausente ou não aponta pro local. Rode: npm run db:analysis-env")
  process.exit(1)
}

const iso = (h) => new Date(Date.now() - h * 3600_000).toISOString().replace(/\.\d+Z$/, ".000Z")

async function logs(sql) {
  const u = new URL(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all`)
  u.searchParams.set("sql", sql)
  u.searchParams.set("iso_timestamp_start", iso(FIM_HA + HORAS))
  u.searchParams.set("iso_timestamp_end", iso(FIM_HA))
  const res = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const body = await res.json()
  if (body.error) throw new Error(String(body.error))
  if (!body.result) throw new Error(JSON.stringify(body).slice(0, 200))
  return body.result
}

/** Refaz a requisição contra o LOCAL. `206` no log = paginação por header `Range`. */
async function medir(pathname, search, parcial) {
  const headers = { apikey: LOCAL_KEY, Authorization: `Bearer ${LOCAL_KEY}` }
  if (parcial) headers.Range = "0-999"
  try {
    const res = await fetch(`${LOCAL_URL}${pathname}${search ?? ""}`, { headers })
    const buf = Buffer.from(await res.arrayBuffer())
    return { cru: buf.length, gz: zlib.gzipSync(buf, { level: 6 }).length }
  } catch {
    return { cru: 0, gz: 0 }
  }
}

/**
 * ⚠️ A família sai da FORMA da query, não do nome do script — o log não sabe quem chamou.
 * `select=*` paginado é varredura de tabela inteira (backup, fingerprint, dump), que é outro
 * regime de custo que navegação.
 */
function familia(p, q = "") {
  if (p.startsWith("/auth")) return "auth"
  if (p.startsWith("/storage")) return "storage"
  if (!p.startsWith("/rest")) return "outro"
  if (/\?select=\*($|&offset=\d+&limit=)/.test(q)) return "varredura completa de tabela"
  if (p === "/rest/v1/works" && q.includes("is_archived=eq.false") && q.includes("select=*"))
    return "recalculateAll (catálogo inteiro)"
  return "app / consultas seletivas"
}

const mb = (n) => (n / 1e6).toFixed(1)

async function main() {
  const janela = FIM_HA
    ? `${HORAS}h terminando ${FIM_HA}h atrás (${iso(FIM_HA + HORAS).slice(11, 16)}Z → ${iso(FIM_HA).slice(11, 16)}Z)`
    : `últimas ${HORAS}h`
  console.log(`\n══ EGRESS — ${janela} (payload medido no LOCAL, quota zero) ══\n`)
  const grupos = await logs(
    "select req.path as path, req.search as qs, r.status_code as st, count(*) as n " +
      "from edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as req " +
      "cross join unnest(m.response) as r group by path, qs, st order by n desc limit 500",
  )
  if (!grupos.length) return console.log("nenhuma requisição na janela (retenção de log no free = 1 dia)\n")

  const linhas = []
  for (const g of grupos) {
    const { cru, gz } = g.st === 200 || g.st === 206 ? await medir(g.path, g.qs, g.st === 206) : { cru: 0, gz: 0 }
    linhas.push({ ...g, cru: g.n * cru, gz: g.n * gz, fam: familia(g.path, g.qs ?? "") })
  }

  const porFam = new Map()
  for (const l of linhas) {
    const a = porFam.get(l.fam) ?? { n: 0, cru: 0, gz: 0 }
    porFam.set(l.fam, { n: a.n + l.n, cru: a.cru + l.cru, gz: a.gz + l.gz })
  }
  const tot = linhas.reduce((a, l) => ({ n: a.n + l.n, cru: a.cru + l.cru, gz: a.gz + l.gz }), { n: 0, cru: 0, gz: 0 })

  console.log(`${"família".padEnd(34)}${"reqs".padStart(7)}${"cru MB".padStart(10)}${"gzip MB".padStart(10)}   share`)
  for (const [f, v] of [...porFam].sort((a, b) => b[1].gz - a[1].gz)) {
    const share = tot.gz ? ((100 * v.gz) / tot.gz).toFixed(0) : "0"
    console.log(`${f.padEnd(34)}${String(v.n).padStart(7)}${mb(v.cru).padStart(10)}${mb(v.gz).padStart(10)}${(share + "%").padStart(8)}`)
  }
  console.log(`${"TOTAL".padEnd(34)}${String(tot.n).padStart(7)}${mb(tot.cru).padStart(10)}${mb(tot.gz).padStart(10)}`)

  const porDia = (tot.gz / HORAS) * 24
  console.log(`\nritmo: ${mb(porDia)} MB/dia comprimido ⇒ ${((porDia * 30) / 1e9).toFixed(2)} GB/mês contra o teto de 5 GB`)
  console.log(`       (${(5e9 / porDia).toFixed(0)} dias até o teto, se este ritmo se mantiver)`)
  console.log(`⚠️ janela curta pega rajada de sessão de trabalho e projeta como se fosse regime.`)

  console.log(`\nmaiores grupos (por bytes comprimidos):`)
  for (const l of linhas.sort((a, b) => b.gz - a.gz).slice(0, TOP)) {
    console.log(`${String(l.n).padStart(6)} × ${mb(l.gz).padStart(7)} MB  ${l.path}${(l.qs ?? "").slice(0, 70)}`)
  }
  console.log()
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
