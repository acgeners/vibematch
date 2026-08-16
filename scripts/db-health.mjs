#!/usr/bin/env node
/**
 * Os números que decidem quando mudar de fase — e a checagem de que o modelo não regrediu.
 *
 *   npm run db:health
 *
 * ALVO: NUVEM — por construção, não por descuido. A pergunta deste comando é "como está o
 * banco de PRODUÇÃO?", e ele lê pelo endpoint SQL da Management API usando o ref de
 * `.env.supabase-cloud`. Do `.env.local` sai apenas o `SUPABASE_ACCESS_TOKEN`. Os únicos
 * trechos que tocam o LOCAL são as comparações local × nuvem (via `psql`), que existem
 * justamente para achar curadoria feita no banco errado.
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
  const cols = aqui.filter((c) => la.has(c))

  /**
   * Por obra, um TOKEN por coluna: `N` quando nula, senão 8 dígitos do md5 do valor.
   *
   * 🔴 É isto que permite ver a DIREÇÃO da diferença, e a direção é a única coisa que
   * importa aqui. Um md5 da linha inteira só responde "igual ou diferente" — e foi por isso
   * que este check disparou por `art_signal`, uma coluna que a NUVEM tem preenchida em 978
   * obras e o local não. Aquilo é o app trabalhando no lugar certo, não curadoria em risco.
   *
   * Só a nulidade não bastaria: duas colunas preenchidas dos dois lados com valores
   * diferentes são conflito de verdade, e um bitmap de nulos não enxerga isso.
   */
  const expr = cols
    .map((c) => `case when "${c}" is null then 'N' else left(md5("${c}"::text), 8) end`)
    .join(` || '|' || `)
  // Além dos tokens, o carimbo mais RECENTE da linha. Sem ele, uma obra cuja nuvem acabou de
  // regenerar digest/sinopse entra como "conflito" — os dois lados têm valor e diferem — e o
  // alarme volta a misturar rotina com risco. Medido: 3 dos 5 primeiros achados eram isso.
  const colsAt = cols.filter((c) => c.endsWith("_at"))
  const maxAt = colsAt.length
    ? `greatest(${colsAt.map((c) => `coalesce("${c}", 'epoch')`).join(", ")})::text`
    : `''`
  const qtok = `select "id"::text as k, ${maxAt} as m, ${expr} as t from public.works`

  const A = new Map(local(qtok).split("\n").filter(Boolean).map((l) => {
    const [k, m, ...resto] = l.split("|")
    return [k, { at: m, tok: resto }]
  }))
  const B = new Map(
    (await nuvem(qtok)).map((r) => [String(r.k), { at: String(r.m), tok: String(r.t).split("|") }]),
  )

  // ⚠️ A Management API já devolveu página incompleta SEM erro em consulta larga. Conferir
  // o tamanho é barato e evita um "0 divergentes" que seria lido como "está tudo certo".
  if (B.size !== A.size) {
    throw new Error(`a nuvem devolveu ${B.size} obras de ${A.size} — consulta incompleta`)
  }

  const iCap = cols.indexOf("total_chapters")
  const soLocal = []   // dado que existe SÓ no local  → curadoria em risco
  const conflito = []  // preenchido dos dois lados, valores diferentes
  let soNuvem = 0      // a nuvem está à frente → rotina
  let soCapitulo = 0

  for (const [id, ra] of A) {
    const rb = B.get(id)
    if (!rb) continue
    const a = ra.tok
    const b = rb.tok
    const difs = []
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) difs.push(k)
    if (difs.length === 0) continue

    // `total_chapters` sozinho é o agregador de capítulos, não curadoria (ver acima).
    if (difs.length === 1 && difs[0] === iCap) { soCapitulo++; continue }

    const perdeLocal = difs.filter((k) => a[k] !== "N" && b[k] === "N")
    const conflita = difs.filter((k) => a[k] !== "N" && b[k] !== "N" && k !== iCap)

    // Dado que só existe no local é sempre risco — nenhuma data desfaz isso.
    if (perdeLocal.length) soLocal.push({ id, cols: perdeLocal.map((k) => cols[k]) })
    // Os dois lados preenchidos e diferentes: só é conflito se o LOCAL for o mais recente.
    // Nuvem na frente é o app trabalhando onde deve.
    else if (conflita.length && ra.at > rb.at) conflito.push({ id, cols: conflita.map((k) => cols[k]) })
    else soNuvem++
  }

  const emRisco = soLocal.length + conflito.length
  editadas = { emRisco, soLocal, conflito, soNuvem, soCapitulo, cols: cols.length }
  if (emRisco > 0) disparou++
  reporta(
    "obra editada?",
    emRisco ? `${emRisco} obra(s) em risco` : "não",
    emRisco ? 1 : 0,
    emRisco
      ? "dado que só existe no local"
      : soNuvem
        ? `${soNuvem} obra(s) só com a nuvem à frente — rotina`
        : `${cols.length} colunas comparadas, carimbos fora`,
  )
} catch (e) {
  reporta("obra editada?", "não deu para checar", null, String(e.message ?? e).split("\n")[0].slice(0, 60))
}


