#!/usr/bin/env node
/**
 * Re-backfill de `user_work_state` a partir de `works` — o passo 1 da FATIA 1
 * (PLANO-MULTIUSER-FASE2.md §13.2). Equivalente em JS da migration 143, que é a
 * versão canônica: as migrations deste projeto são aplicadas À MÃO no SQL editor,
 * e este script existe pra rodar o mesmo backfill sem depender disso.
 *
 *   node scripts/rebackfill-user-work-state.mjs            → aplica
 *   node scripts/rebackfill-user-work-state.mjs --dry-run  → só relata o que mudaria
 *
 * Idempotente (upsert). Rodar de novo depois de aplicar a 143 é inofensivo.
 *
 * ⚠️ O `select` do Supabase corta em 1000 linhas SEM AVISAR e são 882 obras — o
 * dia em que passarem de 1000, um script não-paginado backfillaria as 1000
 * primeiras e diria "pronto". Por isso aqui tudo é paginado e conferido contra
 * `count: "exact"`: se a contagem final não bater com o número de obras, o script
 * FALHA em vez de mentir que terminou.
 *
 * Escopo: todo o estado de `works` é do DONO (a linha singleton de user_settings) —
 * `works` não tem coluna de dono, é a linha compartilhada do catálogo.
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { createClient } = require("@supabase/supabase-js")

const ROOT = path.resolve(import.meta.dirname, "..")
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local")
  process.exit(1)
}

const DRY = process.argv.includes("--dry-run")
const PAGE = 500
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

// Colunas espelhadas. As 4 primeiras são as VIVAS (dual-write daqui pra frente);
// o resto é a FOTOGRAFIA do corte — ninguém lê nem escreve, e envelhece (Fatia 2).
const READING = ["is_favorite", "personal_status_id", "chapters_read", "last_read_at"]
const SNAPSHOT = [
  "user_score", "observation_adjustment", "observations",
  "synopsis_quality", "synopsis_quality_source", "synopsis_quality_prediction_id",
  "synopsis_interest_skipped",
  "post_story_score", "post_fl_score", "post_ml_score", "post_character_development_score",
  "post_pacing_score", "post_art_visual_score", "post_impact_immersion_score",
  "post_originality_score",
]
const COLUMNS = [...READING, ...SNAPSHOT]

/**
 * ⚠️ Os dois lados NÃO têm o mesmo tipo: `works.last_read_at` é **date** ("2025-02-03") e
 * `user_work_state.last_read_at` é **timestamptz** (mig 138) — a mesma data volta da API como
 * "2025-02-03T00:00:00+00:00". Comparar as strings cruas acusa 209 falsas divergências.
 *
 * E não é só cosmético: meia-noite UTC, lida em UTC-3, é o DIA ANTERIOR. Quem ler esta coluna
 * tem que normalizar para o dia — é o que `personalStateFromRow()` faz em
 * server/queries/user-work-state.ts. Aqui, comparamos por dia.
 */
const day = (v) => (v == null ? null : String(v).slice(0, 10))

async function countExact(table, apply = (q) => q) {
  const { count, error } = await apply(sb.from(table).select("*", { count: "exact", head: true }))
  if (error) throw new Error(`count ${table}: ${error.message}`)
  return count ?? 0
}

/**
 * Lê a tabela inteira, paginando. Confere contra `count: "exact"` — some uma linha, falha.
 *
 * `orderBy` precisa ser estável: sem ORDER BY, o Postgres não promete a mesma ordem entre
 * as páginas, e o `range()` devolveria linhas repetidas e linhas nunca vistas. `user_work_state`
 * não tem coluna `id` (a PK é composta), daí o parâmetro.
 */
