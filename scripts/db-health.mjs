#!/usr/bin/env node
/**
 * Os números que decidem quando mudar de fase — e a checagem de que o modelo não regrediu.
 *
 *   npm run db:health
 *
 * ## Por que existe
 *
 * O plano de operação de dados (2026-08-10) tem gatilhos objetivos: egress, tamanho do banco,
 * contas ativas, catálogo. 🔴 **Gatilho que ninguém mede é uma intenção.** Esta base já foi
 * mordida exatamente assim — o CLAUDE.md carregou por dias um status de migration desatualizado
 * que era lido como verdade conferida. Um comando de leitura fácil é o que faz um marco
 * disparar em vez de envelhecer.
 *
 * Custo de rede desprezível: tudo vai pelo endpoint SQL da Management API, que não passa pelo
 * PostgREST — a mesma via do `db:diff`.
 *
 * ⚠️ O egress NÃO é medido aqui: os endpoints de billing da Management API respondem 404 com o
 * token do projeto. Fica como entrada manual, com o caminho impresso — melhor um campo
 * declaradamente vazio do que um número inventado que seria lido como medição.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

/** Limiares do plano. Mudar aqui muda o que o comando chama de "hora de reavaliar". */
const GATILHOS = {
  bancoMb: { alvo: 350, teto: 500, nota: "70% do free tier" },
  contas: { alvo: 5, nota: "contas com estado que doeria perder" },
  obras: { alvo: 1800, nota: "≈350 MB de banco" },
  egressGb: { alvo: 3, teto: 5, nota: "60% da quota, em 2 ciclos seguidos" },
}

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

// O ref sai de `.env.supabase-cloud`, nunca do `.env.local`: este alterna com db:local/db:cloud
// e ainda carrega uma URL COMENTADA de um projeto morto (Ohio) que um regex ingênuo encontra.
const TOKEN = env(".env.local").SUPABASE_ACCESS_TOKEN
const REF = (env(".env.supabase-cloud").NEXT_PUBLIC_SUPABASE_URL ?? "").match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/,
)?.[1]
if (!TOKEN || !REF) {
  console.error("faltam SUPABASE_ACCESS_TOKEN (.env.local) ou a URL da nuvem (.env.supabase-cloud)")
  process.exit(1)
}

