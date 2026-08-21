#!/usr/bin/env node
/**
 * CANÁRIO DO CONTRATO DO POSTGREST — ALVO: LOCAL (só lê, US$0)
 *
 * Duas metades: as RPCs que o código chama, e a FORMA dos embeds que ele lê.
 *
 *   npm run contracts
 *   node --env-file=.env.local --env-file=.env.analysis scripts/contratos-postgrest.mjs
 *
 * ── por que existe ───────────────────────────────────────────────────────────────────────
 *
 * 🔴 `as X[]` sobre resposta de RPC é uma AFIRMAÇÃO sobre um contrato que mora em SQL, e o
 * compilador não a verifica. Quando a migration 151 tirou `user_score` do `RETURNS TABLE` de
 * `find_similar_works`, o consumidor seguiu lendo `r.user_score`: o campo passou a chegar
 * `undefined`, `loved`/`avoided` saíram SEMPRE VAZIOS e o prompt do Deep Dive imprimiu
 * "(nenhuma obra similar…)" enquanto prometia o contrário. **Por um mês.** Nada quebrou.
 *
 * A irmã dessa família mordeu de novo em 2026-08-20: o PostgREST devolve embed to-one como
 * OBJETO, o tipo dizia `Array<…>`, e o `?.[0]` achava o baseline em **19 de 392** obras — com
 * o script anunciando "nada a fazer".
 *
 * ── o que ele acrescenta ao teste que já existe ──────────────────────────────────────────
 *
 * `tests/unit/orchestration/rpc-similares-contrato.test.ts` compara o código com as
 * **migrations do repo**, e cobre UMA função. Isto compara com o **banco de verdade**, e
 * cobre todas as que o código chama. A diferença não é acadêmica: as 173 migrations foram
 * aplicadas via Management API, têm colisões de número e nunca rodaram do zero — "a definição
 * mais recente no repo" é uma heurística, e o que atende o app é o banco.
 *
 * ── por que é script, e não teste ────────────────────────────────────────────────────────
 *
 * 🔴 Ele precisa do stack local no ar. Como teste do vitest, a saída óbvia seria "pula quando
 * não alcança o banco" — que é o fail-soft calado: some da suíte e ninguém nota. Aqui a
 * ausência do banco é FALHA, com a linha de comando para subir.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/* ------------------------------------------------------------------ */
/* 0. O alvo                                                           */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ As guardas vivem DENTRO de `main()`, não no topo do módulo: um `process.exit` em escopo
 * de importação derrubaria a suíte no instante em que um teste importasse o parser daqui.
 */
function exigirAlvoLocal() {
  if (!URL_ || !KEY) {
    console.error("❌ faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.")
    console.error("   Use: npm run contracts   (ele carrega .env.local + .env.analysis)")
    process.exit(1)
  }
  // Guarda de alvo, não preciosismo: este script EXECUTA RPC. As duas que escrevem ficam de
  // fora por nome (ver ESCREVEM), mas apontar para a nuvem por acidente ainda queimaria quota
  // e leria dado de produção. O `.env.analysis` existe justamente para isto — e um script que
  // o esqueça roda contra a NUVEM sem avisar.
  if (!/127\.0\.0\.1|localhost/.test(URL_)) {
    console.error(`❌ este canário é LOCAL e o alvo é ${URL_}.`)
    console.error("   Rode `npm run contracts`, ou gere o .env.analysis com `npm run db:analysis-env`.")
    process.exit(1)
  }
}

const cabecalhos = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }

/* ------------------------------------------------------------------ */
/* 1. Quais RPCs o código chama — derivado, nunca lista fixa           */
/* ------------------------------------------------------------------ */

function arquivosDe(...dirs) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e.startsWith(".")) continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|mjs)$/.test(e)) out.push(p)
    }
  }
  for (const d of dirs) walk(join(REPO, d))
  return out
}

const FONTES = arquivosDe("server", "lib", "app")

