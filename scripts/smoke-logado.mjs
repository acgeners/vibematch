#!/usr/bin/env node
/**
 * O smoke da metade LOGADA do app — ALVO: LOCAL (build de produção, banco descartável).
 *
 *   npm run smoke:logado    # build + sobe + verifica + derruba (o caminho normal)
 *
 * Contra um servidor já no ar:
 *   node --env-file=.env.local --env-file=.env.analysis scripts/smoke-logado.mjs \
 *        --base=http://localhost:3100
 *
 * SMOKE-ALVO: pre-deploy
 *
 * ⚠️ Ele é o TERCEIRO caso da régua de alvo dos scripts, e a régua só previa dois: quem só LÊ
 * declara `.env.analysis` (vai pro local, de graça) e quem GRAVA declara o alvo remoto no
 * cabeçalho (senão o trabalho some no próximo `db:pull`). Este GRAVA — define a senha das
 * contas — e mesmo assim tem de ir pro LOCAL: o que ele escreve é credencial descartável, e é
 * justamente lá em cima que escrever seria o desastre. Por isso a declaração aqui é
 * `.env.analysis`, e quem impede o alvo errado são as guardas de `exigirLocal()`, não a
 * convenção.
 *
 * 🔴 E o comentário acima NÃO pode soletrar o marcador da outra categoria: a varredura de
 * `scripts-apontam-pro-local.test.ts` casa a GRAFIA dele no source, então escrevê-lo em prosa
 * — mesmo para explicar que não se aplica — reclassifica este arquivo como script de nuvem.
 * Medido: a contagem da tabela do CLAUDE.md pulou de 49 para 50 por causa de uma frase.
 *
 * ── por que ele existe ────────────────────────────────────────────────────────────────────
 *
 * 🔴 Os outros dois smokes verificam o que está NO AR, e os dois são ANÔNIMOS. Medido em
 * 2026-08-21: o app tem 39 rotas, 12 delas gateadas (7 em `/curation`, 5 em
 * `SIGNED_IN_PREFIXES`), e o `smoke-browser.mjs` abre 5 — nenhuma logada. A metade do app que
 * só existe com sessão nunca foi vista por instrumento nenhum.
 *
 * ⚠️ E o gate do middleware SUBESTIMA o buraco: ele lista as rotas que REDIRECIONAM. A página
 * de obra responde 200 anônima e muda de árvore com sessão. Medido na mesma obra, no mesmo
 * build:
 *
 *   | papel    | [data-slot] | o que só ele vê          |
 *   |----------|-------------|--------------------------|
 *   | anônimo  | 46          | —                        |
 *   | leitor   | 53          | "Reportar erro na ficha" |
 *   | curador  | 70          | "Atualizar dados"        |
 *
 * Ou seja o smoke anônimo cobre 46 dos 70 nós da MAIOR árvore hidratada do app — que é
 * justamente a que quebrou por um dia em 20/08 (React #310). E o painel `report_error`, que
 * subiu no #495, é de leitor logado: nenhum smoke chegava perto dele.
 *
 * ── por que LOCAL, e não produção ─────────────────────────────────────────────────────────
 *
 * Escolha da Ana em 2026-08-21, com os dois lados medidos. Contra produção ele rodaria depois
 * de publicar (não desfaz nada), exigiria a senha de uma conta real num env var e cobriria
 * MENOS: medido na nuvem no mesmo dia, só a conta LEITORA tem senha — o curador é Google-only
 * (`encrypted_password` NULL) —, então as 7 rotas de `/curation` ficariam de fora.
 *
 * No local as senhas são descartáveis e os DOIS papéis existem, então ele cobre a console
 * inteira. O preço, declarado: ele verifica o que VAI subir, não o que está no ar — não pega
 * env var faltando no Fly nem migration não aplicada na nuvem. Para isso continuam existindo
 * os dois smokes de produção.
 *
 * ── o modo de falha que ele mesmo precisa evitar ──────────────────────────────────────────
 *
 * 🔴 Um smoke logado que não confere que CONTINUA logado é o "resultado plausível" desta
 * família: se a sessão cair, toda rota gateada redireciona para `/login`, que renderiza
 * perfeitamente — 200, sem esqueleto, sem erro de JS — e ele passaria verde tendo verificado
 * a tela de login doze vezes. Por isso o caminho final é conferido em TODA rota, e as rotas
 * não-gateadas exigem um marcador que só existe para aquele papel.
 */