async function selectAllPaged(table, columns, orderBy, apply = (q) => q) {
  const expected = await countExact(table, apply)
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(
      sb.from(table).select(columns).order(orderBy, { ascending: true }).range(from, from + PAGE - 1),
    )
    if (error) throw new Error(`select ${table}: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  if (rows.length !== expected) {
    throw new Error(
      `${table}: li ${rows.length} linhas mas o count exato diz ${expected}. ` +
        `Backfill truncado é pior que backfill nenhum — abortando.`,
    )
  }
  return rows
}

async function main() {
  // Dono = singleton (a linha mais antiga de user_settings), o mesmo critério da mig 138/143.
  const { data: owner, error: ownerErr } = await sb
    .from("user_settings")
    .select("current_user_id, email, role")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (ownerErr) throw new Error(`user_settings: ${ownerErr.message}`)
  if (!owner?.current_user_id) throw new Error("user_settings sem linha singleton.")

  const ownerId = owner.current_user_id
  console.log(`dono (singleton): ${ownerId}  ${owner.email ?? ""} [${owner.role ?? "?"}]`)

  const works = await selectAllPaged("works", ["id", ...COLUMNS].join(", "), "id")
  console.log(`works: ${works.length} linhas lidas (paginado, conferido contra count exato)`)

  const before = await countExact("user_work_state", (q) => q.eq("user_id", ownerId))
  console.log(`user_work_state (dono), antes: ${before} linhas`)

  const now = new Date().toISOString()
  const rows = works.map((w) => ({
    user_id: ownerId,
    work_id: w.id,
    is_favorite: w.is_favorite ?? false,
    personal_status_id: w.personal_status_id ?? null,
    chapters_read: w.chapters_read ?? null,
    last_read_at: w.last_read_at ?? null,
    user_score: w.user_score ?? null,
    observation_adjustment: w.observation_adjustment ?? 0,
    observations: w.observations ?? null,
    synopsis_quality: w.synopsis_quality ?? null,
    synopsis_quality_source: w.synopsis_quality_source ?? "legacy_unknown",
    synopsis_quality_prediction_id: w.synopsis_quality_prediction_id ?? null,
    synopsis_interest_skipped: w.synopsis_interest_skipped ?? false,
    post_story_score: w.post_story_score ?? null,
    post_fl_score: w.post_fl_score ?? null,
    post_ml_score: w.post_ml_score ?? null,
    post_character_development_score: w.post_character_development_score ?? null,
    post_pacing_score: w.post_pacing_score ?? null,
    post_art_visual_score: w.post_art_visual_score ?? null,
    post_impact_immersion_score: w.post_impact_immersion_score ?? null,
    post_originality_score: w.post_originality_score ?? null,
    updated_at: now,
  }))

  if (DRY) {
    const favs = rows.filter((r) => r.is_favorite).length
    const withStatus = rows.filter((r) => r.personal_status_id != null).length
    const withChapters = rows.filter((r) => r.chapters_read != null).length
    console.log(
      `\n[dry-run] escreveria ${rows.length} linhas: ${favs} favoritas, ` +
        `${withStatus} com status, ${withChapters} com capítulos lidos.`,
    )
    return
  }

  for (let i = 0; i < rows.length; i += PAGE) {
    const chunk = rows.slice(i, i + PAGE)
    const { error } = await sb
      .from("user_work_state")
      .upsert(chunk, { onConflict: "user_id,work_id" })
    if (error) throw new Error(`upsert user_work_state: ${error.message}`)
    console.log(`  upsert ${Math.min(i + PAGE, rows.length)}/${rows.length}`)
  }

  // A prova: uma linha do dono por obra, e o estado de leitura idêntico ao de works.
  const after = await countExact("user_work_state", (q) => q.eq("user_id", ownerId))
  if (after !== works.length) {
    throw new Error(`esperava ${works.length} linhas do dono, o banco tem ${after}.`)
  }

  const state = await selectAllPaged(
    "user_work_state",
    ["work_id", ...READING].join(", "),
    "work_id",
    (q) => q.eq("user_id", ownerId),
  )
  const byWork = new Map(state.map((s) => [s.work_id, s]))
  const drift = works.filter((w) => {
    const s = byWork.get(w.id)
    if (!s) return true
    return (
      Boolean(s.is_favorite) !== Boolean(w.is_favorite ?? false) ||
      (s.personal_status_id ?? null) !== (w.personal_status_id ?? null) ||
      (s.chapters_read ?? null) !== (w.chapters_read ?? null) ||
      day(s.last_read_at) !== day(w.last_read_at)
    )
  })
  if (drift.length > 0) {
    throw new Error(`${drift.length} obras com estado de leitura divergente após o backfill.`)
  }

  const favs = rows.filter((r) => r.is_favorite).length
  const withStatus = rows.filter((r) => r.personal_status_id != null).length
  const withChapters = rows.filter((r) => r.chapters_read != null).length
  console.log(
    `\n✅ ${after} linhas do dono (${before} antes) · ${favs} favoritas · ${withStatus} com status · ` +
      `${withChapters} com capítulos · estado de leitura idêntico a works em todas as ${works.length}.`,
  )
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`)
  process.exit(1)
})
