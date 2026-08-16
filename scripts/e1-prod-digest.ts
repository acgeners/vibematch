/**
 * Consolida review_digest SOMENTE nas obras do escopo e1 (ver e1-prod-scope.ts)
 * que ainda NÃO têm digest. Pré-requisito do backfill do Interesse (o digest
 * entra na input_signature; consolidar DEPOIS deixaria as previsões stale).
 *
 * Casca fina: reusa `consolidateReviewsDigestDetailed` (mesma função do painel
 * /curation/settings) e o filtro canônico de `computeE1ProdScope`. PADRÃO = dry-run.
 * Execução paga exige --execute --max-cost-usd=<v>.
 *
 * ✅ Consertado em 2026-08-10, junto com `e1-prod-scope.ts` — o defeito era de lá: a Fase F
 * (`329a446`, 14/07/2026) tirou as 19 colunas pessoais de `works` e `computeE1ProdScope`
 * continuou lendo `personal_status_id` da tabela antiga. Este script só herdava o erro. Ficou
 * assim ~4 semanas porque nada roda os dois.
 *
 * ⚠️ O trabalho é MENOR do que "obras sem digest" sugere: são 136 sem digest, mas o escopo
 * exige >3 reviews e ≥20 tags, e dessas 136 **86 têm ZERO reviews** e 27 têm 1–2 — sobram ~23
 * obras (~US$0,42). O botão de digest da página da obra não depende daqui e funciona, uma a
 * uma. **Confira com o dry-run antes de acreditar neste número** — foi estimá-lo sem rodar a
 * ferramenta que produziu o "US$2,49 de trabalho pendente" sobre um script que nem executava.
 *
 * 🔴 ALVO: NUVEM (resolvido em 2026-08-10). A execução paga grava, e num local descartável
 * esse trabalho morre no próximo `db:pull` — paga-se para jogar fora. O `--execute` recusa
 * alvo local (`exigeAlvoNuvem`), e o npm script deixou de carregar `--env-file=.env.analysis`,
 * que o apontava pro LOCAL nos dois modos. A trava vale para quando o script voltar a rodar.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/e1-prod-digest.ts
 *   npx tsx ... scripts/e1-prod-digest.ts --execute --max-cost-usd=3 [--limit=10]
 *
 * Garantias: gate de custo agregado (não inicia chamada que estoure o teto),
 * custo REAL por usage, resume (re-rodar pega o que falta), cancelamento
 * cooperativo (SIGINT). Pula obras cujas reviews são curtas demais (skip).
 */
