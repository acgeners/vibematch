#!/usr/bin/env node
/**
 * O smoke que ABRE as rotas num browser de verdade e olha o CONSOLE.
 *
 *   node scripts/smoke-browser.mjs                        # contra satoria.fly.dev
 *   node scripts/smoke-browser.mjs --base=http://localhost:3001
 *   node scripts/smoke-browser.mjs --modules=/caminho/do/checkout   # onde achar o playwright
 *
 * Roda no fim do `npm run deploy`, depois do `smoke-producao.mjs`. Sai com 1 se qualquer
 * rota quebrar DEPOIS da hidratação.
 *
 * ── por que ele existe ────────────────────────────────────────────────────────────────────
 *
 * 🔴 O `smoke-producao.mjs` conta conteúdo no HTML SERVIDO, e declara o próprio limite: ele
 * não vê o que quebra só no cliente. Em 2026-08-20 esse limite foi cobrado — **toda página de
 * obra ficou um dia quebrada para visitante** (React #310 na hidratação), com o HTML completo,
 * o smoke VERDE e a suíte verde. Quem achou foi o olho, abrindo o app por outro motivo.
 *
 * Medido na época: abertura DIRETA por UUID quebrava 9 de 10; clicar num link, 0 de 10. Por
 * isso aqui é sempre `goto` — carga fria, como bookmark, link colado, aba nova ou refresh.
 * Navegar clicando nunca reproduziu, e é por isso que o defeito era invisível para quem
 * desenvolve.
 *
 * ── por que ele NÃO reusa a lista do smoke de HTTP ────────────────────────────────────────
 *
 * São perguntas diferentes. Lá entram 307/308 (o gate mandando pro login, o nome antigo
 * redirecionando) — coisas que um browser SEGUE, e que aqui não significariam nada. Aqui
 * entram só páginas que carregam de fato, mais uma página de OBRA, que lá não existe porque
 * exige descobrir um id. Unificar as duas listas obrigaria uma delas a carregar entradas que
 * não sabe verificar.
 */

import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=")
const BASE = (arg("base") ?? "https://satoria.fly.dev").replace(/\/$/, "")
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/* ------------------------------------------------------------------ */
/* Onde mora o browser — e por que ele NÃO vem do worktree publicado   */
/* ------------------------------------------------------------------ */

/**
 * 🔴 O `deploy.sh` roda o smoke a partir do worktree que acabou de publicar (`$WT`), e essa
 * regra é dura: verificar o que subiu com o script de outra versão é verificar outra coisa.
 * Mas worktree recém-criado **não tem `node_modules`** — nem o da raiz nem o do sidecar.
 *
 * Então o SCRIPT vem do worktree (é código, tem de ser o que foi publicado) e o BROWSER vem
 * do checkout local (é ferramenta da máquina, e worktree nenhum vai ter). Não é a mesma
 * armadilha dos "dois critérios pro mesmo fato": são coisas de naturezas diferentes.
 *
 * `playwright-core` não é dependência da raiz — ele entra de carona no sidecar da Comix
 * (`services/comix-render`), que já o tem instalado junto com o Chromium em cache.
 */
function acharPlaywright() {
  const candidatos = [
    arg("modules") && join(resolve(arg("modules")), "services/comix-render"),
    join(REPO, "services/comix-render"),
    REPO,
  ].filter(Boolean)

  for (const dir of candidatos) {
    if (!existsSync(join(dir, "node_modules"))) continue
    try {
      const req = createRequire(join(dir, "__resolver__.js"))
      return { pw: req("playwright-core"), onde: dir }
    } catch {
      /* tenta o próximo */
    }
  }
  return null
}

/**
 * 🔴 Falhar SOFT, e falhar ALTO.
 *
 * Travar o deploy porque falta um binário troca um defeito raro (regressão de hidratação) por
 * um comum (não dá pra publicar) — e o `deploy.sh` roda com `set -e`, então um exit 1 aqui
 * derrubaria o comando inteiro DEPOIS de já ter publicado, que é o pior dos dois mundos.
 *
 * ⚠️ Mas fail-soft calado é como se constrói capacidade DESLIGADA — o `CoverImage` prometia
 * fallback na docstring e estava ligado em 2 de 36 telas; o backup automático avisava num log
 * que ninguém lia e terminava anunciando sucesso. Por isso o aviso é um bloco, diz onde
 * procurou, e diz o que deixou de ser verificado.
 */