/**
 * ⚠️ Import ESTÁTICO de propósito. A 1ª versão usava `await import(join(REPO, "node_modules/…"))`
 * e o caminho COMPUTADO fazia o Vite injetar um `import … from "/@vite/client"` ANTES do
 * shebang — o arquivo deixava de parsear na suíte (`Invalid Character \`!\``), embora rodasse
 * normal no Node. Specifier literal não tem esse efeito.
 */
import { createClient } from "@supabase/supabase-js"
import { createRequire } from "node:module"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=")
const BASE = (arg("base") ?? "http://localhost:3100").replace(/\/$/, "")
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * A senha é DESCARTÁVEL e o script a define ele mesmo, em vez de exigir um passo manual.
 *
 * ⚠️ Isto SOBRESCREVE a senha das contas do banco local. É de propósito: o `db:pull` apaga o
 * hash (os usuários são Google-only na origem), então uma senha combinada à mão envelhece a
 * cada réplica nova e o smoke passaria a falhar por motivo que não é defeito do app.
 */
const SENHA = process.env.SMOKE_SENHA ?? "smoke-local-descartavel"

/* ------------------------------------------------------------------ */
/* Guardas de alvo — ele ESCREVE no banco, então erra caro             */
/* ------------------------------------------------------------------ */

/**
 * 🔴 Duas guardas, porque são dois alvos independentes: o SERVIDOR (`--base`) e o BANCO
 * (`NEXT_PUBLIC_SUPABASE_URL`). Um build local apontando para a nuvem passaria na primeira e
 * escreveria senha em produção — que é a falha que este bloco existe para impedir.
 */
/**
 * ⚠️ EXPORTADA para poder ser testada de verdade: casar a grafia da regex no source provaria
 * que alguém escreveu a palavra "localhost"; o que interessa é que `https://satoria.fly.dev`
 * seja recusado — e que `http://localhost.evil.com` também seja.
 */
// Dono ÚNICO do predicado: scripts/lib/local-primary.mjs. Reexportado aqui porque o teste
// (smoke-logado-verifica-a-sessao) o importa deste módulo — duas grafias da mesma regex
// fariam um script recusar o alvo que o outro aceita.
export { ehLocal } from "./lib/local-primary.mjs"
import { ehLocal } from "./lib/local-primary.mjs"

export function exigirLocal() {
  const local = ehLocal

  if (!local(BASE)) {
    console.error(`❌ recusado: --base=${BASE} não é local.`)
    console.error("   Este smoke DEFINE senha no banco do alvo — contra produção isso mexeria")
    console.error("   na credencial de uma conta real. Suba um build local e aponte para ele.")
    process.exit(1)
  }

  const db = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!db) {
    console.error("❌ falta NEXT_PUBLIC_SUPABASE_URL.")
    console.error("   Rode com: node --env-file=.env.local --env-file=.env.analysis " + "scripts/smoke-logado.mjs")
    process.exit(1)
  }
  if (!local(db)) {
    console.error(`❌ recusado: o BANCO é ${db} — não é o stack local.`)
    console.error("   O servidor pode ser local e o banco não. Acrescente --env-file=.env.analysis")
    console.error("   DEPOIS do .env.local (o último vence).")
    process.exit(1)
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ falta SUPABASE_SERVICE_ROLE_KEY — sem ela não dá para definir a senha.")
    process.exit(1)
  }
  return db
}

/* ------------------------------------------------------------------ */
/* Os papéis e o que cada um alcança                                   */
/* ------------------------------------------------------------------ */

