#!/usr/bin/env node
/**
 * Empurra a CURADORIA feita no banco local para a nuvem — "Atualizar dados" + avaliação IA
 * + estado de leitura + as saídas do recalc.
 *
 *   node scripts/db-push-curation.mjs --dry-run            → ensaio contra a nuvem (roda tudo e dá ROLLBACK)
 *   node scripts/db-push-curation.mjs --target=<pg-url>    → ensaio contra banco descartável (commita)
 *   node scripts/db-push-curation.mjs --yes                → grava na NUVEM
 *
 *   --since=<iso>   sobrescreve o corte (default: o `.backups/pull-*` mais recente)
 *
 * IRMÃO de `db-push-evals.mjs`, que cobre só a avaliação. Este cobre a superfície inteira,
 * medida com `db-table-fingerprint.mjs` num piloto real (2 obras) — não deduzida do código.
 * Foi assim que apareceram `work_processing_jobs`, `ai_cache_events` e o fato de
 * `canonical_synopsis` ser um artefato pago próprio; nenhum dos três estava no mapa lido.
 * Em 2026-07-30 uma verificação de edição manual achou mais quatro fora do mapa:
 * `work_external_reviews_manual` (reviews digitadas à mão — perda irrecuperável),
 * `taste_profile` + `synopsis_quality_predictions` (artefatos pagos, FK entre elas) e
 * `work_cover_archive` (arquivar/restaurar capa não viajava).
 *
 * ⚠️ Limite conhecido: DELETE puro sem rastro (ex.: apagar uma review manual sem tocar em
 * mais nada da obra) não entra no escopo — não há timestamp que o denuncie. Se a obra for
 * tocada por qualquer outro motivo, o conjunto inteiro viaja e o delete vai junto.
 *
 * ⚠️ Escreve em PRODUÇÃO com --yes. Tudo numa ÚNICA transação: entra inteiro ou nada.
 *
 * PREMISSA que torna isto seguro: enquanto a nuvem está restrita (402) ninguém escreve nela,
 * então não existe divergência a resolver — é merge de mão única. Se a nuvem voltar a receber
 * escrita ANTES do push, esta premissa cai e o script passa a poder sobrescrever trabalho.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const args = process.argv.slice(2)
const DRY = args.includes("--dry-run")
const YES = args.includes("--yes")
// `--synopses` só LÊ os dois lados e imprime a comparação — não exige --yes.
const SYNOPSES_ONLY = args.includes("--synopses")
const targetArg = args.find((a) => a.startsWith("--target="))?.slice("--target=".length)
const sinceArg = args.find((a) => a.startsWith("--since="))?.slice("--since=".length)

const parseEnv = (file) => {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}
const die = (msg) => {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

const env = parseEnv(path.join(ROOT, ".env.local"))
const snapshot = parseEnv(path.join(ROOT, ".env.supabase-cloud"))

// ── origem: o Postgres local do `supabase start` ────────────────────────────────────────
const SOURCE = (() => {
  try {
    const raw = execFileSync("supabase", ["--workdir", ROOT, "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return raw.match(/^DB_URL="(.+)"$/m)?.[1] ?? die("`supabase status` não trouxe DB_URL")
  } catch {
    return die("`supabase status` falhou — o stack local está de pé?")
  }
})()

// ── destino ─────────────────────────────────────────────────────────────────────────────
let TARGET, targetLabel
if (targetArg) {
  TARGET = targetArg
  targetLabel = `ENSAIO ${targetArg.replace(/:[^:@]+@/, ":***@")}`
} else {
  const password = env.SUPABASE_DB_PASSWORD
  if (!password) die("falta SUPABASE_DB_PASSWORD no .env.local")
  const cloudUrl = snapshot.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ""
  const ref = cloudUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (!ref) die(`não consegui extrair o project ref de "${cloudUrl}"`)
  TARGET = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`
  targetLabel = `NUVEM db.${ref}.supabase.co`
  if (!DRY && !YES && !SYNOPSES_ONLY) {
    die(
      "escrever na NUVEM exige --yes explícito.\n" +
        "  Ensaie primeiro:  node scripts/db-push-curation.mjs --dry-run",
    )
  }
}
if (TARGET === SOURCE) die("origem e destino são o mesmo banco")

const psql = (url, sql) =>
  execFileSync("psql", [url, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  }).trim()
const lines = (out) => out.split("\n").filter(Boolean)

// ── corte: quando o banco local nasceu ──────────────────────────────────────────────────
// Tudo mais novo que isto foi feito no local. O nome do diretório do `db:pull` É o carimbo —
// sem bookkeeping paralelo pra dessincronizar.
const cutoff = (() => {
  if (sinceArg) return sinceArg
  const dir = path.join(ROOT, ".backups")
  const pulls = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => d.startsWith("pull-")).sort() : []
  if (!pulls.length) die("não achei nenhum `.backups/pull-*` — passe --since=<iso> na mão")
  const stamp = pulls[pulls.length - 1].slice("pull-".length)
  // pull-2026-07-30T00-31-49-679Z → 2026-07-30T00:31:49.679Z
  return stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z")
})()

console.log(`origem : LOCAL  ${SOURCE.replace(/:[^:@]+@/, ":***@")}`)
console.log(`destino: ${targetLabel}`)
console.log(`corte  : ${cutoff}  (tudo mais novo nasceu no local)`)
console.log(`modo   : ${DRY ? "ENSAIO (rollback no fim)" : "GRAVANDO (commit)"}`)

try { psql(SOURCE, "select 1") } catch { die("não conectei no Postgres local") }
try { psql(TARGET, "select 1") } catch (e) {
  die(`não conectei no destino:\n  ${String(e.stderr || e.message).trim().split("\n")[0]}`)
}

// ── 1. escopo: quais obras foram tocadas no local ───────────────────────────────────────
// União de TODAS as tabelas que o piloto mostrou que mudam. Uma obra pode ter mudado só o
// estado de leitura (sem `works.updated_at` mexer), então olhar só `works` perderia obra.
const scopeSql = `
  select distinct id from (
    select id                from public.works                 where updated_at  > '${cutoff}'::timestamptz
    union select work_id     from public.user_work_state       where updated_at  > '${cutoff}'::timestamptz
    union select work_id     from public.work_tags             where created_at  > '${cutoff}'::timestamptz
    union select work_id     from public.work_reviews          where fetched_at  > '${cutoff}'::timestamptz
    union select work_id     from public.ai_evaluations        where created_at  > '${cutoff}'::timestamptz
    union select work_id     from public.work_processing_jobs  where created_at  > '${cutoff}'::timestamptz
    union select work_id     from public.ai_cache_events       where created_at  > '${cutoff}'::timestamptz
    union select work_id     from public.work_covers                  where created_at   > '${cutoff}'::timestamptz
    union select work_id     from public.work_cover_archive           where archived_at  > '${cutoff}'::timestamptz
    union select work_id     from public.work_external_reviews_manual where updated_at   > '${cutoff}'::timestamptz
    union select work_id     from public.synopsis_quality_predictions where predicted_at > '${cutoff}'::timestamptz
  ) t where id is not null`
const workIds = lines(psql(SOURCE, scopeSql))
if (!workIds.length) {
  console.log(`\n✓ nada a empurrar — nenhuma obra mudou no local desde o corte.`)
  process.exit(0)
}
const idArray = `'{${workIds.join(",")}}'::uuid[]`
console.log(`\nescopo: ${workIds.length} obra(s) tocada(s) no local`)
for (const id of workIds.slice(0, 12)) {
  console.log(`   • ${psql(SOURCE, `select title from public.works where id='${id}'`)}`)
}
if (workIds.length > 12) console.log(`   … +${workIds.length - 12}`)

// ── 2. as obras têm de existir no destino ───────────────────────────────────────────────
const presentInTarget = new Set(lines(psql(TARGET, `select id from public.works where id = any(${idArray})`)))
const missing = workIds.filter((id) => !presentInTarget.has(id))
if (missing.length) {
  console.error(`\n✗ ${missing.length} obra(s) não existe(m) no destino — criadas localmente:`)
  for (const id of missing.slice(0, 10)) {
    console.error(`   • ${id}  ${psql(SOURCE, `select title from public.works where id='${id}'`)}`)
  }
  die("criar obra é outro fluxo. Este script só sincroniza obra que já existe nos dois lados.")
}

// ── 3. guarda de TAGS ───────────────────────────────────────────────────────────────────
// O local é cópia byte a byte da nuvem, então toda tag pré-existente tem uuid IDÊNTICO dos
// dois lados — não há o que remapear. Tag nova só nasce de `upsertExternalTags`, e aí o
// uuid local viaja junto no insert. O ÚNICO caso que exigiria remap é o mesmo slug existir
// no destino com outro uuid — impossível com a nuvem congelada. Se acontecer, ABORTA: é
// sinal de que alguém escreveu na nuvem e a premissa do script caiu.
const newTags = Number(psql(SOURCE, `select count(*) from public.tags where created_at > '${cutoff}'::timestamptz`))
if (newTags > 0) {
  const collide = lines(
    psql(
      SOURCE,
      `select slug from public.tags where created_at > '${cutoff}'::timestamptz order by slug`,
    ),
  )
  const targetBySlug = new Map(
    lines(psql(TARGET, `select slug || E'\\t' || id from public.tags`)).map((l) => l.split("\t")),
  )
  const bad = []
  for (const slug of collide) {
    const localId = psql(SOURCE, `select id from public.tags where slug = '${slug.replace(/'/g, "''")}'`)
    const remoteId = targetBySlug.get(slug)
    if (remoteId && remoteId !== localId) bad.push({ slug, localId, remoteId })
  }
  if (bad.length) {
    console.error(`\n✗ ${bad.length} tag(s) com o MESMO slug e uuid DIFERENTE no destino:`)
    for (const b of bad) console.error(`   • ${b.slug}  local ${b.localId}  destino ${b.remoteId}`)
    die("isto só acontece se a nuvem recebeu escrita depois do db:pull — a premissa do script caiu.")
  }
  console.log(`\ntags novas no local: ${newTags} (nenhuma colide por slug — uuid viaja junto, sem remap)`)
} else {
  console.log(`\ntags novas no local: 0 — a classe inteira de risco de remap está ausente nesta rodada`)
}

// ── 3b. `--synopses`: comparar as sinopses canônicas e SAIR ─────────────────────────────
// A sinopse canônica é o único item do push que exige julgamento humano: ela foi REGENERADA
// na curadoria e a regeneração pode PIORAR o texto. O app mostra só a versão local (card
// "Sinopses" da página da obra), então a comparação com a nuvem tem de vir daqui.
if (SYNOPSES_ONLY) {
  const wrap = (s, w = 96) =>
    (s ?? "(vazia)")
      .replace(/\s+/g, " ")
      .trim()
      .replace(new RegExp(`(.{1,${w}})(\\s|$)`, "g"), "$1\n")
      .trimEnd()
      .split("\n")
  const rows = lines(
    psql(SOURCE, `select id || E'\\t' || title from public.works where id = any(${idArray}) order by title`),
  ).map((l) => l.split("\t"))

  let differ = 0
  for (const [id, title] of rows) {
    const here = psql(SOURCE, `select coalesce(canonical_synopsis,'') from public.works where id='${id}'`)
    const there = psql(TARGET, `select coalesce(canonical_synopsis,'') from public.works where id='${id}'`)
    if (here === there) continue
    differ++
    console.log(`\n${"─".repeat(100)}\n${title}`)
    console.log(`\n  DESTINO (será substituída):`)
    for (const l of wrap(there)) console.log(`    ${l}`)
    console.log(`\n  LOCAL (vai entrar):`)
    for (const l of wrap(here)) console.log(`    ${l}`)
  }
  console.log(`\n${"─".repeat(100)}`)
  console.log(`${differ} de ${rows.length} obra(s) com sinopse canônica diferente.`)
  if (differ) {
    console.log(`\nSe alguma versão LOCAL ficou pior, conserte no app ANTES do push — depois é tarde:`)
    console.log(`a sinopse viaja com o inputs_hash, e com o hash novo o app considera que está em dia`)
    console.log(`e nunca mais regenera.`)
  }
  process.exit(0)
}

// ── 4. colunas ──────────────────────────────────────────────────────────────────────────
const colsOf = (url, table) =>
  lines(
    psql(
      url,
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='${table}'
         and is_generated='NEVER' and is_identity='NO'
       order by ordinal_position`,
    ),
  )
// Interseção origem∩destino: protege contra drift de schema (o local é cópia, mas se um dia
// não for, é melhor deixar coluna de fora do que estourar no meio da transação).
const cols = (table) => {
  const there = new Set(colsOf(TARGET, table))
  return colsOf(SOURCE, table).filter((c) => there.has(c))
}

const maxCall = psql(TARGET, "select coalesce(max(created_at)::text, '-infinity') from public.ai_api_calls")
const upsertSet = (table, keys) =>
  cols(table)
    .filter((c) => !keys.includes(c) && c !== "id")
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ")

// ── Dono do push ────────────────────────────────────────────────────────────────────────
// 🔴 As tabelas per-usuário são recortadas ao CURADOR. Sem isto o push é escrita cruzada:
// as tabelas com `user_id` NÃO TÊM FK (conferido em information_schema), então linha de
// usuário que só existe no local entra na nuvem em silêncio e fica órfã pra sempre — e o
// upsert de `user_work_state`/`user_calculated_scores` sobrescreve o dado de leitor REAL.
//
// Medido em 2026-08-10, antes do filtro: o local tinha 7 donos em `user_calculated_scores`
// e 3 em `user_work_state`; a nuvem, 2 e 1. O push levaria 5 contas fantasma (incluindo
// uma chamada "Aceite Teste") pra dentro da nuvem, órfãs pra sempre.
//
// ⚠️ CORREÇÃO do que este comentário dizia antes: eu havia escrito que o push sobrescreveria
// "o dado do leitor REAL". Não há terceiro — as DUAS contas da nuvem são da dona do projeto
// (a segunda tem papel `leitor` e serve pra conferir a experiência de leitor). Foi inferência
// a partir do papel no banco, não medição. O recorte continua certo, mas como PREPARAÇÃO
// pra quando houver usuário de verdade, não como remediação de dano ativo.
//
// ⚠️ O comentário de `user_work_state` dizia "entra porque a nuvem está congelada: não há
// versão concorrente pra perder". Essa premissa EXPIROU — há leitor com login em 05/08.
// Premissa de script envelhece e nada avisa.
const CURADORES = psql(
  SOURCE,
  "select current_user_id from public.user_settings where role = 'curador'",
)
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)

if (CURADORES.length !== 1) {
  console.error(
    `\n✗ esperava EXATAMENTE 1 curador na origem, achei ${CURADORES.length}.` +
      `\n  O recorte per-usuário depende disso. Resolva em user_settings.role antes de empurrar.` +
      (CURADORES.length ? `\n  encontrados: ${CURADORES.join(", ")}` : ""),
  )
  process.exit(1)
}
const CURADOR = CURADORES[0]
/** Recorte per-usuário. Só nas tabelas cujo insert SOBRESCREVE (upsert) ou cria linha de
 *  dono — os logs append-only (`ai_api_calls`, `ai_cache_events`) ficam de fora de
 *  propósito: são `on conflict do nothing`, não destroem nada, e recortá-los perderia
 *  registro de custo legítimo. */