// ── slug duplicado ─────────────────────────────────────────────────────────────────────
// 🔴 Desde 2026-08-12 os links internos de obra apontam para o SLUG, não para o UUID (PR
// #381) — foi assim que o `redirect()` de `/catalog/[id]` deixou de disparar na navegação
// normal, e com ele o "Rendered more hooks" que estourava o Router do Next.
//
// O preço é esta invariante: **dois títulos que geram o mesmo slug quebram o link em
// silêncio**. `getSlugToIdMap` resolve pelo PRIMEIRO id, então a segunda obra fica
// inalcançável e a primeira aparece no lugar dela — sem erro, sem log, com cara de "abriu a
// obra errada". A rota por UUID se protegia sozinha (`slugMatches.length === 1`); a por slug
// não tem como.
//
// Zero quando o check nasceu (978 obras não-arquivadas), e é justamente por isso que ele
// existe: o que precisa ser pego aqui é a obra que ainda não foi cadastrada.
try {
  const q = `
    select count(*)::int as n from (
      select lower(regexp_replace(regexp_replace(title, '[^a-zA-Z0-9\\s-]', '', 'g'), '\\s+', '-', 'g')) as slug
      from public.works where is_archived = false
      group by 1 having count(*) > 1
    ) x`
  const n = Number((await nuvem(q))[0]?.n ?? 0)
  reporta(
    "slug duplicado",
    n ? `${n} slug(s) repetido(s)` : "0 obras",
    n ? 1 : 0,
    n ? "link por slug leva à obra ERRADA" : "links internos de obra usam slug",
  )
} catch (e) {
  reporta("slug duplicado", "não deu para checar", null, String(e.message ?? e).split("\n")[0].slice(0, 60))
}

