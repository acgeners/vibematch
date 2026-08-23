#!/usr/bin/env node
/**
 * Semeia o AUTH do stack LOCAL a partir do dado que o `db:pull` já trouxe. Idempotente.
 *
 *   node --env-file=.env.local --env-file=.env.analysis scripts/db-local-bootstrap-auth.mjs
 *   LOCAL_AUTH_PASSWORD='outra' npm run db:local:auth
 *
 * ALVO: LOCAL — e a guarda é dura, não convenção (ver `exigirAlvoLocal`). Este script GRAVA
 * senha; contra a nuvem isso mexeria na credencial de uma conta real.
 *
 * ── por que existe ────────────────────────────────────────────────────────────────────────
 *
 * `db:pull` destrói e recria o schema `public`, e duas coisas do AUTH ficam para trás:
 *
 *   1. o trigger `on_auth_user_created` mora em `auth.users` mas EXECUTA `public.handle_new_user()`.
 *      Dropar `public` em cascata leva o trigger junto; a FUNÇÃO volta no dump, o TRIGGER não.
 *      Sem ele, conta nova nasce sem linha em `user_settings` (sem display_name, sem
 *      preferências — `setHideAdultContent` falha com "sem linha pro usuário atual").
 *   2. os usuários da nuvem são Google-only (`encrypted_password` NULL) e o `config.toml` local
 *      vem com todo provider externo desligado. Sem uma senha LOCAL não há como entrar.
 *
 * O CLAUDE.md manda rodar SQL à mão depois de cada pull. Isso é um passo manual num caminho
 * que precisa ser repetível — e, com LOCAL PRIMARY, num banco que virou fonte da verdade.
 *
 * 🔴 Os usuários NÃO são chumbados aqui: eles são DERIVADOS de `public.user_settings`
 * (`auth_user_id` + `email`), que veio no dump. É o próprio dado declarando de quem ele é —
 * uma lista fixa de UUIDs neste arquivo divergiria da nuvem no primeiro cadastro novo.
 */
import { execFileSync } from "node:child_process"
import { exigirAlvoLocal, ehLocal } from "./lib/local-primary.mjs"

const URL_ALVO = process.env.NEXT_PUBLIC_SUPABASE_URL
const SENHA = process.env.LOCAL_AUTH_PASSWORD ?? "smoke-local-descartavel"

// A guarda vale SEMPRE aqui, não só sob LOCAL PRIMARY: escrever senha na nuvem é o desastre
// que este script não pode cometer nem antes da ativação do modo.
if (!ehLocal(URL_ALVO)) {
  console.error(`\n🔴 RECUSADO — o alvo é ${URL_ALVO || "(vazio)"}, que não é o stack local.`)
  console.error("   Este script GRAVA SENHA. Rode `npm run db:local` antes.\n")
  process.exit(1)
}
exigirAlvoLocal({ contexto: "db-local-bootstrap-auth" })

const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const sql = (q) =>
  execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
  }).trim()

console.log(`\n▶ bootstrap do AUTH local  (alvo ${URL_ALVO})`)

// ── 1. o trigger ─────────────────────────────────────────────────────────────────────────
const temFuncao = sql(
  `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='handle_new_user'`,
)
if (temFuncao === "0") {
  console.error("🔴 `public.handle_new_user()` não existe — o dump do `db:pull` não foi carregado.")
  process.exit(1)
}
sql(`drop trigger if exists on_auth_user_created on auth.users;
     create trigger on_auth_user_created after insert on auth.users
       for each row execute function public.handle_new_user();`)
console.log("  ✓ trigger on_auth_user_created  (recriado — idempotente por `drop if exists`)")

// ── 2. os usuários, DERIVADOS de user_settings ───────────────────────────────────────────
const alvos = sql(
  `select auth_user_id||'|'||email from user_settings
   where auth_user_id is not null and coalesce(email,'') <> '' order by email`,
)
  .split("\n")
  .filter(Boolean)
  .map((l) => { const [id, email] = l.split("|"); return { id, email } })

if (alvos.length === 0) {
  console.error("🔴 `user_settings` não declara nenhum (auth_user_id, email).")
  console.error("   Sem isso não há de quem derivar os usuários. O dump veio incompleto?")
  process.exit(1)
}

for (const { id, email } of alvos) {
  const existiaAntes = sql(`select count(*) from auth.users where id='${id}'`) !== "0"
  // 🔴 `on conflict (id)` e não por email: o UUID é o que as ~15 tabelas per-user referenciam.
  // Casar por email criaria um usuário novo com outro id e ORFANARIA toda a curadoria.
  sql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${email}', extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(),
      '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb, now(), now()
    )
    on conflict (id) do update set
      email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
      updated_at = now();`)
  console.log(`  ✓ ${email.padEnd(26)} ${id}  ${existiaAntes ? "(senha regravada)" : "(CRIADO)"}`)
}

// ── 3. conferência: o dado per-user aponta para usuário que existe? ──────────────────────
const orfaos = sql(
  `select count(distinct user_id) from user_work_state
   where user_id not in (select id from auth.users)`,
)
console.log(
  orfaos === "0"
    ? "  ✓ nenhum user_id órfão em user_work_state"
    : `  🔴 ${orfaos} user_id de user_work_state SEM usuário em auth.users`,
)
console.log(`\n  senha local: ${SENHA}   (só vale neste stack)\n`)
