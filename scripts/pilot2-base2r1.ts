/**
 * CLI — gera/VERIFICA o snapshot LOCAL `base-2r1` (Plano 3 Fase B2.2O + B2.2O-fix). READ-ONLY no
 * banco (só SELECT via loaders canônicos). É um OVERLAY de corpus de reviews (text-only-v1)
 * sobre o `base-2` IMUTÁVEL: reusa a SELEÇÃO CONGELADA do base-2 (90 obras) e recomputa SÓ o
 * corpus (work_reviews + work_external_reviews_manual). A assinatura VINCULA o base-2
 * (base2Signature). NÃO chama digest/LLM. NÃO lê work_manual_reviews/labels/status/scores/
 * predictions/ranking/digests.
 *
 * Modos:
 *   npm run pilot2:base2r1            → GERA (escrita atômica: temp → revalida → rename). Substitui
 *                                       o base-2r1 anterior (assinatura incompleta), preservando o
 *                                       antigo em replacement-audit.json. NÃO toca o base-2.
 *   npm run pilot2:base2r1 -- --verify → VERIFICA: reconstrói tudo em memória, recalcula assinaturas
 *                                       e compara com os artefatos no disco. ZERO escritas. exit 0 só
 *                                       se idêntico; senão exit 1 listando divergências.
 *
 * Bloqueia (não escreve) se o diff de identidade Projeção A (base-2) × Projeção B (base-2r1
 * materializado) acusar qualquer diferença fora do corpus.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import {
  readScrapedExternalReviews,
  readManuallyEnteredExternalReviews,
  readCanonicalReviewCorpus,
} from "@/lib/synopsis-interest/digest-corpus"
import { isUsefulReviewText } from "@/lib/reviews/useful-review"
import {
  REVIEW_CORPUS_POLICY_VERSION,
  CANONICAL_REVIEW_CAP,
  computeNormalizedTextHash,
} from "@/lib/synopsis-interest/canonical-review-corpus"
import {
  computeBase2r1Signature,
  computeBase2Signature,
  computeReviewCorpusAggregateSignature,
  computeDigestSelectionAggregateSignature,
  diffBase2Overlay,
  diffArtifactJson,
  median,
  BASE2R1_SNAPSHOT_KIND,
  type Base2r1Versions,
  type Base2r1Work,
  type Base2OverlayIdentity,
} from "@/lib/synopsis-interest/base2r1"
import { parseCoverageUnder2Csv } from "@/lib/synopsis-interest/pilot2-review-coverage"

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2"
const BASE2 = resolve(DIR, "base-2-snapshot.json")
const CSV13 = resolve(DIR, "review-coverage-audit/review-coverage-under-2.csv")
const OUT = resolve(DIR, "base-2r1")
const FILE_SNAPSHOT = "base-2r1-snapshot.json"
const FILE_MANIFEST = "base-2r1-manifest.json"
const FILE_DIFF = "base-2r1-vs-base-2-diff.json"

/**
 * Mudanças EXPLICITAMENTE autorizadas pela usuária (Plano 3 B2.2R/B2.2S, decisão (a),
 * 2026-06-21). Registradas no `replacement-audit.json` desta regeneração — NÃO são gate aqui
 * (o gate de seleção/estabilidade roda fora). Texto literal da decisão humana.
 */
