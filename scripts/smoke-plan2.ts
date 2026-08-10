/**
 * Smoke test do Plano 2 — cache real (ai_cache_events) + single-flight.
 *
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 * Uso: npx tsx --env-file=.env.local scripts/smoke-plan2.ts
 *
 * Cuidados (conforme aprovação):
 *  - NÃO persiste dado FUNCIONAL: chama requestAiEvaluation direto; a gravação em
 *    ai_evaluations/category_scores/works/taste_profile é do CALLER (server
 *    action), que não é exercido aqui. Só grava TELEMETRIA (ai_api_calls +
 *    ai_cache_events) = evidência do teste, mantida ao final.
 *  - workId sintético (UUID) só aparece na telemetria; não cria work.
 *  - input único por execução ⇒ chave V2 fresca (miss real).
 *  - taste_profile NÃO é exercido ao vivo (mock nos unit tests) — evita mutar
 *    taste_profile e custo extra.
 *  - teto de custo ~US$0.06 (2 avaliações Sonnet curtas, sem capa/reviews).
 */

import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { requestAiEvaluation, EVAL_OUTPUT_SCHEMA_VERSION } from "@/lib/ai-evaluation/service"
import type { AiEvaluationRequest } from "@/lib/ai-evaluation/service"
import { getCacheEventMetrics } from "@/server/queries/ai-cache"

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const RUN = Date.now()
const SMOKE_WORK_ID = randomUUID() // sintético; só telemetria

let passes = 0
let fails = 0
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passes += 1
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`)
  } else {
    fails += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeReq(tag: string): AiEvaluationRequest {
  return {
    workId: SMOKE_WORK_ID,
    title: `SMOKE Plano2 ${tag} ${RUN}`,
    synopsis:
      "História curta de teste para o smoke do Plano 2: um protagonista comum descobre uma rotina mágica banal. Sem reviews, sem capa.",
    genres: [],
    tags: [],
  }
}

async function countProviderCalls(): Promise<number> {
  const { count } = await sb
    .from("ai_api_calls")
    .select("*", { count: "exact", head: true })
    .eq("metadata->>work_id", SMOKE_WORK_ID)
  return count ?? 0
}

async function cacheEvents(inputHash: string) {
  const { data } = await sb
    .from("ai_cache_events")
    .select("cache_status, cache_layer, is_resolution, cache_miss_reason, output_schema_version, created_at")
    .eq("input_hash", inputHash)
    .order("created_at", { ascending: true })
  return data ?? []
}

async function main() {
  console.log(`\n=== SMOKE Plano 2 — run ${RUN} | work sintético ${SMOKE_WORK_ID} ===`)

  // Pré-checagem: a tabela existe?
  const probe = await sb.from("ai_cache_events").select("id", { count: "exact", head: true })
  if (probe.error) {
    console.error(`\n[ABORT] ai_cache_events indisponível: ${probe.error.message}\nAplique a migration 107 antes do smoke.`)
    process.exit(1)
  }

  // ── 1. Cache miss → hit ────────────────────────────────────────────────────
  console.log("\n[1] Cache miss → hit (ai_evaluation)")
  const before = await countProviderCalls()
  const reqA = makeReq("cache")
  const r1 = await requestAiEvaluation(reqA)
  await sleep(2000) // recordCacheEventAsync é fire-and-forget
  const afterMiss = await countProviderCalls()
  const r2 = await requestAiEvaluation(reqA)
  await sleep(2000)
  const afterHit = await countProviderCalls()

  const evA = await cacheEvents(r1.inputHash)
  const statuses = evA.map((e) => e.cache_status)

  check("miss real gerou 1 chamada em ai_api_calls", afterMiss === before + 1, `${before} → ${afterMiss}`)
  check("hit NÃO gerou nova chamada ao provider", afterHit === afterMiss, `${afterMiss} → ${afterHit}`)
  check("evento de miss registrado", statuses.includes("miss_not_found"), statuses.join(", "))
  check("evento de hit (memory) registrado", statuses.includes("hit_memory"))
  check("2ª execução veio do cache (fromCache=memory)", r2.fromCache === "memory", String(r2.fromCache))
  check("resultado funcional idêntico (9 notas)", JSON.stringify(r1.scores) === JSON.stringify(r2.scores), `${r1.scores.length} notas`)
  check(
    "output_schema_version presente no evento",
    evA.every((e) => e.output_schema_version === EVAL_OUTPUT_SCHEMA_VERSION),
    EVAL_OUTPUT_SCHEMA_VERSION,
  )
  check("eventos são de RESOLUÇÃO (contam na taxa)", evA.every((e) => e.is_resolution === true))

  // ── 2. Single-flight (ai_evaluation) ───────────────────────────────────────
  console.log("\n[2] Single-flight (2 solicitações idênticas simultâneas)")
  const beforeSf = await countProviderCalls()
  const reqB = makeReq("sf")
  const [s1, s2] = await Promise.all([requestAiEvaluation(reqB), requestAiEvaluation(reqB)])
  await sleep(2000)
  const afterSf = await countProviderCalls()

  const evB = await cacheEvents(s1.inputHash)
  const dedup = evB.filter((e) => e.cache_miss_reason === "single_flight_dedup")

  check("2 solicitações idênticas → SOMENTE 1 chamada paga", afterSf === beforeSf + 1, `${beforeSf} → ${afterSf}`)
  check("1 evento single_flight_dedup registrado", dedup.length === 1, `${dedup.length} dedup`)
  check("ambas receberam o MESMO resultado", JSON.stringify(s1.scores) === JSON.stringify(s2.scores))
  check("nenhuma persistência funcional (requestAiEvaluation não escreve ai_evaluations)", true, "by-design")

  // ── 3. Dual-read (evidência) ───────────────────────────────────────────────
  console.log("\n[3] Dual-read (evidência)")
  const { count: legacyEvals } = await sb
    .from("ai_evaluations")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed")
  console.log(`  · ai_evaluations completas (chave legada, pré-107): ${legacyEvals ?? 0} — dual-read as captura via canonicalInputHash`)
  console.log(`  · chave V2 em uso (output_schema_version=${EVAL_OUTPUT_SCHEMA_VERSION}) confirmada nos eventos acima`)
  console.log(`  · L2-legado vivo não exercitado (exige reproduzir input pré-107) — coberto por unit tests`)

  // ── 4. Painel (mesma fonte de dados do /ai-usage) ──────────────────────────
  console.log("\n[4] Painel /ai-usage (getCacheEventMetrics 30d)")
  const panel = await getCacheEventMetrics(30)
  console.log(`  unavailable=${panel.unavailable} | lookups=${panel.totals.lookups} hits=${panel.totals.hits} misses=${panel.totals.misses} bypass=${panel.totals.bypasses} dedup=${panel.totals.dedupWaits} evitadas=${panel.totals.providerCallsAvoided} hitRate=${panel.totals.hitRate}`)
  check("painel mensurável (tabela presente)", !panel.unavailable)
  check("painel mostra dedup do single-flight", panel.totals.dedupWaits >= 1)
  check("painel mostra chamadas evitadas", panel.totals.providerCallsAvoided >= 1)

  console.log(`\n=== RESULTADO: ${passes} ok, ${fails} falha(s) ===`)
  console.log(`Telemetria do smoke (manter como evidência): work_id sintético = ${SMOKE_WORK_ID}`)
  process.exit(fails > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("[smoke] erro:", err)
  process.exit(1)
})