const soDoCurador = (col = "user_id") => `${col} = '${CURADOR}'::uuid`
console.log(`curador do push: ${CURADOR}`)

/** Os `alignment_run` que `calculated_scores` referencia. Sem eles a transação aborta em
 *  `calculated_scores_alignment_run_id_fkey` — foi o que fez o push NUNCA completar até
 *  2026-08-10. O `where` das demais tabelas é incremental por TEMPO, mas o grafo de FK exige
 *  FECHAMENTO: os 19 runs apontavam pra 6 taste_profile (1 ausente na nuvem) e 6
 *  ai_api_calls (5 ausentes), e nenhum viajava. */
const runsNecessarios = `(select distinct alignment_run_id from public.calculated_scores where alignment_run_id is not null)`

/** Os runs que ESTE push carrega: o histórico do curador desde o último pull, MAIS os que a
 *  FK exige (que podem ser mais antigos que o cutoff).
 *
 *  🔴 Fechamento e escopo têm que sair do MESMO fragmento. Se `recommendation_runs` levar o
 *  histórico e os pais (`taste_profile`, `ai_api_calls`) continuarem fechados só sobre
 *  `runsNecessarios`, o erro de FK volta — só que nos runs novos. Ampliar escopo aqui obriga
 *  a ampliar o fechamento junto, e é por isso que os três consomem esta constante.
 *
 *  ⚠️ NÃO usa o `cutoff`, ao contrário das outras tabelas. A premissa do cutoff é "mais
 *  antigo que o último pull já está na nuvem, porque o pull trouxe de lá" — e ela é FALSA
 *  aqui, porque esta tabela nunca esteve no PLAN. Medido em 2026-08-10: cutoff 30/07, runs
 *  do curador de 20/05 a 08/08, e a nuvem tinha 1 run contra 25 no local. Filtrar por tempo
 *  deixaria 6 pra trás pra sempre.
 *
 *  ⚠️ `recommendation_runs.list_id` → `work_lists`, que NÃO está no PLAN. Medido em
 *  2026-08-10: dos 25 runs do curador, ZERO tem `list_id`, então não há o que fechar hoje.
 *  Se um dia aparecer run com lista, este push volta a abortar — e o conserto é somar
 *  `work_lists` ao PLAN, não remover a coluna do escopo. */
