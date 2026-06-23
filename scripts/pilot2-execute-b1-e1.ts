/**
 * CLI — EXECUÇÃO PAGA dos candidatos b1/e1 do Pilot-2 (Plano 3 Fase B2.2X). Reusa o preditor
 * CONGELADO v2 (synopsis-quality-predictor: system prompt + tool + schema) via um `send` que chama
 * o SDK Anthropic DIRETO, SEM `createLoggedMessage` ⇒ 0 INSERT em ai_api_calls (honra "0 escrita no
 * banco"). e1 = v2 + adendo NEUTRO pré-comprometido + bloco do digest text-only-v1 (aprovado pela
 * usuária 2026-06-22). 1 geração por obra/candidato, sem retry pago. READ-ONLY no banco (só SELECT
 * do taste_profile, com gate). Labels lidas SÓ nas métricas. Outputs só em storage local.
 *
 * Uso (dry, só gate): npm run pilot2:execute-b1e1
 * Execução PAGA:       npm run pilot2:execute-b1e1 -- --execute --plan-signature=<sig> --max-cost-usd=3.02
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import type Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { deepStripLoneSurrogates } from "@/lib/ai/sanitize"
import { computeCostUsd } from "@/lib/ai/pricing"
import { TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import { loadCurrentTasteProfile, computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"
import {
  MODEL, SYNOPSIS_QUALITY_SYSTEM_PROMPT, SYNOPSIS_QUALITY_TOOL, synopsisQualityToolPayloadSchema,
  buildSynopsisQualityUserPrompt, type PredictWorkInput,
} from "@/lib/ai-evaluation/synopsis-quality-predictor"
import {
  CANDIDATES, computeCandidateInputSignature, computeTagsSignature, type WorkSnapshotInput,
} from "@/lib/synopsis-interest/experiment"
import { levelOf, ordinalAgreement, spearman, pairwiseAccuracy, ndcgAtK, topKOverlap } from "@/lib/synopsis-interest/metrics"
import type { SanitizedDigest } from "@/lib/synopsis-interest/contextual-package"

const P = ".local-experiments/plan3/digest-exp-1"
const PILOT2 = resolve(P, "pilot-2")
const CAND = resolve(PILOT2, "candidates")
const OUT = resolve(CAND, "paid")
const AUTH = {
  planSignature: "03f5b6f83efa8c0464dd8bd2e461781de77e8b678d58761dce65d9f3789a69e1",
  base2r1Signature: "b9dc2f2751af6ae738d79801d46f4aedd72c45e330a60bd49194c979233436a6",
  enrichedSnapshotSignature: "2e04269efa0b9c3a7b7398adab990f263222673d955dd92a7902363649c9b5a9",
  profileSig: "23eb13f0067132c5c8829bc98cdab0d894f79420c1100619d48b74e9a5177b87",
  finalLabelsSig: "a8abddca6354646a",
  hardCapUsd: 3.02,
}
/** Adendo NEUTRO do e1 (v2+digest) — pré-comprometido na aprovação humana. NÃO ajustado às labels. */
const E1_SYSTEM_ADDENDUM =
  "Além da sinopse, você recebe um RESUMO AGREGADO DE REVIEWS de leitores (consenso, divergências, traços recorrentes e avisos). Use-o como sinal COMPLEMENTAR ao julgamento — a SINOPSE segue dominante. Se não houver contexto de leitores, ignore esta parte."
const MAX_PER_CALL_UPPER = 0.1 // teto conservador por chamada (real ~$0.01-0.05) p/ o guard do hard cap

