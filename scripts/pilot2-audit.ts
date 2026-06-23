/**
 * CLI — Auditoria FINAL read-only dos artefatos da Fase B2.2F (pilot-2 / base-2). NÃO chama
 * LLM, NÃO gera digest, NÃO refresca reviews, NÃO escreve no banco, NÃO sobrescreve pilot-2/
 * base-2. SÓ `SELECT` + leitura local + escrita de artefatos de AUDITORIA em `pilot-2/audit/`.
 *
 * Corrige APENAS o dry-run de custo (planner real `estimateStep`), preservando o anterior como
 * superseded. Reusa produção: estimateStep, computeReviewCorpusSignature, isUsefulReviewText.
 *
 * Uso: npm run pilot2:audit
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { selectNewWorks, canonicalListHash, type EligibleWork } from "@/lib/synopsis-interest/pilot2-selection"
import {
  computeBase2ContentSignature,
  computeBase2BindingSignature,
  computeCarryoverMapSignature,
  validateCarryoverMap,
  digestPlanScopeIssues,
  sumPerWorkCost,
  computeDigestPlanSignature,
  DIGEST_PLAN_ARTIFACT_STATUS,
  type CarryoverMapEntry,
  type DigestPlanItem,
  type Base2WorkEntry,
} from "@/lib/synopsis-interest/pilot2-audit"
import { labelDisplayContentFromWork, computeLabelDisplaySignature } from "@/lib/synopsis-interest/label-reuse"
import { computeReviewCorpusSignature, type FrozenReview } from "@/lib/synopsis-interest/snapshot"
import { isUsefulReviewText } from "@/lib/reviews/useful-review"
import { estimateStep } from "@/lib/orchestration/cost"
import { PRICING_SNAPSHOT_TAG } from "@/lib/ai/pricing"
import type { Stratum, Split } from "@/lib/synopsis-interest/pilot2-composition"

const DIR = ".local-experiments/plan3/digest-exp-1"
const P2 = `${DIR}/pilot-2`
const AUDIT = `${P2}/audit`
const UNREAD_STATUS = [8, 10]
const STRATA: Stratum[] = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"]
const DIGEST_CAP = 40
const FRESH_DAYS = 30
const sha = (o: unknown): string => createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex")
const fileSha = (p: string): string => sha(readFileSync(resolve(p), "utf8"))

async function main(): Promise<void> {
  mkdirSync(resolve(AUDIT), { recursive: true })
  const issues: string[] = []
  const ok = (c: boolean, msg: string) => { if (!c) issues.push(msg); return c }

  // ── artefatos locais ──
  const base1 = JSON.parse(readFileSync(resolve(`${DIR}/base-1/golden-snapshot-base.json`), "utf8"))
  const enr1 = JSON.parse(readFileSync(resolve(`${DIR}/enriched-1/golden-snapshot-enriched.json`), "utf8"))
  const auto = JSON.parse(readFileSync(resolve(`${DIR}/pilot-1-audit/pilot-1-reading-status-auto.json`), "utf8"))
  const manifest = JSON.parse(readFileSync(resolve(`${P2}/pilot-2-manifest.json`), "utf8"))
  const base2 = JSON.parse(readFileSync(resolve(`${P2}/base-2-snapshot.json`), "utf8"))
  ok(String(base1.snapshotBaseSignature).startsWith("634571c2"), "base-1 sig divergente")
  ok(String(enr1.enrichedSnapshotSignature).startsWith("8b61084d"), "enriched-1 sig divergente")

  const base1ById = new Map<string, Record<string, unknown>>(base1.works.map((w: { workId: string }) => [w.workId, w]))
  const enr1ById = new Map<string, Record<string, unknown>>(enr1.works.map((w: { workId: string }) => [w.workId, w]))
  const pilot1Ids = new Set<string>(base1.works.map((w: { workId: string }) => w.workId))
  const carryIds: string[] = auto.rows.filter((r: { derived_reading_status: string }) => r.derived_reading_status === "unread").map((r: { work_id: string }) => r.work_id)
  const newIds: string[] = manifest.newWorkIds

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  async function fetchAll<T>(table: string, cols: string, ids: { col: string; values: Array<string | number> }): Promise<T[]> {
    const out: T[] = []
    let from = 0
    for (;;) {
      const { data, error } = await sb.from(table).select(cols).in(ids.col, ids.values).range(from, from + 999)
      if (error) throw error
      const rows = (data ?? []) as T[]
      out.push(...rows)
      if (rows.length < 1000) break
      from += 1000
    }
    return out
  }

  // ── Parte 2: pool + reprodução da seleção ──
  const poolRows = await fetchAll<{ id: string; synopsis_quality: string | null; is_archived: boolean; canonical_synopsis: string | null; personal_status_id: number }>(
    "works", "id, synopsis_quality, is_archived, canonical_synopsis, personal_status_id", { col: "personal_status_id", values: UNREAD_STATUS },
  )
  const notPilot1 = poolRows.filter((w) => !pilot1Ids.has(w.id))
  const candidates = notPilot1.map((w) => {
    const canonicalOk = (w.canonical_synopsis ?? "").trim().length > 0
    const hasStratum = STRATA.includes(w.synopsis_quality as Stratum)
    let reason: string
    if (w.is_archived) reason = "excluded_archived"
    else if (!hasStratum) reason = "excluded_no_stratum"
    else if (!canonicalOk) reason = "excluded_canonical_invalid"
    else reason = "eligible"
    return { work_id: w.id, personal_status_id: w.personal_status_id, derived_reading_status: "unread", is_archived: w.is_archived, stratum: w.synopsis_quality, canonical_state: canonicalOk ? "present_valid" : "missing_or_empty", reason }
  })
  const eligibleCands = candidates.filter((c) => c.reason === "eligible")
  const eligible: EligibleWork[] = eligibleCands.map((c) => ({ workId: c.work_id, stratum: c.stratum as Stratum }))
  const reSel = selectNewWorks({ pool: eligible })
  const selectionReproduces = reSel.ok && reSel.canonicalListHash === manifest.selectionListHash
  ok(selectionReproduces, `seleção NÃO reproduz (drift): ${reSel.canonicalListHash} != ${manifest.selectionListHash}`)
  // selectionPoolSignature = conjunto elegível canônico (workId+stratum) que determina a seleção
  const selectionPoolSignature = sha([...eligible].sort((a, b) => a.workId.localeCompare(b.workId)).map((e) => [e.workId, e.stratum]))
  const poolByStatus = candidates.reduce<Record<string, number>>((a, c) => ((a[c.personal_status_id] = (a[c.personal_status_id] ?? 0) + 1), a), {})
  const poolReasons = candidates.reduce<Record<string, number>>((a, c) => ((a[c.reason] = (a[c.reason] ?? 0) + 1), a), {})
  const eligibleByStratum = eligibleCands.reduce<Record<string, number>>((a, c) => ((a[c.stratum!] = (a[c.stratum!] ?? 0) + 1), a), {})
  const poolSnapshot = {
    generatedFor: "pilot-2 selection pool audit",
    stratumSource: "works.synopsis_quality (coluna do banco; proveniência = synopsis_quality_source)",
    totals: { statusUnreadNotPilot1: candidates.length, archived: poolReasons.excluded_archived ?? 0, noStratum: poolReasons.excluded_no_stratum ?? 0, canonicalInvalid: poolReasons.excluded_canonical_invalid ?? 0, eligible: eligibleCands.length },
    byStatus: poolByStatus,
    eligibleByStratum,
    selectionPoolSignature,
    selectionReproduces,
    selectionListHash: reSel.canonicalListHash,
    candidates,
  }
  writeFileSync(resolve(`${AUDIT}/selection-pool-snapshot.json`), JSON.stringify(poolSnapshot, null, 2) + "\n")

  // ── Parte 3: manifesto ──
  const primary = manifest.slots.filter((s: { isRepeat: boolean }) => !s.isRepeat)
  const repeatSlots = manifest.slots.filter((s: { isRepeat: boolean }) => s.isRepeat)
  const manifestChecks = {
    uniqueWorkIds: new Set(primary.map((s: { workId: string }) => s.workId)).size,
    carryovers: primary.filter((s: { origin: string }) => s.origin === "carryover").length,
    news: primary.filter((s: { origin: string }) => s.origin === "new").length,
    slots: manifest.slots.length,
    repeats: repeatSlots.length,
    distinctRepeatWorks: new Set(repeatSlots.map((s: { workId: string }) => s.workId)).size,
    dev: primary.filter((s: { split: string }) => s.split === "development").length,
    hold: primary.filter((s: { split: string }) => s.split === "holdout").length,
    repDev: repeatSlots.filter((s: { split: string }) => s.split === "development").length,
    repHold: repeatSlots.filter((s: { split: string }) => s.split === "holdout").length,
    selectionListHashRecalc: canonicalListHash(newIds),
    repeatsListHashRecalc: canonicalListHash(repeatSlots.map((s: { workId: string }) => s.workId)),
  }
  ok(manifestChecks.uniqueWorkIds === 90 && manifestChecks.carryovers === 51 && manifestChecks.news === 39 && manifestChecks.slots === 100 && manifestChecks.repeats === 10 && manifestChecks.distinctRepeatWorks === 10, "manifesto: contagens divergentes")
  ok(manifestChecks.dev === 56 && manifestChecks.hold === 34 && manifestChecks.repDev === 6 && manifestChecks.repHold === 4, "manifesto: split divergente")
  ok(manifestChecks.selectionListHashRecalc === manifest.selectionListHash, "selectionListHash recalc divergente")
  ok(manifestChecks.repeatsListHashRecalc === manifest.repeatsListHash, "repeatsListHash recalc divergente")
  // repeats no mesmo split do original; nenhuma new ∈ pilot-1
  const primaryByWork = new Map(primary.map((s: { workId: string }) => [s.workId, s]))
  for (const r of repeatSlots) ok((primaryByWork.get(r.workId) as { split: string })?.split === r.split, `repeat ${r.workId} split difere`)
  ok(newIds.every((id) => !pilot1Ids.has(id)), "alguma nova ∈ pilot-1")

  // ── Parte 4: mapa de carryovers ──
  const sigByWork = new Map<string, string>((manifest.carryoverDisplaySignatures?.perWork ?? []).map((x: { workId: string; displaySignature: string }) => [x.workId, x.displaySignature]))
  const slotByWork = new Map<string, string>(primary.map((s: { workId: string; slotKey: string }) => [s.workId, s.slotKey]))
  let displaySigRecomputeMatches = true
  const carryMap: CarryoverMapEntry[] = carryIds.map((id) => {
    const b1 = base1ById.get(id)!
    const e1 = enr1ById.get(id)!
    const pilot1Slot = ((b1.slots as Array<{ slotKey: string; isRepeat: boolean }>).find((s) => !s.isRepeat)?.slotKey) ?? ((b1.slots as Array<{ slotKey: string }>)[0]?.slotKey ?? "")
    // recomputa a assinatura de display de base-1+enriched-1 e compara com o manifesto
    const recomputed = computeLabelDisplaySignature(labelDisplayContentFromWork({
      synopsis: b1.canonicalSynopsis as string,
      contextualTags: e1.contextualTags as string[],
      reviewContextType: e1.reviewContext as "digest_available" | "no_reviews_available",
      sanitizedDigest: e1.sanitizedDigest as never,
    }))
    if (recomputed !== sigByWork.get(id)) displaySigRecomputeMatches = false
    return { workId: id, pilot1Slot, pilot2Slot: slotByWork.get(id) ?? "", split: b1.split as Split, stratum: b1.stratum as Stratum, origin: "carryover", displaySignature: recomputed }
  })
  const carryMapVal = validateCarryoverMap(carryMap)
  ok(carryMapVal.ok, "mapa de carryovers inválido: " + carryMapVal.errors.join("; "))
  ok(displaySigRecomputeMatches, "display signature recomputada != manifesto")
  const carryMapSignature = computeCarryoverMapSignature(carryMap)
  writeFileSync(resolve(`${AUDIT}/carryover-map.json`), JSON.stringify({ count: carryMap.length, carryMapSignature, entries: carryMap }, null, 2) + "\n")

  // ── Parte 5: base-2 ──
  const base2Works: Base2WorkEntry[] = base2.works.map((w: { workId: string; canonicalSynopsis: string; tags: string[]; split: Split; stratum: Stratum }) => ({ workId: w.workId, canonicalSynopsis: w.canonicalSynopsis, tags: w.tags, split: w.split, stratum: w.stratum }))
  const base2ContentRecalc = computeBase2ContentSignature(base2Works)
  ok(base2ContentRecalc === base2.base2Signature, `base2Signature recalc divergente: ${base2ContentRecalc} != ${base2.base2Signature}`)
  const carryEntries = base2.works.filter((w: { origin: string }) => w.origin === "carryover")
  ok(carryEntries.length === 51, "base-2 carryovers != 51")
  let verbatim = true
  for (const w of carryEntries) {
    const b1 = base1ById.get(w.workId) as { canonicalSynopsis: string; tags: string[]; reviewCorpusSignature: string; baseInputSignature: string; synopsisSignature: string; tagsSignature: string }
    if (!b1 || w.canonicalSynopsis !== b1.canonicalSynopsis || w.reviewCorpusSignature !== b1.reviewCorpusSignature || w.baseInputSignature !== b1.baseInputSignature) verbatim = false
  }
  ok(verbatim, "base-2 carryover NÃO é verbatim de base-1")
  const newEntriesB2 = base2.works.filter((w: { origin: string }) => w.origin === "new")
  ok(newEntriesB2.length === 39 && newEntriesB2.every((w: { tasteProfileVersion: string }) => w.tasteProfileVersion === "v7"), "base-2 new: perfil != v7 ou contagem")
  const manifestFileSha = fileSha(`${P2}/pilot-2-manifest.json`)
  const base2FileSha = fileSha(`${P2}/base-2-snapshot.json`)
  const base2Binding = {
    finding: "base2Signature original liga só CONTEÚDO; este vínculo adiciona manifesto+seleção+base-1+perfil (não destrutivo).",
    base2Signature: base2.base2Signature,
    base2FileSha256: base2FileSha,
    pilot2ManifestSha256: manifestFileSha,
    selectionListHash: manifest.selectionListHash,
    repeatsListHash: manifest.repeatsListHash,
    base1Signature: base1.snapshotBaseSignature,
    tasteProfileVersion: "v7",
    base2BindingSignature: computeBase2BindingSignature({ goldenVersion: "pilot-2", baseSnapshotVersion: "base-2", base2Signature: base2.base2Signature, base2FileSha256: base2FileSha, pilot2ManifestSha256: manifestFileSha, selectionListHash: manifest.selectionListHash, repeatsListHash: manifest.repeatsListHash, base1Signature: base1.snapshotBaseSignature, tasteProfileVersion: "v7" }),
  }
  writeFileSync(resolve(`${AUDIT}/base-2-binding.json`), JSON.stringify(base2Binding, null, 2) + "\n")

  // ── Parte 6/7: reviews + custo real das 39 novas ──
  const revRows = await fetchAll<{ work_id: string; source: string | null; text: string | null; fetched_at: string | null }>(
    "work_reviews", "work_id, source, text, fetched_at", { col: "work_id", values: newIds },
  )
  const byWork = new Map<string, { useful: FrozenReview[]; lastFetch: number | null }>()
  for (const id of newIds) byWork.set(id, { useful: [], lastFetch: null })
  for (const r of revRows) {
    const e = byWork.get(r.work_id)!
    if (isUsefulReviewText(r.text)) e.useful.push({ source: r.source ?? "", text: r.text ?? "" })
    if (r.fetched_at) { const t = +new Date(r.fetched_at); if (e.lastFetch == null || t > e.lastFetch) e.lastFetch = t }
  }
  const NOW = Date.now()
  const DAY = 86400000
  const newDigestVer = new Map<string, string | null>()
  const newRows2 = await fetchAll<{ id: string; review_digest_version: string | null; review_digest_n: number | null }>(
    "works", "id, review_digest_version, review_digest_n", { col: "id", values: newIds },
  )
  for (const w of newRows2) newDigestVer.set(w.id, w.review_digest_version)

  let freshWithReviews = 0
  let noReviews = 0
  const blockers: Array<{ workId: string; reason: string }> = []
  const planItems: DigestPlanItem[] = []
  const preflightPerWork: Array<Record<string, unknown>> = []
  for (const id of newIds) {
    const e = byWork.get(id)!
    const usefulCount = e.useful.length
    const ageDays = e.lastFetch != null ? (NOW - e.lastFetch) / DAY : null
    const corpusSig = computeReviewCorpusSignature(e.useful)
    const digestVersion = newDigestVer.get(id) ?? null
    let state: string
    if (usefulCount === 0) { state = "no_reviews_available"; noReviews++ }
    else if (ageDays == null || ageDays > FRESH_DAYS) { state = "blocked_by_review_freshness"; blockers.push({ workId: id, reason: ageDays == null ? "no_fetch_date" : "stale_reviews" }) }
    else { freshWithReviews++; state = digestVersion === "digest-v1" ? "digest_compatible_reusable" : "digest_missing_with_reviews" }
    preflightPerWork.push({ workId: id, usefulCount, latestFetchAgeDays: ageDays == null ? null : +ageDays.toFixed(2), reviewCorpusSignature: corpusSig, digestVersion, state })
    if (state === "digest_missing_with_reviews" || state === "digest_stale_incompatible") {
      const scale = Math.min(usefulCount, DIGEST_CAP)
      const c = estimateStep("generate_review_digest", scale)
      planItems.push({ workId: id, state, scale, reviewCorpusSignature: corpusSig, likelyUsd: c.likelyUsd, upperBoundUsd: c.upperBoundUsd })
    }
  }
  ok(freshWithReviews === 30 && noReviews === 9 && blockers.length === 0, `preflight divergente: fresh=${freshWithReviews} no_reviews=${noReviews} blockers=${blockers.length}`)
  writeFileSync(resolve(`${AUDIT}/preflight-audit.json`), JSON.stringify({ freshWithReviews, noReviews, blockers, freshDays: FRESH_DAYS, perWork: preflightPerWork }, null, 2) + "\n")

  // custo agregado (planner real)
  const agg = sumPerWorkCost(planItems)
  const carryIdSet = new Set(carryIds)
  const noReviewsIdSet = new Set(preflightPerWork.filter((w) => w.state === "no_reviews_available").map((w) => w.workId as string))
  const scopeIssues = digestPlanScopeIssues(planItems, { carryoverIds: carryIdSet, noReviewsIds: noReviewsIdSet, pilot2NewIds: new Set(newIds) })
  ok(scopeIssues.length === 0, "plano fora de escopo: " + scopeIssues.join("; "))
  const versions = { model: "claude-sonnet-4-6", digestVersion: "digest-v1", schemaVersion: "v1", promptVersion: "digest-v1", pricingVersion: PRICING_SNAPSHOT_TAG, costPolicyVersion: "safety-1.5+micro-0.02" }
  const planSignature = computeDigestPlanSignature({ versions, base2Signature: base2.base2Signature, pilot2ManifestSha256: manifestFileSha, eligible: planItems.map((p) => ({ workId: p.workId, reviewCorpusSignature: p.reviewCorpusSignature })) })
  const correctedPlan = {
    supersedes: "digest-plan-dry-run.json (constantes fixas; razão upper/likely=5.9 — BUG)",
    method: "lib/orchestration/cost.ts estimateStep('generate_review_digest', min(useful,40))",
    versions,
    model: "claude-sonnet-4-6 (SONNET) · input $3/Mtok · output $15/Mtok",
    tokenFormula: "inputTokens = 1500 + 350×scale ; outputTokens = 2000 (fixo) ; scale = min(usefulReviews,40)",
    safetyMultiplier: 1.5,
    likelyFormula: "computeCostUsd(SONNET, usage) sem desconto de cache",
    upperFormula: "likely × 1.5",
    needGeneration: planItems.length,
    likelyUsd: +agg.likelyUsd.toFixed(6),
    upperBoundUsd: +agg.upperBoundUsd.toFixed(6),
    perWork: planItems.map((p) => ({ workId: p.workId, scale: p.scale, likelyUsd: +p.likelyUsd.toFixed(6), upperBoundUsd: +p.upperBoundUsd.toFixed(6) })),
    planSignature,
    // STATUS de saída (B2.2N) — NÃO entra em `planSignature` (hash v0 preservado).
    artifactStatus: DIGEST_PLAN_ARTIFACT_STATUS,
    scope: { included: "39 novas com reviews úteis (digest_missing_with_reviews)", excluded: "9 no_reviews, 51 carryovers, 29 lidas do pilot-1, fora do pilot-2" },
    revalidationContract: ["pilot2 manifest sha", "base2Signature", "reviewCorpusSignature por obra", "planSignature"],
    executed: false,
  }
  writeFileSync(resolve(`${AUDIT}/digest-plan-dry-run-v2.json`), JSON.stringify(correctedPlan, null, 2) + "\n")

  // ── Parte 9: implementationCorpusSignature ──
  const CODE = [
    "lib/synopsis-interest/pilot2-selection.ts", "lib/synopsis-interest/pilot2-composition.ts",
    "lib/synopsis-interest/pilot2-audit.ts", "lib/synopsis-interest/label-reuse.ts",
    "lib/synopsis-interest/snapshot.ts", "lib/synopsis-interest/golden-digest.ts",
    "lib/orchestration/cost.ts", "lib/orchestration/contracts.ts",
    "lib/reviews/useful-review.ts", "lib/ai/pricing.ts",
    "scripts/pilot2-select.ts", "scripts/pilot2-audit.ts",
  ]
  const codeFiles = CODE.map((p) => ({ path: p, sha256: fileSha(p), bytes: statSync(resolve(p)).size })).sort((a, b) => a.path.localeCompare(b.path))
  const implementationCorpusSignature = sha(codeFiles.map((f) => [f.path, f.sha256]))
  writeFileSync(resolve(`${AUDIT}/implementation-corpus.json`), JSON.stringify({ implementationCorpusSignature, pricingVersion: PRICING_SNAPSHOT_TAG, files: codeFiles }, null, 2) + "\n")

  // ── manifesto de auditoria + relatório ──
  const auditManifest = {
    audited: "B2.2F pilot-2 + base-2 (read-only, sem custo)",
    governance: "materializado localmente; pendente de ratificação humana; execução paga NÃO autorizada",
    selectionPoolSignature, selectionReproduces,
    carryMapSignature, base2ContentRecalc, base2BindingSignature: base2Binding.base2BindingSignature,
    correctedDigestPlanSignature: planSignature,
    artifactStatus: DIGEST_PLAN_ARTIFACT_STATUS,
    correctedCost: { needGeneration: planItems.length, likelyUsd: correctedPlan.likelyUsd, upperBoundUsd: correctedPlan.upperBoundUsd },
    implementationCorpusSignature,
    issues,
  }
  writeFileSync(resolve(`${AUDIT}/AUDIT-manifest.json`), JSON.stringify(auditManifest, null, 2) + "\n")

  console.log("=== AUDITORIA B2.2F (read-only, $0) ===")
  console.log("Parte 2 pool:", JSON.stringify(poolSnapshot.totals), "| seleção reproduz:", selectionReproduces, "| poolSig", selectionPoolSignature.slice(0, 12) + "…")
  console.log("Parte 3 manifesto:", manifestChecks.uniqueWorkIds + "u/" + manifestChecks.slots + "slots", "selHash✓", manifestChecks.selectionListHashRecalc === manifest.selectionListHash, "repHash✓", manifestChecks.repeatsListHashRecalc === manifest.repeatsListHash)
  console.log("Parte 4 carryMap:", carryMap.length + "/51", carryMapVal.ok ? "OK" : "FALHA", "sig", carryMapSignature.slice(0, 12) + "…")
  console.log("Parte 5 base-2: content recalc", base2ContentRecalc === base2.base2Signature ? "✓" : "✗", "verbatim", verbatim, "bindingSig", base2Binding.base2BindingSignature.slice(0, 12) + "…")
  console.log("Parte 6 preflight:", `fresh ${freshWithReviews} / no_reviews ${noReviews} / blockers ${blockers.length}`)
  console.log("Parte 7 custo REAL:", `${planItems.length} digests · likely $${correctedPlan.likelyUsd.toFixed(4)} · upper $${correctedPlan.upperBoundUsd.toFixed(4)} (razão ${(agg.upperBoundUsd / agg.likelyUsd).toFixed(3)}) · planSig ${planSignature.slice(0, 12)}…`)
  console.log("  (antigo BUG: likely $0.59 / upper $3.47 / razão 5.9 — superseded)")
  console.log("Parte 8 escopo:", scopeIssues.length === 0 ? "OK (só 30 novas com reviews)" : scopeIssues.join("; "))
  console.log("Parte 9 implementationCorpusSignature:", implementationCorpusSignature.slice(0, 16) + "…")
  console.log(issues.length === 0 ? "\n✅ AUDITORIA SEM DISCREPÂNCIAS" : `\n⚠️ ${issues.length} discrepância(s):\n - ` + issues.join("\n - "))
  // ── Status do artefato (B2.2N) — NÃO entra no hash; só sinaliza supersessão na saída ──
  console.log("\n=== STATUS DO ARTEFATO (auditor histórico v0) ===")
  console.log("artifactStatus:    " + DIGEST_PLAN_ARTIFACT_STATUS.artifactStatus)
  console.log("corpusPolicyVersion: " + DIGEST_PLAN_ARTIFACT_STATUS.corpusPolicyVersion)
  console.log("supersededBy:      " + DIGEST_PLAN_ARTIFACT_STATUS.supersededBy)
  console.log("executable:        " + DIGEST_PLAN_ARTIFACT_STATUS.executable)
  console.log("reason:            " + DIGEST_PLAN_ARTIFACT_STATUS.reason)
  console.log(`historicalPlanSignature: ${planSignature} (v0, reproduzida; status NÃO entra no hash)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