function pularComAviso(motivo, onde) {
  console.log("")
  console.log("  ┌──────────────────────────────────────────────────────────────────────┐")
  console.log("  │ ⚠️  SMOKE DE BROWSER NÃO RODOU — o deploy NÃO foi verificado no cliente │")
  console.log("  └──────────────────────────────────────────────────────────────────────┘")
  console.log(`  motivo: ${motivo}`)
  if (onde?.length) for (const d of onde) console.log(`  procurei em: ${d}`)
  console.log("  o que ficou SEM verificação: erro de JS depois da hidratação — a família que")
  console.log("  deixou toda página de obra quebrada por um dia em 20/08/2026.")
  console.log("  para ligar: `cd services/comix-render && npm i` e `npx playwright install chromium`")
  console.log("")
  process.exit(0)
}

/* ------------------------------------------------------------------ */
/* O que é erro DE VERDADE — medido, não suposto                       */
/* ------------------------------------------------------------------ */

/**
 * 🔴 A primeira versão deste script mediu as coisas erradas e PASSOU VERDE com um componente
 * que literalmente lançava na hidratação. Os três enganos, porque cada um é a escolha óbvia:
 *
 * 1. **`pageerror` não é o sinal.** O React 19 ENGOLE a exceção da hidratação: ele cai para
 *    render no cliente, a Suspense mais próxima fica no fallback e nada chega ao
 *    `window.onerror`. Medido: página visivelmente quebrada, `pageerror` = 0.
 * 2. **"ignorar erro de console que começa com `Failed to load resource`" é largo demais.** O
 *    sintoma real do estouro era um **500** num chunk, e essa frase é o prefixo dele também.
 *    O filtro que existe para calar as capas mortas calava o defeito.
 * 3. **O piso de conteúdo contava um `h1` que existe na CASCA.** A página quebrada tem
 *    `<h1>Carregando…</h1>` — um elemento, piso satisfeito, defeito invisível.
 *
 * O que separa os dois estados, medido em 20/08/2026 (build local com a sonda × produção sã):
 *
 * | sinal                         | quebrado | são (9 rotas de prod) |
 * |-------------------------------|----------|-----------------------|
 * | respostas **5xx**             | **1**    | **0**                 |
 * | **esqueletos** após hidratar  | **28**   | **0**                 |
 * | `[role="tab"]` na obra        | 0        | 6                     |
 * | `pageerror`                   | 0        | 0  ← não separa       |
 * | 403 `/api/image-proxy`, ERR_ABORTED | 10 | 10 ← piso de ruído   |
 */

/** Qualquer resposta 5xx. Medido: **zero** em 9 rotas de produção; 1 na quebrada. */
const STATUS_QUE_REPROVA = (s) => s >= 500

/**
 * ⚠️ 4xx e `net::ERR_*` são o PISO DE RUÍDO desta aplicação, não saúde: `/api/image-proxy`
 * devolve 403 em toda página de obra e o Next aborta prefetch o tempo todo (10 ocorrências
 * tanto no estado são quanto no quebrado). Reprovar por eles seria o alarme que sempre toca.
 * Eles são CONTADOS e impressos — cortar em silêncio é como "verificado" passa a significar
 * outra coisa sem ninguém decidir.
 */
const E_DE_RECURSO = /^Failed to load resource/i

/**
 * 🔴 O esqueleto sobrando é o sinal GERAL, e é o que pega o defeito sem saber nada da rota.
 *
 * Quando o cliente estoura, a Suspense mais próxima nunca sai do fallback — a página fica
 * eternamente "carregando" com o HTML completo por baixo. Medido: **0 esqueletos em 9 rotas de
 * produção** depois de `networkidle` + folga, contra 28 na quebrada. É o único sinal que não
 * precisa de número por rota.
 */
const SELETOR_ESQUELETO = '[data-slot="skeleton"]'

/**
 * A casca de erro que o Next serve quando o cliente estoura de vez. O app **não tem
 * `error.tsx`** (conferido no filesystem), então quem atende é o boundary embutido.
 */
const ERRO_DO_NEXT = /Application error: a client-side exception/i

