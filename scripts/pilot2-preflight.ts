/**
 * CLI — PREFLIGHT read-only dos digests sob `base-2r1` / `text-only-v1` (Plano 3 Fase B2.2P).
 * READ-ONLY no banco: lê SÓ `works.{review_digest,review_digest_version,review_digest_n}` (estado
 * dos digests persistidos) + o snapshot frozen `base-2r1` (assinaturas/contagens por obra). NÃO
 * reconstrói o corpus por outro caminho, NÃO usa o digest como substituto das reviews, NÃO chama
 * LLM, NÃO gera plano/planSignature/custo. NÃO lê store pessoal/labels/status/scores/predictions/
 * ranking. Classificação FAIL-CLOSED (lib/synopsis-interest/pilot2-preflight.ts).
 *
 * Drift: captura as 4 assinaturas + SHA dos 3 artefatos no início e no fim; diverge ⇒
 * preflight_invalidated (exit 1, não publica). Escreve só o relatório local (autorizado).
 *
 * Uso: npm run pilot2:preflight
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import {
  REVIEW_DIGEST_VERSION,
  REVIEW_DIGEST_MODEL,
} from "@/lib/ai-recommendation/review-summarizer"
import { REVIEW_CORPUS_POLICY_VERSION } from "@/lib/synopsis-interest/canonical-review-corpus"
import { computeBase2r1Signature } from "@/lib/synopsis-interest/base2r1"
import {
  classifyDigestReadiness,
  reconcile,
  computePreflightReportSignature,
  type DigestProvenance,
  type ExpectedDigestIdentity,
  type PreflightWorkInput,
  type PreflightWorkResult,
} from "@/lib/synopsis-interest/pilot2-preflight"

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2/base-2r1"
const SNAP = resolve(DIR, "base-2r1-snapshot.json")
const OUT = resolve(DIR, "preflight")
const ARTIFACTS = ["base-2r1-snapshot.json", "base-2r1-manifest.json", "base-2r1-vs-base-2-diff.json"]

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const sha256File = (p: string): string =>
  existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "(ausente)"

interface SnapWork {
  workId: string
  reviewsAfterDedupe: number
  reviewCorpusSignature: string
  digestSelectionSignature: string
}
interface Snapshot {
  base2r1Signature: string
  reviewCorpusAggregateSignature: string
  digestSelectionAggregateSignature: string
  corpusPolicyVersion: string
  versions: {
    goldenVersion: string; baseSnapshotVersion: string; snapshotKind: string
    corpusPolicyVersion: string; derivedFrom: { base: string; base2Signature: string }
    tasteProfileVersion: string; schemaVersion: string
  }
  works: SnapWork[]
}

/** Snapshot das 4 assinaturas + SHA dos 3 artefatos (detecção de drift). */
function captureState(): { sigs: Record<string, string>; sha: Record<string, string> } {
  const s = JSON.parse(readFileSync(SNAP, "utf8")) as Snapshot
  return {
    sigs: {
      base2Signature: s.versions.derivedFrom.base2Signature,
      base2r1Signature: s.base2r1Signature,
      reviewCorpusAggregateSignature: s.reviewCorpusAggregateSignature,
      digestSelectionAggregateSignature: s.digestSelectionAggregateSignature,
    },
    sha: Object.fromEntries(ARTIFACTS.map((f) => [f, sha256File(resolve(DIR, f))])),
  }
}