const sha = (o: unknown): string => createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex")
const r = (p: string): unknown => JSON.parse(readFileSync(resolve(p), "utf8"))
const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"
const die = (code: string, m: string): never => { console.error(`⛔ ${code} — ${m}`); process.exit(1) }
const writeAtomic = (p: string, c: string): void => { const t = `${p}.tmp`; writeFileSync(t, c); renameSync(t, p) }
const round = (n: number, d = 6): number => Math.round(n * 10 ** d) / 10 ** d
const arg = (n: string): string | undefined => { const p = process.argv.find((a) => a.startsWith(`--${n}=`)); return p ? p.slice(n.length + 3) : undefined }
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`)

/** mulberry32 — PRNG determinístico (bootstrap reprodutível). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function digestText(d: SanitizedDigest | null | undefined): string | null {
  if (!d) return null
  const parts: string[] = []
  if (d.consensus.trim()) parts.push(`Consenso: ${d.consensus}`)
  if (d.divergence.trim()) parts.push(`Divergências: ${d.divergence}`)
  if (d.traits.length) parts.push(`Traços recorrentes: ${d.traits.map((t) => `${t.trait} (${t.polarity})`).join("; ")}`)
  if (d.execution.trim()) parts.push(`Execução: ${d.execution}`)
  if (d.contentWarnings.length) parts.push(`Avisos: ${d.contentWarnings.join("; ")}`)
  return parts.length ? parts.join("\n") : null
}

async function main(): Promise<void> {
  // ── fonte de verdade congelada ──
  const base2 = r(`${PILOT2}/base-2-snapshot.json`) as { base2Signature: string; works: Array<{ workId: string; title: string; canonicalSynopsis: string; tags: string[]; split: string }> }
  const b2r1 = r(`${PILOT2}/base-2r1/base-2r1-snapshot.json`) as { base2r1Signature: string; works: Array<{ workId: string; reviewsAfterDedupe: number }> }
  const en2 = r(`${PILOT2}/enriched-2/pilot-2-snapshot-enriched.json`) as { enrichedSnapshotSignature: string; works: Array<{ workId: string; sanitizedDigest: SanitizedDigest | null; sanitizedDigestSignature: string | null }> }
  const plan = r(`${CAND}/paid-plan-b1-e1.json`) as { planSignature: string; entries: Array<{ workId: string; b1: { inputSignature: string }; e1: { inputSignature: string } }> }

  // ── §pré-execução: GATES (sem chamar o modelo) ──
  if (b2r1.base2r1Signature !== AUTH.base2r1Signature) die("PLAN_INVALIDATED", "base2r1Signature ≠")
  if (en2.enrichedSnapshotSignature !== AUTH.enrichedSnapshotSignature) die("PLAN_INVALIDATED", "enrichedSnapshotSignature ≠")
  if (plan.planSignature !== AUTH.planSignature) die("PLAN_INVALIDATED", "plan.planSignature ≠ autorizada")
  const profileRow = await loadCurrentTasteProfile()
  if (!profileRow || (profileRow as { is_stub?: boolean }).is_stub) die("PROFILE_GAP", "taste_profile ausente/stub")
  const profile = (profileRow as { profile: TasteProfilePayload }).profile
  const profileSig = computeProfileSignature(profile)
  if (profileSig !== AUTH.profileSig) die("PROFILE_DRIFT", `taste_profile ${profileSig.slice(0, 12)} ≠ congelado`)

  const n2g = new Map<string, string>()
  for (const g of TAG_GROUPS_CATALOG) for (const v of g.values) { const k = v.toLowerCase(); if (!n2g.has(k)) n2g.set(k, g.groupSlug) }
  const tagGroupOf = (n: string): string | null => n2g.get((n ?? "").toLowerCase()) ?? null
  const b2by = new Map(base2.works.map((w) => [w.workId, w]))
  const b2r1by = new Map(b2r1.works.map((w) => [w.workId, w]))
  const en2by = new Map(en2.works.map((w) => [w.workId, w]))
  const works = [...base2.works].sort((a, b) => (a.workId < b.workId ? -1 : 1))
  if (works.length !== 90) die("PLAN_INVALIDATED", `base-2 ${works.length} ≠ 90`)

  const snapByWork = new Map<string, WorkSnapshotInput>()
  for (const w of works) {
    const b = b2r1by.get(w.workId)!
    const e = en2by.get(w.workId)
    const reviewContextType = b.reviewsAfterDedupe > 0 ? "digest" : "no_reviews"
    snapByWork.set(w.workId, {
      workId: w.workId, titleSig: sha(w.title), synopsisSig: sha(w.canonicalSynopsis), tagsSig: computeTagsSignature(w.tags),
      profileSig, reviewContextType,
      reviewContextSig: reviewContextType === "digest" ? `text-only-v1:${e?.sanitizedDigestSignature ?? "?"}` : "no_reviews",
    })
  }
  // recomputa planSignature dos artefatos congelados ⇒ tem de bater (drift ⇒ stop)
  const planEntryById = new Map(plan.entries.map((p) => [p.workId, p]))
  for (const w of works) {
    const snap = snapByWork.get(w.workId)!
    const b1 = computeCandidateInputSignature(CANDIDATES.b1, snap)
    const e1 = computeCandidateInputSignature(CANDIDATES.e1, snap)
    const pe = planEntryById.get(w.workId)
    if (!pe) die("PLAN_INVALIDATED", `workId ${w.workId} ausente do plano`)
    if (pe!.b1.inputSignature !== b1 || pe!.e1.inputSignature !== e1) die("PLAN_INVALIDATED", `inputSignature de ${w.workId} divergiu`)
  }
  // Gate forte = plan.planSignature == AUTH (stored) + inputSig por obra recomputado == plano (acima)
  // + sigs congeladas. Detecta qualquer drift de input sem precisar reproduzir o cálculo de custo.
  console.log("=== GATES OK (planSignature/snapshots/profile/inputs congelados) ===")
  console.log(`planSignature ${AUTH.planSignature.slice(0, 16)} · base2r1 ${b2r1.base2r1Signature.slice(0, 12)} · enriched2 ${en2.enrichedSnapshotSignature.slice(0, 12)} · profile ${profileSig.slice(0, 12)} ✅`)

  if (!hasFlag("execute")) { console.log(`\n[DRY] gates ok, 0 chamadas. Para executar: npm run pilot2:execute-b1e1 -- --execute --plan-signature=${AUTH.planSignature} --max-cost-usd=${AUTH.hardCapUsd}`); return }
  if (arg("plan-signature") !== AUTH.planSignature) die("PLAN_INVALIDATED", "--plan-signature ≠")
  if (Number(arg("max-cost-usd")) !== AUTH.hardCapUsd) die("PLAN_INVALIDATED", "--max-cost-usd ≠ hard cap")

  // ── send SEM logging em DB (SDK direto) ──
  const client = getAnthropicClient({ maxRetries: 2 })
  let actualSpentUsd = 0
  let costCapHit = false
  const callModel = async (system: Anthropic.Messages.TextBlockParam[], userBlocks: Anthropic.Messages.TextBlockParam[]): Promise<{ payload: unknown; usageCost: number; ok: boolean; err?: string }> => {
    const params = deepStripLoneSurrogates({
      model: MODEL, max_tokens: 400, temperature: 0, system,
      tools: [SYNOPSIS_QUALITY_TOOL], tool_choice: { type: "tool", name: SYNOPSIS_QUALITY_TOOL.name },
      messages: [{ role: "user", content: userBlocks }],
    }) as Anthropic.Messages.MessageCreateParamsNonStreaming
    const msg = await client.messages.create(params)
    const u = msg.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
    const c = computeCostUsd(MODEL, { inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0, cacheReadTokens: u?.cache_read_input_tokens ?? 0, cacheCreationTokens: u?.cache_creation_input_tokens ?? 0 })
    const cost = c.costInputUsd + c.costOutputUsd + c.costCacheReadUsd + c.costCacheCreationUsd
    actualSpentUsd += cost
    if (actualSpentUsd + MAX_PER_CALL_UPPER > AUTH.hardCapUsd) costCapHit = true
    const tu = msg.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === SYNOPSIS_QUALITY_TOOL.name)
    if (!tu) return { payload: null, usageCost: cost, ok: false, err: msg.stop_reason === "max_tokens" ? "max_tokens" : "no_tool_use" }
    const parsed = synopsisQualityToolPayloadSchema.safeParse(tu.input)
    if (!parsed.success) return { payload: null, usageCost: cost, ok: false, err: "schema_invalid" }
    return { payload: parsed.data, usageCost: cost, ok: true }
  }

  const runCandidate = async (cid: "b1" | "e1") => {
    const outputs: Array<Record<string, unknown>> = []
    let succeeded = 0, failed = 0
    for (const w of works) {
      if (costCapHit) { outputs.push({ candidateId: cid, workId: w.workId, status: "stopped_by_cost" }); continue }
      const inputSignature = planEntryById.get(w.workId)![cid].inputSignature
      const workInput: PredictWorkInput = { id: w.workId, title: w.title, synopsis: w.canonicalSynopsis, tags: w.tags.map((n) => ({ name: n, group: tagGroupOf(n) })) }
      const { profileBlock, tailBlock } = buildSynopsisQualityUserPrompt(profile, workInput)
      const system: Anthropic.Messages.TextBlockParam[] = cid === "b1"
        ? [{ type: "text", text: SYNOPSIS_QUALITY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]
        : [{ type: "text", text: SYNOPSIS_QUALITY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }, { type: "text", text: E1_SYSTEM_ADDENDUM }]
      const userBlocks: Anthropic.Messages.TextBlockParam[] = [{ type: "text", text: profileBlock, cache_control: { type: "ephemeral" } }, { type: "text", text: tailBlock }]
      if (cid === "e1") { const dt = digestText(en2by.get(w.workId)?.sanitizedDigest); if (dt) userBlocks.push({ type: "text", text: `CONTEXTO DE LEITORES (resumo agregado de reviews):\n${dt}` }) }
      let res: Awaited<ReturnType<typeof callModel>>
      try { res = await callModel(system, userBlocks) }
      catch (e) { failed += 1; outputs.push({ candidateId: cid, workId: w.workId, status: "failed", error: e instanceof Error ? e.message : String(e) }); continue }
      if (!res.ok) { failed += 1; outputs.push({ candidateId: cid, workId: w.workId, status: "failed", error: res.err, inputSignature }); continue }
      const pq = (res.payload as { predicted_quality: string; justification: string; confidence?: number | null })
      const level = levelOf(pq.predicted_quality)
      const outputSignature = sha({ kind: "candidate-output", inputSignature, prediction: level })
      succeeded += 1
      outputs.push({ candidateId: cid, workId: w.workId, status: "succeeded", inputSignature, predictionOrdinal: level, predictedQuality: pq.predicted_quality, justification: pq.justification, confidence: pq.confidence ?? null, outputSignature, costUsd: round(res.usageCost) })
    }
    return { outputs, succeeded, failed }
  }

  console.log(`\n=== EXECUÇÃO PAGA — b1 + e1 · hard cap $${AUTH.hardCapUsd} · ${MODEL} ===`)
  const b1 = await runCandidate("b1")
  const e1 = await runCandidate("e1")

  mkdirSync(OUT, { recursive: true })
  const saveCand = (cid: "b1" | "e1", res: { outputs: Array<Record<string, unknown>>; succeeded: number; failed: number }) => {
    const ok = res.outputs.filter((o) => o.status === "succeeded")
    const aggSig = sha({ candidate: cid, items: [...ok].sort((a, b) => ((a.workId as string) < (b.workId as string) ? -1 : 1)).map((o) => [o.workId, o.inputSignature, o.predictionOrdinal, o.outputSignature]) })
    writeAtomic(resolve(OUT, `paid-${cid}.json`), stringify({ kind: "candidate-paid-outputs", candidateId: cid, model: MODEL, counts: { succeeded: res.succeeded, failed: res.failed, total: res.outputs.length }, aggregateSignature: aggSig, outputs: res.outputs }))
    return { aggSig, ok }
  }
  const b1s = saveCand("b1", b1)
  const e1s = saveCand("e1", e1)

  // custo real por candidato
  const costOf = (outs: Array<Record<string, unknown>>) => round(outs.reduce((a, o) => a + ((o.costUsd as number) ?? 0), 0))
  const b1Cost = costOf(b1.outputs), e1Cost = costOf(e1.outputs)

  // ── §pós: validação ──
  const gate = b1.succeeded === 90 && e1.succeeded === 90 && b1.failed === 0 && e1.failed === 0
    && new Set(b1s.ok.map((o) => o.workId)).size === 90 && new Set(e1s.ok.map((o) => o.workId)).size === 90

  // ── MÉTRICAS FINAIS D1/D2/b1/e1 ──
  const fl = r(`${PILOT2}/contextual-2/consolidated/final-labels.json`) as { finalLabelsSignature: string; labels: Array<{ workId: string; label: string }> }
  const labelOf = new Map(fl.labels.map((l) => [l.workId, levelOf(l.label)]))
  const d1Out = (r(`${CAND}/free-d1.json`) as { outputs: Array<{ workId: string; predictionOrdinal: number; score: number }> }).outputs
  const d2Out = (r(`${CAND}/free-d2.json`) as { outputs: Array<{ workId: string; predictionOrdinal: number; score: number }> }).outputs
  const predMap = (outs: Array<{ workId: string; predictionOrdinal: number; score?: number }>) => new Map(outs.map((o) => [o.workId, { pred: o.predictionOrdinal, score: o.score ?? o.predictionOrdinal }]))
  const preds = { d1: predMap(d1Out), d2: predMap(d2Out), b1: predMap(b1s.ok as Array<{ workId: string; predictionOrdinal: number }>), e1: predMap(e1s.ok as Array<{ workId: string; predictionOrdinal: number }>) }
  const splitDev = (id: string) => b2by.get(id)!.split === "development"
  const splitDigest = (id: string) => b2r1by.get(id)!.reviewsAfterDedupe > 0
  const rowsFor = (m: Map<string, { pred: number; score: number }>, filt: (id: string) => boolean) =>
    works.filter((w) => m.has(w.workId) && filt(w.workId)).map((w) => ({ workId: w.workId, pred: m.get(w.workId)!.pred, score: m.get(w.workId)!.score, gold: labelOf.get(w.workId)! }))
  const compute = (rows: Array<{ workId: string; pred: number; score: number; gold: number }>) => {
    if (!rows.length) return { n: 0 }
    const oa = ordinalAgreement(rows.map((x) => ({ pred: x.pred, gold: x.gold })))
    const byScore = [...rows].sort((a, b) => b.score - a.score || (a.workId < b.workId ? -1 : 1))
    const goldOrder = [...rows].sort((a, b) => b.gold - a.gold || (a.workId < b.workId ? -1 : 1)).map((x) => x.workId)
    return { n: rows.length, mae: oa.mae, exactRate: oa.exactRate, within1Rate: oa.within1Rate, bias: oa.bias, qwk: oa.qwk,
      spearman: spearman(rows.map((x) => x.score), rows.map((x) => x.gold)), pairwiseAcc: pairwiseAccuracy(rows.map((x) => ({ score: x.score, truth: x.gold }))),
      ndcgAt10: ndcgAtK(byScore.map((x) => x.gold), 10), topK10Overlap: topKOverlap(byScore.map((x) => x.workId), goldOrder, 10), topK20Overlap: topKOverlap(byScore.map((x) => x.workId), goldOrder, 20) }
  }
  const splits = { overall: () => true, development: splitDev, holdout: (id: string) => !splitDev(id), digest_available: splitDigest, no_reviews_available: (id: string) => !splitDigest(id) } as const
  const metricsFor = (m: Map<string, { pred: number; score: number }>) => Object.fromEntries(Object.entries(splits).map(([k, f]) => [k, compute(rowsFor(m, f))]))
  const metrics = { d1: metricsFor(preds.d1), d2: metricsFor(preds.d2), b1: metricsFor(preds.b1), e1: metricsFor(preds.e1) }

  // ── ΔMAE pareado e1−b1 + bootstrap CI (seeded) ──
  const pairedDelta = (filt: (id: string) => boolean) => {
    const ids = works.map((w) => w.workId).filter((id) => preds.b1.has(id) && preds.e1.has(id) && filt(id))
    const ae = ids.map((id) => ({ b1: Math.abs(preds.b1.get(id)!.pred - labelOf.get(id)!), e1: Math.abs(preds.e1.get(id)!.pred - labelOf.get(id)!) }))
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
    const point = round(mean(ae.map((x) => x.e1)) - mean(ae.map((x) => x.b1)), 4)
    const rand = rng(20260622)
    const B = 5000; const deltas: number[] = []
    for (let b = 0; b < B; b++) { let se = 0, sb = 0; for (let i = 0; i < ae.length; i++) { const j = Math.floor(rand() * ae.length); se += ae[j]!.e1; sb += ae[j]!.b1 } deltas.push((se - sb) / ae.length) }
    deltas.sort((a, b) => a - b)
    return { n: ae.length, deltaMae: point, ci95: [round(deltas[Math.floor(0.025 * B)]!, 4), round(deltas[Math.floor(0.975 * B)]!, 4)], bootstrap: B, seed: 20260622, note: "ΔMAE<0 ⇒ e1 melhor (menos erro) que b1" }
  }
  const deltaHoldout = pairedDelta((id) => !splitDev(id))
  const deltaOverall = pairedDelta(() => true)
  const deltaDigest = pairedDelta(splitDigest)

  // ── conclusão pelo critério CONGELADO (MAE holdout; não decidir por dev/overall) ──
  const maeH = { d1: metrics.d1.holdout, d2: metrics.d2.holdout, b1: metrics.b1.holdout, e1: metrics.e1.holdout } as Record<string, { mae?: number | null }>
  const ranked = (["d1", "d2", "b1", "e1"] as const).map((c) => ({ c, mae: maeH[c]?.mae ?? Infinity })).sort((a, b) => a.mae - b.mae)
  const e1HelpsHoldout = deltaHoldout.ci95[1]! < 0 ? "e1<b1 (CI exclui 0, e1 ajuda)" : deltaHoldout.ci95[0]! > 0 ? "e1>b1 (CI exclui 0, e1 piora)" : "inconclusivo (CI inclui 0)"
  const conclusion = { criterion: "MAE ordinal no holdout (congelado)", holdoutRanking: ranked.map((x) => `${x.c}=${x.mae === Infinity ? "n/a" : x.mae?.toFixed(3)}`), e1_vs_b1_holdout: e1HelpsHoldout, note: "Não selecionar vencedor por development/overall." }

  const metricsSig = sha({ kind: "final-metrics", finalLabelsSignature: fl.finalLabelsSignature, metrics, deltaHoldout, deltaOverall, deltaDigest })
  writeAtomic(resolve(OUT, "final-metrics.json"), stringify({ kind: "candidate-final-metrics", primary: "MAE ordinal — holdout", finalLabelsSignature: fl.finalLabelsSignature, metricsSignature: metricsSig,
    realCostUsd: { b1: b1Cost, e1: e1Cost, total: round(b1Cost + e1Cost) }, metrics, pairedDeltaMae: { holdout: deltaHoldout, overall: deltaOverall, digest_available: deltaDigest }, conclusion }))
  writeAtomic(resolve(OUT, "manifest.json"), stringify({ kind: "b1e1-execution-manifest", capturedAt: new Date().toISOString(), planSignature: AUTH.planSignature,
    counts: { b1: { succeeded: b1.succeeded, failed: b1.failed }, e1: { succeeded: e1.succeeded, failed: e1.failed }, input_changed: 0 },
    gateAllOk: gate, realCostUsd: { b1: b1Cost, e1: e1Cost, total: round(b1Cost + e1Cost) }, costCapHit, hardCapUsd: AUTH.hardCapUsd,
    aggregateSignatures: { b1: b1s.aggSig, e1: e1s.aggSig }, metricsSignature: metricsSig,
    e1Prompt: { systemAddendum: E1_SYSTEM_ADDENDUM, digestSource: "enriched-2 sanitized text-only-v1" },
    note: "0 escrita no banco (send sem createLoggedMessage; só SELECT do profile). 1 geração/obra. 0 retry pago de aplicação." }))

  // ── relatório ──
  const fmt = (m: { n?: number; mae?: number | null; exactRate?: number | null; within1Rate?: number | null; qwk?: number | null; spearman?: number | null; pairwiseAcc?: number | null }) =>
    (m.n ?? 0) > 0 ? `n=${m.n} MAE=${m.mae?.toFixed(3)} exact=${((m.exactRate ?? 0) * 100).toFixed(0)}% w1=${((m.within1Rate ?? 0) * 100).toFixed(0)}% QWK=${m.qwk?.toFixed(3)} ρ=${m.spearman?.toFixed(3)} pair=${m.pairwiseAcc?.toFixed(3)}` : "(vazio)"
  console.log(`\nb1: succeeded=${b1.succeeded} failed=${b1.failed} | e1: succeeded=${e1.succeeded} failed=${e1.failed} | costCapHit=${costCapHit}`)
  console.log(`custo REAL: b1 $${b1Cost} · e1 $${e1Cost} · total $${round(b1Cost + e1Cost)} (hard $${AUTH.hardCapUsd})`)
  console.log(`\n=== HOLDOUT (métrica primária) ===`)
  for (const c of ["d1", "d2", "b1", "e1"] as const) console.log(`  ${c}: ${fmt(metrics[c].holdout as { n: number })}`)
  console.log(`ΔMAE e1−b1 holdout: ${deltaHoldout.deltaMae} CI95 [${deltaHoldout.ci95[0]}, ${deltaHoldout.ci95[1]}] (n=${deltaHoldout.n}) → ${e1HelpsHoldout}`)
  console.log(`ΔMAE e1−b1 overall: ${deltaOverall.deltaMae} CI95 [${deltaOverall.ci95[0]}, ${deltaOverall.ci95[1]}]`)
  console.log(`grupos: digest_available e1 MAE=${(metrics.e1.digest_available as { mae?: number }).mae?.toFixed(3)} b1 MAE=${(metrics.b1.digest_available as { mae?: number }).mae?.toFixed(3)} | no_reviews e1 MAE=${(metrics.e1.no_reviews_available as { mae?: number }).mae?.toFixed(3)} b1 MAE=${(metrics.b1.no_reviews_available as { mae?: number }).mae?.toFixed(3)}`)
  console.log(`conclusão (holdout): ranking ${conclusion.holdoutRanking.join(" < ")} | e1 vs b1: ${e1HelpsHoldout}`)
  console.log(`metricsSignature: ${metricsSig}`)
  console.log(`b1 aggSig ${b1s.aggSig.slice(0, 16)} · e1 aggSig ${e1s.aggSig.slice(0, 16)}`)
  console.log(`artefatos: ${OUT.replace(process.cwd() + "/", "")}/ · 0 escrita no banco · 0 commit`)
  if (!gate) die("POSTCHECK_FAILED", "não há 90 succeeded em b1/e1 (ver manifest)")
}

main().catch((e) => { console.error("[b1e1] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