/* ------------------------------------------------------------------ */
/* As rotas                                                            */
/* ------------------------------------------------------------------ */

/**
 * O piso é baixo de propósito, pela mesma razão do smoke de HTTP: ele separa "a página
 * sobreviveu à hidratação" de "a árvore foi embora". Cravar o número de hoje faria qualquer
 * mudança de layout reprovar um deploy.
 */
const ROTAS_FIXAS = [
  { rota: "/", seletor: "[data-slot]", min: 10, o: "elementos" },
  { rota: "/catalog", seletor: '[data-slot="table-row"]', min: 10, o: "linhas de obra" },
  { rota: "/ranking", seletor: "tr", min: 5, o: "linhas de obra" },
]

/**
 * A página de obra entra por descoberta, não por id fixo: obra arquivada ou renomeada faria um
 * id cravado aqui reprovar um deploy que está são.
 *
 * ⚠️ E as DUAS formas da URL entram. A canônica é o slug — é o que a `/catalog` linka —, mas
 * bookmark e link colado circulam por UUID desde que o `redirect()` saiu da página, e era
 * justamente por UUID que a página quebrava em 20/08. Só o slug deixaria de fora a forma que
 * de fato mordeu.
 */
async function descobrirObra() {
  const html = await (await fetch(`${BASE}/catalog`)).text()
  const slug = html.match(/href="\/catalog\/([a-z0-9][a-z0-9-]{3,})"/)?.[1]
  if (!slug) return { erro: "não achei link de obra na /catalog" }

  const obra = await (await fetch(`${BASE}/catalog/${slug}`)).text()
  const canon = obra.match(/<link rel="canonical" href="\/catalog\/([^"]+)"/)?.[1]

  // O uuid é DERIVADO (o id da própria obra é o que mais se repete no HTML dela) e depois
  // CONFERIDO: só entra na lista se `/catalog/<uuid>` devolver a canonical do mesmo slug.
  // Heurística sem conferência mandaria o smoke bater numa obra qualquer e chamar de sucesso.
  const contagem = new Map()
  for (const u of obra.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) {
    contagem.set(u, (contagem.get(u) ?? 0) + 1)
  }
  const uuid = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  let uuidOk = false
  if (uuid) {
    const porId = await (await fetch(`${BASE}/catalog/${uuid}`)).text()
    uuidOk = porId.includes(`<link rel="canonical" href="/catalog/${canon ?? slug}"`)
  }
  return { slug, uuid: uuidOk ? uuid : null }
}

/* ------------------------------------------------------------------ */

const TIMEOUT_MS = 45_000

async function abrir(page, rota, r) {
  const js = []
  const recursos = []
  const servidor = []
  const onConsole = (m) => {
    if (m.type() !== "error") return
    const t = m.text()
    ;(E_DE_RECURSO.test(t) ? recursos : js).push(t.slice(0, 200))
  }
  const onPageError = (e) => js.push(`EXCEÇÃO NÃO TRATADA: ${String(e).split("\n")[0].slice(0, 200)}`)
  const onResponse = (resp) => {
    if (STATUS_QUE_REPROVA(resp.status())) servidor.push(`${resp.status()} ${new URL(resp.url()).pathname.slice(0, 60)}`)
  }
  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  page.on("response", onResponse)

  try {
    // `goto`, nunca clique: é a carga FRIA que reproduz a família toda.
    const resp = await page.goto(BASE + rota, { waitUntil: "networkidle", timeout: TIMEOUT_MS })
    // A hidratação termina depois do networkidle; sem esta folga o erro dela não teria tempo
    // de acontecer, e o smoke passaria verde por ter olhado cedo demais.
    await page.waitForTimeout(1500)

    const status = resp?.status() ?? 0
    if (status >= 400) return { ok: false, motivo: `HTTP ${status}`, recursos }

    // 5xx primeiro: foi o único sinal que separou os dois estados no chunk que estourou.
    if (servidor.length) {
      return { ok: false, motivo: `resposta ${servidor[0]}`, extras: servidor.slice(1), recursos }
    }

    const corpo = await page.evaluate(() => document.body.innerText.slice(0, 400))
    if (ERRO_DO_NEXT.test(corpo)) {
      return { ok: false, motivo: "a página trocou pela casca de erro do Next (estouro no cliente)", recursos }
    }

    const esq = await page.evaluate((s) => document.querySelectorAll(s).length, SELETOR_ESQUELETO)
    if (esq > 0) {
      return {
        ok: false,
        motivo: `${esq} esqueleto(s) na tela depois de hidratar — a página ficou presa carregando`,
        recursos,
      }
    }

    const n = await page.evaluate((s) => document.querySelectorAll(s).length, r.seletor)
    if (n < r.min) {
      return { ok: false, motivo: `só ${n} ${r.o} depois da hidratação (mínimo ${r.min})`, recursos }
    }
    if (js.length) return { ok: false, motivo: js[0], extras: js.slice(1), recursos }
    return { ok: true, detalhe: `${n} ${r.o}`, recursos }
  } catch (e) {
    return { ok: false, motivo: String(e).split("\n")[0].slice(0, 200), recursos }
  } finally {
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
    page.off("response", onResponse)
  }
}

