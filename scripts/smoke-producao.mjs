#!/usr/bin/env node
/**
 * Bate nas rotas de verdade depois de publicar — e falha alto quando uma delas sobe VAZIA.
 *
 *   node scripts/smoke-producao.mjs                       # contra satoria.fly.dev
 *   node scripts/smoke-producao.mjs --base=http://localhost:3001
 *
 * SMOKE-ALVO: producao
 *
 * Roda sozinho no fim do `npm run deploy`. Sai com código 1 se qualquer rota reprovar.
 *
 * ── por que ele existe, com o caso que o motivou ──────────────────────────────────────────
 *
 * 🔴 Em 19/08/2026 um deploy levou 90 PRs ao ar e a `/ranking` subiu **quebrada**: HTTP 200,
 * erro de Server Components no render e **zero obras na tela**. O deploy conferiu
 * `/api/health`, que respondeu `{"ok":true}` — porque o health exercita o banco, mas **não
 * abre a `/ranking`**. O defeito (uma coluna dropada em `works_owner`) só apareceu quando
 * alguém abriu a página num browser e olhou o console.
 *
 * A lição não é "healthcheck é inútil": é que **status não é conteúdo**. Uma página React
 * que falha num Server Component ainda responde 200 e ainda serve o HTML da casca. O que
 * distingue "renderizou" de "subiu vazia" é o CONTEÚDO — e é isso que este script conta.
 *
 * ── por que sem browser ───────────────────────────────────────────────────────────────────
 *
 * Um Playwright pegaria também erro de JS no cliente, mas o binário não está na raiz do repo
 * e o smoke passaria a depender de um download de ~150 MB no meio do deploy. Medido no dia:
 * o HTML SERVIDO já denuncia o caso que aconteceu — a `/ranking` quebrada trazia 0 `<tr>` e a
 * sã traz 42. Um `fetch` resolve, roda em qualquer máquina e não adiciona dependência.
 *
 * ⚠️ O preço, declarado: isto **não** vê erro puramente client-side (algo que só quebra depois
 * da hidratação). Para esses continua valendo abrir no browser. O que ele cobre é a família
 * que já mordeu: página que o servidor devolve sem o conteúdo dela.
 */

const args = process.argv.slice(2)
const BASE = (args.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "https://satoria.fly.dev").replace(
  /\/$/,
  "",
)

/**
 * O que cada rota precisa TRAZER para ser considerada viva.
 *
 * 🔴 O `min` é deliberadamente baixo — ele separa "renderizou" de "veio vazia", que é o
 * defeito real. Cravar o número de hoje (a `/ranking` traz 42 linhas) transformaria qualquer
 * mudança de filtro padrão numa falha de deploy, e um smoke que grita à toa é desligado na
 * segunda vez. O que se perde com o piso baixo é a detecção de "veio pela metade", que este
 * script não promete.
 *
 * ⚠️ As rotas gateadas entram com `status: 307`: elas redirecionam para `/login` sem sessão, e
 * é isso que prova que o gate está de pé. Trocar por 200 aqui esconderia o gate caindo.
 */
const ROTAS = [
  { rota: "/api/health", status: 200, json: (j) => j?.ok === true && j?.works > 0 },
  // 🔴 O critério era `data-slot="` com mínimo 10, e a CASCA VAZIA já entrega 65 — medido em
  // 2026-08-23 com o backend derrubado: a `/` passava verde enquanto anunciava "0 OBRAS" como
  // fato do acervo. Marcador de casca não separa "renderizou" de "veio vazia" nesta rota.
  // Agora conta LINK DE OBRA da vitrine (`/catalog/<slug>`), que só existe se
  // `getPublicShowcase` tiver devolvido linhas — a casca não tem como produzi-lo, e "/catalog"
  // sozinho (os dois botões de navegação) não casa, porque a barra final é exigida.
  { rota: "/", status: 200, marca: /href="\/catalog\/[^"]/g, min: 6, o: "obras na vitrine" },
  { rota: "/catalog", status: 200, marca: /data-slot="table-row"/g, min: 10, o: "linhas de obra" },
  { rota: "/ranking", status: 200, marca: /<tr\b/g, min: 5, o: "linhas de obra" },
  { rota: "/guide", status: 200, marca: /<article\b/g, min: 3, o: "cards de conceito" },
  { rota: "/guide/attributes", status: 200, marca: /<article\b/g, min: 9, o: "verbetes" },
  { rota: "/guide/scores", status: 200, marca: /<article\b/g, min: 15, o: "verbetes" },
  { rota: "/about", status: 200, marca: /<article\b|data-slot="card"/g, min: 3 },
  // gateadas: sem sessão têm que MANDAR pro login, não renderizar
  { rota: "/my-list", status: 307 },
  { rota: "/curation/works", status: 307 },
  // e o nome antigo tem que continuar redirecionando
  { rota: "/titles", status: 308 },
]