const runsDoPush = `(select id from public.recommendation_runs
    where ${soDoCurador()} or id in ${runsNecessarios})`

// Ordem = ordem de FK. `tags` antes de `work_tags`; `ai_evaluations` antes de
// `category_scores` (que a referencia com NO ACTION).
const PLAN = [
  {
    table: "tags",
    where: `created_at > '${cutoff}'::timestamptz`,
    atLeast: true,
    insert: (c) => `insert into public.tags (${c})
      select ${c} from stage_tags s
      where not exists (select 1 from public.tags t where t.slug = s.slug)
      on conflict do nothing`,
  },
  {
    // Curadoria de tags: a que sub-grupo cada tag pertence. É CATÁLOGO (sem `user_id`,
    // compartilhado), escrito só pela curadoria — que roda no local. Ficava fora do push sem
    // decisão registrada; medido em 2026-08-10: 4 linhas presas no local, 0 só na nuvem.
    //
    // 🔴 O alvo do conflito é `tag_id`, NÃO `id`. A tabela tem PK em `id` e UNIQUE em
    // `tag_id`: se a mesma tag receber ids diferentes nos dois bancos, o upsert por `id`
    // insere e VIOLA o unique — erro no meio do push, com metade do PLAN aplicada. Hoje as
    // duas chaves coincidem (2831 ids e 2831 tag_ids em comum, ZERO divergindo), mas isso é
    // estado, não garantia: basta uma linha recriada de um lado. Mesma armadilha de chave
    // surrogate que já deu falso positivo em `platform_ratings`.
    //
    // Sem recorte por tempo de propósito: `status`/`applied_at` mudam por UPDATE, sem tocar
    // `created_at` — um `where created_at > cutoff` deixaria a revisão de tag antiga pra trás.
    // São 2.835 linhas, o conjunto inteiro é barato.
    table: "tag_subgroup_assignment",
    where: "true",
    insert: (c) => `insert into public.tag_subgroup_assignment (${c})
      select ${c} from stage_tag_subgroup_assignment
      on conflict (tag_id) do update set ${upsertSet("tag_subgroup_assignment", ["tag_id"])}`,
  },
  {
    table: "ai_api_calls",
    // Log append-only: NÃO recortado por usuário de propósito (`on conflict do nothing`,
    // não sobrescreve nada, e filtrar perderia registro de custo legítimo).
    where: `created_at > '${maxCall}'::timestamptz
      or id in (select ai_api_call_id from public.recommendation_runs
                where id in ${runsDoPush} and ai_api_call_id is not null)`,
    atLeast: true,
    insert: (c) => `insert into public.ai_api_calls (${c}) select ${c} from stage_ai_api_calls on conflict do nothing`,
  },
  {
    // Perfil de gosto — regenerado no local é artefato PAGO, e as previsões de Interesse
    // apontam pra ele por FK (então entra ANTES delas). O índice parcial
    // uniq_taste_profile_current_per_user aceita UM is_current por usuário: o `pre`
    // despromove o atual da nuvem antes do insert (idempotente: exclui o próprio id,
    // então re-push do mesmo perfil não despromove ninguém à toa).
    table: "taste_profile",
    where: `(created_at > '${cutoff}'::timestamptz
        or id in (select taste_profile_id from public.recommendation_runs where id in ${runsDoPush}))
      and ${soDoCurador()}`,
    atLeast: true,
    pre: `update public.taste_profile t set is_current = false
      where t.is_current and exists (
        select 1 from stage_taste_profile s
        where s.user_id = t.user_id and s.is_current and s.id <> t.id);`,
    insert: (c) => `insert into public.taste_profile (${c}) select ${c} from stage_taste_profile on conflict do nothing`,
  },
  {
    // Previsões de Interesse (pagas). CONJUNTO por obra: re-predição reescreve a linha
    // in-place (chave natural work_id+prompt_version) e o flip de `stale` também tem de
    // viajar — um insert-if-missing deixaria os dois pra trás. Folha nas FKs.
    table: "synopsis_quality_predictions",
    where: `work_id = any(${idArray})`,
    pre: `delete from public.synopsis_quality_predictions where work_id = any(${idArray});`,
    insert: (c) =>
      `insert into public.synopsis_quality_predictions (${c}) select ${c} from stage_synopsis_quality_predictions on conflict do nothing`,
  },
  {
    table: "ai_evaluations",
    where: `work_id = any(${idArray})`,
    insert: (c) => `insert into public.ai_evaluations (${c}) select ${c} from stage_ai_evaluations on conflict do nothing`,
  },
  {
    // 🔴 UPSERT por `id`, não `do nothing`. Com `do nothing`, EDIÇÃO IN-PLACE de linha
    // preexistente nunca propaga: o id já existe no destino (veio do mesmo `db:pull`), então
    // o insert é pulado em silêncio. Medido em 2026-08-10: o backfill de realinhamento de
    // faixa reescreveu 126 justificativas aqui e a nuvem continuou com as dela — 126 × 45,
    // dois textos diferentes pra mesma avaliação.
    //
    // O efeito era uma assimetria feia: `category_scores` (o NÚMERO) é upsert e propagava,
    // `ai_evaluation_scores` (o TEXTO ao lado) não. Dava pra ficar com nota certa e
    // justificativa velha na mesma ficha.
    //
    // ⚠️ Local vence, como no resto do PLAN. É seguro porque esta tabela é escrita pelo
    // pipeline de avaliação, não por leitor — e o recorte de `where` já limita às obras
    // curadas nesta rodada.
    table: "ai_evaluation_scores",
    where: `ai_evaluation_id in (select id from public.ai_evaluations where work_id = any(${idArray}))`,
    insert: (c) =>
      `insert into public.ai_evaluation_scores (${c}) select ${c} from stage_ai_evaluation_scores
       on conflict (id) do update set ${upsertSet("ai_evaluation_scores", ["id"])}`,
  },
  {
    table: "category_scores",
    where: `work_id = any(${idArray})`,
    insert: (c) => `insert into public.category_scores (${c}) select ${c} from stage_category_scores
      on conflict (work_id, criterion_slug) do update set ${upsertSet("category_scores", ["work_id", "criterion_slug"])}`,
  },
  {
    // Sincronização de CONJUNTO: o local é a verdade sobre quais tags a obra tem. Um
    // insert-if-missing deixaria pra trás tag REMOVIDA na curadoria. `work_tags` é folha
    // (nada a referencia — conferido nas FKs), então delete+insert não cascateia.
    table: "work_tags",
    where: `work_id = any(${idArray})`,
    pre: `delete from public.work_tags where work_id = any(${idArray});`,
    insert: (c) => `insert into public.work_tags (${c}) select ${c} from stage_work_tags on conflict do nothing`,
  },
  {
    // Gêneros da obra. Legado do `works.genres` (o `sync-constants` faz o backfill pra
    // `work_tags`), mas VIVO: `server/queries/ranking.ts`, `similar-works.ts`, `works.ts`,
    // `onboarding-deck.ts` e `adult-audit.ts` leem daqui. Ficava fora do push sem decisão
    // registrada — medido em 2026-08-10: 6 pares presos no local, e produção ordenava e
    // recomendava sem eles.
    //
    // CONJUNTO, pela mesma razão de `work_tags`: o local é a verdade sobre quais gêneros a
    // obra tem, e um insert-if-missing deixaria pra trás gênero REMOVIDO na curadoria. Folha
    // nas FKs (conferido: ninguém a referencia), então delete+insert não cascateia.
    //
    // ⚠️ Conferido antes de escolher delete+insert: **0 pares só na nuvem** (comparando o
    // conjunto de `work_id/genre_id`, não o hash). O detalhe do `db:diff` NÃO responde isso
    // sozinho — ele chaveia pela PRIMEIRA coluna do PK, e com PK composta as linhas da mesma
    // obra colapsam: ele reportava "21 valor diferente" onde o conjunto real diverge em 6.
    table: "work_genres",
    where: `work_id = any(${idArray})`,
    pre: `delete from public.work_genres where work_id = any(${idArray});`,
    insert: (c) => `insert into public.work_genres (${c}) select ${c} from stage_work_genres on conflict do nothing`,
  },
  {
    // Idem: `is_primary`/`position` mudam na curadoria, então tem de ser conjunto, não união.
    table: "work_covers",
    where: `work_id = any(${idArray})`,
    pre: `delete from public.work_covers where work_id = any(${idArray});`,
    insert: (c) => `insert into public.work_covers (${c}) select ${c} from stage_work_covers on conflict do nothing`,
  },
  {
    // Capas ARQUIVADAS (mig 163): arquivar/restaurar capa mexe SÓ aqui — fora do push, a
    // curadoria de capas desfazia no pull seguinte. Conjunto, como work_covers (restaurar
    // = a linha sumir daqui). Folha nas FKs.
    table: "work_cover_archive",
    where: `work_id = any(${idArray})`,
    pre: `delete from public.work_cover_archive where work_id = any(${idArray});`,
    insert: (c) =>
      `insert into public.work_cover_archive (${c}) select ${c} from stage_work_cover_archive on conflict do nothing`,
  },
  {
    table: "work_synopses",
    where: `work_id = any(${idArray})`,
    pre: `delete from public.work_synopses where work_id = any(${idArray});`,
    insert: (c) => `insert into public.work_synopses (${c}) select ${c} from stage_work_synopses on conflict do nothing`,
  },
  {
    table: "platform_ratings",
    where: `work_id = any(${idArray})`,
    insert: (c) => `insert into public.platform_ratings (${c}) select ${c} from stage_platform_ratings
      on conflict (work_id, platform) do update set ${upsertSet("platform_ratings", ["work_id", "platform"])}`,
  },
  {
    table: "work_external_ids",
    where: `work_id = any(${idArray})`,
    insert: (c) => `insert into public.work_external_ids (${c}) select ${c} from stage_work_external_ids
      on conflict (work_id, source) do update set ${upsertSet("work_external_ids", ["work_id", "source"])}`,
  },
  {
    // Sem chave natural (só PK em id) e re-raspadas a cada avaliação ⇒ chegam com uuid novo.
    // Dedup por CONTEÚDO, e a conferência é por conteúdo distinto, não por contagem: se a
    // origem tem duas reviews de texto idêntico, a dedup grava UMA e o destino fica
    // legitimamente com menos linhas.
    table: "work_reviews",
    where: `work_id = any(${idArray})`,
    atLeast: true,
    verify: `select count(*) from (
               select distinct work_id, source, md5(coalesce(text,'')) from public.work_reviews
               where work_id = any(${idArray})) t`,
    insert: (c) => `insert into public.work_reviews (${c})
      select ${c} from stage_work_reviews s
      where not exists (
        select 1 from public.work_reviews r
        where r.work_id = s.work_id and r.source = s.source
          and md5(coalesce(r.text,'')) = md5(coalesce(s.text,''))
      ) on conflict do nothing`,
  },
  {
    // Reviews manuais digitadas no editor local-only da edição da obra — conteúdo de MÃO,
    // perda irrecuperável (foi assim que a lacuna apareceu: 6 reviews digitadas no local,
    // zero na nuvem). CONJUNTO: edição muda a linha in-place e delete tem de sumir na
    // nuvem. Folha nas FKs.
    table: "work_external_reviews_manual",
    where: `work_id = any(${idArray})`,
    pre: `delete from public.work_external_reviews_manual where work_id = any(${idArray});`,
    insert: (c) =>
      `insert into public.work_external_reviews_manual (${c}) select ${c} from stage_work_external_reviews_manual on conflict do nothing`,
  },
  {
    // Embedding da obra. NÃO é per-usuário (não tem user_id) — é catálogo, recortado por obra.
    // Entra porque é DERIVADO de entrada que só existe no local: medido em 2026-08-10, 183 das
    // 978 obras tinham `input_hash` diferente entre os bancos, 183 de 183 por sinopse/tags
    // editadas aqui. Deixar fora significa "Obras parecidas" e busca vetorial rodando em
    // produção sobre o vetor de um texto que já mudou.
    table: "work_embeddings",
    where: `work_id = any(${idArray})`,
    insert: (c) => `insert into public.work_embeddings (${c}) select ${c} from stage_work_embeddings
      on conflict (work_id) do update set ${upsertSet("work_embeddings", ["work_id"])}`,
  },
  {
    // Ledger de custo por job — é o que o /ai-usage soma. Sem ele a nuvem não mostra o que
    // esta curadoria gastou.
    table: "work_processing_jobs",
    where: `work_id = any(${idArray})`,
    insert: (c) =>
      `insert into public.work_processing_jobs (${c}) select ${c} from stage_work_processing_jobs on conflict do nothing`,
  },
  {
    table: "ai_cache_events",
    where: `work_id = any(${idArray})`,
    insert: (c) => `insert into public.ai_cache_events (${c}) select ${c} from stage_ai_cache_events on conflict do nothing`,
  },
  {
    // Dado PER-USER (status, capítulos, nota, favorito, pós-leitura). Entra porque a nuvem
    // está congelada: não há versão concorrente pra perder.
    table: "user_work_state",
    where: `work_id = any(${idArray}) and ${soDoCurador()}`,
    insert: (c) => `insert into public.user_work_state (${c}) select ${c} from stage_user_work_state
      on conflict (user_id, work_id) do update set ${upsertSet("user_work_state", ["user_id", "work_id"])}`,
  },
  {
    // ── As três abaixo são ENTRADA do recalc, não saída ─────────────────────────────────
    // O recalc lê `attribute_bias` e `user_tag_preferences` do DONO (ver CLAUDE.md). Fora do
    // push, elas derivam — e um recalc rodado na nuvem produz notas DIFERENTES das daqui, sem
    // erro e sem log. Entram por isso, não porque estejam quebradas hoje.
    //
    // ⚠️ Medido em 2026-08-10, RECORTADO ao curador: `attribute_bias` 9=9 e
    // `user_tag_preferences` 158=158 com hash IDÊNTICO — já estavam em dia. Só
    // `user_attribute_assessment` tinha deriva real (1377 local × 1314 nuvem, 63 linhas).
    // A divergência bruta que motivou a investigação (18×9, 164×158) era quase toda linha de
    // OUTROS usuários no local, não drift do curador. Contagem bruta engana; compare o
    // conteúdo já recortado.
    table: "attribute_bias",
    where: `${soDoCurador()}`,
    insert: (c) => `insert into public.attribute_bias (${c}) select ${c} from stage_attribute_bias
      on conflict (user_id, attribute_slug) do update set ${upsertSet("attribute_bias", ["user_id", "attribute_slug"])}`,
  },
  {
    table: "user_tag_preferences",
    where: `${soDoCurador()}`,
    // CONJUNTO: o local é a verdade sobre o que o curador declarou. Insert-if-missing deixaria
    // pra trás preferência REMOVIDA — mesma razão do delete+insert de `work_tags`.
    pre: `delete from public.user_tag_preferences where ${soDoCurador()};`,
    insert: (c) => `insert into public.user_tag_preferences (${c}) select ${c} from stage_user_tag_preferences on conflict do nothing`,
  },
  {
    table: "user_attribute_assessment",
    where: `${soDoCurador()}`,
    insert: (c) => `insert into public.user_attribute_assessment (${c}) select ${c} from stage_user_attribute_assessment
      on conflict (user_id, work_id, attribute_slug) do update set ${upsertSet("user_attribute_assessment", ["user_id", "work_id", "attribute_slug"])}`,
  },
  {
    // Histórico de recomendação do curador + o fechamento da FK de `calculated_scores`.
    // Depende de `ai_api_calls` e `taste_profile`, que vêm antes na ordem.
    table: "recommendation_runs",
    where: `id in ${runsDoPush}`,
    insert: (c) => `insert into public.recommendation_runs (${c}) select ${c} from stage_recommendation_runs on conflict do nothing`,
  },
  {
    // Saída determinística do recalc. Entra pra a nuvem não ficar com category_scores novo e
    // nota velha na tela — esquecer de recalcular produz nota ERRADA visível, não um vazio.
    table: "calculated_scores",
    where: `true`,
    insert: (c) => `insert into public.calculated_scores (${c}) select ${c} from stage_calculated_scores
      on conflict (work_id) do update set ${upsertSet("calculated_scores", ["work_id"])}`,
  },
  {
    table: "user_calculated_scores",
    where: `${soDoCurador()}`,
    insert: (c) => `insert into public.user_calculated_scores (${c}) select ${c} from stage_user_calculated_scores
      on conflict (user_id, work_id) do update set ${upsertSet("user_calculated_scores", ["user_id", "work_id"])}`,
  },
  {
    table: "calibration_history",
    where: `recorded_at > '${cutoff}'::timestamptz`,
    atLeast: true,
    insert: (c) =>
      `insert into public.calibration_history (${c}) select ${c} from stage_calibration_history on conflict do nothing`,
  },
]

