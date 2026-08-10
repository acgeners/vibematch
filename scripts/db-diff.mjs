/**
 * Compara LOCAL × NUVEM tabela a tabela, sem baixar o banco.
 *
 * Por que existe: em 2026-08-10 descobrimos 190 notas divergentes entre os dois bancos que
 * ninguém tinha notado — mesmo número de linhas, mesmas chaves, zero órfãos. **A divergência
 * é silenciosa**: só um diff de VALOR mostra, e ninguém roda isso por hábito. Some-se que o
 * `db:push-curation` falhava em toda execução por uma FK (consertado no mesmo dia), e o
 * resultado foi meses de deriva sem nenhum sinal.
 *
 * Como funciona: calcula um hash de conteúdo por tabela **nos dois lados** e compara os
 * hashes. Só quando divergem é que desce ao detalhe. Custo de rede desprezível — a nuvem
 * responde pelo endpoint SQL da Management API, que não passa pelo PostgREST e não conta no
 * egress relevante ([[project-supabase-egress-quota-402]]).
 *
 * Uso:
 *   node scripts/db-diff.mjs                    # todas as tabelas
 *   node scripts/db-diff.mjs category_scores    # uma tabela, com detalhe por linha
 *   node scripts/db-diff.mjs --com-volateis     # inclui updated_at (ver abaixo)
 *
 * 🔴 `updated_at` FICA DE FORA por padrão, e isso não é preguiça. Cinco tabelas têm um
 * trigger `BEFORE UPDATE` que faz `NEW.updated_at = now()` — o DESTINO reescreve a coluna no
 * ato da gravação. Efeito medido: depois de um push, o conteúdo de `works` batia byte a byte
 * nos dois bancos e só o `updated_at` diferia. Incluí-la faria este script gritar
 * "divergente" em toda tabela, para sempre, logo após cada sincronização bem-sucedida.
 *
 * ⚠️ Corolário: **`updated_at` não serve para decidir "quem é mais novo"** numa estratégia de
 * last-write-wins. O ato de sincronizar destrói a evidência, e sempre a favor do destino —
 * a regra não empataria, inverteria.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const ARGS = process.argv.slice(2)
const COM_VOLATEIS = ARGS.includes("--com-volateis")
const ALVOS = ARGS.filter((a) => !a.startsWith("--"))

/** Colunas cujo valor o destino reescreve sozinho — comparar é ruído garantido. */
const VOLATEIS = new Set(COM_VOLATEIS ? [] : ["updated_at"])

const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

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

// ⚠️ O ref da NUVEM sai de `.env.supabase-cloud`, nunca do `.env.local` — este alterna com
// `db:local`/`db:cloud` e ainda carrega uma URL COMENTADA de um projeto morto (Ohio). Um
// regex ingênuo no .env.local acha a morta e consulta o banco errado, que responde normal.
const TOKEN = env(".env.local").SUPABASE_ACCESS_TOKEN
const REF = (env(".env.supabase-cloud").NEXT_PUBLIC_SUPABASE_URL ?? "").match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/,
)?.[1]
if (!TOKEN || !REF) {
  console.error("faltam SUPABASE_ACCESS_TOKEN (.env.local) ou a URL da nuvem (.env.supabase-cloud)")
  process.exit(1)
}

function local(sql) {
  return execFileSync("psql", [LOCAL_URL, "-At", "-c", sql], { encoding: "utf8" }).trim()
}