/**
 * As rotas saem da medição de 2026-08-21 contra o build de produção, e os pisos são baixos de
 * propósito — mesma régua dos outros smokes: eles separam "renderizou" de "veio vazia", não
 * cravam o número de hoje. `[data-slot]` medido vai de 4 a 3749 conforme a rota.
 *
 * ⚠️ `/my-list` do LEITOR é o caso magro e tem piso próprio: a conta leitora tem ZERO linhas em
 * `user_work_state` (medido nos dois bancos), então a lista dela é legitimamente vazia — 4
 * slots. Piso alto ali reprovaria um app são.
 */
const PISO_PADRAO = 8

export const PAPEIS = [
  {
    id: "curador",
    email: process.env.SMOKE_EMAIL_CURADOR ?? "ac.generoso@gmail.com",
    // Alcança a console INTEIRA. Medido: [data-slot] 15–3749 nas doze.
    alcanca: [
      { rota: "/curation" },
      { rota: "/curation/ai-usage" },
      { rota: "/curation/model-metrics" },
      { rota: "/curation/requests" },
      { rota: "/curation/settings" },
      { rota: "/curation/settings/tag-consolidation" },
      { rota: "/curation/works" },
      { rota: "/account" },
      { rota: "/account/taste-profile" },
      { rota: "/dashboard" },
      { rota: "/discover" },
      { rota: "/my-list" },
      // A página de obra NÃO é gateada, então o caminho final não prova sessão nenhuma: quem
      // prova é o texto, que só o curador vê. Medido: 70 slots (contra 46 anônimo).
      { obra: true, texto: /Atualizar dados/, oQue: "as ações de curadoria" },
    ],
    naoAlcanca: [],
  },
  {
    id: "leitor",
    email: process.env.SMOKE_EMAIL_LEITOR ?? "ana.generoso22@gmail.com",
    alcanca: [
      { rota: "/account" },
      { rota: "/dashboard" },
      { rota: "/discover" },
      { rota: "/my-list", min: 3 },
      // 🔴 O painel do #495. É a razão de este smoke existir: ele subiu em 20/08 e nenhum
      // instrumento o tocava, porque só aparece para leitor LOGADO na página de obra.
      { obra: true, texto: /Reportar erro na ficha/, oQue: "o painel de reportar erro" },
    ],
    /**
     * 🔴 A metade NEGATIVA, e é o que nenhum outro instrumento faz. Ela não pergunta "a página
     * renderizou?" e sim "o gate de PAPEL continua de pé?". Esta base já pagou 10 vazamentos
     * per-user; um deles foi `/account` anônimo servindo o perfil do DONO com "Entrar" na
     * barra ao lado. Se a console vazar para leitor, aqui reprova.
     *
     * ⚠️ O anônimo já é coberto pelo `smoke-producao.mjs` (rota gateada esperando 307), então
     * não é reduplicado aqui — o que falta lá é justamente o papel INSUFICIENTE, que só existe
     * com sessão.
     */
    naoAlcanca: [{ rota: "/curation", destino: "/", oQue: "a console" }],
  },
]

/* ------------------------------------------------------------------ */
/* Os sinais — herdados do smoke-browser, que os mediu                 */
/* ------------------------------------------------------------------ */

/**
 * Medidos em 20/08/2026 (build com uma sonda que lançava na hidratação × produção sã):
 * `pageerror` NÃO separa (o React 19 engole a exceção); o que separa é resposta **5xx** (1×0) e
 * **esqueleto sobrando** depois de hidratar (28×0). 4xx e `net::ERR_*` são o piso de ruído
 * desta aplicação — contados e impressos, nunca descartados em silêncio.
 *
 * 🔴 Medido de novo em 21/08/2026, agora numa rota LOGADA (sonda que estoura na hidratação da
 * `/curation`): **os dois sinais daquela tabela ficaram MUDOS** — 0 esqueletos e 0 respostas
 * 5xx —, e quem separou foi o PISO de conteúdo (`[data-slot]` 0 contra 17) mais o `pageerror`,
 * que ali disparou (1 contra 0). É o inverso do caso de 20/08, onde o `pageerror` é que era
 * mudo. Conclusão que vale para os dois smokes: nenhum sinal isolado serve, e é por isso que
 * o piso continua existindo ao lado deles.
 */