// ── obras dividindo o mesmo id externo ─────────────────────────────────────────────────
// `work_external_ids` é o que liga a obra às fontes. Duas obras com o mesmo par
// (source, external_id) fazem reviews e capítulos de UMA serem atribuídos a DUAS — e nada
// reclama, porque o app busca por id e escreve onde mandarem. O sintoma não é erro: é
// avaliação de IA feita sobre reviews da obra errada, ou ficha mostrando 4 reviews numa obra
// que tem 45. Foi exatamente isso em 2026-08-13: `Loved by the Villains` tinha 4 reviews
// enquanto 41 estavam na duplicata arquivada.
//
// 🔴 SÓ o que é acionável ALARMA. Depois da correção sobrou 1 par legítimo — duas entradas da
// MESMA obra, uma já arquivada, dividindo os 7 ids que de fato são dela. Pôr isso no alarme
// faria o db:health gritar para sempre por um estado correto, que é o erro que este arquivo
// evita no check de escrita local e no de `total_chapters`. Então: par com uma arquivada vira
// NOTA; alarme fica para obras distintas com id trocado e para duplicata ainda no catálogo.
//
// ⚠️ A régua entre "é a mesma obra" e "id trocado" é quantas FONTES concordam, nunca o título:
// título alternativo ("Oppa's Friends…" × "My Brother's Friend…") é justamente o que confunde
// o matcher. 7 fontes batendo ⇒ mesma obra; 6 divergindo e 1 batendo ⇒ aquela fonte errou.
//
// ⚠️ `external_id` NULO fica de fora: "não tem id nesta fonte" não é "tem o mesmo id".
// Agrupar os nulos junta todas as obras nunca resolvidas naquela fonte num falso par gigante
// (custou 3 pares reais virarem 7 quando isto foi levantado a primeira vez).
let idsCompartilhados = null
try {
  const q = `
    with vinculos as (
      select source, external_id, work_id from public.work_external_ids
      where external_id is not null and btrim(external_id) <> ''
    ),
    colisoes as (
      select source, external_id, array_agg(distinct work_id order by work_id) as works
      from vinculos group by source, external_id having count(distinct work_id) > 1
    ),
    pares as (select works, count(*)::int as fontes from colisoes group by works),
    classificado as (
      select p.fontes,
             (select count(*) from public.works w where w.id = any(p.works) and w.is_archived) as arquivadas
      from pares p
    )
    select
      count(*) filter (where fontes < 3)::int                          as id_errado,
      count(*) filter (where fontes >= 3 and arquivadas = 0)::int      as duplicata_ativa,
      count(*) filter (where fontes >= 3 and arquivadas > 0)::int      as duplicata_arquivada
    from classificado`
  const r = (await nuvem(q))[0] ?? {}
  idsCompartilhados = {
    idErrado: Number(r.id_errado ?? 0),
    duplicataAtiva: Number(r.duplicata_ativa ?? 0),
    arquivada: Number(r.duplicata_arquivada ?? 0),
  }
  const acionavel = idsCompartilhados.idErrado + idsCompartilhados.duplicataAtiva
  reporta(
    "id repetido",
    acionavel ? `${acionavel} par(es) a resolver` : "0 pares",
    acionavel ? 1 : 0,
    acionavel
      ? "review/capítulo indo pra obra errada"
      : idsCompartilhados.arquivada
        ? `${idsCompartilhados.arquivada} duplicata(s) já arquivada(s) — ok`
        : "cada obra responde só pelos ids dela",
  )
} catch (e) {
  reporta("id repetido", "não deu para checar", null, String(e.message ?? e).split("\n")[0].slice(0, 60))
}