/** Marcas de erro que o Next serve no HTML quando a página estoura de vez. */
const ERRO_NO_HTML = /Application error: a server-side exception|__next_error__/

const TIMEOUT_MS = 90_000

async function bater(r) {
  const url = BASE + r.rota
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, { redirect: "manual", signal: ctrl.signal })
    if (resp.status !== r.status) {
      return { ok: false, motivo: `HTTP ${resp.status}, esperado ${r.status}` }
    }
    if (r.status !== 200) return { ok: true, detalhe: `${resp.status} →  ${resp.headers.get("location") ?? "?"}` }

    if (r.json) {
      const j = await resp.json().catch(() => null)
      return r.json(j)
        ? { ok: true, detalhe: JSON.stringify(j) }
        : { ok: false, motivo: `corpo não passou na asserção: ${JSON.stringify(j)}` }
    }

    const html = await resp.text()
    if (ERRO_NO_HTML.test(html)) return { ok: false, motivo: "o HTML traz a página de erro do Next" }

    const n = (html.match(r.marca) ?? []).length
    return n >= r.min
      ? { ok: true, detalhe: `${n} ${r.o ?? "elementos"}` }
      : {
          ok: false,
          motivo: `só ${n} ${r.o ?? "elementos"} (mínimo ${r.min}) — a rota respondeu 200 e subiu VAZIA`,
        }
  } catch (e) {
    return { ok: false, motivo: e.name === "AbortError" ? `sem resposta em ${TIMEOUT_MS / 1000}s` : String(e) }
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  console.log(`▶ smoke em ${BASE}`)

  // ⚠️ A máquina da Fly dorme (`min_machines_running = 0`) e o cold start medido é ~7,5s. Sem
  // aquecer, a primeira rota pagaria a subida e o resto correria contra um alvo já quente —
  // o que faz o tempo de cada rota dizer menos do que parece.
  await bater({ rota: "/api/health", status: 200, json: () => true }).catch(() => {})

  let falhas = 0
  for (const r of ROTAS) {
    const t0 = Date.now()
    const res = await bater(r)
    const ms = String(Date.now() - t0).padStart(5)
    const nome = r.rota.padEnd(20)
    if (res.ok) {
      console.log(`  ✅ ${nome} ${ms}ms  ${res.detalhe ?? ""}`)
    } else {
      falhas++
      console.log(`  ❌ ${nome} ${ms}ms  ${res.motivo}`)
    }
  }

  if (falhas > 0) {
    // ⚠️ A dica de log acompanha o ALVO: mandar olhar o log da Fly enquanto se testa um dev
    // server local é o tipo de instrução que faz alguém procurar o erro no lugar errado.
    const onde = BASE.includes("localhost")
      ? "   O erro real está no terminal do dev server."
      : "   Veja o erro real nos logs — a mensagem do Server Component é omitida em produção:\n" +
        "     flyctl logs -a satoria --no-tail | tail -40"
    console.error(`\n❌ ${falhas} rota(s) reprovaram.\n${onde}`)
    process.exit(1)
  }
  console.log(`\n✅ ${ROTAS.length} rotas OK.`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