const STATUS_QUE_REPROVA = (s) => s >= 500
const E_DE_RECURSO = /^Failed to load resource/i
const SELETOR_ESQUELETO = '[data-slot="skeleton"]'
/**
 * 🔴 A casca de erro tem DUAS grafias, e a segunda foi medida aqui em 21/08/2026 — o
 * `smoke-browser.mjs` só conhece a primeira. Com uma sonda que estoura na hidratação da
 * `/curation`, o Next 16 serve **"This page couldn't load"** (apóstrofo tipográfico), e
 * `Application error: a client-side exception` NÃO aparece. Casar só uma delas é ter o
 * detector desligado justamente no caso que ele existe para pegar.
 */
const ERRO_DO_NEXT = /Application error: a client-side exception|This page could?n[\u2019']t load/i
const TIMEOUT_MS = 45_000

/* ------------------------------------------------------------------ */

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
 * 🔴 Fail-HARD, ao contrário do `smoke-browser.mjs` — e a diferença é o MOMENTO. Lá o
 * fail-soft existe porque ele roda depois de publicar, sob `set -e`: um exit 1 derrubaria o
 * comando com o código já no ar. Aqui nada foi publicado, então "não verifiquei" não pode
 * passar por "verifiquei" — é exatamente assim que se constrói capacidade DESLIGADA.
 */
function semPlaywright(onde) {
  console.error("")
  console.error("❌ SMOKE LOGADO NÃO RODOU — não encontrei `playwright-core`.")
  for (const d of onde ?? []) console.error(`   procurei em: ${d}`)
  console.error("   para ligar: `cd services/comix-render && npm i` e `npx playwright install chromium`")
  process.exit(1)
}

/** Define a senha nas contas do banco LOCAL e prova que ela loga. */
async function prepararContas(dbUrl) {
  const admin = createClient(dbUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data, error } = await admin.auth.admin.listUsers()
  if (error) {
    console.error(`❌ não consegui listar as contas do banco local: ${error.message}`)
    process.exit(1)
  }
  const porEmail = new Map(data.users.map((u) => [u.email, u]))

  for (const p of PAPEIS) {
    const u = porEmail.get(p.email)
    if (!u) {
      console.error(`❌ a conta do papel "${p.id}" (${p.email}) não existe no banco local.`)
      console.error("   Réplica sem essa conta não exercita o papel — rode `npm run db:pull`.")
      process.exit(1)
    }
    const up = await admin.auth.admin.updateUserById(u.id, { password: SENHA })
    if (up.error) {
      console.error(`❌ não consegui definir a senha de ${p.email}: ${up.error.message}`)
      process.exit(1)
    }
  }
  return admin
}

/** A obra entra por DESCOBERTA: id cravado reprovaria um deploy são no dia em que ela sair. */
async function descobrirObra() {
  const html = await (await fetch(`${BASE}/catalog`)).text()
  return html.match(/href="\/catalog\/([a-z0-9][a-z0-9-]{3,})"/)?.[1] ?? null
}

async function entrar(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: TIMEOUT_MS })
  await page.fill("#email", email)
  await page.fill("#password", SENHA)
  await Promise.all([
    page.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: TIMEOUT_MS }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1200)
  const onde = new URL(page.url()).pathname
  return onde.startsWith("/login") ? { ok: false, onde } : { ok: true, onde }
}