// ── banda dos tiers: código × nuvem × local ────────────────────────────────────────────
//
// 🔴 Este indicador existe por um erro MEDIDO. Em 06/08 a largura da banda foi calibrada e a
// constante do código foi para 0,25; a mensagem do commit anunciava o `UPDATE` junto. Ele
// nunca rodou — em 13/08 os dois bancos ainda tinham 0,5, com `updated_at` de 23/07, duas
// semanas ANTES do commit. E `resolveTierBandWidth` só usa a constante quando o valor é
// ausente (a coluna é NOT NULL), então o valor medido nunca esteve em vigor: o /ranking
// agrupou uma semana na largura que a medição havia reprovado, com a suíte verde.
//
// ⚠️ O esperado é DERIVADO da migration mais recente que define a coluna, nunca escrito aqui:
// uma 4ª cópia do mesmo número é o próprio defeito que este indicador vigia. Mesma fonte que
// `tests/unit/ranking/tier-config.test.ts` usa.
//
// ⚠️ Divergir do esperado NÃO é alarme: a coluna existe para ser ajustada sem deploy, e um
// valor escolhido à mão é decisão de alguém. Alarme é só os DOIS BANCOS discordando entre si,
// que não é escolha de ninguém.
try {
  const dir = path.join(ROOT, "supabase/migrations")
  const doMigration = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((arquivo) => {
      const stmt = fs
        .readFileSync(path.join(dir, arquivo), "utf8")
        .split(";")
        .map((s) => s.replace(/^\s*--.*$/gm, ""))
        .find((s) => /tier_band_width/.test(s) && /\bdefault\s+[\d.]+/i.test(s))
      if (!stmt) return null
      return { num: Number(arquivo.split("_")[0]), valor: Number(/\bdefault\s+([\d.]+)/i.exec(stmt)[1]) }
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num)
    .at(-1)

  const naNuvem = Number((await nuvem("select tier_band_width from formula_config limit 1"))[0]?.tier_band_width)
  const noLocal = Number(local("select tier_band_width from formula_config limit 1"))
  const discordam = naNuvem !== noLocal
  const foraDoEsperado = doMigration && naNuvem !== doMigration.valor

  reporta(
    "banda do tier",
    // Curto de propósito: a coluna tem 22 caracteres e "nuvem X × local Y" a estoura,
    // colando no gráfico de barra. Quem é quem vai na nota.
    discordam ? `${naNuvem} × ${noLocal}` : String(naNuvem),
    discordam ? 1 : 0,
    discordam
      ? "nuvem × local discordam — um deles não recebeu a migration"
      : foraDoEsperado
        ? `⚠️ migration diz ${doMigration.valor}; valor à mão? (o banco vence o código)`
        : "igual à migration vigente",
  )
} catch (e) {
  reporta("banda do tier", "não deu para checar", null, String(e.message ?? e).split("\n")[0].slice(0, 60))
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

if (editadas?.emRisco > 0) {
  console.log(`\n  🔴 ${editadas.emRisco} obra(s) com dado que a nuvem NÃO tem.`)
  if (editadas.soLocal.length) {
    const cols = [...new Set(editadas.soLocal.flatMap((o) => o.cols))].slice(0, 6)
    console.log(`       ${pad(editadas.soLocal.length + " obra(s)", 14)} preenchidas só no local: ${cols.join(", ")}`)
  }
  if (editadas.conflito.length) {
    const cols = [...new Set(editadas.conflito.flatMap((o) => o.cols))].slice(0, 6)
    console.log(`       ${pad(editadas.conflito.length + " obra(s)", 14)} valores diferentes dos dois lados: ${cols.join(", ")}`)
  }
  console.log(`     Isto some no próximo db:pull. Veja quais: \`node scripts/db-diff.mjs works\``)
}

if (idsCompartilhados?.idErrado || idsCompartilhados?.duplicataAtiva) {
  const { idErrado, duplicataAtiva } = idsCompartilhados
  console.log(`\n  🔴 obras dividindo o mesmo id externo:`)
  if (idErrado) {
    console.log(`       ${pad(idErrado + " par(es)", 18)} obras DISTINTAS — uma está com id que não é dela`)
  }
  if (duplicataAtiva) {
    console.log(`       ${pad(duplicataAtiva + " par(es)", 18)} mesma obra DUAS vezes no catálogo, nenhuma arquivada`)
  }
  console.log(`     Reviews e capítulos de uma estão indo para as duas.`)
  console.log(`     Veja quais: \`npx tsx --env-file=.env.local scripts/diag-external-ids-compartilhados.ts\``)
}

// A nuvem estar à frente é o REGIME NORMAL — o app roda contra ela, então artefato novo
// (review_summary, art_signal, digest) nasce lá e o local só o vê no próximo db:pull.
// Vira nota justamente para o alarme acima significar uma coisa só: dado preso no local.
if (editadas?.soNuvem) {
  console.log(`\n  ⓘ  ${editadas.soNuvem} obra(s) em que a NUVEM está à frente — rotina, não é problema.`)
  console.log(`     O app grava na nuvem; o local alcança no próximo \`npm run db:pull\`.`)
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