import "server-only"
import { readFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { computeE1ProdScope } from "./e1-prod-scope"
import {
  consolidateReviewsDigestDetailed,
  REVIEW_DIGEST_VERSION,
  REVIEW_DIGEST_MODEL,
} from "@/lib/ai-recommendation/review-summarizer"
import { computeCostUsd } from "@/lib/ai/pricing"
import { exigeAlvoNuvem } from "./lib/exige-alvo-nuvem"

const DIGEST_UPPER_PER_WORK = 0.05 // teto conservador p/ o gate (plano: $0,02–0,05)

const arg = (n: string): string | undefined => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`))
  return p ? p.slice(n.length + 3) : undefined
}
const hasFlag = (n: string) => process.argv.includes(`--${n}`)

async function main() {
  const execute = hasFlag("execute")
  // 🔴 ANTES de qualquer chamada paga: alvo local aqui significa pagar para jogar fora.
  if (execute) {
    exigeAlvoNuvem(
      "npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/e1-prod-digest.ts \\\n" +
        "       --execute --max-cost-usd=<v> [--limit=N]",
    )
  }
  const maxCostUsd = arg("max-cost-usd") != null ? Number(arg("max-cost-usd")) : undefined
  const limit = arg("limit") != null ? Math.max(1, Number(arg("limit"))) : undefined
  const idsFile = arg("ids-file") // lista explícita (CSV/linhas de UUID) — sobrepõe o escopo e1 filtrado

  const sb = createAdminClient()
  // Escopo: --ids-file (lista explícita) OU o filtro canônico e1. Em ambos os
  // casos processamos só as que AINDA não têm digest (resume-friendly).
  let pendingAll: string[]
  let scopeLabel: string
  if (idsFile) {
    const ids = [...new Set(readFileSync(idsFile, "utf8").trim().split(/[\s,]+/).filter(Boolean))]
    const noDigest: string[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from("works").select("id, review_digest").in("id", ids.slice(i, i + 200))
      if (error) throw new Error(`ids-file lookup: ${error.message}`)
      for (const r of data ?? []) if ((r as { review_digest: unknown }).review_digest == null) noDigest.push((r as { id: string }).id)
    }
    pendingAll = noDigest
    scopeLabel = `ids-file: ${ids.length} ids | sem digest: ${noDigest.length}`
  } else {
    const scope = await computeE1ProdScope(sb)
    pendingAll = scope.filteredNoDigest
    scopeLabel = `escopo e1 filtrado: filtradas ${scope.filtered.length} | sem digest: ${scope.filteredNoDigest.length}`
  }
  let pending = pendingAll
  if (limit != null) pending = pending.slice(0, limit)

  console.log("=== DIGEST ===")
  console.log(scopeLabel)
  console.log(`a processar nesta execução: ${pending.length}${limit != null ? ` (limit=${limit})` : ""}`)
  console.log(`custo estimado (upper, $${DIGEST_UPPER_PER_WORK}/obra): $${(pending.length * DIGEST_UPPER_PER_WORK).toFixed(2)}`)
  console.log(`modelo: ${REVIEW_DIGEST_MODEL}  versão: ${REVIEW_DIGEST_VERSION}`)

  if (!execute) {
    console.log(`\nDRY-RUN (nada gravado). Para executar:`)
    console.log(`  npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/e1-prod-digest.ts \\`)
    console.log(`    --execute --max-cost-usd=${Math.max(1, Math.ceil(pending.length * DIGEST_UPPER_PER_WORK))} [--limit=N]`)
    return
  }

  if (maxCostUsd == null || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    console.error("✗ --execute exige --max-cost-usd=<valor positivo>.")
    process.exit(2)
  }
  const upper = pending.length * DIGEST_UPPER_PER_WORK
  if (upper > maxCostUsd) {
    console.error(`✗ Upper bound ($${upper.toFixed(2)}) acima do teto ($${maxCostUsd.toFixed(2)}). Aumente --max-cost-usd ou use --limit.`)
    process.exit(1)
  }

  let cancel = false
  process.on("SIGINT", () => { if (!cancel) { cancel = true; console.log("\nSIGINT — parando após a obra atual.") } })
  process.on("SIGTERM", () => { if (!cancel) { cancel = true } })

  let attempted = 0, digested = 0, skipped = 0, failed = 0
  let spent = 0
  let consecutiveFailures = 0
  const MAX_CONSEC = 3

  for (const id of pending) {
    if (cancel) break
    if (spent + DIGEST_UPPER_PER_WORK > maxCostUsd) {
      console.log(`Teto atingido (gasto $${spent.toFixed(4)} + próximo > $${maxCostUsd}). Parando.`)
      break
    }
    attempted++
    const { data: revRows } = await sb
      .from("work_reviews")
      .select("source, text, user_rating")
      .eq("work_id", id)
    const inputs = (revRows ?? []).map((r) => ({
      source: (r.source as string | null) ?? "desconhecida",
      text: (r.text as string | null) ?? "",
      userRating: r.user_rating != null ? Number(r.user_rating) : null,
    }))
    const status = await consolidateReviewsDigestDetailed(inputs, { workId: id })
    if (status.kind === "skipped") {
      skipped++
      consecutiveFailures = 0
      continue
    }
    if (status.kind === "api_failed") {
      failed++
      consecutiveFailures++
      console.error(`  ✗ ${id}: ${status.error}`)
      if (consecutiveFailures >= MAX_CONSEC) {
        console.error(`Abortando: ${MAX_CONSEC} falhas consecutivas de API.`)
        break
      }
      continue
    }
    consecutiveFailures = 0
    const cost = computeCostUsd(REVIEW_DIGEST_MODEL, {
      inputTokens: status.result.tokensIn,
      outputTokens: status.result.tokensOut,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
    spent += cost.costInputUsd + cost.costOutputUsd + cost.costCacheReadUsd + cost.costCacheCreationUsd
    const nNonEmpty = inputs.filter((i) => i.text.trim().length > 0).length
    const { error: upErr } = await sb
      .from("works")
      .update({
        review_digest: status.result.digest,
        review_digest_at: new Date().toISOString(),
        review_digest_n: nNonEmpty,
        review_digest_version: REVIEW_DIGEST_VERSION,
      })
      .eq("id", id)
    if (upErr) {
      failed++
      console.error(`  ✗ update ${id}: ${upErr.message}`)
      continue
    }
    digested++
    if (digested % 10 === 0) console.log(`  …${digested} digests | gasto real $${spent.toFixed(4)}`)
  }

  console.log(`\n=== FIM ===`)
  console.log(`tentadas=${attempted} digeridas=${digested} puladas(skip)=${skipped} falhas=${failed}`)
  console.log(`custo REAL: $${spent.toFixed(4)}`)
  const remaining = pendingAll.length - digested
  console.log(`restam sem digest no escopo: ~${remaining}${remaining > 0 ? "  (re-rode p/ continuar)" : "  ✓"}`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e))
  process.exit(1)
})