// ── 5. relatório ANTES de escrever ──────────────────────────────────────────────────────
// `works` vai por último no SQL (triggers leem as filhas), mas o relatório vem aqui.
const worksCols = cols("works").filter((c) => !["id", "created_at"].includes(c))

// A sinopse canônica é artefato PAGO e foi REGENERADA na curadoria — em pelo menos um caso
// do piloto ela piorou ("crate" em vez de "caixote"). Não dá pra deixar de fora (ela viaja
// com `canonical_synopsis_inputs_hash`; levar o hash sem o texto faz o app achar que está em
// dia e NUNCA mais regenerar). Então: leva, mas mostra antes.
const synopsisChanged = lines(
  psql(
    SOURCE,
    `select id || E'\\t' || title from public.works where id = any(${idArray})
       and canonical_synopsis is not null order by title`,
  ),
).map((l) => l.split("\t"))

console.log(`\nlinhas a transferir:`)
const staged = []
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const outDir = path.join(ROOT, ".backups", `push-curation-${stamp}`)
fs.mkdirSync(outDir, { recursive: true })

for (const step of PLAN) {
  const c = cols(step.table)
  const list = c.map((x) => `"${x}"`).join(",")
  const n = Number(psql(SOURCE, `select count(*) from public.${step.table} where ${step.where}`))
  const file = path.join(outDir, `${step.table}.tsv`)
  execFileSync(
    "psql",
    [SOURCE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
     `\\copy (select ${list} from public.${step.table} where ${step.where}) to '${file}'`],
    { stdio: ["ignore", "ignore", "inherit"] },
  )
  console.log(`  ${step.table.padEnd(24)} ${String(n).padStart(6)} linha(s)${step.pre ? "  (substitui o conjunto)" : ""}`)
  staged.push({ ...step, cols: list, file, n })
}

