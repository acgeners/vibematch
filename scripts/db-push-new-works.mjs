#!/usr/bin/env node
/**
 * Cria na NUVEM as obras que existem só no banco LOCAL — o buraco que `db:push-evals` e
 * `db:push-curation` deixam de propósito (os dois são merge de linhas-FILHAS sobre obras que já
 * existem nos dois lados com o mesmo uuid; nenhum insere em `works`).
 *
 *   node scripts/db-push-new-works.mjs --extract-only        → só EXTRAI pro cofre e sai
 *   node scripts/db-push-new-works.mjs --dry-run             → extrai + roda a transação e dá ROLLBACK
 *   node scripts/db-push-new-works.mjs --target=<pg-url>     → ensaio contra outro banco (db:cloudsim)
 *   node scripts/db-push-new-works.mjs --yes                 → escreve de verdade na nuvem
 *   node scripts/db-push-new-works.mjs --load-from=<dir> --target=<pg-url>
 *                                                            → recarrega um cofre já extraído
 *
 * ── Por que `--extract-only` existe (e por que ele vem primeiro) ────────────────────────
 * O banco local é DESCARTÁVEL: o próximo `npm run db:pull` o recria a partir da nuvem e leva
 * junto tudo que só existe aqui. Enquanto essas obras não sobem, o único backup delas é o
 * `.backups` semanal do Mac inteiro. `--extract-only` grava um cofre auto-contido (TSV por
 * tabela + manifest) que `--load-from` sabe recarregar em QUALQUER destino — inclusive no
 * próprio local depois de um `db:pull`. Extrair custa segundos e não escreve em lugar nenhum;
 * é a metade barata de um push que pode esperar.
 *
 * ── Escopo: medido, não deduzido ────────────────────────────────────────────────────────
 * O plano abaixo saiu de uma varredura de TODA tabela com FK pra `works` (29 tabelas; 19 com
 * linhas) + as FKs de SAÍDA de cada uma delas — não de leitura do código do app. O que ficou
 * de fora está listado em FORA_DO_ESCOPO, com o motivo.
 *
 * ⚠️ Escreve em PRODUÇÃO com --yes. Tudo numa ÚNICA transação: ou entra inteiro ou nada entra.
 * Só INSERT — nenhum passo faz update ou delete de linha que já esteja no destino. É o que
 * torna este script seguro AGORA que a nuvem voltou a receber escrita (a premissa "nuvem
 * congelada" do db:push-curation caiu quando prod subiu): o pior caso aqui é falhar, não
 * sobrescrever curadoria feita em prod.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { podar } from "./lib/backups-retencao.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")

const args = process.argv.slice(2)
const DRY = args.includes("--dry-run")
const YES = args.includes("--yes")
const EXTRACT_ONLY = args.includes("--extract-only")
const targetArg = args.find((a) => a.startsWith("--target="))?.slice("--target=".length)
const loadFrom = args.find((a) => a.startsWith("--load-from="))?.slice("--load-from=".length)

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
// Em `--load-from` não há origem: o cofre É a origem.
const SOURCE = loadFrom
  ? null
  : (() => {
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
let TARGET = null
let targetLabel = "(nenhum)"
if (!EXTRACT_ONLY) {
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
    if (!DRY && !YES) {
      die(
        "escrever na NUVEM exige --yes explícito.\n" +
          "  Ensaie primeiro:  node scripts/db-push-new-works.mjs --dry-run\n" +
          "  Ou só guarde o cofre: node scripts/db-push-new-works.mjs --extract-only"
      )
    }
  }
  if (TARGET && SOURCE && TARGET === SOURCE) die("origem e destino são o mesmo banco")
}

const psql = (url, sql) =>
  execFileSync("psql", [url, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim()

const lines = (out) => out.split("\n").filter(Boolean)

/** Colunas graváveis de uma tabela, na ordem física. Usada pelos DOIS caminhos. */
const colsOf = (url, table) =>
  lines(
    psql(
      url,
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='${table}'
         and is_generated='NEVER' and is_identity='NO'
       order by ordinal_position`
    )
  )

/**
 * O `where` da CONFERÊNCIA não é o mesmo da extração nas tabelas per-user: o passo de carga
 * apaga do stage quem o destino não conhece, então comparar contra o total extraído acusaria
 * divergência onde há acerto. A invariante honesta é "toda linha de dono que o DESTINO conhece
 * chegou" — e essa expressão é válida nos dois lados.
 */
const verifyWhereFor = (step, targetUserIds) =>
  PER_USER_TABLES.includes(step.table) && targetUserIds.length
    ? `${step.where} and user_id = any('{${targetUserIds.join(",")}}'::uuid[])`
    : step.where

/**
 * Correções que só o DESTINO sabe fazer, aplicadas no stage dentro da transação. Ficam num mapa
 * por NOME de tabela, e não numa função dentro do passo, porque o `--load-from` reconstrói o
 * plano a partir do manifest.json — e função não sobrevive a JSON. É o que faz um cofre extraído
 * hoje continuar correto ao ser carregado noutro destino amanhã.
 */
const PER_USER_TABLES = ["user_work_state", "user_calculated_scores", "prediction_snapshots"]
const PREPARE_BY_TABLE = {
  // Estado pessoal de dono que o destino não conhece não entra: nenhuma dessas tabelas tem FK
  // pra `auth.users`, então o insert passaria em SILÊNCIO e deixaria estado fantasma em prod.
  ...Object.fromEntries(
    PER_USER_TABLES.map((t) => [
      t,
      [`delete from stage_${t} where not exists (select 1 from auth.users u where u.id = stage_${t}.user_id);`],
    ])
  ),
  // `synopsis_quality_predictions` é artefato PAGO com dois pais opcionais: `taste_profile`
  // (fora do escopo) e `ai_api_calls` (que vai junto). As duas colunas são NULLABLE, então
  // neutralizamos o vínculo órfão em vez de descartar a predição. `taste_profile_hash` fica na
  // linha, e é ele que faz a app enxergar perfil diferente e regenerar quando fizer sentido.
  synopsis_quality_predictions: [
    `update stage_synopsis_quality_predictions s set taste_profile_id = null where s.taste_profile_id is not null
       and not exists (select 1 from public.taste_profile p where p.id = s.taste_profile_id);`,
    `update stage_synopsis_quality_predictions s set ai_api_call_id = null where s.ai_api_call_id is not null
       and not exists (select 1 from public.ai_api_calls a where a.id = s.ai_api_call_id);`,
  ],
}

console.log(`origem : ${loadFrom ? `COFRE ${loadFrom}` : `LOCAL  ${SOURCE.replace(/:[^:@]+@/, ":***@")}`}`)
console.log(`destino: ${targetLabel}`)
console.log(
  `modo   : ${EXTRACT_ONLY ? "SÓ EXTRAÇÃO (não escreve em lugar nenhum)" : DRY ? "ENSAIO (rollback no fim)" : "GRAVANDO (commit)"}`
)

if (SOURCE) {
  try {
    psql(SOURCE, "select 1")
  } catch {
    die("não conectei no Postgres local")
  }
}
if (TARGET) {
  try {
    psql(TARGET, "select 1")
  } catch (e) {
    die(`não conectei no destino:\n  ${String(e.stderr || e.message).trim().split("\n")[0]}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════
// CAMINHO 2: recarregar um cofre já extraído. Não toca no banco local.
// ════════════════════════════════════════════════════════════════════════════════════════
if (loadFrom) {
  const dir = path.resolve(loadFrom)
  const manifestPath = path.join(dir, "manifest.json")
  if (!fs.existsSync(manifestPath)) die(`não achei ${path.relative(ROOT, manifestPath)}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  console.log(`\ncofre de ${manifest.stamp}: ${manifest.works.length} obra(s), ${manifest.steps.length} tabela(s)`)

  const already = new Set(
    lines(psql(TARGET, `select id from public.works where id = any('{${manifest.works.map((w) => w.id).join(",")}}'::uuid[])`))
  )
  if (already.size) {
    console.log(`  ⚠️ ${already.size} obra(s) do cofre JÁ existem no destino — os inserts vão ignorá-las`)
  }
  // O cofre pode ter sido extraído contra um schema MAIS NOVO que o destino (um `--extract-only`
  // não tem destino pra intersectar, então grava as colunas da origem). Reintersecta aqui, e
  // grita o que caiu: sem isto o psql morre com "column X of relation stage_Y does not exist",
  // que é seguro (a transação aborta inteira) mas não diz o que fazer.
  const steps = manifest.steps.map((s) => {
    const file = path.join(dir, `${s.table}.tsv`)
    if (s.special) return { ...s, file }
    const tgt = new Set(colsOf(TARGET, s.table))
    const all = s.cols.split(",")
    const kept = all.filter((c) => tgt.has(c.replace(/"/g, "")))
    const dropped = all.filter((c) => !tgt.has(c.replace(/"/g, "")))
    if (dropped.length) console.log(`  ⚠️ ${s.table}: coluna(s) fora do destino, ignorada(s): ${dropped.join(", ")}`)
    // `copyCols` mantém a ORDEM do arquivo (o \copy exige isso); `cols` é o que de fato entra.
    return { ...s, cols: kept.join(","), copyCols: all.join(","), extraCols: dropped, file }
  })
  applyTransaction(steps, dir)
  if (DRY) {
    console.log(`\n✓ ENSAIO passou: a transação inteira rodou e foi revertida. Nada mudou no destino.`)
    process.exit(0)
  }
  // `< s.n` (e não `!==`) porque o destino pode ter linhas próprias mais novas nessas tabelas —
  // o cofre é um piso, não um espelho.
  const tgtUsers = lines(psql(TARGET, "select id from auth.users"))
  const bad = manifest.steps.filter((s) => {
    if (s.special) return false // não é tabela
    const w = verifyWhereFor(s, tgtUsers)
    const there = Number(psql(TARGET, `select count(*) from public.${s.table} where ${w}`))
    return w === s.where ? there < s.n : there === 0 && s.n > 0
  })
  if (bad.length) die(`${bad.length} tabela(s) com menos linhas que o cofre: ${bad.map((b) => b.table).join(", ")}`)
  console.log(`\n✓ cofre recarregado e conferido.`)
  process.exit(0)
}

// ════════════════════════════════════════════════════════════════════════════════════════
// CAMINHO 1: descobrir, extrair e (opcionalmente) empurrar.
// ════════════════════════════════════════════════════════════════════════════════════════

// ── 1. quais obras existem SÓ no local ──────────────────────────────────────────────────
// Sem `--target`/`--yes` (isto é, em `--extract-only`) não há destino pra comparar. Aí o
// recorte é "criada depois que o banco local nasceu": o nome do diretório do último `db:pull`
// é o carimbo, o mesmo truque do db:push-curation — sem bookkeeping paralelo pra dessincronizar.
let workIds
let escopoLabel
if (TARGET) {
  const localIds = lines(psql(SOURCE, "select id from public.works"))
  const targetIds = new Set(lines(psql(TARGET, "select id from public.works")))
  workIds = localIds.filter((id) => !targetIds.has(id))
  escopoLabel = `ausentes no destino`
  console.log(`\nworks: ${localIds.length} no local, ${targetIds.size} no destino`)
} else {
  // Sem destino não há com o que comparar: o recorte é "criada depois que o banco local
  // nasceu". O nome do diretório do `db:pull` É o carimbo — mesmo truque do db:push-curation,
  // sem bookkeeping paralelo pra dessincronizar.
  const sinceArg = args.find((a) => a.startsWith("--since="))?.slice("--since=".length)
  const dir = path.join(ROOT, ".backups")
  const pulls = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => d.startsWith("pull-")).sort() : []
  if (!sinceArg && !pulls.length) die("sem destino e sem `.backups/pull-*` — passe --since=<iso> na mão")
  // pull-2026-07-30T00-31-49-679Z → 2026-07-30T00:31:49.679Z
  const cutoff = sinceArg ?? pulls.at(-1).slice("pull-".length).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z")
  workIds = lines(psql(SOURCE, `select id from public.works where created_at > '${cutoff}'::timestamptz`))
  escopoLabel = `criadas depois de ${cutoff}`
  console.log(`\nworks criadas depois do último db:pull (${cutoff})`)
}

if (!workIds.length) {
  console.log(`\n✓ nada a fazer — nenhuma obra ${escopoLabel}.`)
  process.exit(0)
}
const idArray = `'{${workIds.join(",")}}'::uuid[]`
const idText = `'{${workIds.join(",")}}'::text[]`

const titles = lines(psql(SOURCE, `select id || '|' || title from public.works where id = any(${idArray}) order by created_at`))
console.log(`  → ${workIds.length} obra(s) ${escopoLabel}:`)
for (const t of titles) console.log(`     ${t.split("|")[1]}`)

// ── 2. guarda de TAGS ───────────────────────────────────────────────────────────────────
// O local nasce como cópia byte a byte da nuvem, então toda tag pré-existente tem uuid
// IDÊNTICO dos dois lados e não há o que remapear. Tag nova nasce de `upsertExternalTags` e o
// uuid local viaja junto no insert. O único caso que exigiria remap é o mesmo SLUG existir no
// destino com outro uuid — sinal de que a nuvem criou tag por conta própria. Aí ABORTA: um
// insert cego duplicaria o slug (ou estouraria o unique) e um remap silencioso reescreveria
// vínculo de obra alheia.
if (TARGET) {
  const srcTags = new Map(lines(psql(SOURCE, "select slug || '|' || id from public.tags")).map((l) => l.split("|")))
  const tgtTags = new Map(lines(psql(TARGET, "select slug || '|' || id from public.tags")).map((l) => l.split("|")))
  const colisoes = [...srcTags].filter(([slug, id]) => tgtTags.has(slug) && tgtTags.get(slug) !== id)
  if (colisoes.length) {
    console.error(`\n✗ ${colisoes.length} tag(s) com o mesmo slug e uuid DIFERENTE nos dois lados:`)
    for (const [slug, id] of colisoes.slice(0, 10)) console.error(`   ${slug}: local ${id} × destino ${tgtTags.get(slug)}`)
    die("a nuvem criou tag por conta própria — este script não faz remap. Resolva à mão antes.")
  }
}

// ── 3. de quem é a linha per-user ───────────────────────────────────────────────────────
// O corte é em DOIS tempos, e o segundo é o que vale:
//   1. AQUI, na extração: filtra pelos donos que a ORIGEM conhece. Tira do cofre os ids que não
//      são de gente nenhuma — medido: 4 dos 6 donos de `user_calculated_scores` das obras novas
//      não existem nem em `auth.users` local (simulação de piloto).
//   2. na carga: `PREPARE_BY_TABLE` apaga do stage quem o DESTINO não conhece (a conta de teste
//      local, por exemplo). Roda contra o banco real em que se está gravando.
const sourceUsers = lines(psql(SOURCE, "select id from auth.users"))
const userFilter = sourceUsers.length ? `user_id = any('{${sourceUsers.join(",")}}'::uuid[])` : "false"

// ── 4. colunas: interseção origem∩destino ───────────────────────────────────────────────
// Protege contra drift de schema. Melhor deixar coluna de fora do que estourar no meio da
// transação — e o relatório mostra o que ficou.
const cols = (table) => {
  const src = colsOf(SOURCE, table)
  if (!TARGET) return src
  const tgt = new Set(colsOf(TARGET, table))
  const kept = src.filter((c) => tgt.has(c))
  const dropped = src.filter((c) => !tgt.has(c))
  if (dropped.length) console.log(`  ⚠️ ${table}: coluna(s) fora do destino, ignorada(s): ${dropped.join(", ")}`)
  return kept
}

const onConflictNothing = (table) => (c) =>
  `insert into public.${table} (${c}) select ${c} from stage_${table} on conflict do nothing`

/**
 * O que NÃO viaja, e por quê. Está aqui em vez de num comentário solto porque o relatório
 * imprime — omissão silenciosa é o que faz alguém descobrir a falta seis meses depois.
 */
const FORA_DO_ESCOPO = [
  ["imports / import_rows", "histórico de importação; os `imports` pais não existem no destino e são log, não curadoria"],
  ["work_lists / work_list_items", "pastas de favoritos; as listas pais não existem no destino (criá-las é decisão de UI, não de migração)"],
  ["taste_profile", "artefato per-user com unique parcial em is_current — empurrar exige DESPROMOVER o perfil da nuvem. Fora do escopo de 'criar obra'"],
  ["linhas per-user de quem o destino não conhece", "sem FK pra auth.users: entraria como lixo invisível"],
]

const PLAN = [
  {
    // Só as tags que as obras novas referenciam — não o catálogo inteiro. Tag nova de obra que
    // JÁ existe no destino é outro problema (e outro script).
    table: "tags",
    where: `id in (select tag_id from public.work_tags where work_id = any(${idArray}))`,
    insert: onConflictNothing("tags"),
  },
  {
    // `works` PRIMEIRO: aqui é INSERT, e todas as filhas têm FK pra cá. (No db:push-curation ela
    // vai por último porque lá é UPDATE e os triggers leem as filhas — caso oposto.) Os dois
    // triggers de mutação de `works` são BEFORE/AFTER **UPDATE**: no insert, `updated_at` chega
    // intacto e serve de invariante na conferência.
    table: "works",
    where: `id = any(${idArray})`,
    insert: onConflictNothing("works"),
  },
  {
    // Log de custo. `ai_api_calls` não tem work_id — tem `metadata->>'work_id'` (medido: 3041 de
    // 4574 linhas). NÃO dá pra escopar por tempo como o db:push-evals faz: prod voltou a gerar
    // chamadas, então `max(created_at)` do destino já é mais novo que TODA chamada local e o
    // recorte por tempo devolveria zero. Escopo por obra é exato e imune a isso.
    table: "ai_api_calls",
    where: `metadata->>'work_id' = any(${idText})`,
    insert: onConflictNothing("ai_api_calls"),
  },
  { table: "work_tags", where: `work_id = any(${idArray})`, insert: onConflictNothing("work_tags") },
  { table: "work_genres", where: `work_id = any(${idArray})`, insert: onConflictNothing("work_genres") },
  { table: "work_covers", where: `work_id = any(${idArray})`, insert: onConflictNothing("work_covers") },
  { table: "work_cover_archive", where: `work_id = any(${idArray})`, insert: onConflictNothing("work_cover_archive") },
  { table: "work_synopses", where: `work_id = any(${idArray})`, insert: onConflictNothing("work_synopses") },
  { table: "work_external_ids", where: `work_id = any(${idArray})`, insert: onConflictNothing("work_external_ids") },
  { table: "platform_ratings", where: `work_id = any(${idArray})`, insert: onConflictNothing("platform_ratings") },
  {
    // Reviews raspadas de 8 fontes atrás de Cloudflare: o item mais caro de refazer depois da
    // avaliação. Obra nova ⇒ o destino não tem nenhuma ⇒ não precisa da dedup por conteúdo que
    // o db:push-evals faz (lá as obras já existiam e podiam ter review repetida).
    table: "work_reviews",
    where: `work_id = any(${idArray})`,
    insert: onConflictNothing("work_reviews"),
  },
  {
    // Reviews digitadas à mão no editor local-only. Alimentam o prompt da avaliação.
    table: "work_external_reviews_manual",
    where: `work_id = any(${idArray})`,
    insert: onConflictNothing("work_external_reviews_manual"),
  },
  { table: "work_embeddings", where: `work_id = any(${idArray})`, insert: onConflictNothing("work_embeddings") },
  {
    // Ledger durável de jobs com cost_actual_usd — é o que o /ai-usage soma.
    table: "work_processing_jobs",
    where: `work_id = any(${idArray})`,
    insert: onConflictNothing("work_processing_jobs"),
  },
  { table: "ai_evaluations", where: `work_id = any(${idArray})`, insert: onConflictNothing("ai_evaluations") },
  {
    table: "ai_evaluation_scores",
    where: `ai_evaluation_id in (select id from public.ai_evaluations where work_id = any(${idArray}))`,
    insert: onConflictNothing("ai_evaluation_scores"),
  },
  { table: "category_scores", where: `work_id = any(${idArray})`, insert: onConflictNothing("category_scores") },
  {
    // Saída determinística do recalc. Viaja pra a obra não aparecer sem Nota.Calc/Prevista até o
    // próximo recalc geral — nota vazia na tela é pior que nota velha.
    table: "calculated_scores",
    where: `work_id = any(${idArray})`,
    insert: onConflictNothing("calculated_scores"),
  },
  {
    // Artefato PAGO com dois pais opcionais — ver PREPARE_BY_TABLE, que neutraliza o vínculo
    // órfão no stage em vez de descartar a predição.
    table: "synopsis_quality_predictions",
    where: `work_id = any(${idArray})`,
    insert: onConflictNothing("synopsis_quality_predictions"),
  },
  {
    // Estado de leitura (status, capítulos, nota, favorito, pós-leitura) de quem o destino
    // conhece. Obra nova ⇒ nenhuma linha concorrente pra sobrescrever.
    table: "user_work_state",
    where: `work_id = any(${idArray}) and ${userFilter}`,
    insert: onConflictNothing("user_work_state"),
  },
  {
    table: "user_calculated_scores",
    where: `work_id = any(${idArray}) and ${userFilter}`,
    insert: onConflictNothing("user_calculated_scores"),
  },
  {
    table: "prediction_snapshots",
    where: `work_id = any(${idArray}) and ${userFilter}`,
    insert: onConflictNothing("prediction_snapshots"),
  },
  {
    // 🔴 ÚLTIMO passo, e não é enfeite. `ai_evaluations` tem um AFTER INSERT
    // (`trg_mark_work_review_pending_after_completed_ai_eval`) que, pra toda avaliação
    // `completed`, faz `UPDATE works SET ai_eval_status = 'review_pending'`. Como as avaliações
    // entram DEPOIS de `works`, as 15 obras — que estão `done`, já revisadas à mão no local —
    // chegavam ao destino como `review_pending` e caíam na fila de revisão de novo. Medido no
    // ensaio do cloudsim: 15/15 viradas. É corrupção silenciosa clássica: nenhum erro, contagem
    // certa em toda tabela, e uma fila de 15 pendências falsas na cara de quem abrir o app.
    //
    // O trigger de `works` (`trg_enforce_work_ai_eval_pending_reality`, BEFORE UPDATE OF
    // ai_eval_status) não atrapalha a volta: ele só coage `pending` → `review_pending`, e o
    // valor que restauramos é o da origem.
    special: "restore-works-status",
    table: "works_status",
    from: "works",
    selectCols: `"id","ai_eval_status"`,
    where: `id = any(${idArray})`,
  },
]

// ── 5. extração pro cofre ───────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const outDir = path.join(ROOT, ".backups", `new-works-${stamp}`)
fs.mkdirSync(outDir, { recursive: true })

// Retenção: TODA execução grava um cofre (~1,3 MB), inclusive `--dry-run` — por isso o teto
// existe (COFRE_KEEP, default 5). A política mora em `lib/backups-retencao.mjs`, dono único.
podar("new-works")

console.log(`\nlinhas a transferir:`)
const staged = []
for (const step of PLAN) {
  const from = step.from ?? step.table
  const list = step.selectCols ?? cols(step.table).map((x) => `"${x}"`).join(",")
  const n = Number(psql(SOURCE, `select count(*) from public.${from} where ${step.where}`))
  const file = path.join(outDir, `${step.table}.tsv`)
  execFileSync(
    "psql",
    [SOURCE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
     `\\copy (select ${list} from public.${from} where ${step.where}) to '${file}'`],
    { stdio: ["ignore", "ignore", "inherit"] }
  )
  console.log(`  ${step.table.padEnd(30)} ${String(n).padStart(6)} linha(s)`)
  staged.push({ ...step, cols: list, file, n })
}
const total = staged.reduce((a, s) => a + s.n, 0)
console.log(`  ${"TOTAL".padEnd(30)} ${String(total).padStart(6)} linha(s)`)

// Linhas per-user que ficaram de fora por dono desconhecido — contadas, não sussurradas.
for (const t of PER_USER_TABLES) {
  const fora = Number(psql(SOURCE, `select count(*) from public.${t} where work_id = any(${idArray}) and not (${userFilter})`))
  if (fora) console.log(`  ⚠️ ${t}: ${fora} linha(s) de user_id que nem a origem conhece — FORA do cofre`)
}

console.log(`\nfora do escopo de propósito:`)
for (const [what, why] of FORA_DO_ESCOPO) console.log(`  • ${what} — ${why}`)

fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    {
      stamp,
      escopo: escopoLabel,
      works: titles.map((t) => ({ id: t.split("|")[0], title: t.split("|")[1] })),
      // `special` TEM de viajar: sem ele o `--load-from` tenta criar um stage `like
      // public.works_status` (tabela que não existe) e a transação inteira aborta. Pego rodando
      // o caminho de recarga contra um cofre real — o `--yes` sozinho nunca teria mostrado.
      steps: staged.map((s) => ({ table: s.table, cols: s.cols, where: s.where, n: s.n, special: s.special })),
      foraDoEscopo: FORA_DO_ESCOPO,
    },
    null,
    2
  ) + "\n"
)
console.log(`\n✓ cofre gravado em ${path.relative(ROOT, outDir)}/ (${staged.length} tsv + manifest.json)`)

if (EXTRACT_ONLY) {
  console.log(`\nEle recarrega em qualquer banco — inclusive neste local depois de um db:pull:`)
  console.log(`  node scripts/db-push-new-works.mjs --load-from=${path.relative(ROOT, outDir)} \\`)
  console.log(`    --target='postgresql://postgres:postgres@127.0.0.1:54322/postgres'`)
  process.exit(0)
}

// ── 6. uma transação só ─────────────────────────────────────────────────────────────────
function applyTransaction(steps, dir) {
  const sql = [`\\set ON_ERROR_STOP on`, `begin;`]
  for (const s of steps) {
    if (s.special === "restore-works-status") {
      sql.push(`create temp table stage_works_status (id uuid, ai_eval_status text) on commit drop;`)
      sql.push(`\\copy stage_works_status from '${s.file}'`)
      sql.push(`with upd as (
         update public.works w set ai_eval_status = st.ai_eval_status
         from stage_works_status st
         where st.id = w.id and w.ai_eval_status is distinct from st.ai_eval_status
         returning 1)
       select 'works_status(restaurado)=' || count(*) from upd;`)
      continue
    }
    sql.push(`create temp table stage_${s.table} (like public.${s.table} including defaults) on commit drop;`)
    // Coluna que o cofre tem e o destino não: entra no stage como `text` só pra o \copy ter onde
    // pôr o campo (o arquivo tem largura fixa e o \copy não sabe pular coluna). Ela não é
    // selecionada no insert — o valor é lido e descartado, de propósito e com aviso.
    for (const c of s.extraCols ?? []) sql.push(`alter table stage_${s.table} add column ${c} text;`)
    sql.push(`\\copy stage_${s.table} (${s.copyCols ?? s.cols}) from '${s.file}'`)
    // Correções que só o DESTINO sabe fazer (dono desconhecido, pai ausente). Ficam num mapa
    // por NOME de tabela, não numa função no passo, porque o `--load-from` reconstrói o plano a
    // partir do manifest.json — e função não sobrevive a JSON.
    for (const p of PREPARE_BY_TABLE[s.table] ?? []) sql.push(p)
    const ins = s.insert
      ? s.insert(s.cols)
      : `insert into public.${s.table} (${s.cols}) select ${s.cols} from stage_${s.table} on conflict do nothing`
    sql.push(`with ins as (${ins} returning 1) select '${s.table}=' || count(*) from ins;`)
  }
  sql.push(DRY ? `rollback;` : `commit;`)

  const sqlFile = path.join(dir, "push.sql")
  fs.writeFileSync(sqlFile, sql.join("\n") + "\n")

  console.log(`\n→ aplicando no destino (${DRY ? "com ROLLBACK no fim" : "COMMIT"})`)
  const run = spawnSync("psql", [TARGET, "-X", "-A", "-t", "-q", "-f", sqlFile], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
  if (run.stderr?.trim()) console.error(run.stderr.trim())
  if (run.status !== 0) die(`a transação falhou — NADA foi gravado (ver ${path.relative(ROOT, sqlFile)})`)
  const applied = new Map(lines(run.stdout).filter((l) => l.includes("=")).map((l) => l.split("=")))
  for (const [k, v] of applied) console.log(`  ${k.padEnd(30)} ${String(v).padStart(6)} inserida(s)`)
  return applied
}

applyTransaction(staged, outDir)

// ── 7. conferência ──────────────────────────────────────────────────────────────────────
if (DRY) {
  console.log(`\n✓ ENSAIO passou: a transação inteira rodou (constraints, triggers e policies incluídos)`)
  console.log(`  e foi revertida. Nada mudou no destino. O cofre em ${path.relative(ROOT, outDir)}/ continua válido.`)
  console.log(`\nPra valer:  node scripts/db-push-new-works.mjs${targetArg ? ` --target=${targetArg}` : " --yes"}`)
  process.exit(0)
}

console.log(`\n→ conferindo destino contra origem`)
const targetUsers = lines(psql(TARGET, "select id from auth.users"))
const problems = []
for (const s of staged) {
  if (s.special) continue // não é tabela; a conferência dele é o hash de `works` abaixo
  const w = verifyWhereFor(s, targetUsers)
  const there = Number(psql(TARGET, `select count(*) from public.${s.table} where ${w}`))
  const here = w === s.where ? s.n : Number(psql(SOURCE, `select count(*) from public.${s.table} where ${w}`))
  if (there !== here) problems.push(`${s.table}: origem ${here} × destino ${there}`)
  else console.log(`  ${s.table.padEnd(30)} destino ${String(there).padStart(6)} (origem ${here}) ok`)
}

// `works` por CONTEÚDO, não por contagem: contar só provaria que 15 linhas chegaram, não que
// chegaram iguais — e o ensaio mostrou que não chegam (o trigger de `ai_evaluations` vira o
// `ai_eval_status`). É este hash que prova que o passo de restauração funcionou.
//
// `updated_at` fica FORA, e não dá pra "consertar": `trg_works_updated_at` é BEFORE UPDATE e faz
// `NEW.updated_at = now()` incondicionalmente, então a restauração do status reescreve a coluna
// de novo. No destino ela passa a valer "quando esta linha foi criada aqui", que é honesto.
const WORKS_HASH_EXCLUI = ["updated_at"]
const worksCols = cols("works")
  .filter((c) => !WORKS_HASH_EXCLUI.includes(c))
  .map((c) => `"${c}"::text`)
  .join(", ")
const hashSql = `select md5(string_agg(h, '' order by h)) from (
  select md5(concat_ws('§', ${worksCols})) h from public.works where id = any(${idArray})) t`
if (psql(SOURCE, hashSql) !== psql(TARGET, hashSql)) problems.push(`works: conteúdo das colunas empurradas DIFERE`)
else console.log(`  ${"works (conteúdo)".padEnd(30)} hash idêntico ao da origem`)

if (problems.length) {
  console.error(`\n✗ ${problems.length} divergência(s) depois do push:`)
  for (const p of problems) console.error(`   • ${p}`)
  process.exit(1)
}

console.log(`\n✓ push conferido: ${workIds.length} obra(s) e ${total} linha(s) criadas no destino.`)
console.log(`\nDepois disto, na nuvem:`)
console.log(`  • rode um recalc geral se quiser as notas destas obras alinhadas ao modelo de lá`)
console.log(`  • confira uma obra na UI antes de considerar fechado (capa, tags, sinopse, notas)`)