async function abrir(page, alvo) {
  const js = []
  const recursos = []
  const servidor = []
  const onConsole = (m) => {
    if (m.type() !== "error") return
    const t = m.text()
    ;(E_DE_RECURSO.test(t) ? recursos : js).push(t.slice(0, 200))
  }
  const onPageError = (e) => js.push(`EXCEÇÃO NÃO TRATADA: ${String(e).split("\n")[0].slice(0, 200)}`)
  const onResponse = (r) => {
    if (STATUS_QUE_REPROVA(r.status())) servidor.push(`${r.status()} ${new URL(r.url()).pathname.slice(0, 60)}`)
  }
  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  page.on("response", onResponse)

  try {
    // `goto`, nunca clique — é a carga FRIA que reproduz a família de 20/08.
    const resp = await page.goto(BASE + alvo.rota, { waitUntil: "networkidle", timeout: TIMEOUT_MS })
    await page.waitForTimeout(1500)

    const caminho = new URL(page.url()).pathname

    // A metade NEGATIVA: aqui redirecionar é o resultado CERTO.
    if (alvo.destino) {
      return caminho === alvo.destino
        ? { ok: true, detalhe: `barrado → ${caminho}`, recursos }
        : { ok: false, motivo: `devia cair em ${alvo.destino} e ficou em ${caminho} — ${alvo.oQue} VAZOU`, recursos }
    }

    // 🔴 Antes de qualquer piso: continua logado? Sessão caída redireciona para /login, que
    // renderiza limpa — e o smoke passaria verde tendo olhado a tela de login.
    if (caminho !== alvo.rota) {
      const porQue = caminho.startsWith("/login")
        ? "a sessão caiu (ou o gate mudou)"
        : "algo redirecionou a rota"
      return { ok: false, motivo: `terminou em ${caminho} — ${porQue}`, recursos }
    }

    const status = resp?.status() ?? 0
    if (status >= 400) return { ok: false, motivo: `HTTP ${status}`, recursos }
    if (servidor.length) return { ok: false, motivo: `resposta ${servidor[0]}`, extras: servidor.slice(1), recursos }

    const corpo = await page.evaluate(() => document.body.innerText)
    if (ERRO_DO_NEXT.test(corpo.slice(0, 400))) {
      return { ok: false, motivo: "a página trocou pela casca de erro do Next (estouro no cliente)", recursos }
    }

    const esq = await page.evaluate((s) => document.querySelectorAll(s).length, SELETOR_ESQUELETO)
    if (esq > 0) {
      return { ok: false, motivo: `${esq} esqueleto(s) depois de hidratar — presa carregando`, recursos }
    }

    // Rota não-gateada: o texto é o que prova o PAPEL, porque o caminho não prova nada.
    if (alvo.texto && !alvo.texto.test(corpo)) {
      return { ok: false, motivo: `não achei ${alvo.oQue} — a sessão de ${alvo.papel} não chegou na árvore`, recursos }
    }

    const n = await page.evaluate((s) => document.querySelectorAll(s).length, "[data-slot]")
    const min = alvo.min ?? PISO_PADRAO
    if (n < min) return { ok: false, motivo: `só ${n} elementos depois da hidratação (mínimo ${min})`, recursos }

    if (js.length) return { ok: false, motivo: js[0], extras: js.slice(1), recursos }
    return { ok: true, detalhe: `${n} elementos${alvo.texto ? " · " + alvo.oQue : ""}`, recursos }
  } catch (e) {
    return { ok: false, motivo: String(e).split("\n")[0].slice(0, 200), recursos }
  } finally {
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
    page.off("response", onResponse)
  }
}