const worksFile = path.join(outDir, "works.tsv")
execFileSync(
  "psql",
  [SOURCE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
   `\\copy (select "id",${worksCols.map((c) => `"${c}"`).join(",")} from public.works where id = any(${idArray})) to '${worksFile}'`],
  { stdio: ["ignore", "ignore", "inherit"] },
)
console.log(`  ${"works".padEnd(24)} ${String(workIds.length).padStart(6)} obra(s)  (${worksCols.length} colunas)`)

if (synopsisChanged.length) {
  console.log(`\n  ⚠️ canonical_synopsis será SOBRESCRITA em ${synopsisChanged.length} obra(s).`)
  console.log(`     Ela viaja junto do inputs_hash — levar um sem o outro faria o app nunca mais`)
  console.log(`     regenerar. Se alguma regeneração local ficou pior, conserte no app ANTES do push:`)
  for (const [, title] of synopsisChanged.slice(0, 12)) console.log(`       • ${title}`)
}

// ── 6. uma transação só ─────────────────────────────────────────────────────────────────
const sql = [`\\set ON_ERROR_STOP on`, `begin;`]
for (const s of staged) {
  sql.push(`create temp table stage_${s.table} (like public.${s.table} including defaults) on commit drop;`)
  sql.push(`\\copy stage_${s.table} (${s.cols}) from '${s.file}'`)
  if (s.pre) sql.push(s.pre)
  sql.push(`with ins as (${s.insert(s.cols)} returning 1) select '${s.table}=' || count(*) from ins;`)
}
// `works` por ÚLTIMO: os triggers (ex.: enforce_work_ai_eval_pending_reality) leem as filhas
// pra decidir se o status é legal. Com as filhas já no lugar, a checagem vê o estado final.
sql.push(
  `create temp table stage_works (like public.works including defaults) on commit drop;`,
  `\\copy stage_works ("id",${worksCols.map((c) => `"${c}"`).join(",")}) from '${worksFile}'`,
  `with upd as (
     update public.works w set ${worksCols.map((c) => `"${c}" = s."${c}"`).join(", ")}
     from stage_works s where s.id = w.id
     returning 1)
   select 'works=' || count(*) from upd;`,
)
sql.push(DRY ? `rollback;` : `commit;`)