async function nuvem(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

function local(sql) {
  return execFileSync("psql", [LOCAL_URL, "-At", "-c", sql], { encoding: "utf8" }).trim()
}

const barra = (frac) => {
  const n = Math.max(0, Math.min(10, Math.round(frac * 10)))
  return "▓".repeat(n) + "░".repeat(10 - n)
}
const estado = (frac) => (frac >= 1 ? "DISPAROU" : frac >= 0.8 ? "perto" : "ok")
const pad = (s, n) => String(s).padEnd(n)

const linhas = []
let disparou = 0

function reporta(rotulo, valorTexto, frac, nota) {
  const st = frac == null ? "—" : estado(frac)
  if (st === "DISPAROU") disparou++
  linhas.push(
    "  " + pad(rotulo, 16) + pad(valorTexto, 22) +
      (frac == null ? pad("", 13) : pad(barra(frac), 13)) + pad(st, 10) + (nota ?? ""),
  )
}

console.log(`\nnuvem: ${REF}\n`)

// ── 1. tamanho do banco ────────────────────────────────────────────────────────────────
// ⚠️ SOMA de todos os bancos, não `current_database()`. A 1ª versão media só o `postgres` e
// dava 189 MB contra os 213 MB do painel — **11% a menos**, num indicador cujo gatilho está a
// 350 MB. Os `template0`/`template1` somam ~15 MB, e o painel ainda conta uns 9 MB de overhead
// (WAL) que não aparecem por SQL nenhum. Subestimar aqui atrasa o alarme, que é o pior lado.
const mb = Number((await nuvem("select sum(pg_database_size(datname)) as b from pg_database"))[0].b) / 1048576
reporta("banco", `${mb.toFixed(0)} MB / ${GATILHOS.bancoMb.teto} MB`, mb / GATILHOS.bancoMb.alvo,
  `${GATILHOS.bancoMb.nota} · o painel mostra ~5% a mais`)

// ── 2. contas ──────────────────────────────────────────────────────────────────────────
const contas = Number(
  (await nuvem("select count(*) as n from auth.users where last_sign_in_at > now() - interval '30 days'"))[0].n,
)
reporta("contas ativas", `${contas} / ${GATILHOS.contas.alvo}`, contas / GATILHOS.contas.alvo,
  "ativas nos últimos 30 dias")

// ── 3. catálogo ────────────────────────────────────────────────────────────────────────
const obras = Number((await nuvem("select count(*) as n from public.works"))[0].n)
reporta("obras", `${obras} / ${GATILHOS.obras.alvo}`, obras / GATILHOS.obras.alvo, GATILHOS.obras.nota)

// ── 4. egress ──────────────────────────────────────────────────────────────────────────
reporta("egress", "— informe à mão", null, `veja Reports → Usage · gatilho: ${GATILHOS.egressGb.alvo} GB`)

/**
 * ── 5. o local voltou a ser fonte de verdade? ──────────────────────────────────────────
 *
 * 🔴 A linha que importa mais que todas as quotas. As outras quatro degradam devagar e avisam;
 * esta acontece numa tarde de curadoria no banco errado, e o trabalho some no `db:pull`
 * seguinte sem nada acusar.
 *
 * 🔴 O corte é a última RECONCILIAÇÃO, não o último `db:pull` — e a diferença não é teórica.
 * A 1ª versão usava só o `pull-*` e acusou 981 works + 1.333 work_tags de escrita local
 * "suspeita": era a curadoria de 11 dias que o push de 2026-08-10 já tinha levado para a nuvem.
 * Um alarme que nasce tocando é um alarme que ninguém vai ler.
 *
 * Então o corte é o MAIS RECENTE entre `pull-*` (nuvem → local) e `push-*` (local → nuvem):
 * qualquer um dos dois deixa os lados alinhados. O nome do diretório É a data, sem bookkeeping
 * paralelo para dessincronizar. Com o push aposentado, isto converge naturalmente para o pull.
 *
 * ⚠️ Conta ESCRITA no local depois do corte, não divergência de conteúdo. Comparar valor daria
 * alarme permanente por causa dos carimbos que cada lado gera sozinho — `chapters_checked_at`,
 * `adult_score_tier_reviewed_at`, `updated_at` — e alarme que sempre toca é alarme ignorado.
 */
/**
 * 🔴 Dois níveis, porque `works.updated_at` NÃO distingue curadoria de navegação.
 *
 * Medido ao construir isto: uma única visita à home com o app apontado pro local escreveu **27
 * linhas** de `works`. É o `persistReadingDates` cacheando `chapters_checked_at` e as datas de
 * capítulo — dado derivado de fonte externa, que ambos os lados regeneram sozinhos. Alarmar
 * nisso faria o comando gritar toda vez que alguém abrisse o app no local, e um alarme que
 * sempre toca deixa de ser lido — exatamente o que este check existe para evitar.
 *
 * Então: ALARME só para escrita que apenas a curadoria produz. `works` entra pela CRIAÇÃO
 * (obra nova nasceu no lugar errado), não pela atualização.
 *
 * ⚠️ Contagem sozinha NÃO pega EDIÇÃO de obra que já existe (trocar sinopse, título, capa):
 * não nasce linha nova, e `works.updated_at` está fora do alarme pelo motivo acima. Por isso
 * existe a checagem 5b, que compara CONTEÚDO — sem ela, o caminho mais provável de curadoria
 * no banco errado ficaria invisível, já que o catálogo está construído e hoje quase toda
 * curadoria é edição, não criação.
 */
const CURADORIA = [
  ["works", "created_at", "obra nova criada no local"],
  ["category_scores", "created_at", "nota de atributo"],
  ["ai_evaluations", "created_at", "avaliação de IA (paga)"],
  ["work_tags", "created_at", "tag de obra"],
]

/** Escrita que navegar sozinho produz — informativa, nunca alarme. */
const NAVEGACAO = [["works", "updated_at", "inclui o cache de capítulos (só navegar já escreve)"]]

let escritaLocal = null
try {
  const dir = path.join(ROOT, ".backups")
  const marcos = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    // `pull-` traz a nuvem pro local; `push-`/`push-curation-` levam o local pra nuvem. Os dois
    // alinham os lados, então o corte é o mais RECENTE de qualquer um deles.
    // ⚠️ `push-curation` ANTES de `push` na alternância: regex casa a primeira que serve, e
    // com `push` na frente o prefixo removido é só `push-`, deixando `curation-2026-…` como
    // se fosse a data. O erro vira um timestamp inválido no SQL e o fail-soft o esconde.
    .filter((d) => /^(?:push-curation|pull|push)-\d{4}-\d{2}-\d{2}T/.test(d))
    .map((d) => d.replace(/^(?:push-curation|pull|push)-/, ""))
    .sort()
  if (!marcos.length) throw new Error("sem pull-*/push-* em .backups para servir de corte")
  const corte = marcos[marcos.length - 1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "T$1:$2:$3.$4Z",
  )

  const consulta = (lista) =>
    local(
      lista
        .map(([t, col], i) =>
          `select ${i} as i, count(*) as n from public.${t} where ${col} > '${corte}'::timestamptz`,
        )
        .join(" union all "),
    )
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("|"))
      .filter(([, n]) => Number(n) > 0)
      .map(([i, n]) => ({ ...{ tabela: lista[Number(i)][0], nota: lista[Number(i)][2] }, n: Number(n) }))

  escritaLocal = { corte, achados: consulta(CURADORIA), navegacao: consulta(NAVEGACAO) }
} catch (e) {
  escritaLocal = { erro: String(e.message ?? e).split("\n")[0].slice(0, 70) }
}