/**
 * Cada chamada, com o arquivo e os NOMES dos argumentos passados.
 *
 * ⚠️ Lista fixa aqui seria o jeito de a RPC nova nascer fora do canário — a mesma armadilha
 * que o teste dos escritores de `.backups` já pagou.
 */
export function chamadasNoTexto(src) {
  const out = []
  {
    for (const m of src.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"\s*(,)?/g)) {
      const nome = m[1]
      let args = []
      if (m[2]) {
        // O objeto de argumentos, por contagem de chaves — regex não fecha bloco aninhado.
        const i = src.indexOf("{", m.index + m[0].length)
        if (i >= 0 && src.slice(m.index + m[0].length, i).trim() === "") {
          let nivel = 0
          let fim = i
          for (; fim < src.length; fim++) {
            if (src[fim] === "{") nivel++
            else if (src[fim] === "}" && --nivel === 0) break
          }
          const corpo = src.slice(i + 1, fim)
          // Só as chaves de PRIMEIRO nível: `{ a: x, b: { c: 1 } }` passa `a` e `b`.
          let n = 0
          for (const par of corpo.split(/,(?![^{[]*[}\]])/)) {
            const k = par.trim().match(/^([a-z_][a-z0-9_]*)\s*:/i)
            if (k && n >= 0) args.push(k[1])
            n++
          }
        }
      }
      out.push({ nome, args })
    }
  }
  return out
}

function chamadas() {
  const achadas = new Map()
  for (const f of FONTES) {
    const rel = f.slice(REPO.length + 1)
    for (const { nome, args } of chamadasNoTexto(readFileSync(f, "utf8"))) {
      const atual = achadas.get(nome) ?? { nome, consumidores: new Set(), args: new Set() }
      atual.consumidores.add(rel)
      for (const a of args) atual.args.add(a)
      achadas.set(nome, atual)
    }
  }
  return [...achadas.values()].sort((a, b) => a.nome.localeCompare(b.nome))
}

/* ------------------------------------------------------------------ */
/* 2. O que o PostgREST diz — a fonte que o APP conversa               */
/* ------------------------------------------------------------------ */

async function spec() {
  const r = await fetch(`${URL_}/rest/v1/`, { headers: cabecalhos })
  if (!r.ok) throw new Error(`o PostgREST devolveu ${r.status} no /rest/v1/`)
  return r.json()
}

/* ------------------------------------------------------------------ */
/* 3. Como EXERCITAR cada uma                                          */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ Esta tabela diz como CHAMAR, nunca o que ESPERAR — o que se espera vem do banco e do
 * código. Sem ela não há como executar (toda RPC daqui precisa de id ou título real), e
 * derivar argumento de assinatura daria `null` em tudo e zero linha em tudo.
 *
 * 🔴 As duas que ESCREVEM ficam fora por nome: `touch_recalc_pending` e
 * `refresh_calculated_scores_confidence` devolvem `void` e mexem no banco. Elas ainda são
 * conferidas quanto a existência e argumentos — só não são chamadas.
 */
const ESCREVEM = new Set(["touch_recalc_pending", "refresh_calculated_scores_confidence"])

async function amostras() {
  const pega = async (q) => {
    const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: cabecalhos })
    if (!r.ok) throw new Error(`${q} → ${r.status}`)
    return r.json()
  }
  // Obras COM embedding: sem isso `find_similar_works` devolve zero linha e o canário não
  // teria como olhar as colunas — que é justamente o buraco que ele existe para não ter.
  const comEmb = await pega("work_embeddings?select=work_id&limit=4")
  const ids = comEmb.map((r) => r.work_id)
  const obras = await pega(`works?select=id,title&id=in.(${ids.join(",")})`)
  return { ids, titulo: obras[0]?.title ?? "" }
}