async function main(): Promise<void> {
  const startState = captureState()
  const snap = JSON.parse(readFileSync(SNAP, "utf8")) as Snapshot

  // Consistência interna do snapshot (a assinatura recompõe dos campos gravados).
  const recomputed = computeBase2r1Signature(
    {
      goldenVersion: snap.versions.goldenVersion, baseSnapshotVersion: snap.versions.baseSnapshotVersion,
      snapshotKind: snap.versions.snapshotKind, corpusPolicyVersion: snap.versions.corpusPolicyVersion,
      derivedFrom: snap.versions.derivedFrom, tasteProfileVersion: snap.versions.tasteProfileVersion,
      schemaVersion: snap.versions.schemaVersion,
    },
    snap.works as Array<{ workId: string; reviewCorpusSignature: string; digestSelectionSignature: string }>,
  )
  if (recomputed !== snap.base2r1Signature) {
    console.error(`⛔ snapshot_changed: base2r1Signature recomputada (${recomputed.slice(0, 12)}…) ≠ gravada`)
    process.exit(1)
  }

  // Identidade exigida pelo text-only-v1 (do código do gerador). promptVersion/schema do digest
  // text-only ainda NÃO existem como constante própria ⇒ sentinelas (ressalva: bump proposto).
  const expected: ExpectedDigestIdentity = {
    corpusPolicyVersion: REVIEW_CORPUS_POLICY_VERSION,
    digestVersion: REVIEW_DIGEST_VERSION,
    promptVersion: "review-text-only-v1 (PROPOSTO — ainda não implementado)",
    model: REVIEW_DIGEST_MODEL,
    schema: "digest-schema-v1 (PROPOSTO — não versionado no código)",
  }

  // Estado ATUAL dos digests persistidos (read-only; SÓ colunas de digest).
  const ids = snap.works.map((w) => w.workId)
  const { data, error } = await sb
    .from("works")
    .select("id, review_digest, review_digest_version, review_digest_n")
    .in("id", ids)
  if (error) throw new Error(`leitura de works.review_digest: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; review_digest: unknown; review_digest_version: string | null; review_digest_n: number | null }>
  const seen = new Set<string>()
  const dupIds = new Set<string>()
  const byId = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    if (seen.has(r.id)) dupIds.add(r.id)
    seen.add(r.id)
    byId.set(r.id, r)
  }

  // Classificação por obra.
  const results: PreflightWorkResult[] = snap.works.map((w) => {
    const row = byId.get(w.workId)
    const digestVal = row?.review_digest ?? null
    const present = digestVal != null
    const malformed = present && (typeof digestVal !== "object")
    const persisted: DigestProvenance | null = present
      ? {
          present: true,
          version: row?.review_digest_version ?? null,
          n: row?.review_digest_n ?? null,
          malformed,
          // campos de PROVA NÃO existem no schema ⇒ undefined (fail-closed)
        }
      : null
    const input: PreflightWorkInput = {
      workId: w.workId,
      reviewsAfterDedupe: w.reviewsAfterDedupe,
      reviewCorpusSignature: w.reviewCorpusSignature,
      digestSelectionSignature: w.digestSelectionSignature,
      persisted,
      duplicateWorkId: dupIds.has(w.workId),
      missingFromSnapshot: false,
    }
    return classifyDigestReadiness(input, expected)
  })

  const rc = reconcile(results, { total: 90, noReviews: 19, withReviews: 71 })

  // Drift no FIM.
  const endState = captureState()
  const sigDrift = Object.keys(startState.sigs).filter((k) => startState.sigs[k] !== endState.sigs[k])
  const shaDrift = ARTIFACTS.filter((f) => startState.sha[f] !== endState.sha[f])
  const drift = sigDrift.length > 0 || shaDrift.length > 0

  const reportSignature = computePreflightReportSignature({
    base2Signature: startState.sigs.base2Signature,
    base2r1Signature: startState.sigs.base2r1Signature,
    reviewCorpusAggregateSignature: startState.sigs.reviewCorpusAggregateSignature,
    digestSelectionAggregateSignature: startState.sigs.digestSelectionAggregateSignature,
    corpusPolicyVersion: snap.corpusPolicyVersion,
    expected,
    results,
  })

  const status = drift ? "preflight_invalidated" : rc.ok ? "ok" : "reconcile_violation"

  // ── Artefato local ──
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  const stringify = (o: unknown) => JSON.stringify(o, null, 2) + "\n"
  const report = {
    kind: "digest-preflight",
    status,
    generatedAt: new Date().toISOString(), // fora da assinatura
    snapshot: {
      base2Signature: startState.sigs.base2Signature,
      base2r1Signature: startState.sigs.base2r1Signature,
      reviewCorpusAggregateSignature: startState.sigs.reviewCorpusAggregateSignature,
      digestSelectionAggregateSignature: startState.sigs.digestSelectionAggregateSignature,
      corpusPolicyVersion: snap.corpusPolicyVersion,
      artifactSha256: startState.sha,
    },
    expectedDigestIdentity: expected,
    counts: rc.counts,
    reconcile: { ok: rc.ok, total: rc.total, noReviews: rc.noReviews, withReviews: rc.withReviews, reusableExact: rc.reusableExact, futureGeneration: rc.futureGeneration, blocked: rc.blocked, violations: rc.violations },
    drift: { detected: drift, signatureDrift: sigDrift, artifactSha256Drift: shaDrift },
    classifications: results.map((r) => ({ workId: r.workId, readiness: r.readiness, reason: r.reason })),
    reportSignature,
    notAuthorization: "Relatório diagnóstico — NÃO é plano, planSignature, autorização nem estimativa de custo.",
  }
  const manifest = {
    kind: "digest-preflight-manifest",
    status,
    base2r1Signature: startState.sigs.base2r1Signature,
    reportSignature,
    corpusPolicyVersion: snap.corpusPolicyVersion,
    counts: rc.counts,
    reconcileOk: rc.ok,
    driftDetected: drift,
    historicalPlans: [
      { signaturePrefix: "295fe2d6", fullSignatureAvailable: false, status: "superseded", executable: false },
      { signaturePrefix: "7037bc1e", fullSignatureAvailable: true, status: "superseded", executable: false, note: "dry-run pré-text-only-v1; NÃO confundir com 295fe2d6" },
    ],
  }
  writeFileSync(resolve(OUT, "digest-preflight.json"), stringify(report))
  writeFileSync(resolve(OUT, "digest-preflight-manifest.json"), stringify(manifest))

  // ── Relatório console ──
  console.log("=== PREFLIGHT base-2r1 / text-only-v1 (read-only DB, $0) ===")
  console.log(`status: ${status}`)
  console.log(`base2r1Signature: ${startState.sigs.base2r1Signature}`)
  console.log(`contagens por classe:`)
  for (const [k, v] of Object.entries(rc.counts)) if (v > 0) console.log(`   ${k}: ${v}`)
  console.log(`reconcile: total=${rc.total} no_reviews=${rc.noReviews} withReviews=${rc.withReviews} reusable=${rc.reusableExact} futureGen=${rc.futureGeneration} blocked=${rc.blocked} ok=${rc.ok}`)
  if (rc.violations.length) for (const v of rc.violations) console.log(`   ⚠ ${v}`)
  console.log(`drift: ${drift ? "DETECTADO ⛔ " + [...sigDrift, ...shaDrift].join(",") : "nenhum ✅"}`)
  console.log(`reportSignature: ${reportSignature}`)
  console.log(`artefatos: ${OUT}/digest-preflight.json · digest-preflight-manifest.json`)
  console.log(`NENHUM digest/LLM/plano/planSignature/custo. Store pessoal/labels NÃO consultados (só colunas de digest).`)

  if (status !== "ok") process.exit(1)
}

main().catch((e) => { console.error("[preflight] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