if (escritaLocal.erro) {
  reporta("local escreveu?", "não deu para checar", null, escritaLocal.erro)
} else if (!escritaLocal.achados.length) {
  reporta("local escreveu?", "não", 0, `desde ${escritaLocal.corte.slice(0, 10)}`)
} else {
  disparou++
  reporta("local escreveu?", "SIM — veja abaixo", 1, `desde ${escritaLocal.corte.slice(0, 10)}`)
}

/**
 * ── 5b. EDIÇÃO de obra que já existe ───────────────────────────────────────────────────
 *
 * Compara o conteúdo de `works` nos dois lados, coluna a coluna, **excluindo apenas os
 * carimbos e caches que cada lado escreve sozinho**. O que sobrar divergindo é edição de
 * verdade — a forma de curadoria que a contagem por `created_at` não enxerga.
 *
 * 🔴 A lista é de EXCLUSÃO, nunca de inclusão. Coluna nova entra na comparação sozinha, e o
 * erro cai para o lado seguro (alarme a mais, nunca a menos). Uma lista de inclusão silencia
 * exatamente o campo que ninguém lembrou de acrescentar — foi assim que o `db:diff` passou
 * seis dias cego.
 *
 * Cada exclusão tem motivo MEDIDO em 2026-08-10, não suposto:
 *   updated_at ................. trigger BEFORE UPDATE reescreve no destino, sempre
 *   chapters_checked_at ........ 27 linhas: cache do `persistReadingDates`, só navegar escreve
 *   last_chapter_released_at ... 24 linhas: idem
 *   next_chapter_predicted_at ...  6 linhas: idem
 *   ai_eval_status ............. 1 linha: `trg_enforce_work_ai_eval_pending_reality`, e nesse
 *                                caso a NUVEM é a correta (tinha avaliação que o local não tem)
 *
 * ⚠️ `total_chapters` é o caso de fronteira e ganha tratamento PRÓPRIO. Ele é material (entra
 * no recalc da Nota Prevista) mas quem o move é o agregador de capítulos, por navegação — na
 * prática, 1 obra de ruído medida hoje (55 × 54, que se auto-corrige na próxima leitura).
 * Deixá-lo no alarme faria o comando disparar por rotina; tirá-lo esconderia divergência que
 * move nota. Então a comparação roda DUAS vezes, e a diferença entre elas isola exatamente as
 * obras que divergem só em capítulo. Alarme para o resto, nota informativa para essas.
 */
