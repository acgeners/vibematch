#!/usr/bin/env node
/**
 * Backup do banco LOCAL enquanto ele é a fonte da verdade temporária (LOCAL PRIMARY).
 *
 *   npm run db:local:backup
 *   node --env-file=.env.local --env-file=.env.analysis scripts/db-local-backup.mjs
 *
 * ALVO: LOCAL. Guarda dura em `exigirAlvoLocal` — este script não fala com a nuvem.
 *
 * 🔴 Por que não reusar `backup-db.mjs`: aquele grava NDJSON **só de dado**, pelo PostgREST, e
 * NÃO tem restore. Enquanto o local era descartável isso bastava (a nuvem era a verdade e o
 * `db:pull` reconstruía tudo). Com LOCAL PRIMARY o original não existe em outro lugar, então o
 * backup precisa de duas coisas que aquele não dá: **schema junto do dado** e um **caminho de
 * volta provado**. `pg_dump` dá as duas, e é o mesmo mecanismo que o `db:pull` já usa.
 *
 * O que entra:
 *   - schema `public` COMPLETO (schema + dado + policies + functions + triggers)
 *   - os UUIDs de `auth.users` — só `id` e `email`, o mínimo para o `db:local:auth` recriar
 *     as contas. Senha NÃO é preservada de propósito: ela é local e descartável, e o bootstrap
 *     a regrava.
 *
 * ⚠️ Storage local NÃO entra: hoje o bucket local está vazio (os 19 ícones de critério vivem
 * na nuvem e estão inacessíveis por 402). No dia em que houver objeto local relevante, isto
 * precisa crescer — e o aviso é impresso ao fim de toda execução para não virar omissão calada.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import { exigirAlvoLocal, ehLocal, registrarBackup } from "./lib/local-primary.mjs"
import { podar } from "./lib/backups-retencao.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

if (!ehLocal(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error(`\n🔴 RECUSADO — alvo ${process.env.NEXT_PUBLIC_SUPABASE_URL || "(vazio)"} não é local.`)
  console.error("   Rode `npm run db:local` antes.\n")
  process.exit(1)
}
exigirAlvoLocal({ contexto: "db-local-backup" })

// 🔴 Conferir os binarios ANTES de criar o diretorio. Sob launchd o PATH e minimo e o
// `pg_dump` do Homebrew fica fora dele: sem esta checagem o job criava o diretorio, morria
// com ENOENT e deixava uma pasta VAZIA em `.backups/` — indistinguivel, na listagem, de um
// backup que rodou e nao achou nada. Foi assim que 3 semanas de falha passaram despercebidas.
for (const bin of ["pg_dump", "psql"]) {
  const r = spawnSync(bin, ["--version"], { stdio: "ignore" })
  if (r.error) {
    console.error(`\n🔴 BACKUP FALHOU — \`${bin}\` nao esta no PATH.`)
    console.error(`   PATH atual: ${process.env.PATH}`)
    console.error(`   No launchd o PATH e o do plist, nao o do seu shell. Nada foi gravado.\n`)
    process.exit(1)
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const dir = path.join(ROOT, ".backups", `local-primary-${stamp}`)
fs.mkdirSync(dir, { recursive: true })

console.log(`\n▶ backup do LOCAL → ${path.relative(ROOT, dir)}`)

// 1. schema public completo
execFileSync("pg_dump", [DB, "--schema=public", "--no-owner", "--no-privileges", "-f", path.join(dir, "public.sql")], { stdio: "inherit" })
// 2. os UUIDs do auth (o bootstrap recria o resto)
const users = execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-c",
  "select coalesce(json_agg(json_build_object('id',id,'email',email)),'[]') from auth.users"], { encoding: "utf8" }).trim()
fs.writeFileSync(path.join(dir, "auth-users.json"), users + "\n")

// 3. as contagens que o restore vai ter que reproduzir
// 🔴 count(*) EXATO, nunca `n_live_tup`: aquilo é estimativa do planner, atualizada por
// autovacuum, e um backup validado contra estimativa valida contra um número que pode não ser
// o do banco. É a contagem que o restore vai ter que reproduzir — precisa ser fato.
const counts = execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-c",
  `select coalesce(json_object_agg(table_name, n),'{}') from (
     select c.relname table_name,
            (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', c.relname), false, true, '')))[1]::text::bigint n
     from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r') t`],
  { encoding: "utf8" }).trim()
fs.writeFileSync(path.join(dir, "counts.json"), counts + "\n")

const bytes = fs.statSync(path.join(dir, "public.sql")).size
const contagens = JSON.parse(counts)

// 🔴 FAIL-CLOSED. Tabela crítica vazia é falha de acesso, não estado: o catálogo nunca fica
// vazio. Sem isto, um banco fora do ar produz backup válido-looking e some com o alarme.
const CRITICAS = ["works", "category_scores", "ai_evaluations", "user_work_state", "work_reviews", "work_tags"]
const vazias = CRITICAS.filter((t) => !(contagens[t] > 0))
if (vazias.length) {
  console.error(`\n🔴 BACKUP FALHOU — tabela crítica vazia: ${vazias.join(", ")}`)
  console.error(`   Um banco primário real nunca fica assim. Backup DESCARTADO.\n`)
  fs.rmSync(dir, { recursive: true, force: true })
  process.exit(1)
}

// 🔴 Piso contra o backup ANTERIOR: encolher é sinal, não rotina. O corte é 10% porque
// curadoria só cresce; queda maior que isso significa restore parcial, banco errado ou perda.
const anteriores = fs.readdirSync(path.join(ROOT, ".backups"))
  .filter((n) => /^local-primary-\d{4}-\d{2}-\d{2}T/.test(n) && n !== path.basename(dir)).sort()
const ultimo = anteriores.at(-1)
if (ultimo) {
  const antesPath = path.join(ROOT, ".backups", ultimo, "counts.json")
  if (fs.existsSync(antesPath)) {
    const prev = JSON.parse(fs.readFileSync(antesPath, "utf8"))
    const quedas = CRITICAS
      .filter((t) => prev[t] > 0 && contagens[t] < prev[t] * 0.9)
      .map((t) => `${t}: ${prev[t]} → ${contagens[t]}`)
    if (quedas.length) {
      console.error(`\n🔴 BACKUP FALHOU — queda >10% contra ${ultimo}:`)
      quedas.forEach((q) => console.error(`     ${q}`))
      console.error(`   Se a queda for legítima, rode com BACKUP_ACEITA_QUEDA=1.\n`)
      if (process.env.BACKUP_ACEITA_QUEDA !== "1") {
        fs.rmSync(dir, { recursive: true, force: true })
        process.exit(1)
      }
    }
  }
}

const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "public.sql"))).digest("hex")
fs.writeFileSync(path.join(dir, "public.sql.sha256"), `${sha}  public.sql\n`)
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
  criadoEm: new Date().toISOString(), origem: "local", schemas: ["public", "auth.users(id,email)"],
  bytesPublicSql: bytes, sha256PublicSql: sha, linhasPorTabela: contagens, storageIncluido: false,
}, null, 2) + "\n")

console.log(`  ✓ public.sql        ${(bytes / 1048576).toFixed(1)} MB`)
console.log(`  ✓ auth-users.json   ${JSON.parse(users).length} usuários (id + email)`)
console.log(`  ✓ counts.json       ${Object.keys(JSON.parse(counts)).length} tabelas`)
console.log("  ⚠️ Storage NÃO incluído (bucket local vazio hoje). Reveja quando houver objeto local.")

// 🔴 Cópia FORA do mesmo armazenamento. O backup de 23/08 sobreviveu por acidente: ele estava
// no repo, não dentro do Docker.raw que foi apagado. Cópia que mora no mesmo volume do primário
// morre junto com ele — foi exatamente o que quase aconteceu.
const EXTERNO = process.env.BACKUP_EXTERNO_DIR
  ?? path.join(process.env.HOME ?? "", "Library/CloudStorage/GoogleDrive-ac.generoso@gmail.com/Meu Drive/VibeMatch-Backups")
try {
  if (!fs.existsSync(path.dirname(EXTERNO))) throw new Error(`destino externo indisponível: ${path.dirname(EXTERNO)}`)
  const destino = path.join(EXTERNO, path.basename(dir))
  fs.mkdirSync(destino, { recursive: true })
  for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(destino, f))
  const shaLa = crypto.createHash("sha256").update(fs.readFileSync(path.join(destino, "public.sql"))).digest("hex")
  if (shaLa !== sha) {
    console.error(`\n🔴 BACKUP FALHOU — a cópia externa não confere (${shaLa.slice(0, 12)} != ${sha.slice(0, 12)}).\n`)
    process.exit(1)
  }
  console.log(`  ✓ cópia externa     ${destino}  (sha256 conferido)`)
} catch (e) {
  // ⚠️ Fail-HARD, ao contrário do fail-soft do schema no backup-db.mjs: aqui a cópia externa É
  // o requisito. "Backup local feito, externo não" foi o estado que produziu a perda de 08/09.
  console.error(`\n🔴 BACKUP INCOMPLETO — o local foi gravado, mas a cópia externa falhou:`)
  console.error(`   ${e.message}`)
  console.error(`   Defina BACKUP_EXTERNO_DIR ou monte o destino, e rode de novo.\n`)
  process.exit(1)
}

podar("local-primary")
registrarBackup(path.relative(ROOT, dir))
console.log(`\n  restore:  npm run db:local:restore -- ${path.relative(ROOT, dir)}\n`)
