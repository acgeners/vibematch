/**
 * CLI — PLANO read-only de execução dos digests text-only-v1 sob o base-2r1 (Plano 3 Fase B2.2S).
 * READ-ONLY no banco (SELECT via loader canônico). NÃO chama LLM, NÃO cria job, NÃO escreve no
 * banco, NÃO gera digest. Monta as 71 entradas (obras COM reviews; exclui as 19 no_reviews; NÃO
 * reutiliza os digests de produção — preflight = 0 reusable), calcula tokens/custo (estimateStep
 * real + pricing real) e a `planSignature`. Escreve só os 3 artefatos locais.
 *
 * GUARD de drift: recomputa o reviewCorpusSignature de cada obra do banco e compara com o base-2r1
 * congelado; qualquer divergência ⇒ aborta (um escritor voltou a rodar). A seleção atual também é
 * revalidada contra os hashes congelados (checkFrozenInput).
 *
 * Uso: npm run pilot2:digest-plan
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { readCanonicalReviewCorpus } from "@/lib/synopsis-interest/digest-corpus"
import { CANONICAL_REVIEW_CAP } from "@/lib/synopsis-interest/canonical-review-corpus"
import {
  EXPERIMENT_DIGEST_MODEL,
  EXPERIMENT_DIGEST_MAX_TOKENS,
  EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
  EXPERIMENT_DIGEST_PRICING_VERSION,
  selectTextOnly,
  checkFrozenInput,
  computeDigestPromptCorpusSignature,
  computeDigestInputSignature,
  computeDigestContractSignature,
  computeDigestImplementationSignature,
} from "@/lib/synopsis-interest/digest-text-only"
import { estimateStep, ceilUsdToCents } from "@/lib/orchestration/cost"
import { priceForModel, PRICING_SNAPSHOT_TAG } from "@/lib/ai/pricing"
import {
  DIGEST_PLAN_VERSION,
  computeDigestPlanSignature,
  type DigestPlanEntry,
  type DigestPlanVersions,
} from "@/lib/synopsis-interest/digest-plan"

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2/base-2r1"
const SNAP = resolve(DIR, "base-2r1-snapshot.json")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6
function atomicWrite(name: string, content: string): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
  const final = resolve(DIR, name)
  const tmp = `${final}.tmp`
  writeFileSync(tmp, content)
  renameSync(tmp, final)
}

interface SnapWork {
  workId: string
  reviewsAfterDedupe: number
  reviewCorpusSignature: string
  digestSelectionSignature: string
  digestSelectionNormalizedHashes: string[]
}
interface Snapshot {
  base2r1Signature: string
  reviewCorpusAggregateSignature: string
  digestSelectionAggregateSignature: string
  versions: { derivedFrom: { base2Signature: string } }
  works: SnapWork[]
}

async function main(): Promise<void> {
  const snap = JSON.parse(readFileSync(SNAP, "utf8")) as Snapshot
  const contractSig = computeDigestContractSignature()
  const implSig = computeDigestImplementationSignature()

  // Obras COM reviews (exclui no_reviews). Ordem determinística por workId (code-unit).
  const withReviews = snap.works
    .filter((w) => w.reviewsAfterDedupe > 0)
    .sort((a, b) => (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0))

  const entries: DigestPlanEntry[] = []
  const driftErrors: string[] = []

  for (const w of withReviews) {
    const corpus = await readCanonicalReviewCorpus(w.workId, sb)
    // GUARD de drift: corpus atual TEM de bater com o base-2r1 congelado.
    if (corpus.reviewCorpusSignature !== w.reviewCorpusSignature) {
      driftErrors.push(`${w.workId}: reviewCorpusSignature do banco ≠ base-2r1 (corpus mudou desde a regeneração)`)
      continue
    }
    const selected = selectTextOnly(corpus.reviews)
    const check = checkFrozenInput(
      { reviewCorpusSignature: w.reviewCorpusSignature, digestSelectionSignature: w.digestSelectionSignature, digestSelectionNormalizedHashes: w.digestSelectionNormalizedHashes },
      { reviewCorpusSignature: corpus.reviewCorpusSignature, digestSelectionSignature: corpus.digestSelectionSignature, selectedNormalizedHashes: selected.map((s) => s.normalizedHash) },
    )
    if (!check.ok) { driftErrors.push(`${w.workId}: seleção atual ≠ congelada (${check.detail})`); continue }

    const promptTexts = selected.map((s) => s.promptText)
    const promptCorpusSig = computeDigestPromptCorpusSignature(promptTexts)
    const inputSig = computeDigestInputSignature({
      workId: w.workId,
      base2r1Signature: snap.base2r1Signature,
      reviewCorpusSignature: w.reviewCorpusSignature,
      digestSelectionSignature: w.digestSelectionSignature,
      digestPromptCorpusSignature: promptCorpusSig,
      digestContractSignature: contractSig,
    })
    const scale = Math.min(corpus.usefulReviewCount, CANONICAL_REVIEW_CAP)
    const est = estimateStep("generate_review_digest", scale)
    entries.push({
      workId: w.workId,
      reviewCorpusSignature: w.reviewCorpusSignature,
      digestSelectionSignature: w.digestSelectionSignature,
      digestPromptCorpusSignature: promptCorpusSig,
      digestInputSignature: inputSig,
      digestContractSignature: contractSig,
      digestImplementationSignature: implSig,
      reviewCountCanonical: corpus.usefulReviewCount,
      reviewCountSelected: selected.length,
      estimatedInputTokens: est.usage.inputTokens,
      maxOutputTokens: est.usage.outputTokens,
      status: "planned",
    })
  }

  if (driftErrors.length > 0) {
    console.error("⛔ DRIFT durante o plano — corpus mudou desde a regeneração (escritor voltou?):")
    for (const e of driftErrors.slice(0, 20)) console.error("   - " + e)
    process.exit(1)
  }

  // ── Tokens + custo (estimateStep real + pricing real) ──
  const price = priceForModel(EXPERIMENT_DIGEST_MODEL)! // sonnet-4-6 = 3 / 15 por Mtok
  const SAFETY = 1.5 // COST_SAFETY_MULTIPLIER (upper = likely × 1.5)
  let inputTokensLikely = 0
  let outputTokensLikely = 0
  let costLikely = 0
  for (const e of entries) {
    inputTokensLikely += e.estimatedInputTokens
    outputTokensLikely += e.maxOutputTokens
    costLikely += estimateStep("generate_review_digest", e.reviewCountSelected).likelyUsd
  }
  const inputTokensUpper = Math.ceil(inputTokensLikely * SAFETY)
  const outputTokensUpper = Math.ceil(outputTokensLikely * SAFETY)
  const costUpper = round6(costLikely * SAFETY)
  costLikely = round6(costLikely)
  const softCapUsd = ceilUsdToCents(costLikely)
  const hardCapUsd = ceilUsdToCents(costUpper)

  const versions: DigestPlanVersions = {
    planVersion: DIGEST_PLAN_VERSION,
    base2Signature: snap.versions.derivedFrom.base2Signature,
    base2r1Signature: snap.base2r1Signature,
    reviewCorpusAggregateSignature: snap.reviewCorpusAggregateSignature,
    digestSelectionAggregateSignature: snap.digestSelectionAggregateSignature,
    digestContractSignature: contractSig,
    digestImplementationSignature: implSig,
    pricingVersion: EXPERIMENT_DIGEST_PRICING_VERSION,
    model: EXPERIMENT_DIGEST_MODEL,
    maxTokens: EXPERIMENT_DIGEST_MAX_TOKENS,
    temperaturePolicy: EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
  }
  const planSignature = computeDigestPlanSignature(versions, entries, { softCapUsd, hardCapUsd })

  // ── Artefatos ──
  const plan = { kind: "digest-execution-plan", planVersion: DIGEST_PLAN_VERSION, planSignature, versions, count: entries.length, entries, notAuthorization: "Plano read-only — execução paga exige autorização humana com a planSignature exata + 71 digests + modelo + custo provável + hard cap." }
  const costEstimate = {
    kind: "digest-cost-estimate",
    model: EXPERIMENT_DIGEST_MODEL,
    pricingVersion: EXPERIMENT_DIGEST_PRICING_VERSION,
    pricingSnapshotTag: PRICING_SNAPSHOT_TAG,
    pricePerMTok: { input: price.inputPerMTok, output: price.outputPerMTok },
    formula: "por obra: inputTokens = 1500 + 350×reviewCountSelected; outputTokens = 2000 (max). likely = (in/1e6)×$3 + (out/1e6)×$15. upper = likely × 1.5 (COST_SAFETY_MULTIPLIER).",
    works: entries.length,
    tokens: { inputLikely: inputTokensLikely, inputUpper: inputTokensUpper, outputLikely: outputTokensLikely, outputUpper: outputTokensUpper },
    cost: { likelyUsd: costLikely, upperUsd: costUpper },
    caps: { softCapUsd, hardCapUsd, note: "PROPOSTAS — NÃO autorizam execução; hardCap = --max-cost-usd mínimo (≥ upper)." },
  }
  const manifest = {
    kind: "digest-execution-plan-manifest",
    planVersion: DIGEST_PLAN_VERSION,
    planSignature,
    base2r1Signature: snap.base2r1Signature,
    digestContractSignature: contractSig,
    digestImplementationSignature: implSig,
    count: entries.length,
    cost: { likelyUsd: costLikely, upperUsd: costUpper },
    caps: { softCapUsd, hardCapUsd },
    status: "planned-not-authorized",
    note: "Execução paga NÃO autorizada. Sem LLM/job/escrita.",
  }
  atomicWrite("digest-execution-plan.json", stringify(plan))
  atomicWrite("digest-execution-plan-manifest.json", stringify(manifest))
  atomicWrite("digest-cost-estimate.json", stringify(costEstimate))

  console.log("=== PLANO digests text-only-v1 (read-only DB, $0) ===")
  console.log(`entradas (obras com reviews): ${entries.length}  (19 no_reviews excluídas; 0 reuso de digest de produção)`)
  console.log(`base2r1Signature: ${snap.base2r1Signature}`)
  console.log(`digestContractSignature: ${contractSig}`)
  console.log(`digestImplementationSignature: ${implSig}`)
  console.log(`tokens input: likely=${inputTokensLikely}  upper=${inputTokensUpper}`)
  console.log(`tokens output: likely=${outputTokensLikely}  upper=${outputTokensUpper}`)
  console.log(`custo: likely=$${costLikely.toFixed(4)}  upper=$${costUpper.toFixed(4)}  (sonnet-4-6 $${price.inputPerMTok}/$${price.outputPerMTok} por Mtok, ${PRICING_SNAPSHOT_TAG})`)
  console.log(`caps PROPOSTOS: soft=$${softCapUsd.toFixed(2)}  hard=$${hardCapUsd.toFixed(2)}`)
  console.log(`planSignature: ${planSignature}`)
  console.log(`artefatos: ${DIR}/digest-execution-plan{,.-manifest}.json · digest-cost-estimate.json`)
  console.log(`SEM LLM/job/custo realizado. Execução paga exige autorização humana com a planSignature exata.`)
}

main().catch((e) => { console.error("[digest-plan] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