const HUMAN_ACCEPTED_EXPECTED_CHANGES = {
  decision: "(a) trocar para o comparador canônico locale-independente, aceitando as mudanças abaixo",
  authorizedBy: "human-decision-(a)-2026-06-21",
  selectionPolicyVersion: { from: "normalized-text-order-cap40-v1", to: "normalized-text-js-code-unit-order-cap40-v1" },
  comparator: { from: "String.prototype.localeCompare (locale/ICU-dependente)", to: "compareCanonicalText (unidades de código UTF-16, locale-independente)" },
  cap40SetChanges: [
    { workId: "4e5c14ac-7260-477f-afb1-504a30f72d51", title: "Miss Not-So Sidekick", delta: "2 saíram / 2 entraram" },
    { workId: "4690c262-c1f6-4622-982e-eb9c56e8ed02", title: "The Villainess Is a Marionette", delta: "1 / 1" },
    { workId: "1d2c5b07-407e-472e-a970-f69209f5cfc7", title: "It Was All a Mistake", delta: "1 / 1" },
  ],
  acceptedCorpusDrift: [
    { workId: "889a02ce-f50a-44c5-9c44-e4b2b70b44cd", title: "The Sword-Bearing Flower", change: "1 → 35 úteis" },
    { workId: "0d217b26-542e-492c-816b-c95e7d3210c5", title: "I Became the Squirrel That Saves the Villain", change: "3 → 29 úteis" },
  ],
  corpusAcceptanceRule:
    "estado atual VÁLIDO já persistido após pausar os escritores: só os 2 canais EXTERNOS (scraped + manual-externo), texto útil, dedupe canônico, sem o store pessoal de opinião, sem inconsistência estrutural; não preservar contagens antigas",
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

interface Base2Work {
  workId: string
  origin: "carryover" | "new"
  split: "development" | "holdout"
  stratum: string
  title: string
  canonicalSynopsis: string
  canonicalSynopsisInputsHash: string
  tags: string[]
  tagContextType: string
  tasteProfileVersion: string
}

interface BuiltArtifacts {
  base2r1Signature: string
  reviewCorpusAggregateSignature: string
  digestSelectionAggregateSignature: string
  snapshotJson: string
  manifestJson: string
  diffJson: string
  blocking: string[]
  works: Base2r1Work[]
}

const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"

/** Reconstrói TODO o base-2r1 em memória (read-only no banco). NÃO escreve nada. */
async function buildInMemory(): Promise<BuiltArtifacts> {
  const base2 = JSON.parse(readFileSync(BASE2, "utf8")) as {
    versions: { goldenVersion: string; tasteProfileVersion: string; schemaVersion: string }
    uniqueWorks: number
    carryoverCount: number
    newCount: number
    base2Signature: string
    works: Base2Work[]
  }

  // ── Validação de INTEGRIDADE do base-2 (não confia cegamente no campo) ──
  const recomputedBase2Sig = computeBase2Signature(base2.works)
  if (recomputedBase2Sig !== base2.base2Signature) {
    throw new Error(
      `base-2 corrompido: base2Signature do arquivo (${base2.base2Signature.slice(0, 12)}…) ` +
        `≠ recomputada do conteúdo (${recomputedBase2Sig.slice(0, 12)}…)`,
    )
  }

  const the13 = new Set(parseCoverageUnder2Csv(readFileSync(CSV13, "utf8")).map((r) => r.workId))

  const versions: Base2r1Versions = {
    goldenVersion: base2.versions.goldenVersion,
    baseSnapshotVersion: "base-2r1",
    snapshotKind: BASE2R1_SNAPSHOT_KIND,
    corpusPolicyVersion: REVIEW_CORPUS_POLICY_VERSION,
    derivedFrom: { base: "base-2", base2Signature: base2.base2Signature },
    tasteProfileVersion: base2.versions.tasteProfileVersion,
    schemaVersion: base2.versions.schemaVersion,
  }

  // Corpus por obra (text-only-v1) — read-only, em paralelo. canonicalIndex = ordem do base-2.
  const works: Base2r1Work[] = await Promise.all(
    base2.works.map(async (w, idx): Promise<Base2r1Work> => {
      const [scraped, manual, corpus] = await Promise.all([
        readScrapedExternalReviews(w.workId, sb),
        readManuallyEnteredExternalReviews(w.workId, sb),
        readCanonicalReviewCorpus(w.workId, sb),
      ])
      const scrapedUseful = scraped.filter((r) => isUsefulReviewText(r.text)).length
      const manualUseful = manual.filter((r) => isUsefulReviewText(r.text)).length
      const sources = new Set<string>()
      const origins = new Set<string>()
      for (const r of corpus.reviews) for (const p of r.provenance) { sources.add(p.source); origins.add(p.origin) }
      return {
        workId: w.workId,
        origin: w.origin,
        split: w.split,
        stratum: w.stratum,
        title: w.title,
        canonicalIndex: idx,
        corpusPolicyVersion: REVIEW_CORPUS_POLICY_VERSION,
        reviewsBeforeDedupe: scrapedUseful + manualUseful,
        reviewsAfterDedupe: corpus.usefulReviewCount,
        reviewCorpusSignature: corpus.reviewCorpusSignature,
        digestSelectionSignature: corpus.digestSelectionSignature,
        digestSelectionNormalizedHashes: corpus.sample.map((r) => computeNormalizedTextHash(r.text)),
        administrativeTrace: {
          reviewIds: corpus.sample.map((r) => r.reviewId),
          excludedFromExperimentalSignal: true,
          excludedFromSelection: true,
          excludedFromSignatures: true,
        },
        provenance: { sources: [...sources].sort(), origins: [...origins].sort(), scrapedUseful, manualUseful },
      }
    }),
  )

  // ── Diff REAL: Projeção A (base-2 histórico) × Projeção B (base-2r1 materializado) ──
  const projA: Base2OverlayIdentity[] = base2.works.map((w, idx) => ({
    workId: w.workId, origin: w.origin, split: w.split, stratum: w.stratum, title: w.title, canonicalIndex: idx,
  }))
  const projB: Base2OverlayIdentity[] = works.map((w) => ({
    workId: w.workId, origin: w.origin, split: w.split, stratum: w.stratum, title: w.title, canonicalIndex: w.canonicalIndex,
  }))
  const diff = diffBase2Overlay(projA, projB)

  // ── Assinaturas (vinculadas ao base-2) ──
  const base2r1Signature = computeBase2r1Signature(versions, works)
  const reviewCorpusAggregateSignature = computeReviewCorpusAggregateSignature(REVIEW_CORPUS_POLICY_VERSION, works)
  const digestSelectionAggregateSignature = computeDigestSelectionAggregateSignature(REVIEW_CORPUS_POLICY_VERSION, works)

  // ── Validações ──
  const newWorks = works.filter((w) => w.origin === "new")
  const newGe2 = newWorks.filter((w) => w.reviewsAfterDedupe >= 2).length
  const the13Works = works.filter((w) => the13.has(w.workId))
  const the13Ge2 = the13Works.filter((w) => w.reviewsAfterDedupe >= 2).length
  const dups = works.filter((w) => w.reviewsBeforeDedupe > w.reviewsAfterDedupe)
  const dups13 = dups.filter((w) => the13.has(w.workId))
  const validations = {
    newWorks: newWorks.length,
    newGe2,
    the13: the13Works.length,
    the13Ge2,
    canonicalDupsTotal: dups.length,
    canonicalDups13: dups13.length,
    dupWorkIds: dups.map((w) => w.workId),
  }

  // ── Estatísticas ──
  const counts = works.map((w) => w.reviewsAfterDedupe)
  const dist: Record<string, number> = {}
  for (const c of counts) { const k = c >= 8 ? "8+" : String(c); dist[k] = (dist[k] ?? 0) + 1 }
  const stats = {
    perWork: { min: Math.min(...counts), max: Math.max(...counts), median: median(counts), total: counts.reduce((a, b) => a + b, 0) },
    distribution: dist,
    worksOverCap: counts.filter((c) => c > CANONICAL_REVIEW_CAP).length,
    cap: CANONICAL_REVIEW_CAP,
    sampleTotal: works.reduce((n, w) => n + w.administrativeTrace.reviewIds.length, 0),
  }

  const snapshot = {
    versions,
    base2r1Signature,
    reviewCorpusAggregateSignature,
    digestSelectionAggregateSignature,
    uniqueWorks: works.length,
    carryoverCount: works.filter((w) => w.origin === "carryover").length,
    newCount: newWorks.length,
    previousSnapshot: { version: "base-2", base2Signature: base2.base2Signature, status: "superseded", supersededBy: "base-2r1 (text-only-v1)" },
    corpusPolicyVersion: REVIEW_CORPUS_POLICY_VERSION,
    works,
  }
  const manifest = {
    snapshot: "base-2r1",
    snapshotKind: BASE2R1_SNAPSHOT_KIND,
    corpusPolicyVersion: REVIEW_CORPUS_POLICY_VERSION,
    base2r1Signature,
    reviewCorpusAggregateSignature,
    digestSelectionAggregateSignature,
    derivedFrom: versions.derivedFrom,
    uniqueWorks: works.length,
    carryoverCount: snapshot.carryoverCount,
    newCount: newWorks.length,
    selectionInvariant: { uniqueWorks: 90, carryover: 51, new: 39, dev: 56, hold: 34, strata: "22/23/23/22" },
    validations,
    stats,
    diffBlocking: diff.blockingDifferences.length,
    base2Status: "superseded",
    historicalDigestPlan: {
      signaturePrefix: "295fe2d6",
      fullSignatureAvailable: false,
      status: "superseded",
      executable: false,
      reason: "full historical signature was never persisted; corpus policy changed",
    },
  }
  const diffReport = {
    base: "base-2",
    baseSignature: base2.base2Signature,
    target: "base-2r1",
    targetSignature: base2r1Signature,
    setEqual: diff.setEqual,
    fieldEqual: diff.fieldEqual,
    count: diff.count,
    identicalIdentityWorks: diff.identicalWorks,
    missingWorkIds: diff.missingWorkIds,
    extraWorkIds: diff.extraWorkIds,
    duplicateWorkIds: diff.duplicateWorkIds,
    fieldDifferences: diff.fieldDifferences,
    blocking: diff.blockingDifferences,
    expectedDifferences: ["reviewCorpus", "reviewCounts (before/after dedupe)", "reviewCorpusSignature", "digestSelectionSignature", "corpusPolicyVersion (→ text-only-v1)", "base2r1Signature", "previousSnapshot.status (→ superseded)"],
    perWorkCorpusChange: works.map((w) => ({
      workId: w.workId, origin: w.origin, reviewsAfterDedupe: w.reviewsAfterDedupe,
      reviewCorpusSignature: w.reviewCorpusSignature.slice(0, 16), digestSelectionSignature: w.digestSelectionSignature.slice(0, 16),
    })),
  }

  return {
    base2r1Signature,
    reviewCorpusAggregateSignature,
    digestSelectionAggregateSignature,
    snapshotJson: stringify(snapshot),
    manifestJson: stringify(manifest),
    diffJson: stringify(diffReport),
    blocking: diff.blockingDifferences,
    works,
  }
}

/** Escrita ATÔMICA: temp dir → revalida (readback + JSON.parse) → rename → remove temp. */
function atomicWrite(files: Record<string, string>): void {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  const tmp = resolve(OUT, ".tmp-gen")
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(resolve(tmp, name), content)
  for (const [name, content] of Object.entries(files)) {
    const back = readFileSync(resolve(tmp, name), "utf8")
    if (back !== content) throw new Error(`readback do temp divergiu: ${name}`)
    JSON.parse(back) // valida JSON
  }
  for (const name of Object.keys(files)) renameSync(resolve(tmp, name), resolve(OUT, name))
  rmSync(tmp, { recursive: true, force: true })
}

const sha256File = (p: string): string =>
  existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "(ausente)"

async function generate(): Promise<void> {
  const built = await buildInMemory()
  if (built.blocking.length > 0) {
    console.error("⛔ BLOQUEADO — diferença de identidade Projeção A × B (fora do corpus):")
    for (const d of built.blocking.slice(0, 20)) console.error("   - " + d)
    process.exit(1)
  }

  // Preservar o anterior ANTES de substituir (assinaturas + SHA-256 dos artefatos).
  const prevSnapPath = resolve(OUT, FILE_SNAPSHOT)
  let prev: {
    previousBase2r1Signature: string | null
    previousReviewCorpusAggregateSignature: string | null
    previousDigestSelectionAggregateSignature: string | null
    previousSha256: Record<string, string>
  } | null = null
  if (existsSync(prevSnapPath)) {
    let prevSig: string | null = null
    let prevRcAgg: string | null = null
    let prevDsAgg: string | null = null
    try {
      const old = JSON.parse(readFileSync(prevSnapPath, "utf8")) as { base2r1Signature?: string; reviewCorpusAggregateSignature?: string; digestSelectionAggregateSignature?: string }
      prevSig = old.base2r1Signature ?? null
      prevRcAgg = old.reviewCorpusAggregateSignature ?? null
      prevDsAgg = old.digestSelectionAggregateSignature ?? null
    } catch { /* ignore */ }
    prev = {
      previousBase2r1Signature: prevSig,
      previousReviewCorpusAggregateSignature: prevRcAgg,
      previousDigestSelectionAggregateSignature: prevDsAgg,
      previousSha256: {
        [FILE_SNAPSHOT]: sha256File(resolve(OUT, FILE_SNAPSHOT)),
        [FILE_MANIFEST]: sha256File(resolve(OUT, FILE_MANIFEST)),
        [FILE_DIFF]: sha256File(resolve(OUT, FILE_DIFF)),
      },
    }
  }

  atomicWrite({ [FILE_SNAPSHOT]: built.snapshotJson, [FILE_MANIFEST]: built.manifestJson, [FILE_DIFF]: built.diffJson })

  if (prev) {
    writeFileSync(
      resolve(OUT, "replacement-audit.json"),
      stringify({
        replacedAt: "base-2r1 regenerado (B2.2S — comparador code-unit + corpus estável congelado)",
        reason: "decisão humana (a): trocar localeCompare→compareCanonicalText (selectionPolicyVersion bumpada) e aceitar o estado de corpus VÁLIDO atual após pausar os escritores (drift de 889a02ce e 0d217b26 incluso). As 3 mudanças de conjunto cap40 são esperadas e autorizadas.",
        humanAcceptedExpectedChanges: HUMAN_ACCEPTED_EXPECTED_CHANGES,
        previousBase2r1Signature: prev.previousBase2r1Signature,
        previousReviewCorpusAggregateSignature: prev.previousReviewCorpusAggregateSignature,
        previousDigestSelectionAggregateSignature: prev.previousDigestSelectionAggregateSignature,
        previousSha256: prev.previousSha256,
        newBase2r1Signature: built.base2r1Signature,
        newReviewCorpusAggregateSignature: built.reviewCorpusAggregateSignature,
        newDigestSelectionAggregateSignature: built.digestSelectionAggregateSignature,
        newSha256: {
          [FILE_SNAPSHOT]: sha256File(resolve(OUT, FILE_SNAPSHOT)),
          [FILE_MANIFEST]: sha256File(resolve(OUT, FILE_MANIFEST)),
          [FILE_DIFF]: sha256File(resolve(OUT, FILE_DIFF)),
        },
        note: "base-2r1 anterior (cb38eaaf…, localeCompare) SUPERSEDED — preservado só como histórico; base-2 intocado.",
      }),
    )
  }

  console.log("=== base-2r1 (text-only-v1, overlay) — GERADO (read-only DB, $0, escrita atômica) ===")
  console.log(`base2r1Signature:               ${built.base2r1Signature}`)
  console.log(`reviewCorpusAggregateSignature: ${built.reviewCorpusAggregateSignature}`)
  console.log(`digestSelectionAggregateSignature: ${built.digestSelectionAggregateSignature}`)
  if (prev?.previousBase2r1Signature) console.log(`(substituiu assinatura anterior: ${prev.previousBase2r1Signature.slice(0, 16)}… → replacement-audit.json)`)
  console.log(`DIFF Projeção A × B: setEqual + fieldEqual + 0 bloqueantes (validado).`)
  console.log(`base-2 preservado (status: superseded). NENHUM digest/plano/preflight executado.`)
}

async function verify(): Promise<void> {
  const before = {
    [FILE_SNAPSHOT]: existsSync(resolve(OUT, FILE_SNAPSHOT)) ? statSync(resolve(OUT, FILE_SNAPSHOT)).mtimeMs : 0,
    [FILE_MANIFEST]: existsSync(resolve(OUT, FILE_MANIFEST)) ? statSync(resolve(OUT, FILE_MANIFEST)).mtimeMs : 0,
    [FILE_DIFF]: existsSync(resolve(OUT, FILE_DIFF)) ? statSync(resolve(OUT, FILE_DIFF)).mtimeMs : 0,
  }
  const built = await buildInMemory()
  const onDisk: Record<string, string> = {
    [FILE_SNAPSHOT]: existsSync(resolve(OUT, FILE_SNAPSHOT)) ? readFileSync(resolve(OUT, FILE_SNAPSHOT), "utf8") : "",
    [FILE_MANIFEST]: existsSync(resolve(OUT, FILE_MANIFEST)) ? readFileSync(resolve(OUT, FILE_MANIFEST), "utf8") : "",
    [FILE_DIFF]: existsSync(resolve(OUT, FILE_DIFF)) ? readFileSync(resolve(OUT, FILE_DIFF), "utf8") : "",
  }
  const rebuilt: Record<string, string> = {
    [FILE_SNAPSHOT]: built.snapshotJson,
    [FILE_MANIFEST]: built.manifestJson,
    [FILE_DIFF]: built.diffJson,
  }

  const divergences: string[] = []
  for (const name of Object.keys(rebuilt)) {
    const diffKeys = diffArtifactJson(onDisk[name], rebuilt[name])
    if (diffKeys.length > 0) divergences.push(`${name}: campos divergentes: ${diffKeys.join(", ")}`)
  }

  const after = {
    [FILE_SNAPSHOT]: existsSync(resolve(OUT, FILE_SNAPSHOT)) ? statSync(resolve(OUT, FILE_SNAPSHOT)).mtimeMs : 0,
    [FILE_MANIFEST]: existsSync(resolve(OUT, FILE_MANIFEST)) ? statSync(resolve(OUT, FILE_MANIFEST)).mtimeMs : 0,
    [FILE_DIFF]: existsSync(resolve(OUT, FILE_DIFF)) ? statSync(resolve(OUT, FILE_DIFF)).mtimeMs : 0,
  }
  const mtimeUnchanged = Object.keys(before).every((k) => before[k as keyof typeof before] === after[k as keyof typeof after])

  console.log("=== base-2r1 --verify (read-only, ZERO escritas) ===")
  console.log(`base2r1Signature (recomputada): ${built.base2r1Signature}`)
  console.log(`reviewCorpusAggregateSignature: ${built.reviewCorpusAggregateSignature}`)
  console.log(`digestSelectionAggregateSignature: ${built.digestSelectionAggregateSignature}`)
  console.log(`mtimes inalterados: ${mtimeUnchanged ? "SIM ✅" : "NÃO ⛔"}`)
  if (built.blocking.length > 0) divergences.unshift("diff Projeção A×B com bloqueantes: " + built.blocking.length)

  if (divergences.length === 0 && mtimeUnchanged) {
    console.log("✅ base-2r1 no disco é IDÊNTICO ao reconstruído. Reprodutível. exit 0.")
    process.exit(0)
  }
  console.error("⛔ DIVERGÊNCIA detectada (artefato no disco ≠ reconstruído):")
  for (const d of divergences) console.error("   - " + d)
  if (!mtimeUnchanged) console.error("   - mtime ALTERADO durante o verify (não deveria)")
  process.exit(1)
}

async function main(): Promise<void> {
  if (process.argv.includes("--verify")) await verify()
  else await generate()
}

main().catch((e) => { console.error("[base2r1] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