async function main() {
  const achado = acharPlaywright()
  if (!achado) {
    pularComAviso("não encontrei `playwright-core`", [
      arg("modules") && join(resolve(arg("modules")), "services/comix-render"),
      join(REPO, "services/comix-render"),
      REPO,
    ].filter(Boolean))
  }

  console.log(`▶ smoke de BROWSER em ${BASE}`)
  console.log(`  playwright: ${achado.onde}`)

  let browser
  try {
    browser = await achado.pw.chromium.launch()
  } catch (e) {
    pularComAviso(`o Chromium não subiu: ${String(e).split("\n")[0].slice(0, 160)}`)
  }

  const rotas = [...ROTAS_FIXAS]
  const obra = await descobrirObra().catch((e) => ({ erro: String(e) }))
  if (obra.erro || !obra.slug) {
    // ⚠️ Não é falha do deploy — é falha da DESCOBERTA. Mas também não pode passar calado: a
    // página de obra é a maior árvore hidratada do app e a que já quebrou.
    console.log(`  ⚠️  página de obra fora do smoke: ${obra.erro ?? "sem slug"}`)
  } else {
    // ⚠️ `h1` NÃO serve de piso aqui: a página quebrada tem `<h1>Carregando…</h1>` e passaria.
    // As abas só existem quando a obra renderizou de verdade (medido: 6 sã × 0 quebrada).
    rotas.push({ rota: `/catalog/${obra.slug}`, seletor: '[role="tab"]', min: 4, o: "abas da obra" })
    if (obra.uuid) {
      rotas.push({ rota: `/catalog/${obra.uuid}`, seletor: '[role="tab"]', min: 4, o: "abas (por UUID)" })
    }
    else console.log("  ⚠️  a forma por UUID ficou de fora: não consegui derivar o id da obra")
  }

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await ctx.newPage()

  let falhas = 0
  let recursosTotal = 0
  for (const r of rotas) {
    const t0 = Date.now()
    const res = await abrir(page, r.rota, r)
    const ms = String(Date.now() - t0).padStart(6)
    const nome = r.rota.length > 34 ? r.rota.slice(0, 31) + "…" : r.rota.padEnd(34)
    recursosTotal += res.recursos?.length ?? 0
    if (res.ok) {
      console.log(`  ✅ ${nome} ${ms}ms  ${res.detalhe}`)
    } else {
      falhas++
      console.log(`  ❌ ${nome} ${ms}ms  ${res.motivo}`)
      for (const x of res.extras ?? []) console.log(`       · ${x}`)
    }
  }

  await browser.close()

  // Contado e impresso, nunca descartado em silêncio: é o que separa "não houve" de "eu não
  // olhei". Capa morta é conhecida (29 obras, host `static.comix.to` fora do ar).
  if (recursosTotal) console.log(`\n  ℹ️  ${recursosTotal} falha(s) de RECURSO ignoradas (imagem/fonte que não carrega).`)

  if (falhas > 0) {
    console.error(`\n❌ ${falhas} rota(s) quebraram no cliente. Está NO AR assim.`)
    console.error("   Abra a rota num browser e olhe o console — o stack minificado do React")
    console.error("   (#310, #418, #423) fica legível em https://react.dev/errors/<n>.")
    process.exit(1)
  }
  console.log(`\n✅ ${rotas.length} rotas sobreviveram à hidratação.`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