const sqlFile = path.join(outDir, "push.sql")
fs.writeFileSync(sqlFile, sql.join("\n") + "\n")

console.log(`\n→ aplicando no destino (${DRY ? "com ROLLBACK no fim" : "COMMIT"})`)
const run = spawnSync("psql", [TARGET, "-X", "-A", "-t", "-q", "-f", sqlFile], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
})
if (run.stderr?.trim()) console.error(run.stderr.trim())
if (run.status !== 0) die(`a transação falhou — NADA foi gravado (ver ${path.relative(ROOT, sqlFile)})`)

const applied = new Map(lines(run.stdout).filter((l) => l.includes("=")).map((l) => l.split("=")))
for (const [k, v] of applied) console.log(`  ${k.padEnd(24)} ${String(v).padStart(6)} aplicada(s)`)

// ── 7. conferência ──────────────────────────────────────────────────────────────────────
if (DRY) {
  console.log(`\n✓ ENSAIO passou: a transação inteira rodou (constraints, triggers e policies)`)
  console.log(`  e foi revertida. Nada mudou no destino.`)
  console.log(`\nPra valer:  node scripts/db-push-curation.mjs${targetArg ? ` --target=${targetArg}` : " --yes"}`)
  process.exit(0)
}

console.log(`\n→ conferindo destino contra origem`)
const problems = []
for (const s of staged) {
  const q = s.verify ?? `select count(*) from public.${s.table} where ${s.where}`
  const there = Number(psql(TARGET, q))
  const here = Number(psql(SOURCE, q))
  const ok = s.atLeast ? there >= here : there === here
  if (!ok) problems.push(`${s.table}: origem ${here} × destino ${there}${s.verify ? " (conteúdo distinto)" : ""}`)
  else console.log(`  ${s.table.padEnd(24)} destino ${there} (origem ${here}) ok`)
}
// `works`: conferência por CONTEÚDO das colunas empurradas, não por contagem (a contagem
// nunca muda — são updates).
//
// `updated_at` fica FORA da comparação: o trigger BEFORE UPDATE `trg_works_updated_at` faz
// `NEW.updated_at = now()`, então o destino reescreve o valor e ele NUNCA vai bater. Isto foi
// pego pelo ensaio no cloudsim — o `--dry-run` sai antes desta seção e jamais mostraria.
// Continuamos empurrando a coluna (o trigger ignora), só não a usamos como invariante.
const verifyCols = worksCols.filter((c) => c !== "updated_at")
const worksHash = (url) =>
  psql(
    url,
    `select coalesce(md5(string_agg(h, '' order by h)), '-') from (
       select md5(row(${verifyCols.map((c) => `w."${c}"`).join(",")})::text) h
       from public.works w where w.id = any(${idArray})) t`,
  )