function argsDeExecucao(nome, am) {
  switch (nome) {
    case "find_similar_works":
      return { target_work_id: am.ids[0], match_limit: 5 }
    case "find_similar_to_seeds":
      return { seed_ids: am.ids.slice(0, 2), match_limit: 20 }
    case "seed_pair_similarity":
      return { seed_ids: am.ids.slice(0, 3) }
    case "pairwise_similarity":
      return { work_ids: am.ids.slice(0, 3) }
    case "work_card_counts":
      return { work_ids: am.ids.slice(0, 3) }
    case "find_works_matching_titles":
      return { query_titles: [am.titulo] }
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* 4. O que a migration do repo promete (para achar DERIVA)            */
/* ------------------------------------------------------------------ */

const MIGRATIONS = join(REPO, "supabase/migrations")

/**
 * 🔴 As três formas convivem no repo — `create function public.x`, `CREATE OR REPLACE FUNCTION
 * x` (sem schema, em maiúsculas) — e a 1ª versão deste parser casava só a primeira. Resultado:
 * ele afirmou "nenhuma migration declara `work_card_counts`" sobre uma função declarada na
 * migration 122. Plausível e errado, que é o defeito que este canário existe para pegar — pela
 * mesma causa de sempre, um padrão estreito demais.
 *
 * ⚠️ `tests/unit/orchestration/rpc-similares-contrato.test.ts` tem a MESMA limitação. Lá não
 * morde porque a função que ele cobre usa a primeira forma; morderia na próxima.
 */
function colunasNaMigration(fn) {
  const declara = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\b`, "i")
  for (const nome of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().reverse()) {
    const sql = readFileSync(join(MIGRATIONS, nome), "utf8")
    const achado = sql.match(declara)
    const i = achado ? achado.index : -1
    if (i < 0) continue
    const m = sql.slice(i).match(/returns\s+table\s*\(([\s\S]*?)\)\s*language/i)
    if (!m) return { arquivo: nome, colunas: null } // devolve `void` ou setof
    return {
      arquivo: nome,
      colunas: m[1].split(",").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean),
    }
  }
  return { arquivo: null, colunas: null }
}

/* ------------------------------------------------------------------ */
/* 5. O que o consumidor DECLARA (o campo fantasma)                    */
/* ------------------------------------------------------------------ */

/**
 * A interface do `as X[]` que tipa o resultado DESTA chamada.
 *
 * 🔴 A 1ª versão ligava por PROXIMIDADE — o primeiro cast depois do nome da função — e isso
 * produziu um falso positivo na primeira execução: `seed-discovery.ts` chama
 * `find_similar_to_seeds` e `seed_pair_similarity` no MESMO `Promise.all`, e o cast seguinte
 * (`as SimRow[]`) pertence à primeira. O canário acusou a segunda de declarar cinco campos
 * fantasmas que ela nunca declarou. Detector que produz resultado plausível e errado é
 * exatamente a família que ele existe para pegar — e ele quase a reproduziu.
 *
 * O que liga o cast à chamada é a VARIÁVEL, não a distância. Aqui só a forma inequívoca é
 * aceita — `const { data, … } = await x.rpc("nome", …)`, com o cast sobre `data` antes de
 * qualquer outra `.rpc(`. Chamada dentro de `Promise.all` fica **declarada como não
 * resolvida** em vez de adivinhada: cobrir só o que se sabe parsear SEM dizer quanto ficou
 * de fora é o falso conforto que este projeto já pagou.
 */
function camposDeclarados(arquivo, fn) {
  const src = readFileSync(join(REPO, arquivo), "utf8")
  const achados = []
  let ambiguas = 0

  let semCast = 0

  for (const m of src.matchAll(new RegExp(`\\.rpc\\(\\s*"${fn}"`, "g"))) {
    // A forma inequívoca: o resultado é desestruturado NA MESMA sentença.
    const antes = src.slice(Math.max(0, m.index - 120), m.index)
    // ⚠️ Sem `\.` no fim: o ponto do `.rpc(` faz parte do MATCH, não do texto anterior. Com
    // ele a regra nunca casava e o canário ligava zero tipos — passando verde por não olhar.
    if (!/const\s*\{[^}]*\bdata\b[^}]*\}\s*=\s*await\s+[A-Za-z_$][\w$]*$/.test(antes)) {
      ambiguas++
      continue
    }
    // A janela para no próximo `.rpc(` — nunca atravessa outra chamada.
    const resto = src.slice(m.index + m[0].length, m.index + 2000)
    const corte = resto.search(/\.rpc\(/)
    const janela = corte === -1 ? resto : resto.slice(0, corte)
    const cast = janela.match(/\bdata\b[^\n]{0,40}?\bas\s+([A-Z][A-Za-z0-9_]*)\[\]/)
    // ⚠️ "não tem cast" é FATO DO CÓDIGO (não há tipo a conferir); "não consegui ligar" é
    // limite do PARSER. Somar os dois num contador só faria o relatório culpar o código por
    // uma limitação minha, e esconder a limitação atrás de um número que parece cobertura.
    if (!cast) {
      semCast++
      continue
    }
    const decl = src.match(new RegExp(`interface\\s+${cast[1]}\\s*\\{([\\s\\S]*?)\\n\\}`))
    if (!decl) {
      ambiguas++
      continue
    }
    achados.push({
      tipo: cast[1],
      campos: [...decl[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*[?:]/gim)].map((x) => x[1]),
    })
  }
  return { achados, ambiguas, semCast }
}

/* ------------------------------------------------------------------ */
/* 5. A metade EMBED — a FORMA que o PostgREST devolve                 */
/* ------------------------------------------------------------------ */

/**
 * 🔴 O PostgREST devolve embed **to-one** como OBJETO e **to-many** como ARRAY, e quem decide
 * é o BANCO — a direção da FK mais os índices únicos. O código não tem como saber, e errar não
 * dá erro: `?.[0]` sobre objeto é `undefined`, `.campo` sobre array é `undefined`. Os dois
 * somem em silêncio.
 *
 * Foi o que aconteceu em 20/08/2026: o tipo dizia `Array<…>`, o código fazia `?.[0]`, e o
 * `--heal` do `adult-content-retroactive-bounds` achava o baseline em **19 de 392** obras — com
 * o script anunciando "nada a fazer".
 *
 * ⚠️ A forma NÃO é estável por natureza: ela muda se alguém dropar um índice único. Medido:
 * `works→calculated_scores` volta **OBJETO** (há unique em `work_id`) enquanto
 * `works→category_scores` volta **ARRAY** — a mesma direção de FK, formas opostas. Perder esse
 * unique transformaria todo `.expected_score` direto em `undefined`, sem erro.
 *
 * Por isso o canário CONGELA a forma medida: par novo exige declaração, e forma que muda
 * REPROVA.
 */
const FORMAS = {
  "ai_evaluations→ai_evaluation_scores": "ARRAY",
  "calculated_scores→works": "OBJETO",
  "category_scores→ai_evaluations": "OBJETO",
  "category_scores→works": "OBJETO",
  "curation_requests→works": "OBJETO",
  "import_rows→imports": "OBJETO",
  "synopsis_quality_predictions→works_owner": "OBJETO",
  "tag_subgroup_assignment→tag_subgroup": "OBJETO",
  "user_work_state→works": "OBJETO",
  "work_external_ids→works": "OBJETO",
  "work_genres→genres": "OBJETO",
  "work_tags→tags": "OBJETO",
  "work_tags→works": "OBJETO",
  "works→calculated_scores": "OBJETO",
  "works→work_embeddings": "OBJETO",
  "works_owner→calculated_scores": "OBJETO",
  "works→category_scores": "ARRAY",
  "works→platform_ratings": "ARRAY",
  "works→work_covers": "ARRAY",
  "works→work_external_ids": "ARRAY",
  "works→work_genres": "ARRAY",
  "works→work_reviews": "ARRAY",
  "works→work_synopses": "ARRAY",
  "works→work_tags": "ARRAY",
  "works_owner→category_scores": "ARRAY",
  "works_owner→pilot_taste_scores": "ARRAY",
  "works_owner→work_covers": "ARRAY",
  "works_owner→work_external_ids": "ARRAY",
  "works_owner→work_genres": "ARRAY",
  "works_owner→work_synopses": "ARRAY",
  "works_owner→work_tags": "ARRAY",
}

/**
 * Os nomes embutidos em NÍVEL 0 do select — `tags(...)` conta; o `x` de `tags(x(y))` não, que é
 * embed do embed. `alias:` e `!fk` não fazem parte do nome.
 */
export function embedsDoSelect(sel) {
  const out = []
  let d = 0
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i]
    if (ch === "(") {
      if (d === 0) {
        const m = sel.slice(0, i).match(/([A-Za-z_][A-Za-z0-9_]*)(?:![A-Za-z0-9_]+)?\s*$/)
        // ⚠️ precedido de ponto é MÉTODO, não tabela: sem isto, `${xs.join(", ")}` dentro de um
        // template de select entra no inventário como se fosse uma relação chamada "join".
        if (m && sel[i - m[0].length - 1] !== ".") out.push(m[1])
      }
      d++
    } else if (ch === ")") d--
  }
  return out
}

/** Pares (base, embed) de uma cadeia `.from("X")…\.select("…emb(…)")`. */
export function paresNoTexto(src) {
  const out = []
  const re = /\.from\(\s*["\'`]([a-z_][a-z0-9_]*)["\'`]\s*\)/g
  let m
  while ((m = re.exec(src))) {
    const base = m[1]
    const resto = src.slice(m.index + m[0].length)
    // A janela para no `.from(` seguinte: sem isso o select de uma query é atribuído à base da
    // anterior, e o canário passa a conferir um par que não existe.
    const fim = Math.min(...[resto.indexOf(".from("), resto.indexOf("\n}\n")].filter((i) => i >= 0).concat([2000]))
    const sel = resto.slice(0, fim).match(/\.select\(\s*(["\'`])([\s\S]*?)\1/)
    if (!sel) continue
    for (const embed of embedsDoSelect(sel[2])) out.push({ base, embed })
  }
  return out
}

/** O universo: todo par que o código lê, derivado do git. */
function paresDoCodigo() {
  const mapa = new Map()
  for (const arquivo of arquivosDe("server", "lib", "app", "scripts")) {
    for (const { base, embed } of paresNoTexto(readFileSync(arquivo, "utf8"))) {
      const k = `${base}→${embed}`
      if (!mapa.has(k)) mapa.set(k, new Set())
      mapa.get(k).add(arquivo.replace(REPO + "/", ""))
    }
  }
  return mapa
}

/**
 * A decisão, separada do fetch para poder ser EXERCITADA: o clone local não tem tabela vazia,
 * então os ramos de "sem dado" não têm como rodar contra o banco. Deixá-los sem teste seria
 * confiar justamente no caminho que existe para impedir o canário de passar sem olhar.
 *
 * 🔴 Ausência de dado é ERRO, nunca sucesso: sem linha, ou com o embed nulo em todas elas, o
 * canário não viu forma nenhuma. É a mesma régua da zero-linha na metade das RPCs.
 */
export function classificarForma(linhas, embed) {
  if (!Array.isArray(linhas) || !linhas.length) {
    return { erro: "a tabela base não tem linha — sem dado não dá para ver a forma" }
  }
  const v = linhas.find((x) => x[embed] != null)?.[embed]
  if (v === undefined) return { erro: "o embed veio nulo em todas as linhas da amostra" }
  return { forma: Array.isArray(v) ? "ARRAY" : "OBJETO" }
}

async function formaReal(base, embed) {
  const r = await fetch(`${URL_}/rest/v1/${base}?select=${embed}(*)&limit=3`, { headers: cabecalhos })
  if (!r.ok) return { erro: `HTTP ${r.status} ${(await r.text()).slice(0, 90)}` }
  return classificarForma(await r.json(), embed)
}

async function conferirEmbeds() {
  const pares = paresDoCodigo()
  embedsConferidos = pares.size
  console.log(`\n  ${pares.size} par(es) de embed no código\n`)
  for (const [k, consumidores] of [...pares].sort()) {
    const [base, embed] = k.split("→")
    const esperada = FORMAS[k]
    const { forma, erro } = await formaReal(base, embed)

    if (erro) {
      falhas.push(`${k}: não deu para medir a forma — ${erro}`)
      console.log(`  ❌ ${k.padEnd(44)} ${erro}`)
      continue
    }
    if (!esperada) {
      // Par novo NÃO passa calado: declarar é a revisão humana de que o consumidor trata a
      // forma certa. A mensagem já traz a linha para colar.
      falhas.push(
        `${k}: par NOVO, sem forma declarada. O banco devolve ${forma} — confira como ` +
          `${[...consumidores].join(", ")} o trata e cole em FORMAS: "${k}": "${forma}",`,
      )
      console.log(`  ❌ ${k.padEnd(44)} NOVO (banco diz ${forma})`)
      continue
    }
    if (forma !== esperada) {
      falhas.push(
        `${k}: o banco passou a devolver ${forma} e o canário esperava ${esperada}. ` +
          `Todo consumidor quebra em SILÊNCIO (${[...consumidores].join(", ")}).`,
      )
      console.log(`  ❌ ${k.padEnd(44)} ${esperada} → ${forma}`)
      continue
    }
    console.log(`  ✅ ${k.padEnd(44)} ${forma} · ${consumidores.size} consumidor(es)`)
  }

  // Declarado que deixou de existir no código é ruído que envelhece — nota, não falha.
  const orfas = Object.keys(FORMAS).filter((k) => !pares.has(k))
  if (orfas.length) notas.push(`FORMAS declara ${orfas.length} par(es) que o código não lê mais: ${orfas.join(", ")}`)
}

/* ------------------------------------------------------------------ */

const falhas = []
const notas = []
let embedsConferidos = 0

async function main() {
  exigirAlvoLocal()
  console.log(`▶ canário do contrato em ${URL_}\n`)

  let api
  try {
    api = await spec()
  } catch (e) {
    console.error(`❌ não alcancei o PostgREST: ${e.message}`)
    console.error("   Suba o stack local:  supabase start   (e `npm run db:analysis-env` depois)")
    process.exit(1)
  }

  const expostos = new Map(
    Object.keys(api.paths ?? {})
      .filter((p) => p.startsWith("/rpc/"))
      .map((p) => [
        p.slice(5),
        (api.paths[p].get?.parameters ?? []).map((x) => x.name),
      ]),
  )

  const am = await amostras()
  if (!am.ids.length) {
    console.error("❌ o banco local não tem obra com embedding — sem isso não dá para exercitar as RPCs.")
    process.exit(1)
  }

  const chamados = chamadas()
  console.log(`  ${chamados.length} RPC(s) chamadas pelo código, ${expostos.size} expostas pelo PostgREST\n`)

  for (const c of chamados) {
    const arg = expostos.get(c.nome)

    if (!arg) {
      falhas.push(`${c.nome}: o código chama, o PostgREST NÃO expõe (${[...c.consumidores].join(", ")})`)
      console.log(`  ❌ ${c.nome.padEnd(38)} não existe no banco`)
      continue
    }

    // (a) argumento que a função não tem → o PostgREST responde 404 em runtime.
    const forasteiros = [...c.args].filter((a) => !arg.includes(a))
    if (forasteiros.length) {
      falhas.push(`${c.nome}: o código passa ${forasteiros.join(", ")}, que a função não aceita`)
    }

    if (ESCREVEM.has(c.nome)) {
      console.log(`  ✅ ${c.nome.padEnd(38)} existe · args ok · ESCREVE, não executei`)
      continue
    }

    // (b) as colunas que de fato voltam.
    const corpo = argsDeExecucao(c.nome, am)
    if (!corpo) {
      falhas.push(`${c.nome}: não sei como exercitar — declare em \`argsDeExecucao\``)
      console.log(`  ❌ ${c.nome.padEnd(38)} sem receita de execução`)
      continue
    }

    const r = await fetch(`${URL_}/rest/v1/rpc/${c.nome}`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify(corpo),
    })
    if (!r.ok) {
      falhas.push(`${c.nome}: a chamada devolveu ${r.status} — ${(await r.text()).slice(0, 140)}`)
      console.log(`  ❌ ${c.nome.padEnd(38)} HTTP ${r.status}`)
      continue
    }
    const linhas = await r.json()

    // 🔴 ZERO linha não é "passou": é o canário não tendo olhado nada. Tratar isso como
    // sucesso é a forma exata do defeito que ele existe para pegar — "nada a fazer"
    // indistinguível de "está tudo certo".
    if (!Array.isArray(linhas) || linhas.length === 0) {
      falhas.push(
        `${c.nome}: devolveu ZERO linha, então não deu para ver coluna nenhuma. ` +
          `Ajuste a amostra em \`argsDeExecucao\` — passar sem olhar é pior que não rodar.`,
      )
      console.log(`  ❌ ${c.nome.padEnd(38)} zero linha (cobertura, não sucesso)`)
      continue
    }

    const vivas = Object.keys(linhas[0]).sort()

    // (c) DERIVA repo ↔ banco.
    const mig = colunasNaMigration(c.nome)
    if (mig.colunas) {
      const soNoRepo = mig.colunas.filter((x) => !vivas.includes(x))
      const soNoBanco = vivas.filter((x) => !mig.colunas.includes(x))
      if (soNoRepo.length || soNoBanco.length) {
        falhas.push(
          `${c.nome}: o banco e ${mig.arquivo} discordam — ` +
            `só no repo [${soNoRepo}], só no banco [${soNoBanco}]`,
        )
      }
    } else {
      notas.push(`${c.nome}: nenhuma migration do repo declara o RETURNS TABLE dela`)
    }

    // (d) campo fantasma: o consumidor declara o que a função não devolve.
    let tipados = 0
    let naoResolvidas = 0
    let semTipo = 0
    for (const arquivo of c.consumidores) {
      const { achados, ambiguas, semCast } = camposDeclarados(arquivo, c.nome)
      naoResolvidas += ambiguas
      semTipo += semCast
      for (const d of achados) {
        tipados++
        const fantasmas = d.campos.filter((x) => !vivas.includes(x))
        if (fantasmas.length) {
          falhas.push(
            `${c.nome}: ${arquivo} declara \`${d.tipo}.{${fantasmas.join(", ")}}\`, que a função ` +
              `NÃO devolve — chega undefined e some em silêncio`,
          )
        }
      }
    }
    // Declarado, nunca calado: é a diferença entre "não há tipo errado" e "eu não olhei".
    if (semTipo) notas.push(`${c.nome}: ${semTipo} chamada(s) não declaram tipo — não há o que conferir`)
    if (naoResolvidas) notas.push(`${c.nome}: ${naoResolvidas} chamada(s) que o parser NÃO ligou a um tipo (dentro de Promise.all)`)

    console.log(
      `  ✅ ${c.nome.padEnd(38)} ${linhas.length} linha(s) · ${vivas.length} colunas · ${tipados} tipo(s) conferido(s)`,
    )
  }

  // A metade EMBED: a FORMA que o PostgREST devolve, congelada contra o banco.
  await conferirEmbeds()

  if (notas.length) {
    console.log("\n  ℹ️  o que ficou FORA da conferência (não é falha, é alcance):")
    for (const n of notas) console.log(`     · ${n}`)
  }

  if (falhas.length) {
    console.error(`\n❌ ${falhas.length} problema(s) de contrato:`)
    for (const f of falhas) console.error(`   · ${f}`)
    process.exit(1)
  }
  console.log(
    `\n✅ ${chamados.length} RPC(s) e ${embedsConferidos} embed(s) conferidos contra o banco.`,
  )
}

/**
 * Só roda quando chamado direto. Sem isto, importar o módulo num teste dispararia o canário
 * inteiro (inclusive o `process.exit`) durante a suíte.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
}
