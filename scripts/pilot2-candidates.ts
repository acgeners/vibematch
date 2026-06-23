/**
 * CLI — Candidatos GRATUITOS (D1/D2) + plano PAGO read-only (b1/e1) do Pilot-2 (Plano 3 Fase B2.2W).
 * READ-ONLY no banco (SÓ o taste_profile via SELECT, com gate de assinatura; NUNCA labels). NÃO chama
 * LLM. Determinístico. Fonte de verdade = artefatos congelados (base-2, base-2r1, enriched-2,
 * contextual-2/consolidated/final-labels.json). Labels lidas SÓ na etapa de métricas (nunca na geração).
 *
 * S0/S1 são candidatos de LLM no contrato congelado (deterministic:false, sonnet-4-6) ⇒ NÃO são
 * gratuitos: reportados como GAP (sem inventar substituto, plano §2). Só D1/D2 rodam grátis.
 *
 * Uso: npm run pilot2:candidates
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import { loadCurrentTasteProfile, computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"
import { baselineD1, baselineD2 } from "@/lib/synopsis-interest/baselines"
import {
  CANDIDATES, computeCandidateInputSignature, computeSnapshotSignature, computeTagsSignature,
  EXPERIMENT_VERSION, type WorkSnapshotInput,
} from "@/lib/synopsis-interest/experiment"
import { levelOf, ordinalAgreement, spearman, pairwiseAccuracy, ndcgAtK, topKOverlap } from "@/lib/synopsis-interest/metrics"
import { computeCostUsd, priceForModel } from "@/lib/ai/pricing"
import { ceilUsdToCents } from "@/lib/orchestration/cost"

const P = ".local-experiments/plan3/digest-exp-1"
const PILOT2 = resolve(P, "pilot-2")
const OUT = resolve(PILOT2, "candidates")
const FROZEN_PROFILE_SIG = "23eb13f0067132c5c8829bc98cdab0d894f79420c1100619d48b74e9a5177b87" // base-1 (v7)
const FROZEN_BASE2R1 = "b9dc2f2751af6ae738d79801d46f4aedd72c45e330a60bd49194c979233436a6"
const FROZEN_ENRICHED2 = "2e04269efa0b9c3a7b7398adab990f263222673d955dd92a7902363649c9b5a9"
const FROZEN_FINAL_LABELS = "a8abddca6354646a" // prefixo

const sha = (o: unknown): string => createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex")
const r = (p: string): unknown => JSON.parse(readFileSync(resolve(p), "utf8"))
const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"
const die = (code: string, m: string): never => { console.error(`⛔ ${code} — ${m}`); process.exit(1) }
const writeAtomic = (p: string, c: string): void => { const t = `${p}.tmp`; writeFileSync(t, c); renameSync(t, p) }
const round = (n: number, d = 4): number => Math.round(n * 10 ** d) / 10 ** d
const SONNET = "claude-sonnet-4-6"
const SAFETY = 1.5 // COST_SAFETY_MULTIPLIER

async function main(): Promise<void> {
  // ── §1 VALIDAÇÃO DAS LABELS FINAIS (não entram na geração) ──
  const fl = r(`${PILOT2}/contextual-2/consolidated/final-labels.json`) as { count: number; finalLabelsSignature: string; distribution: Record<string, number>; labels: Array<{ workId: string; label: string; source: string }> }
  const reFinalSig = sha({ kind: "final-labels", items: [...fl.labels].sort((a, b) => (a.workId < b.workId ? -1 : 1)).map((f) => [f.workId, f.label, f.source]) })
  if (!reFinalSig.startsWith(FROZEN_FINAL_LABELS)) die("LABELS_INVALID", `finalLabelsSignature recomputada ${reFinalSig.slice(0, 16)} ≠ ${FROZEN_FINAL_LABELS}`)
  if (fl.count !== 90 || fl.labels.length !== 90) die("LABELS_INVALID", `labels ${fl.labels.length} ≠ 90`)
  if (new Set(fl.labels.map((l) => l.workId)).size !== 90) die("LABELS_INVALID", "workIds não-distintos")
  const VALIDL = new Set(["♥", "♥♥", "♥♥♥", "♥♥♥♥"])
  if (fl.labels.some((l) => !VALIDL.has(l.label))) die("LABELS_INVALID", "label fora do domínio")
  const labelOf = new Map(fl.labels.map((l) => [l.workId, l.label]))

  // ── fonte de verdade congelada ──
  const base2 = r(`${PILOT2}/base-2-snapshot.json`) as { base2Signature: string; works: Array<{ workId: string; title: string; canonicalSynopsis: string; tags: string[]; split: string; stratum: string; origin: string }> }
  const b2r1 = r(`${PILOT2}/base-2r1/base-2r1-snapshot.json`) as { base2r1Signature: string; works: Array<{ workId: string; reviewsAfterDedupe: number }> }
  const en2 = r(`${PILOT2}/enriched-2/pilot-2-snapshot-enriched.json`) as { enrichedSnapshotSignature: string; works: Array<{ workId: string; reviewContext: string; sanitizedDigest: unknown; sanitizedDigestSignature: string | null }> }
  if (b2r1.base2r1Signature !== FROZEN_BASE2R1) die("SNAPSHOT_DIVERGE", "base2r1Signature ≠ congelada")
  if (en2.enrichedSnapshotSignature !== FROZEN_ENRICHED2) die("SNAPSHOT_DIVERGE", "enrichedSnapshotSignature ≠ congelada")
  const b2by = new Map(base2.works.map((w) => [w.workId, w]))
  const b2r1by = new Map(b2r1.works.map((w) => [w.workId, w]))
  const en2by = new Map(en2.works.map((w) => [w.workId, w]))
  if (base2.works.length !== 90) die("SNAPSHOT_DIVERGE", `base-2 ${base2.works.length} ≠ 90`)
  for (const l of fl.labels) if (!b2by.has(l.workId)) die("SNAPSHOT_DIVERGE", `label workId ausente do base-2: ${l.workId}`)

  // ── §1 GATE do taste profile (SELECT, NÃO-label) — assinatura == congelada ──
  const profileRow = await loadCurrentTasteProfile()
  if (!profileRow || (profileRow as { is_stub?: boolean }).is_stub) die("PROFILE_GAP", "taste_profile ausente/stub")
  const profile = (profileRow as { profile: TasteProfilePayload }).profile
  const profileSig = computeProfileSignature(profile)
  if (profileSig !== FROZEN_PROFILE_SIG) die("PROFILE_DRIFT", `taste_profile atual (${profileSig.slice(0, 12)}) ≠ congelado base-1 (${FROZEN_PROFILE_SIG.slice(0, 12)}) — input não congelado`)

  // ── tag → grupo (case-insensitive; base-2 tem casing misto) ──
  const n2g = new Map<string, string>()
  for (const g of TAG_GROUPS_CATALOG) for (const v of g.values) { const k = v.toLowerCase(); if (!n2g.has(k)) n2g.set(k, g.groupSlug) }
  const tagGroupOf = (n: string): string | null => n2g.get((n ?? "").toLowerCase()) ?? null

  // ── WorkSnapshotInput por obra (90) ──
  const works = [...base2.works].sort((a, b) => (a.workId < b.workId ? -1 : 1))
  const snapByWork = new Map<string, WorkSnapshotInput>()
  for (const w of works) {
    const b = b2r1by.get(w.workId)!
    const e = en2by.get(w.workId)
    const reviewContextType = b.reviewsAfterDedupe > 0 ? "digest" : "no_reviews"
    const reviewContextSig = reviewContextType === "digest" ? `text-only-v1:${e?.sanitizedDigestSignature ?? "?"}` : "no_reviews"
    snapByWork.set(w.workId, {
      workId: w.workId,
      titleSig: sha(w.title),
      synopsisSig: sha(w.canonicalSynopsis),
      tagsSig: computeTagsSignature(w.tags),
      profileSig,
      reviewContextType,
      reviewContextSig,
    })
  }
  const snapInputs = works.map((w) => snapByWork.get(w.workId)!)

  // ── §3 EXECUTAR D1/D2 (determinísticos, $0; NÃO leem labels) ──
  mkdirSync(OUT, { recursive: true })
  const runFree = (cid: "d1" | "d2") => {
    const cand = CANDIDATES[cid]
    const outputs = works.map((w) => {
      const bw = { tags: w.tags.map((n) => ({ name: n, group: tagGroupOf(n) })), synopsis: w.canonicalSynopsis }
      const res = cid === "d1" ? baselineD1(bw, profile) : baselineD2(bw, profile)
      const inputSignature = computeCandidateInputSignature(cand, snapByWork.get(w.workId)!)
      const outputSignature = sha({ kind: "candidate-output", inputSignature, prediction: res.level })
      return { candidateId: cid, workId: w.workId, inputSignature, predictionOrdinal: res.level, score: round(res.score, 6), outputSignature }
    })
    if (outputs.length !== 90) die("CANDIDATE_INCOMPLETE", `${cid}: ${outputs.length} ≠ 90`)
    if (new Set(outputs.map((o) => o.workId)).size !== 90) die("CANDIDATE_INCOMPLETE", `${cid}: workIds não-distintos`)
    const aggSig = sha({ candidate: cid, items: outputs.map((o) => [o.workId, o.inputSignature, o.predictionOrdinal, o.outputSignature]) })
    writeAtomic(resolve(OUT, `free-${cid}.json`), stringify({ kind: "candidate-free-outputs", candidateId: cid, count: outputs.length, aggregateSignature: aggSig, outputs }))
    return { outputs, aggSig }
  }
  const d1 = runFree("d1")
  const d2 = runFree("d2")

  // ── §4 MÉTRICAS (cruzam com as 90 labels — única etapa que lê labels) ──
  type Split = "overall" | "development" | "holdout" | "digest_available" | "no_reviews_available"
  const splitOf = (workId: string): { dev: boolean; digest: boolean } => {
    const w = b2by.get(workId)!
    const b = b2r1by.get(workId)!
    return { dev: w.split === "development", digest: b.reviewsAfterDedupe > 0 }
  }
  const metricsFor = (outputs: Array<{ workId: string; predictionOrdinal: number; score: number }>) => {
    const all = outputs.map((o) => ({ workId: o.workId, pred: o.predictionOrdinal, score: o.score, gold: levelOf(labelOf.get(o.workId)) }))
    const subset = (f: (s: { dev: boolean; digest: boolean }) => boolean) => all.filter((x) => f(splitOf(x.workId)))
    const compute = (rows: typeof all) => {
      if (rows.length === 0) return { n: 0 }
      const oa = ordinalAgreement(rows.map((x) => ({ pred: x.pred, gold: x.gold })))
      const sp = spearman(rows.map((x) => x.score), rows.map((x) => x.gold))
      const pw = pairwiseAccuracy(rows.map((x) => ({ score: x.score, truth: x.gold })))
      const byScore = [...rows].sort((a, b) => b.score - a.score || (a.workId < b.workId ? -1 : 1))
      const goldOrder = [...rows].sort((a, b) => b.gold - a.gold || (a.workId < b.workId ? -1 : 1)).map((x) => x.workId)
      const ndcg10 = ndcgAtK(byScore.map((x) => x.gold), 10)
      const top10 = topKOverlap(byScore.map((x) => x.workId), goldOrder, 10)
      const top20 = topKOverlap(byScore.map((x) => x.workId), goldOrder, 20)
      return { n: rows.length, mae: oa.mae, exactRate: oa.exactRate, within1Rate: oa.within1Rate, bias: oa.bias, qwk: oa.qwk, spearman: sp, pairwiseAcc: pw, ndcgAt10: ndcg10, topK10Overlap: top10, topK20Overlap: top20 }
    }
    const splits: Record<Split, ReturnType<typeof compute>> = {
      overall: compute(all),
      development: compute(subset((s) => s.dev)),
      holdout: compute(subset((s) => !s.dev)),
      digest_available: compute(subset((s) => s.digest)),
      no_reviews_available: compute(subset((s) => !s.digest)),
    }
    return splits
  }
  const metrics = { d1: metricsFor(d1.outputs), d2: metricsFor(d2.outputs) }
  const metricsSig = sha({ kind: "free-metrics", finalLabelsSignature: fl.finalLabelsSignature, d1: metrics.d1, d2: metrics.d2 })
  writeAtomic(resolve(OUT, "free-metrics.json"), stringify({ kind: "candidate-free-metrics", primary: "MAE ordinal — holdout", finalLabelsSignature: fl.finalLabelsSignature, metricsSignature: metricsSig, metrics }))

  // ── §5 PLANO PAGO b1/e1 (read-only; NÃO executa) ──
  const DIGEST_CHARS = (workId: string): number => {
    const e = en2by.get(workId); const d = e?.sanitizedDigest as { consensus?: string; divergence?: string; execution?: string; traits?: Array<{ trait: string }>; contentWarnings?: string[] } | null | undefined
    if (!d) return 0
    return [d.consensus ?? "", d.divergence ?? "", d.execution ?? "", ...(d.traits ?? []).map((t) => t.trait), ...(d.contentWarnings ?? [])].join(" ").length
  }
  const B1_IN = 1500, OUT_TOK = 400 // contrato congelado predict_interest_potential (base tokens(1500,400))
  const cost1 = (inTok: number, outTok: number) => { const c = computeCostUsd(SONNET, { inputTokens: inTok, outputTokens: outTok, cacheReadTokens: 0, cacheCreationTokens: 0 }); return c.costInputUsd + c.costOutputUsd }
  const planEntries = works.map((w) => {
    const snap = snapByWork.get(w.workId)!
    const b1InputSig = computeCandidateInputSignature(CANDIDATES.b1, snap)
    const e1InputSig = computeCandidateInputSignature(CANDIDATES.e1, snap)
    const e1DigestTokens = Math.ceil(DIGEST_CHARS(w.workId) / 4) // texto sanitizado injetado no e1 (~4 chars/token)
    return { workId: w.workId, b1: { inputSignature: b1InputSig, inputTokens: B1_IN, outputTokens: OUT_TOK }, e1: { inputSignature: e1InputSig, inputTokens: B1_IN + e1DigestTokens, outputTokens: OUT_TOK, reviewContextType: snap.reviewContextType } }
  })
  const sumTok = (sel: (e: typeof planEntries[number]) => { inputTokens: number; outputTokens: number }) => planEntries.reduce((a, e) => { const x = sel(e); a.in += x.inputTokens; a.out += x.outputTokens; return a }, { in: 0, out: 0 })
  const b1Tok = sumTok((e) => e.b1); const e1Tok = sumTok((e) => e.e1)
  const costOf = (tok: { in: number; out: number }) => { const likely = round(cost1(tok.in, tok.out), 6); return { likelyUsd: likely, upperUsd: round(likely * SAFETY, 6) } }
  const b1Cost = costOf(b1Tok); const e1Cost = costOf(e1Tok)
  const totalLikely = round(b1Cost.likelyUsd + e1Cost.likelyUsd, 6); const totalUpper = round(b1Cost.upperUsd + e1Cost.upperUsd, 6)
  const tokensTotal = { inputLikely: b1Tok.in + e1Tok.in, inputUpper: Math.ceil((b1Tok.in + e1Tok.in) * SAFETY), outputLikely: b1Tok.out + e1Tok.out, outputUpper: Math.ceil((b1Tok.out + e1Tok.out) * SAFETY) }
  const softCapUsd = ceilUsdToCents(totalLikely); const hardCapUsd = ceilUsdToCents(totalUpper)

  const snapshotSignature = computeSnapshotSignature({ goldenVersion: "pilot-2", works: snapInputs, promptVersions: [CANDIDATES.b1.promptVersion, CANDIDATES.e1.promptVersion], models: [SONNET], schemaVersions: ["v1"] })
  const planSignature = sha({
    planVersion: "candidate-paid-plan-v1", experimentVersion: EXPERIMENT_VERSION,
    base2Signature: base2.base2Signature, base2r1Signature: b2r1.base2r1Signature, enrichedSnapshotSignature: en2.enrichedSnapshotSignature,
    snapshotSignature, candidates: ["b1", "e1"], model: SONNET, schema: "v1",
    promptVersions: { b1: CANDIDATES.b1.promptVersion, e1: CANDIDATES.e1.promptVersion },
    pricing: { input: priceForModel(SONNET)!.inputPerMTok, output: priceForModel(SONNET)!.outputPerMTok },
    softCapUsd, hardCapUsd,
    entries: planEntries.map((e) => [e.workId, e.b1.inputSignature, e.e1.inputSignature]),
  })
  writeAtomic(resolve(OUT, "paid-plan-b1-e1.json"), stringify({
    kind: "candidate-paid-plan", planVersion: "candidate-paid-plan-v1", planSignature, status: "planned-not-authorized",
    candidates: { b1: { ...CANDIDATES.b1 }, e1: { ...CANDIDATES.e1 } }, model: SONNET,
    callsPlanned: { b1: 90, e1: 90, total: 180 },
    tokens: { b1: b1Tok, e1: e1Tok, total: tokensTotal },
    cost: { b1: b1Cost, e1: e1Cost, totalLikelyUsd: totalLikely, totalUpperUsd: totalUpper },
    caps: { softCapUsd, hardCapUsd, note: "PROPOSTAS — não autorizam execução." },
    formula: "b1: 1500 in / 400 out (contrato predict_interest_potential). e1: 1500 + ceil(chars_digest_sanitizado/4) in / 400 out. likely=sonnet $3/$15; upper=×1.5.",
    snapshotSignature, entries: planEntries, notAuthorization: "Plano read-only — execução paga exige autorização humana com a planSignature exata.",
  }))

  // ── manifesto ──
  const consolidationSig = sha({ kind: "candidates-phase", metricsSignature: metricsSig, d1: d1.aggSig, d2: d2.aggSig, planSignature })
  writeAtomic(resolve(OUT, "manifest.json"), stringify({
    kind: "candidates-manifest", capturedAt: new Date().toISOString(),
    gates: { labelsValid: true, finalLabelsSignature: fl.finalLabelsSignature, profileSignature: profileSig, profileFrozenMatch: true, base2r1Signature: b2r1.base2r1Signature, enrichedSnapshotSignature: en2.enrichedSnapshotSignature },
    free: { executed: ["d1", "d2"], outputsPerCandidate: 90, d1AggregateSignature: d1.aggSig, d2AggregateSignature: d2.aggSig },
    gap: { candidates: ["s0", "s1"], reason: "contrato congelado: deterministic=false, model=claude-sonnet-4-6 ⇒ LLM (não gratuitos). Não executados nesta fase $0; sem substituto inventado." },
    metricsSignature: metricsSig, paidPlanSignature: planSignature, consolidationSignature: consolidationSig,
    note: "0 LLM/$/escrita-no-banco. Labels lidas só nas métricas. taste_profile lido por SELECT (não-label), gate de assinatura ok.",
  }))

  // ── relatório ──
  const fmt = (m: ReturnType<typeof metricsFor>[Split]) => "n" in m && m.n > 0 ? `n=${m.n} MAE=${m.mae?.toFixed(3)} exact=${(m.exactRate! * 100).toFixed(0)}% w1=${(m.within1Rate! * 100).toFixed(0)}% QWK=${m.qwk?.toFixed(3)} ρ=${m.spearman?.toFixed(3)} pair=${m.pairwiseAcc?.toFixed(3)}` : "(vazio)"
  console.log("=== CANDIDATOS GRATUITOS + PLANO PAGO (local, $0) ===")
  console.log(`labels: 90/90 válidas (finalLabelsSignature ${fl.finalLabelsSignature.slice(0, 12)}) ✅`)
  console.log(`profile gate: ${profileSig.slice(0, 12)} == congelado ✅`)
  console.log(`GAP S0/S1: LLM (deterministic=false) — não gratuitos, não executados.`)
  for (const c of ["d1", "d2"] as const) {
    console.log(`\n[${c.toUpperCase()}] outputs=90`)
    console.log(`  overall : ${fmt(metrics[c].overall)}`)
    console.log(`  dev     : ${fmt(metrics[c].development)}`)
    console.log(`  holdout : ${fmt(metrics[c].holdout)}  ← MÉTRICA PRIMÁRIA (MAE)`)
    console.log(`  digest  : ${fmt(metrics[c].digest_available)}`)
    console.log(`  noRev   : ${fmt(metrics[c].no_reviews_available)}`)
  }
  console.log(`\nPLANO PAGO b1/e1: 180 chamadas (90+90)`)
  console.log(`  tokens: in likely=${tokensTotal.inputLikely} upper=${tokensTotal.inputUpper} | out likely=${tokensTotal.outputLikely} upper=${tokensTotal.outputUpper}`)
  console.log(`  custo b1: likely $${b1Cost.likelyUsd} upper $${b1Cost.upperUsd} | e1: likely $${e1Cost.likelyUsd} upper $${e1Cost.upperUsd}`)
  console.log(`  custo TOTAL: likely $${totalLikely} upper $${totalUpper} | soft $${softCapUsd.toFixed(2)} hard $${hardCapUsd.toFixed(2)}`)
  console.log(`  planSignature: ${planSignature}`)
  console.log(`artefatos: ${OUT.replace(process.cwd() + "/", "")}/`)
  console.log(`0 LLM · US$ 0 realizado · 0 escrita no banco · 0 commit.`)
}

main().catch((e) => { console.error("[candidates] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