async function main() {
  const dbUrl = exigirLocal()
  const achado = acharPlaywright()
  if (!achado) {
    semPlaywright([
      arg("modules") && join(resolve(arg("modules")), "services/comix-render"),
      join(REPO, "services/comix-render"),
      REPO,
    ].filter(Boolean))
  }

  console.log(`▶ smoke LOGADO em ${BASE}`)
  console.log(`  banco: ${dbUrl}`)
  console.log(`  playwright: ${achado.onde}`)

  await prepararContas(dbUrl)

  const slug = await descobrirObra().catch(() => null)
  if (!slug) console.log("  ⚠️  página de obra fora do smoke: não achei link na /catalog")

  let browser
  try {
    browser = await achado.pw.chromium.launch()
  } catch (e) {
    console.error(`❌ o Chromium não subiu: ${String(e).split("\n")[0].slice(0, 160)}`)
    process.exit(1)
  }

  let falhas = 0
  let ruido = 0
  let verificadas = 0

  for (const papel of PAPEIS) {
    // Contexto NOVO por papel: reusar o do curador daria ao "leitor" a sessão dele, e a
    // metade negativa passaria verde afirmando o contrário do que houve.
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    const page = await ctx.newPage()

    const login = await entrar(page, papel.email)
    if (!login.ok) {
      console.error(`\n  ❌ ${papel.id}: o login não passou (ficou em ${login.onde}).`)
      falhas++
      await ctx.close()
      continue
    }
    console.log(`\n  ${papel.id} (${papel.email}) → entrou em ${login.onde}`)

    const alvos = [
      ...papel.alcanca.map((a) => ({ ...a, papel: papel.id, rota: a.obra ? `/catalog/${slug}` : a.rota })),
      ...papel.naoAlcanca.map((a) => ({ ...a, papel: papel.id })),
    ].filter((a) => !a.obra || slug)

    for (const alvo of alvos) {
      const t0 = Date.now()
      const res = await abrir(page, alvo)
      const ms = String(Date.now() - t0).padStart(6)
      const nome = alvo.rota.length > 36 ? alvo.rota.slice(0, 33) + "…" : alvo.rota.padEnd(36)
      ruido += res.recursos?.length ?? 0
      verificadas++
      if (res.ok) {
        console.log(`    ✅ ${nome} ${ms}ms  ${res.detalhe}`)
      } else {
        falhas++
        console.log(`    ❌ ${nome} ${ms}ms  ${res.motivo}`)
        for (const x of res.extras ?? []) console.log(`         · ${x}`)
      }
    }
    await ctx.close()
  }

  await browser.close()

  if (ruido) console.log(`\n  ℹ️  ${ruido} falha(s) de RECURSO ignoradas (imagem/fonte que não carrega).`)

  if (falhas > 0) {
    console.error(`\n❌ ${falhas} verificação(ões) da metade logada falharam.`)
    console.error("   Isto roda ANTES de publicar: ainda não está no ar.")
    process.exit(1)
  }
  console.log(`\n✅ ${verificadas} verificações logadas passaram (${PAPEIS.length} papéis).`)
}

/**
 * 🔴 Só executa quando chamado DIRETO. Sem isto, importar este módulo num teste dispararia o
 * smoke de verdade — inclusive o `process.exit` das guardas, que derruba a suíte inteira.
 * Mesma proteção do `smoke.mjs` e do `contratos-postgrest.mjs`.
 *
 * 🔴 Mas a comparação tem de passar por `realpathSync`, e a versão sem ele FALHOU CALADA — o
 * pior desfecho possível para uma verificação. No macOS `mktemp -d` devolve `/var/folders/…`,
 * que é symlink para `/private/var/folders/…`: `process.argv[1]` guarda o caminho como foi
 * digitado e `import.meta.url` guarda o REAL, então os dois nunca batem. Medido em 21/08/2026
 * no próprio `smoke-logado.sh` — build feito, servidor no ar, e o script terminou com código
 * **0 sem abrir uma única rota**. É a mesma família do backup automático que avisava num log
 * que ninguém lia e reportava sucesso.
 *
 * ⚠️ O `smoke.mjs` tem a mesma guarda sem `realpath` e não morde hoje só porque ele é sempre
 * invocado do checkout, onde não há symlink no caminho.
 */
export const mesmoArquivo = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}
const chamadoDireto = Boolean(process.argv[1]) && mesmoArquivo(process.argv[1], fileURLToPath(import.meta.url))

if (chamadoDireto) {
  main().catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
}
