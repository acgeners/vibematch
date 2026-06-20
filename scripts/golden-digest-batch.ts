/**
 * Lote AGREGADO SEGURO dos digests do golden contextual (Plano 3 Fase B2.2A).
 * Casca fina sobre `lib/synopsis-interest/golden-digest`. READ-ONLY por padrão
 * (dry-run): lê o snapshot-base + o banco e imprime o plano/custo/assinatura. NÃO
 * chama provider, NÃO cria job, NÃO escreve no banco.
 *
 * A execução real exige `--execute` + `--plan-signature` + `--max-cost-usd` +
 * `--snapshot-version` + `--golden-version` (validados ANTES de qualquer chamada).
 * Reusa `ensureReviewDigest` (job durável + dedup + cost gate). SIGINT/SIGTERM =
 * cancelamento cooperativo. SEM `--retry-failed` na 1ª execução.
 *
 * Uso (dry-run):
 *   npm run digest:golden
 * Execução (NÃO nesta etapa):
 *   npm run digest:golden -- --execute --golden-version=pilot-1 --snapshot-version=base-1 \
 *     --plan-signature=<hash> --max-cost-usd=<teto> --concurrency=2
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { computeReviewCorpusSignature, type FrozenReview } from "@/lib/synopsis-interest/snapshot"
import {
  planGoldenDigestBatch,
  runGoldenDigestBatch,
  type CurrentWorkState,
  type SnapshotWorkRef,
  type GoldenDigestVersions,
} from "@/lib/synopsis-interest/golden-digest"
import { isUsefulReviewText } from "@/lib/reviews/useful-review"
import { estimateStep, ceilUsdToCents } from "@/lib/orchestration/cost"
import { REVIEW_DIGEST_VERSION, REVIEW_DIGEST_MODEL } from "@/lib/ai-recommendation/review-summarizer"
import { PRICING_SNAPSHOT_TAG } from "@/lib/ai/pricing"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const SNAP_PATH = resolve(process.cwd(), ".local-experiments/plan3/digest-exp-1/base-1/golden-snapshot-base.json")

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`))
  return p ? p.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

interface SnapWork { workId: string; reviewState: "frozen_current" | "no_reviews" | "no_reviews_available"; reviewCorpusSignature: string }

function digestVersions(): GoldenDigestVersions {
  return {
    experimentVersion: "digest-exp-1",
    goldenVersion: "pilot-1",
    snapshotVersion: "base-1",
    digestVersion: REVIEW_DIGEST_VERSION, // digest-v1
    promptVersion: REVIEW_DIGEST_VERSION, // o digest versiona por REVIEW_DIGEST_VERSION
    model: REVIEW_DIGEST_MODEL, // claude-sonnet-4-6
    schemaVersion: "v1",
    pricingVersion: PRICING_SNAPSHOT_TAG,
    costPolicyVersion: "safety-1.5+micro-0.02",
  }
}

async function loadCurrentState(snap: { snapshotBaseSignature: string; reviewCorpusSignature: string; works: SnapWork[] }) {
  const ids = snap.works.map((w) => w.workId)
  const reviewsByWork = new Map<string, FrozenReview[]>()
  for (const c of chunk(ids, 60)) {
    const { data, error } = await sb.from("work_reviews").select("work_id, source, text").in("work_id", c)
    if (error) throw new Error("reviews: " + error.message)
    for (const r of (data ?? []) as Array<{ work_id: string; source: string | null; text: string | null }>) {
      if (!reviewsByWork.has(r.work_id)) reviewsByWork.set(r.work_id, [])
      if (isUsefulReviewText(r.text)) reviewsByWork.get(r.work_id)!.push({ source: String(r.source ?? ""), text: String(r.text ?? "") })
    }
  }
  const digestByWork = new Map<string, { present: boolean; version: string | null }>()
  for (const c of chunk(ids, 60)) {
    const { data, error } = await sb.from("works").select("id, review_digest, review_digest_version").in("id", c)
    if (error) throw new Error("works: " + error.message)
    for (const w of (data ?? []) as Array<{ id: string; review_digest: unknown; review_digest_version: string | null }>) {
      digestByWork.set(w.id, { present: w.review_digest != null, version: w.review_digest_version })
    }
  }
  return { reviewsByWork, digestByWork }
}

async function buildPlan() {
  const snap = JSON.parse(readFileSync(SNAP_PATH, "utf8")) as { snapshotBaseSignature: string; reviewCorpusSignature: string; works: SnapWork[] }
  const { reviewsByWork, digestByWork } = await loadCurrentState(snap)
  const items = snap.works.map((w) => {
    const useful = reviewsByWork.get(w.workId) ?? []
    const d = digestByWork.get(w.workId) ?? { present: false, version: null }
    const snapRef: SnapshotWorkRef = { workId: w.workId, reviewState: w.reviewState, reviewCorpusSignature: w.reviewCorpusSignature }
    const current: CurrentWorkState = { workId: w.workId, currentCorpusSignature: computeReviewCorpusSignature(useful), digestPresent: d.present, digestVersion: d.version }
    return { snap: snapRef, current, usefulCount: useful.length }
  })
  const plan = planGoldenDigestBatch({
    versions: digestVersions(),
    snapshotBaseSignature: snap.snapshotBaseSignature,
    reviewCorpusSignature: snap.reviewCorpusSignature,
    items,
    costPerWork: (scale) => { const e = estimateStep("generate_review_digest", scale); return { likelyUsd: e.likelyUsd, upperBoundUsd: e.upperBoundUsd } },
  })
  return { snap, plan, items }
}

async function main() {
  const { snap, plan } = await buildPlan()
  const minCeil = ceilUsdToCents(plan.upperBoundUsd)

  if (!hasFlag("execute")) {
    console.log("\n=== DRY-RUN — Digests do golden (base-1) ===")
    console.log(`snapshotBaseSignature: ${snap.snapshotBaseSignature}`)
    console.log(`reviewCorpusSignature: ${snap.reviewCorpusSignature}`)
    console.log(`obras: total=${plan.items.length} | elegíveis=${plan.eligibleWorkIds.length} reutilizáveis=${plan.reusableWorkIds.length} no_reviews=${plan.noReviewsWorkIds.length} corpus_changed=${plan.changedWorkIds.length}`)
    console.log(`bloqueado (corpus mudou): ${plan.blocked ? "SIM ⛔ (exige base-2)" : "não"}`)
    if (plan.changedWorkIds.length) console.log(`  corpus_changed: ${plan.changedWorkIds.join(", ")}`)
    console.log(`custo: likely=$${plan.likelyUsd.toFixed(4)}  upper=$${plan.upperBoundUsd.toFixed(4)}`)
    console.log(`teto mínimo (≥ upper, ceil ao centavo): $${minCeil.toFixed(2)}`)
    console.log(`versões: model=${plan.versions.model} digest=${plan.versions.digestVersion} schema=${plan.versions.schemaVersion} pricing=${plan.versions.pricingVersion}`)
    console.log(`requiresAggregateAuthorization: ${plan.requiresAggregateAuthorization}`)
    console.log(`\nplanSignature: ${plan.planSignature}`)
    console.log(`\nComando futuro (NÃO executado):`)
    console.log(`  npm run digest:golden -- --execute --golden-version=pilot-1 --snapshot-version=base-1 \\`)
    console.log(`    --plan-signature=${plan.planSignature} --max-cost-usd=${minCeil.toFixed(2)} --concurrency=2`)
    console.log(`\n[DRY-RUN] nenhum job criado, nenhuma chamada paga.`)
    return
  }

  // ---- EXECUÇÃO (gated; NÃO acionada nesta etapa) ----
  const planSig = arg("plan-signature")
  const maxCost = arg("max-cost-usd")
  const gv = arg("golden-version")
  const sv = arg("snapshot-version")
  if (!planSig || !maxCost || gv !== "pilot-1" || sv !== "base-1") {
    console.error("Execução exige: --plan-signature, --max-cost-usd, --golden-version=pilot-1, --snapshot-version=base-1")
    process.exit(2)
  }
  if (plan.blocked) { console.error("⛔ corpus mudou — exige base-2. Abortado."); process.exit(1) }
  if (planSig !== plan.planSignature) { console.error(`⛔ plan_changed: assinatura divergente.\n  esperado=${plan.planSignature}\n  recebido=${planSig}`); process.exit(1) }
  const maxCostUsd = Number(maxCost)
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < plan.upperBoundUsd) { console.error(`⛔ teto $${maxCostUsd} < upper $${plan.upperBoundUsd.toFixed(4)}.`); process.exit(1) }

  let cancel = false
  const onSig = () => { cancel = true; console.log("\nsinal recebido — não inicia novos itens.") }
  process.on("SIGINT", onSig); process.on("SIGTERM", onSig)

  const { ensureReviewDigest } = await import("@/lib/orchestration/integrations/reviews")
  const report = await runGoldenDigestBatch(plan, {
    maxCostUsd,
    shouldStop: () => cancel,
    upperFor: () => estimateStep("generate_review_digest", 40).upperBoundUsd,
    recheck: async (workId) => {
      const { data } = await sb.from("work_reviews").select("source, text").eq("work_id", workId)
      const useful = ((data ?? []) as Array<{ source: string | null; text: string | null }>)
        .filter((r) => isUsefulReviewText(r.text)).map((r) => ({ source: String(r.source ?? ""), text: String(r.text ?? "") }))
      const cur = computeReviewCorpusSignature(useful)
      const frozen = snap.works.find((w) => w.workId === workId)?.reviewCorpusSignature
      return { snapshotValid: true, corpusUnchanged: cur === frozen }
    },
    ensureDigest: async (workId) => {
      const out = await ensureReviewDigest(workId, { supabase: sb, allowPaid: true, maxCostUsd })
      switch (out.status) {
        case "succeeded": return { status: "succeeded", ranLlm: out.ranLlm, costUsd: out.costUsd }
        case "skipped": return { status: "skipped", ranLlm: false, costUsd: 0 }
        case "processing": return { status: "processing", ranLlm: false, costUsd: 0 }
        case "not_ready": return { status: "failed", ranLlm: false, costUsd: 0, error: `not_ready:${out.reason}` }
        case "blocked_cost_confirmation": return { status: "failed", ranLlm: false, costUsd: 0, error: `blocked_cost:${out.reason}` }
        case "failed": return { status: "failed", ranLlm: false, costUsd: 0, error: out.error }
        default: return { status: "failed", ranLlm: false, costUsd: 0, error: "unknown" }
      }
    },
  })
  console.log(JSON.stringify(report, null, 2))
  if (report.status !== "completed") process.exit(1)
}

main().catch((e) => { console.error("[golden-digest] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