async function nuvem(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`)
  return JSON.parse(body)
}

/** Colunas em comum, já sem as voláteis — protege contra drift de schema entre os bancos. */
async function colunasComuns(tabela) {
  const q = `select column_name from information_schema.columns
             where table_schema='public' and table_name='${tabela}' order by column_name`
  const aqui = new Set(local(q).split("\n").filter(Boolean))
  const la = new Set((await nuvem(q)).map((r) => r.column_name))
  return [...aqui].filter((c) => la.has(c) && !VOLATEIS.has(c))
}

/**
 * Expressão de linha, NULL-SAFE.
 *
 * 🔴 A 1ª versão era `col1::text || '|' || col2::text || …` embrulhada num `coalesce(…, '')`,
 * e isso tornava o script INÚTIL sem nada acusar. Em SQL, `NULL || qualquer_coisa = NULL`:
 * UMA coluna nula anula a concatenação da linha INTEIRA, o `coalesce` a transforma em `''` e
 * a linha vira `md5('')` — o mesmo valor pra qualquer conteúdo. Como quase toda linha larga
 * tem algum NULL, o hash da tabela passava a depender só da CONTAGEM.
 *
 * Medido em 2026-08-10, `works` com apenas 5 colunas: 981 linhas → **223 hashes distintos**
 * (758 colapsaram). Com as 36 colunas reais o script dizia "✓ idêntico" enquanto `works`
 * divergia de verdade — o push acusou a divergência e o diff a desmentiu.
 *
 * É a pior classe de bug do projeto: **um erro que produz resultado**. O `coalesce` por
 * COLUNA é o que conserta; a sentinela e o separador são caracteres de controle porque
 * `'\N'` e `'|'` podem aparecer no dado e provocariam colisão posicional.
 */
function rowExpr(cols) {
  return cols.map((c) => `coalesce(t."${c}"::text, chr(1))`).join(" || chr(2) || ")
}

/** Hash do conteúdo inteiro da tabela, estável entre bancos (ordem explícita por chave). */
function sqlHash(tabela, cols, chave) {
  return `select count(*) as n, coalesce(md5(string_agg(md5(${rowExpr(cols)}), '' order by ${chave})), '-') as h
          from public.${tabela} t`
}

async function chaveDe(tabela) {
  const q = `select kcu.column_name from information_schema.table_constraints tc
             join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
             where tc.table_schema='public' and tc.table_name='${tabela}' and tc.constraint_type='PRIMARY KEY'
             order by kcu.ordinal_position`
  const ks = local(q).split("\n").filter(Boolean)
  return ks.length ? ks.map((k) => `t."${k}"`).join(", ") : null
}

function pad(s, n) { return String(s).length >= n ? String(s) : String(s) + " ".repeat(n - String(s).length) }

async function main() {
  console.log(`local: ${LOCAL_URL.replace(/:[^:@]*@/, ":…@")}`)
  console.log(`nuvem: ${REF}${COM_VOLATEIS ? "" : "   (updated_at fora da comparação — ver cabeçalho)"}\n`)

  const tabelas = ALVOS.length
    ? ALVOS
    : local(`select table_name from information_schema.tables
             where table_schema='public' and table_type='BASE TABLE' order by table_name`)
        .split("\n").filter(Boolean)

  const divergentes = []
  console.log(pad("tabela", 32) + pad("local", 10) + pad("nuvem", 10) + "conteúdo")
  for (const t of tabelas) {
    let chave, cols
    try {
      chave = await chaveDe(t)
      if (!chave) { console.log(pad(t, 32) + "— sem PK, pulada"); continue }
      cols = await colunasComuns(t)
    } catch { console.log(pad(t, 32) + "— erro lendo schema"); continue }

    const sql = sqlHash(t, cols, chave)
    let aqui, la
    try {
      const [n, h] = local(sql).split("|")
      aqui = { n: Number(n), h }
      const r = (await nuvem(sql))[0]
      la = { n: Number(r.n), h: r.h }
    } catch (e) { console.log(pad(t, 32) + `— erro: ${String(e).slice(0, 40)}`); continue }

    const igual = aqui.h === la.h
    if (!igual) divergentes.push({ t, aqui, la, cols, chave })
    console.log(pad(t, 32) + pad(aqui.n, 10) + pad(la.n, 10) + (igual ? "✓ idêntico" : "✗ DIVERGE"))
  }

  if (!divergentes.length) {
    console.log(`\n✓ os dois bancos estão idênticos nas colunas comparadas.`)
    return
  }

  console.log(`\n${"=".repeat(78)}\n${divergentes.length} tabela(s) divergente(s) — detalhe\n${"=".repeat(78)}`)
  for (const d of divergentes) {
    const dLinhas = d.aqui.n - d.la.n
    console.log(`\n${d.t}: ${d.aqui.n} local × ${d.la.n} nuvem` +
      (dLinhas === 0 ? "  (mesma contagem ⇒ diferença é de VALOR)" : `  (${dLinhas > 0 ? "+" : ""}${dLinhas} no local)`))

    // Só desce ao detalhe quando pedido explicitamente: comparar linha a linha em 40k linhas
    // é caro e raramente é o que se quer numa varredura geral.
    if (!ALVOS.includes(d.t)) { console.log(`  (rode \`node scripts/db-diff.mjs ${d.t}\` pro detalhe por linha)`); continue }

    const q = `select ${d.chave.split(", ")[0]} as k, md5(${rowExpr(d.cols)}) as h from public.${d.t} t`
    const A = new Map(local(q).split("\n").filter(Boolean).map((l) => l.split("|")))
    const B = new Map((await nuvem(q)).map((r) => [String(r.k), r.h]))
    const soLocal = [...A.keys()].filter((k) => !B.has(k))
    const soNuvem = [...B.keys()].filter((k) => !A.has(k))
    const difValor = [...A.keys()].filter((k) => B.has(k) && B.get(k) !== A.get(k))
    console.log(`  só no local: ${soLocal.length} · só na nuvem: ${soNuvem.length} · valor diferente: ${difValor.length}`)

    // 🔴 Sentinela contra o bug de COLAPSO que este script já teve (ver `rowExpr`): se muitas
    // linhas distintas compartilham o mesmo hash, a comparação está cega e o "✓ idêntico" das
    // outras tabelas não vale nada. É barato — os hashes já estão em memória.
    const distintos = new Set(A.values()).size
    if (A.size >= 20 && distintos <= A.size / 2) {
      console.log(`  🔴 ${A.size} linhas → apenas ${distintos} hashes distintos. A expressão de`)
      console.log(`     linha está COLAPSANDO e o resultado deste script não é confiável.`)
    }

    // 🔴 Assinatura de CHAVE REGENERADA, não de dado divergente: N só de um lado, N só do
    // outro, ZERO com valor diferente. Acontece em tabela delete-e-reinsere, onde a linha
    // volta com `id` novo — `platform_ratings` é assim (ver CLAUDE.md). Medido em
    // 2026-08-10: 240/240/0 nela, e o conteúdo batia 100% pela chave natural. Sem este
    // aviso o script acusa divergência eterna numa tabela perfeitamente sincronizada.
    if (soLocal.length > 0 && soLocal.length === soNuvem.length && difValor.length === 0) {
      console.log(`  ⚠️ mesma quantidade dos dois lados e ZERO valor diferente — assinatura de`)
      console.log(`     CHAVE SURROGATE REGENERADA (delete-e-reinsere), não de dado divergente.`)
      console.log(`     Compare pela chave NATURAL antes de concluir que há deriva.`)
    }

    for (const k of soNuvem.slice(0, 5)) console.log(`    só na nuvem: ${k}`)
    for (const k of difValor.slice(0, 5)) console.log(`    valor difere: ${k}`)
  }

  console.log(`\n⚠️ Divergência não implica erro: a nuvem recebe escrita de leitores e o push é`)
  console.log(`   insert-if-missing nas tabelas de avaliação — linha só na nuvem é o esperado.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
