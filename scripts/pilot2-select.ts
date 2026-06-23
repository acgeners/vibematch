/**
 * CLI — Fase B2.2F: seleção DETERMINÍSTICA do pilot-2 + materialização do pilot-2 e,
 * condicionalmente, do base-2. READ-ONLY no banco (só `SELECT`). NÃO chama LLM, NÃO gera
 * digest, NÃO refresca reviews, NÃO escreve no banco, NÃO cria migration. NÃO toca labels.
 *
 * Casca sobre `lib/synopsis-interest/pilot2-selection` (lógica pura/testada).
 *
 * PROTEÇÃO: aborta antes do banco se o manifesto do pilot-2 já existir, salvo `--force`.
 *
 * Uso: npm run pilot2:select   |   npm run pilot2:select -- --force
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import {
  selectNewWorks,
  selectRepeats,
  buildPilot2Definition,
  validatePilot2Definition,
  evaluateReviewsGate,
  canonicalListHash,
  SELECTION_SEED,
  REPEATS_SEED,
  STRATUM_QUOTA,
  CELL_QUOTA,
  type EligibleWork,
  type CarryoverEntry,
  type NewWorkReviewState,
} from "@/lib/synopsis-interest/pilot2-selection"
import { labelDisplayContentFromWork, computeLabelDisplaySignature } from "@/lib/synopsis-interest/label-reuse"
import type { Stratum } from "@/lib/synopsis-interest/pilot2-composition"

const sha = (s: string): string => createHash("sha256").update(s).digest("hex")
const OUT_DIR = ".local-experiments/plan3/digest-exp-1/pilot-2"
const BASE1 = ".local-experiments/plan3/digest-exp-1/base-1/golden-snapshot-base.json"
const ENR1 = ".local-experiments/plan3/digest-exp-1/enriched-1/golden-snapshot-enriched.json"
const AUTO = ".local-experiments/plan3/digest-exp-1/pilot-1-audit/pilot-1-reading-status-auto.json"
const UNREAD_STATUS = [8, 10]
const STRATA: Stratum[] = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"]
const FRESH_DAYS = 30
// custo/digest histórico (golden 51 → ~$1.0 likely / ~$5.9 upper)
const DIGEST_LIKELY_USD = 0.0196
const DIGEST_UPPER_USD = 0.1157

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"]
  }),
) as Record<string, string>
const force = args.force === "true"

interface Base1Work {
  workId: string
  title: string
  split: "development" | "holdout"
  stratum: string
  canonicalSynopsis: string
  tags: string[]
  tagContextType: string
  titleSignature: string
  synopsisSignature: string
  tagsSignature: string
  tasteProfileSignature: string
  reviewCorpusSignature: string
  baseInputSignature: string
}
interface EnrWork {
  workId: string
  contextualTags: string[]
  reviewContext: "digest_available" | "no_reviews_available"
  sanitizedDigest: unknown
}

async function main(): Promise<void> {
  const manifestPath = resolve(OUT_DIR, "pilot-2-manifest.json")
  if (existsSync(manifestPath) && !force) {
    console.error(`⛔ pilot-2 já materializado: ${manifestPath} — use --force para regenerar.`)
    console.error(`   sha256 atual: ${sha(readFileSync(manifestPath, "utf8")).slice(0, 16)}… (PRESERVADO)`)
    process.exit(2)
  }
  // criar dir
  const { mkdirSync } = await import("node:fs")
  mkdirSync(resolve(OUT_DIR), { recursive: true })

  // ── artefatos congelados ──
  const base1 = JSON.parse(readFileSync(resolve(BASE1), "utf8")) as { snapshotBaseSignature: string; works: Base1Work[] }
  if (!base1.snapshotBaseSignature.startsWith("634571c2")) throw new Error("base-1 sig inesperada")
  const enr1 = JSON.parse(readFileSync(resolve(ENR1), "utf8")) as { enrichedSnapshotSignature: string; works: EnrWork[] }
  if (!enr1.enrichedSnapshotSignature.startsWith("8b61084d")) throw new Error("enriched-1 sig inesperada")
  const auto = JSON.parse(readFileSync(resolve(AUTO), "utf8")) as { rows: Array<{ work_id: string; derived_reading_status: string }> }

  const base1ById = new Map(base1.works.map((w) => [w.workId, w]))
  const enr1ById = new Map(enr1.works.map((w) => [w.workId, w]))
  const pilot1Ids = new Set(base1.works.map((w) => w.workId))
  const unreadCarryoverIds = auto.rows.filter((r) => r.derived_reading_status === "unread").map((r) => r.work_id)
  if (unreadCarryoverIds.length !== 51) throw new Error(`esperado 51 carryovers, achou ${unreadCarryoverIds.length}`)
  const carryovers: CarryoverEntry[] = unreadCarryoverIds.map((id) => {
    const b = base1ById.get(id)!
    return { workId: id, stratum: b.stratum as Stratum, split: b.split }
  })

  // ── DB read-only ──
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // paginação read-only com filtro `.in(col, values)` (captura `sb`)
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

  // pool elegível (gates Parte C)
  const poolRows = await fetchAll<{ id: string; synopsis_quality: string | null; is_archived: boolean; canonical_synopsis: string | null }>(
    "works", "id, synopsis_quality, is_archived, canonical_synopsis", { col: "personal_status_id", values: UNREAD_STATUS },
  )
  const eligible: EligibleWork[] = poolRows
    .filter((w) => !pilot1Ids.has(w.id) && !w.is_archived && STRATA.includes(w.synopsis_quality as Stratum) && (w.canonical_synopsis ?? "").trim().length > 0)
    .map((w) => ({ workId: w.id, stratum: w.synopsis_quality as Stratum }))

  // ── seleção das 39 (Parte D) ──
  const sel = selectNewWorks({ pool: eligible })
  if (!sel.ok) {
    console.error("⛔ DÉFICIT de stratum — parando, sem seleção parcial:")
    for (const d of sel.deficits) console.error(`   ${d.stratum}: elegíveis=${d.available} quota=${d.quota} déficit=${d.deficit}`)
    process.exit(3)
  }
  // ── repeats (Parte E) ──
  const rep = selectRepeats({ newSelected: sel.selected })
  if (!rep.ok) throw new Error("repeats: " + rep.error)

  // ── definição do pilot-2 (Parte F) ──
  const def = buildPilot2Definition({ carryovers, newSelected: sel.selected, repeats: rep.repeats })
  const val = validatePilot2Definition(def)
  if (!val.ok) throw new Error("definição inválida: " + val.errors.join("; "))

  const newIds = sel.selected.map((w) => w.workId)

  // ── base-2 preflight: reviews/tags/digest das 39 novas (Parte G) ──
  const newWorkRows = await fetchAll<{ id: string; title: string; synopsis_quality: string; canonical_synopsis: string; canonical_synopsis_inputs_hash: string; review_digest_version: string | null; review_digest_n: number | null }>(
    "works", "id, title, synopsis_quality, canonical_synopsis, canonical_synopsis_inputs_hash, review_digest_version, review_digest_n", { col: "id", values: newIds },
  )
  const newById = new Map(newWorkRows.map((w) => [w.id, w]))
  const revRows = await fetchAll<{ work_id: string; text_length: number | null; fetched_at: string | null }>(
    "work_reviews", "work_id, text_length, fetched_at", { col: "work_id", values: newIds },
  )
  const tagRows = await fetchAll<{ work_id: string; tags: { name: string } | null }>(
    "work_tags", "work_id, tags(name)", { col: "work_id", values: newIds },
  )
  const tagsByWork = new Map<string, string[]>()
  for (const r of tagRows) {
    if (!r.tags?.name) continue
    const arr = tagsByWork.get(r.work_id) ?? []
    arr.push(r.tags.name)
    tagsByWork.set(r.work_id, arr)
  }
  const usefulByWork = new Map<string, number>()
  const lastFetch = new Map<string, number>()
  const NOW = Date.now()
  const DAY = 86400000
  for (const r of revRows) {
    if ((r.text_length ?? 0) >= 40) usefulByWork.set(r.work_id, (usefulByWork.get(r.work_id) ?? 0) + 1)
    if (r.fetched_at) {
      const t = +new Date(r.fetched_at)
      if (t > (lastFetch.get(r.work_id) ?? 0)) lastFetch.set(r.work_id, t)
    }
  }
  const reviewStates: NewWorkReviewState[] = newIds.map((id) => {
    const useful = usefulByWork.get(id) ?? 0
    const t = lastFetch.get(id)
    return { workId: id, hasUsefulReviews: useful > 0, maxFetchAgeDays: useful > 0 ? (t ? (NOW - t) / DAY : null) : null }
  })
  const gate = evaluateReviewsGate(reviewStates, FRESH_DAYS)

  // ── Parte H: assinaturas de display dos 51 carryovers (artefatos congelados) ──
  const carrySigs = unreadCarryoverIds.map((id) => {
    const b = base1ById.get(id)!
    const e = enr1ById.get(id)!
    const content = labelDisplayContentFromWork({
      synopsis: b.canonicalSynopsis,
      contextualTags: e.contextualTags,
      reviewContextType: e.reviewContext,
      sanitizedDigest: e.sanitizedDigest as never,
    })
    return { workId: id, displaySignature: computeLabelDisplaySignature(content) }
  })
  const carrySigOk = carrySigs.length === 51 && carrySigs.every((c) => c.displaySignature.length === 64)
  const carryCorpusSig = sha(JSON.stringify([...carrySigs].sort((a, b) => a.workId.localeCompare(b.workId))))

  // ── Parte I: dry-run de digests das 39 novas (sem executar) ──
  const digestPlan = newIds.map((id) => {
    const w = newById.get(id)
    const useful = usefulByWork.get(id) ?? 0
    const rs = reviewStates.find((r) => r.workId === id)!
    let state: string
    if (useful === 0) state = "no_reviews_available"
    else if (rs.maxFetchAgeDays != null && rs.maxFetchAgeDays > FRESH_DAYS) state = "blocked_by_review_freshness"
    else if (rs.maxFetchAgeDays == null) state = "blocked_by_review_freshness"
    else if (w?.review_digest_version === "digest-v1" && (w.review_digest_n ?? 0) >= useful) state = "digest_compatible_reusable"
    else if (w?.review_digest_version === "digest-v1") state = "digest_stale_incompatible"
    else state = "digest_missing_with_reviews"
    return { workId: id, state }
  })
  const digestCounts = digestPlan.reduce<Record<string, number>>((a, d) => ((a[d.state] = (a[d.state] ?? 0) + 1), a), {})
  const needDigestIds = digestPlan.filter((d) => d.state === "digest_missing_with_reviews" || d.state === "digest_stale_incompatible").map((d) => d.workId)

  // ── escrever manifesto do pilot-2 (Parte F) ──
  const versions = { goldenVersion: "pilot-2", baseSnapshotVersion: "base-2", derivedFrom: { base: "base-1", enriched: "enriched-1" }, tasteProfileVersion: "v7", schemaVersion: "v1" }
  const pilot2Manifest = {
    versions,
    selectionSeed: SELECTION_SEED,
    repeatsSeed: REPEATS_SEED,
    stratumQuota: STRATUM_QUOTA,
    cellQuota: CELL_QUOTA,
    uniqueWorks: def.uniqueWorks,
    totalSlots: def.totalSlots,
    carryoverCount: def.carryoverCount,
    newCount: def.newCount,
    repeatCount: def.repeatCount,
    splitTotals: def.splitTotals,
    stratumTotals: def.stratumTotals,
    eligiblePool: { totalEligible: eligible.length, byStratum: sel.eligibleByStratum, reservesByStratum: sel.reservesByStratum },
    selectionListHash: sel.canonicalListHash,
    repeatsListHash: rep.canonicalListHash,
    repeatDistribution: rep.distribution,
    carryoverWorkIds: [...unreadCarryoverIds].sort(),
    newWorkIds: [...newIds].sort(),
    slots: def.slots,
    repeatMap: def.repeatMap,
    carryoverDisplaySignatures: { ok: carrySigOk, count: carrySigs.length, corpusSignature: carryCorpusSig, perWork: carrySigs },
    reviewsGate: { ok: gate.ok, freshWithReviews: gate.freshWithReviews, noReviews: gate.noReviews, blockers: gate.blockers },
    digestDryRun: { counts: digestCounts, needGeneration: needDigestIds.length },
  }
  const pilot2Json = JSON.stringify(pilot2Manifest, null, 2) + "\n"
  writeFileSync(manifestPath, pilot2Json)

  // ── base-2: materializa SE o gate passar (Parte G) ──
  let base2Status: string
  if (gate.ok) {
    const carryEntries = carryovers.map((c) => {
      const b = base1ById.get(c.workId)!
      return {
        workId: c.workId,
        origin: "carryover",
        derivedFrom: "base-1",
        split: c.split,
        stratum: c.stratum,
        title: b.title,
        canonicalSynopsis: b.canonicalSynopsis,
        tags: b.tags,
        tagContextType: b.tagContextType,
        titleSignature: b.titleSignature,
        synopsisSignature: b.synopsisSignature,
        tagsSignature: b.tagsSignature,
        tasteProfileSignature: b.tasteProfileSignature,
        reviewCorpusSignature: b.reviewCorpusSignature,
        baseInputSignature: b.baseInputSignature,
      }
    })
    const newEntries = sel.selected.map((w) => {
      const row = newById.get(w.workId)!
      const tags = tagsByWork.get(w.workId) ?? []
      const useful = usefulByWork.get(w.workId) ?? 0
      return {
        workId: w.workId,
        origin: "new",
        split: w.split,
        stratum: w.stratum,
        title: row.title,
        canonicalSynopsis: row.canonical_synopsis,
        canonicalSynopsisInputsHash: row.canonical_synopsis_inputs_hash,
        tags,
        tagContextType: tags.length > 0 ? "tags_present" : "missing_recoverable_frozen_empty",
        reviewContextType: useful > 0 ? "frozen_current" : "no_reviews_available",
        usefulReviewCount: useful,
        digestVersion: row.review_digest_version ?? null,
        tasteProfileVersion: "v7",
      }
    })
    const allEntries = [...carryEntries, ...newEntries].sort((a, b) => a.workId.localeCompare(b.workId))
    const base2Sig = sha(JSON.stringify(allEntries.map((e) => ({ id: e.workId, syn: sha(e.canonicalSynopsis || ""), tags: [...e.tags].sort(), split: e.split, stratum: e.stratum }))))
    const base2 = {
      versions: { ...versions, baseSnapshotVersion: "base-2" },
      derivedFrom: { base: "base-1", baseSignature: base1.snapshotBaseSignature, enriched: "enriched-1" },
      uniqueWorks: allEntries.length,
      totalSlots: 100,
      carryoverCount: carryEntries.length,
      newCount: newEntries.length,
      reviewsGate: { ok: true, policy: `useful≤${FRESH_DAYS}d || no_reviews` },
      base2Signature: base2Sig,
      works: allEntries,
    }
    writeFileSync(resolve(OUT_DIR, "base-2-snapshot.json"), JSON.stringify(base2, null, 2) + "\n")
    base2Status = `MATERIALIZADO (base2Signature=${base2Sig.slice(0, 12)}…)`
  } else {
    const blockerReport = {
      reason: "review-freshness gate",
      blockers: gate.blockers.map((b) => ({ workId: b.workId, reason: b.reason })),
      note: "pilot-2 preservado; obras NÃO trocadas. Opções: (1) refresh antes do snapshot; (2) substituir candidata (decisão humana); (3) congelar com limitação explícita.",
    }
    writeFileSync(resolve(OUT_DIR, "base-2-BLOCKED.json"), JSON.stringify(blockerReport, null, 2) + "\n")
    base2Status = `NÃO materializado — ${gate.blockers.length} blocker(s) de freshness`
  }

  // ── relatório ──
  console.log("✅ pilot-2 materializado (local):", manifestPath, "sha256", sha(pilot2Json).slice(0, 16) + "…")
  console.log(`   90 únicas / 100 slots · dev ${def.splitTotals.development} / hold ${def.splitTotals.holdout} · strata ${STRATA.map((s) => def.stratumTotals[s]).join("/")}`)
  console.log(`   selectionListHash ${sel.canonicalListHash.slice(0, 16)}… · repeatsListHash ${rep.canonicalListHash.slice(0, 16)}…`)
  console.log("   reservas por stratum:", JSON.stringify(sel.reservesByStratum))
  console.log(`   repeats: 10 (dev 6 / hold 4) dist ${JSON.stringify(rep.distribution)}`)
  console.log(`   carryover display sigs: ${carrySigOk ? "51/51 OK" : "FALHA"} corpus ${carryCorpusSig.slice(0, 12)}…`)
  console.log(`   reviews gate: ${gate.ok ? "OK" : "BLOQUEADO"} (fresh ${gate.freshWithReviews} / no_reviews ${gate.noReviews} / blockers ${gate.blockers.length})`)
  console.log("   base-2:", base2Status)
  console.log("   digest dry-run:", JSON.stringify(digestCounts))
  if (gate.ok) {
    const n = needDigestIds.length
    const planSig = canonicalListHash(needDigestIds)
    console.log(`   digest plan: ${n} a gerar · planSignature ${planSig.slice(0, 12)}… · likely $${(n * DIGEST_LIKELY_USD).toFixed(2)} · upper $${(n * DIGEST_UPPER_USD).toFixed(2)} (teto humano recomendado $${Math.max(1, Math.ceil(n * DIGEST_UPPER_USD)).toFixed(2)}) — NÃO executado`)
    writeFileSync(resolve(OUT_DIR, "digest-plan-dry-run.json"), JSON.stringify({ planSignature: planSig, needGeneration: n, perWork: digestPlan, likelyUsd: +(n * DIGEST_LIKELY_USD).toFixed(2), upperBoundUsd: +(n * DIGEST_UPPER_USD).toFixed(2), executed: false }, null, 2) + "\n")
  } else {
    console.log("   digest plan: preliminar apenas (base-2 bloqueado) — sem plano final")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