if (worksHash(SOURCE) !== worksHash(TARGET)) problems.push(`works: as colunas empurradas divergem entre origem e destino`)
else console.log(`  ${"works".padEnd(24)} conteúdo idêntico ao da origem ok`)

if (problems.length) {
  console.error(`\n✗ ${problems.length} divergência(s) depois do push:`)
  for (const p of problems) console.error(`   • ${p}`)
  process.exit(1)
}

console.log(`\n✓ push conferido: ${workIds.length} obra(s) sincronizada(s) na nuvem.`)
console.log(`\nNÃO foram empurradas, de propósito:`)
console.log(`  formula_config          mistura saída do modelo com CONFIGURAÇÃO sua (faixas, cores,`)
console.log(`                          atalhos de nota) — empurrar sobrescreveria seus ajustes`)
console.log(`  external_source_health  operacional, se refaz na primeira busca`)
console.log(`  genre_proposal          contadores derivados de work_genres, recontam sozinhos`)
// As de baixo apareciam como divergentes no `db:diff` SEM decisão registrada, o que é pior
// que ausência: gap sem registro parece esquecimento e vira rediscussão a cada sessão.
// Decidido em 2026-08-10, com o número medido de cada uma.
console.log(`  work_lists /            🔴 divergem nos DOIS sentidos — a nuvem tem pasta e itens`)
console.log(`  work_list_items            que o local não tem. Pasta de favoritos é ação de LEITOR,`)
console.log(`                             feita em produção; aqui o local NÃO é a verdade.`)
console.log(`                             Precisa de merge com decisão, não de push.`)
console.log(`  user_settings           papel, plano e saldo + contas de teste locais. Empurrar cria`)
console.log(`                             conta fantasma e mexe no que guard_role_self_escalation protege`)
console.log(`  prediction_snapshots /  histórico de análise gerado por rodadas LOCAIS (13,5k × 6,7k).`)
console.log(`  prediction_ledger /        Refazível, e produção não fica errada sem ele`)
console.log(`  pilot_taste_scores`)
console.log(`  imports / import_rows   histórico do EVENTO de importação. As obras que ele criou já`)
console.log(`                             viajam como catálogo; o registro em si é local`)