const WORKS_IGNORAR = [
  "updated_at",
  "chapters_checked_at",
  "last_chapter_released_at",
  "next_chapter_predicted_at",
  "ai_eval_status",
]

/** Material, mas mexido por navegação — contado à parte (ver acima). */
const WORKS_SO_CAPITULO = ["total_chapters"]

let editadas = null
try {
  const qcols = `select column_name from information_schema.columns
                 where table_schema='public' and table_name='works'
                 and column_name not in (${WORKS_IGNORAR.map((c) => `'${c}'`).join(",")})
                 order by column_name`
  const aqui = local(qcols).split("\n").filter(Boolean)
  const la = new Set((await nuvem(qcols)).map((r) => r.column_name))
  const todas = aqui.filter((c) => la.has(c))
  const estruturais = todas.filter((c) => !WORKS_SO_CAPITULO.includes(c))

  /** Ids cujo conteúdo diverge, para um conjunto de colunas. */
  async function divergentes(cols) {
    const expr = cols.map((c) => `coalesce("${c}"::text, chr(1))`).join(" || chr(2) || ")
    const q = `select "id"::text as k, md5(${expr}) as h from public.works`
    const A = new Map(local(q).split("\n").filter(Boolean).map((l) => l.split("|")))
    const B = new Map((await nuvem(q)).map((r) => [String(r.k), r.h]))
    return new Set([...A.keys()].filter((k) => B.has(k) && B.get(k) !== A.get(k)))
  }

  const comCap = await divergentes(todas)
  const semCap = await divergentes(estruturais)
  // Diverge com `total_chapters` mas não sem ele ⇒ o capítulo é a única diferença.
  const soCapitulo = [...comCap].filter((id) => !semCap.has(id)).length

  editadas = { n: semCap.size, soCapitulo, cols: estruturais.length }
  if (semCap.size > 0) disparou++
  reporta(
    "obra editada?",
    semCap.size ? `${semCap.size} obra(s) divergem` : "não",
    semCap.size ? 1 : 0,
    `${estruturais.length} colunas comparadas, carimbos fora`,
  )
} catch (e) {
  reporta("obra editada?", "não deu para checar", null, String(e.message ?? e).split("\n")[0].slice(0, 60))
}

// ── saída ──────────────────────────────────────────────────────────────────────────────
console.log("  " + pad("indicador", 16) + pad("valor", 22) + pad("", 13) + "estado")
console.log("  " + "─".repeat(62))
for (const l of linhas) console.log(l)

if (escritaLocal.achados?.length) {
  console.log(`\n  🔴 CURADORIA feita no banco local depois de ${escritaLocal.corte.slice(0, 10)}:`)
  for (const a of escritaLocal.achados) {
    console.log(`       ${pad(a.tabela, 18)} ${pad(a.n + " linha(s)", 14)} ${a.nota}`)
  }
  console.log(`     A nuvem é a fonte de verdade — isto some no próximo db:pull.`)
  console.log(`     Confira o alvo do app com \`npm run db:target\`.`)
}

if (editadas?.n > 0) {
  console.log(`\n  🔴 ${editadas.n} obra(s) com CONTEÚDO diferente entre local e nuvem.`)
  console.log(`     Carimbos e caches já estão fora da comparação, então isto é edição de verdade.`)
  console.log(`     Veja quais: \`node scripts/db-diff.mjs works\``)
}

if (escritaLocal.navegacao?.length || editadas?.soCapitulo) {
  console.log(`\n  ⓘ  escrita não-curatorial no local (esperada, não é problema):`)
  for (const a of escritaLocal.navegacao ?? []) {
    console.log(`       ${pad(a.tabela, 18)} ${pad(a.n + " linha(s)", 14)} ${a.nota}`)
  }
  if (editadas?.soCapitulo) {
    console.log(
      `       ${pad("total_chapters", 18)} ${pad(editadas.soCapitulo + " obra(s)", 14)}` +
        ` agregador de capítulos; auto-corrige na próxima leitura`,
    )
  }
}

console.log(
  disparou === 0
    ? `\n  → Fase 0 (banco único). Nenhum gatilho disparado.\n`
    : `\n  → ${disparou} gatilho(s) disparado(s). Hora de reavaliar a fase — veja o plano.\n`,
)
