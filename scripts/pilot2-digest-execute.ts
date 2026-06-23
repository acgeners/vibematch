/**
 * CLI — EXECUÇÃO PAGA dos 71 digests text-only-v1 sob o base-2r1 (Plano 3 Fase B2.2T). Wira o
 * runner `runTextOnlyDigest` ao adapter Anthropic REAL, com um `send` que NÃO loga no banco
 * (chama o SDK direto, sem `createLoggedMessage` ⇒ 0 INSERT em ai_api_calls). READ-ONLY no banco
 * (só SELECT de reviews). Escreve SÓ no storage experimental local (digests-text-only-v1/works/).
 *
 * GATES (antes da 1ª chamada): planSignature + base2r1Signature + contrato + implementação +
 * selectionPolicyVersion + 71 entradas + 19 no_reviews + pricing 3/15. Divergência ⇒ PLAN_INVALIDATED.
 * COST: hard cap absoluto (estimate-cap do runner em UPPER + guard por custo REAL acumulado).
 * Sem retry pago de aplicação (1 geração por obra; falha ⇒ status failed). Sem --execute = dry-gates.
 *
 * Uso (dry, só gates): npm run pilot2:digest-execute
 * Execução PAGA:        npm run pilot2:digest-execute -- --execute --plan-signature=<sig> --max-cost-usd=4.82
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import type Anthropic from "@anthropic-ai/sdk"
import { readCanonicalReviewCorpus } from "@/lib/synopsis-interest/digest-corpus"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { deepStripLoneSurrogates } from "@/lib/ai/sanitize"
import { computeCostUsd, priceForModel, PRICING_SNAPSHOT_TAG } from "@/lib/ai/pricing"
import { estimateStep } from "@/lib/orchestration/cost"
import {
  EXPERIMENT_DIGEST_MODEL,
  EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
  computeDigestContractSignature,
  computeDigestImplementationSignature,
} from "@/lib/synopsis-interest/digest-text-only"
import { createAnthropicDigestAdapter, type AnthropicSend } from "@/lib/synopsis-interest/digest-text-only-adapter"
import {
  runTextOnlyDigest,
  nodeFs,
  type FrozenWork,
  type CurrentCorpus,
  type WorkOutcomeStatus,
} from "@/lib/synopsis-interest/digest-text-only-runner"
import { computeDigestPlanSignature, type DigestPlanEntry, type DigestPlanVersions } from "@/lib/synopsis-interest/digest-plan"

// ── Autorização humana (vale SÓ p/ este plano/assinaturas) ──────────────────────
const AUTH = {
  planSignature: "2a2fde38eb15d8b0fab0cb942455b8cb022b143d5e548de786895fccdecb8a20",
  base2r1Signature: "b9dc2f2751af6ae738d79801d46f4aedd72c45e330a60bd49194c979233436a6",
  digestContractSignature: "41fad884c81d121fda676d5a24aae29a0254a3654fd6b02458605471ca29251e",
  digestImplementationSignature: "c0bdd9608c614eb84e2f16cf4a83ca1ae86e1585cf328c4bfd416466685370d2",
  selectionPolicyVersion: "normalized-text-js-code-unit-order-cap40-v1",
  model: "claude-sonnet-4-6",
  count: 71,
  noReviews: 19,
  softCapUsd: 3.22,
  hardCapUsd: 4.82,
  pricePerMTok: { input: 3, output: 15 },
}

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2/base-2r1"
const SNAP = resolve(DIR, "base-2r1-snapshot.json")
const PLAN = resolve(DIR, "digest-execution-plan.json")
const RUN_MANIFEST = resolve(DIR, "digests-text-only-v1", "run-manifest.json")

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"
const arg = (name: string): string | undefined => { const p = process.argv.find((a) => a.startsWith(`--${name}=`)); return p ? p.slice(name.length + 3) : undefined }
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`)

interface SnapWork { workId: string; reviewsAfterDedupe: number; reviewCorpusSignature: string; digestSelectionSignature: string; digestSelectionNormalizedHashes: string[] }
interface Snapshot { base2r1Signature: string; reviewCorpusAggregateSignature: string; digestSelectionAggregateSignature: string; versions: { derivedFrom: { base2Signature: string } }; works: SnapWork[] }
interface Plan { planSignature: string; count: number; versions: DigestPlanVersions; entries: DigestPlanEntry[] }

function fail(msg: string): never { console.error(`⛔ PLAN_INVALIDATED — ${msg}`); process.exit(1) }

async function main(): Promise<void> {
  const snap = JSON.parse(readFileSync(SNAP, "utf8")) as Snapshot
  const plan = JSON.parse(readFileSync(PLAN, "utf8")) as Plan

  // ── §1 GATES de identidade (antes de qualquer chamada) ──
  const contractSig = computeDigestContractSignature()
  const implSig = computeDigestImplementationSignature()
  if (EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION !== AUTH.selectionPolicyVersion) fail(`selectionPolicyVersion ${EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION} ≠ ${AUTH.selectionPolicyVersion}`)
  if (contractSig !== AUTH.digestContractSignature) fail(`digestContractSignature ${contractSig} ≠ autorizada`)
  if (implSig !== AUTH.digestImplementationSignature) fail(`digestImplementationSignature ${implSig} ≠ autorizada`)
  if (snap.base2r1Signature !== AUTH.base2r1Signature) fail(`snapshot base2r1Signature ≠ autorizada`)
  if (plan.versions.base2r1Signature !== AUTH.base2r1Signature) fail(`plan base2r1Signature ≠ autorizada`)
  if (plan.versions.digestContractSignature !== AUTH.digestContractSignature) fail("plan digestContractSignature ≠ autorizada")
  if (plan.versions.digestImplementationSignature !== AUTH.digestImplementationSignature) fail("plan digestImplementationSignature ≠ autorizada")
  if (plan.count !== AUTH.count || plan.entries.length !== AUTH.count) fail(`contagem do plano ${plan.count}/${plan.entries.length} ≠ ${AUTH.count}`)

  // planSignature recomputada do plano no disco (caps do manifesto = soft/hard autorizados).
  const recomputedPlanSig = computeDigestPlanSignature(plan.versions, plan.entries, { softCapUsd: AUTH.softCapUsd, hardCapUsd: AUTH.hardCapUsd })
  if (recomputedPlanSig !== AUTH.planSignature) fail(`planSignature recomputada ${recomputedPlanSig} ≠ autorizada ${AUTH.planSignature}`)
  if (plan.planSignature !== AUTH.planSignature) fail(`plan.planSignature no disco ≠ autorizada`)

  // 90 = 71 com reviews + 19 no_reviews; os 71 do plano == os 71 com reviews do snapshot.
  const withReviews = snap.works.filter((w) => w.reviewsAfterDedupe > 0)
  const noReviews = snap.works.filter((w) => w.reviewsAfterDedupe === 0)
  if (noReviews.length !== AUTH.noReviews) fail(`no_reviews ${noReviews.length} ≠ ${AUTH.noReviews}`)
  const planIds = new Set(plan.entries.map((e) => e.workId))
  const withIds = new Set(withReviews.map((w) => w.workId))
  if (planIds.size !== withIds.size || [...planIds].some((id) => !withIds.has(id))) fail("workIds do plano ≠ obras com reviews do snapshot")

  // ── §2 GATE de pricing (config real) ──
  const price = priceForModel(AUTH.model)
  if (!price) fail(`pricing desconhecido p/ ${AUTH.model}`)
  if (price.inputPerMTok !== AUTH.pricePerMTok.input || price.outputPerMTok !== AUTH.pricePerMTok.output) {
    console.error(`⛔ pricing divergente: ${price.inputPerMTok}/${price.outputPerMTok} ≠ ${AUTH.pricePerMTok.input}/${AUTH.pricePerMTok.output} — parar e recalcular o plano.`)
    process.exit(1)
  }

  console.log("=== GATES OK (identidade + pricing) ===")
  console.log(`planSignature: ${AUTH.planSignature}`)
  console.log(`base2r1Signature: ${snap.base2r1Signature}`)
  console.log(`contract: ${contractSig}  impl: ${implSig}`)
  console.log(`selectionPolicyVersion: ${EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION}`)
  console.log(`71 entradas · 19 no_reviews · pricing ${price.inputPerMTok}/${price.outputPerMTok} (${PRICING_SNAPSHOT_TAG})`)

  if (!hasFlag("execute")) {
    console.log("\n[DRY] sem --execute: gates validados, NENHUMA chamada ao modelo. $0.")
    console.log(`Para executar: npm run pilot2:digest-execute -- --execute --plan-signature=${AUTH.planSignature} --max-cost-usd=${AUTH.hardCapUsd}`)
    return
  }

  // ── Confirmação dos args de execução paga ──
  const pSig = arg("plan-signature")
  const maxCost = arg("max-cost-usd")
  if (pSig !== AUTH.planSignature) fail(`--plan-signature ≠ autorizada`)
  const maxCostUsd = Number(maxCost)
  if (!Number.isFinite(maxCostUsd) || maxCostUsd !== AUTH.hardCapUsd) fail(`--max-cost-usd ${maxCost} ≠ hard cap ${AUTH.hardCapUsd}`)

  // ── Adapter REAL com send SEM logging em DB (SDK direto; 0 INSERT em ai_api_calls) ──
  const client = getAnthropicClient({ maxRetries: 2 }) // só transientes HTTP (não-faturados); 0 retry pago de aplicação
  const usageLog: Array<{ inputTokens: number; outputTokens: number }> = []
  let actualSpentUsd = 0
  const MAX_PER_WORK_UPPER = estimateStep("generate_review_digest", 40).upperBoundUsd
  let costCapHit = false
  let cancelled = false

  const send: AnthropicSend = async (params) => {
    const safe = deepStripLoneSurrogates(params) as Anthropic.Messages.MessageCreateParamsNonStreaming
    const message = await client.messages.stream(safe).finalMessage()
    const u = message.usage as { input_tokens?: number; output_tokens?: number } | undefined
    const inputTokens = u?.input_tokens ?? 0
    const outputTokens = u?.output_tokens ?? 0
    usageLog.push({ inputTokens, outputTokens })
    const c = computeCostUsd(EXPERIMENT_DIGEST_MODEL, { inputTokens, outputTokens, cacheReadTokens: 0, cacheCreationTokens: 0 })
    actualSpentUsd += c.costInputUsd + c.costOutputUsd
    if (actualSpentUsd + MAX_PER_WORK_UPPER > AUTH.hardCapUsd) costCapHit = true // guard por custo REAL
    return { message: message as unknown as { model?: string; content?: Array<{ type?: string; name?: string; input?: unknown }> }, usage: { inputTokens, outputTokens } }
  }
  const adapter = createAnthropicDigestAdapter({ send })

  // SIGINT/SIGTERM = cancelamento cooperativo.
  const onSig = () => { cancelled = true; console.log("\nsinal recebido — não inicia novas obras.") }
  process.on("SIGINT", onSig); process.on("SIGTERM", onSig)

  // frozen map (do snapshot) + readCorpus (DB, read-only).
  const frozen = new Map<string, FrozenWork>(
    withReviews.map((w) => [w.workId, { workId: w.workId, reviewCorpusSignature: w.reviewCorpusSignature, digestSelectionSignature: w.digestSelectionSignature, digestSelectionNormalizedHashes: w.digestSelectionNormalizedHashes }]),
  )
  const readCorpus = async (workId: string): Promise<CurrentCorpus> => {
    const c = await readCanonicalReviewCorpus(workId, sb)
    return { reviewCorpusSignature: c.reviewCorpusSignature, digestSelectionSignature: c.digestSelectionSignature, reviews: c.reviews.map((r) => ({ text: r.text })) }
  }

  const scopeWorkIds = plan.entries.map((e) => e.workId) // ordem determinística do plano (por workId)
  console.log(`\n=== EXECUÇÃO PAGA — ${scopeWorkIds.length} digests · hard cap $${AUTH.hardCapUsd} · model ${AUTH.model} ===`)

  const report = await runTextOnlyDigest({
    baseDir: DIR,
    base2Signature: snap.versions.derivedFrom.base2Signature,
    base2r1Signature: snap.base2r1Signature,
    scopeWorkIds,
    frozen,
    readCorpus,
    adapter,
    fs: nodeFs(),
    now: () => new Date().toISOString(),
    maxCostUsd, // hard cap; runner acumula UPPER estimado e para antes de exceder
    estimateUsd: (n) => estimateStep("generate_review_digest", n).upperBoundUsd,
    shouldStop: () => cancelled || costCapHit,
  })

  // ── Custo/uso REAIS ──
  const inputTokensReal = usageLog.reduce((n, u) => n + u.inputTokens, 0)
  const outputTokensReal = usageLog.reduce((n, u) => n + u.outputTokens, 0)
  const costReal = Math.round(actualSpentUsd * 1e6) / 1e6
  const remainingToHardCap = Math.round((AUTH.hardCapUsd - costReal) * 1e6) / 1e6
  const c = (s: WorkOutcomeStatus) => report.counts[s] ?? 0

  // ── Manifesto final + assinatura (determinística sobre os RESULTADOS) ──
  const perWork = [...report.outcomes]
    .map((o) => ({ workId: o.workId, status: o.status, digestOutputSignature: o.digestOutputSignature ?? null }))
    .sort((a, b) => (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0))
  const manifestSignature = createHash("sha256").update(JSON.stringify({
    kind: "digest-run-manifest",
    planSignature: AUTH.planSignature,
    base2r1Signature: snap.base2r1Signature,
    digestContractSignature: contractSig,
    digestImplementationSignature: implSig,
    perWork: perWork.map((w) => [w.workId, w.status, w.digestOutputSignature]),
  })).digest("hex")

  const stopReason = costCapHit ? "COST_CAP_REACHED" : cancelled ? "cancelled" : "completed"
  const manifest = {
    kind: "digest-run-manifest",
    planSignature: AUTH.planSignature,
    base2r1Signature: snap.base2r1Signature,
    digestContractSignature: contractSig,
    digestImplementationSignature: implSig,
    model: AUTH.model,
    planned: scopeWorkIds.length,
    counts: { succeeded: c("succeeded"), failed: c("failed"), input_changed: c("input_changed"), conflict: c("conflict"), cancelled: c("cancelled"), reused: c("reused"), stopped_by_cost: c("stopped_by_cost") },
    stopReason,
    tokensReal: { input: inputTokensReal, output: outputTokensReal },
    costRealUsd: costReal,
    remainingToHardCapUsd: remainingToHardCap,
    softCapUsd: AUTH.softCapUsd,
    hardCapUsd: AUTH.hardCapUsd,
    paidAutoRetries: 0,
    perWork,
    manifestSignature,
  }
  if (!existsSync(resolve(DIR, "digests-text-only-v1"))) mkdirSync(resolve(DIR, "digests-text-only-v1"), { recursive: true })
  const tmp = `${RUN_MANIFEST}.tmp`
  writeFileSync(tmp, stringify(manifest))
  renameSync(tmp, RUN_MANIFEST)

  console.log("\n=== EXECUÇÃO CONCLUÍDA ===")
  console.log(`planned=${scopeWorkIds.length} succeeded=${c("succeeded")} failed=${c("failed")} input_changed=${c("input_changed")} conflict=${c("conflict")} cancelled=${c("cancelled")} reused=${c("reused")} stopped_by_cost=${c("stopped_by_cost")}`)
  console.log(`stopReason: ${stopReason}`)
  console.log(`tokens reais: input=${inputTokensReal} output=${outputTokensReal}`)
  console.log(`custo real: $${costReal.toFixed(4)}  (soft $${AUTH.softCapUsd} / hard $${AUTH.hardCapUsd}; restante até hard=$${remainingToHardCap.toFixed(4)})`)
  console.log(`manifestSignature: ${manifestSignature}`)
  console.log(`run-manifest: ${RUN_MANIFEST}`)
  console.log(`0 writes no banco · 0 digests de produção alterados · 0 retries pagos automáticos`)
}

main().catch((e) => { console.error("[digest-execute] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
