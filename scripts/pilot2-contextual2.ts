/**
 * CLI — materializa `enriched-2` + pacote cego `contextual-2` (Plano 3 Fase B2.2T). PURO/LOCAL:
 * sem banco, sem rede, sem LLM. Deriva ESTRITAMENTE de artefatos locais congelados:
 *   base-2-snapshot.json (sinopse/tags/título/split/stratum/origin frozen) +
 *   base-2r1-snapshot.json (reviewCorpusSignature/digestSelectionSignature/reviewsAfterDedupe) +
 *   71 digests text-only-v1 (works/<id>.json) + run-manifest.json +
 *   enriched-1 + base-1 (para comparar os 51 carryovers).
 *
 * NÃO sobrescreve enriched-1/contextual-1/base-*; escreve só enriched-2/ e contextual-2/ (escrita
 * temporária + rename atômico, após validar leakage + determinismo). NÃO lê labels nem o banco.
 *
 * Uso: npm run pilot2:contextual2
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { selectContextualTagsByPriority, sanitizeTextOnlyDigestForLabeling, type ContextualTag, type SanitizedDigest } from "@/lib/synopsis-interest/contextual-package"
import { computeLabelDisplaySignature, labelDisplayContentFromWork } from "@/lib/synopsis-interest/label-reuse"
import { buildContextualHtml, buildContextualLabelsTemplateCsv, assertContextualHtmlOffline, computeContextualPackageSignature, type ContextualCard } from "@/lib/synopsis-interest/contextual-html"
import type { EnrichedReviewContext } from "@/lib/synopsis-interest/enriched"
import { TARGET_CONSTRUCT } from "@/lib/synopsis-interest/enriched"
import { TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import {
  EXPERIMENT_DIGEST_VERSION,
  EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
  EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
  EXPERIMENT_DIGEST_CAP,
  computeDigestContractSignature,
  computeDigestImplementationSignature,
  type TextOnlyDigest,
} from "@/lib/synopsis-interest/digest-text-only"

const ROOT = ".local-experiments/plan3/digest-exp-1"
const PILOT2 = resolve(ROOT, "pilot-2")
const B2R1 = resolve(PILOT2, "base-2r1")
const WORKS = resolve(B2R1, "digests-text-only-v1", "works")
const OUT_ENRICHED = resolve(PILOT2, "enriched-2")
const OUT_CONTEXTUAL = resolve(PILOT2, "contextual-2")

const AUTH_BASE2R1 = "b9dc2f2751af6ae738d79801d46f4aedd72c45e330a60bd49194c979233436a6"
const AUTH_PLAN_SIG = "2a2fde38eb15d8b0fab0cb942455b8cb022b143d5e548de786895fccdecb8a20"
const AUTH_RUN_MANIFEST_SIG = "ae537f6de87a5b5a170f8c5c9accfa20f03f9d5cadda6a721c2bacc0fe4fbbb1"

const ENRICHED2_VERSION = "enriched-2"
const CONTEXTUAL2_VERSION = "contextual-2"
const LABEL_REUSE_PLAN_VERSION = "label-reuse-plan-v1"

const sha = (o: unknown): string => createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex")
const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"))
const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"
const die = (code: string, msg: string): never => { console.error(`⛔ ${code} — ${msg}`); process.exit(1) }

/**
 * Remove de um texto de digest os TÍTULOS ESTRANGEIROS (de OUTRAS obras do golden) que vazaram via
 * cross-referência das reviews (ex.: "obra anterior do mesmo autor ('X')"). Um título que pertence à
 * PRÓPRIA obra e já aparece na sua sinopse (nome de protagonista = título, ex.: "Zenith") é INERENTE
 * ao conteúdo exibido e NÃO é raspado (a §4 proíbe alterar a sinopse). Limpa aspas/parênteses vazios.
 */
function stripForeignTitles(text: string, foreignTitles: string[]): string {
  let out = text
  for (const t of foreignTitles) if (out.includes(t)) out = out.split(t).join("")
  return out
    .replace(/[([]\s*[‘'"“]?\s*[’'"”]?\s*[)\]]/g, "")
    .replace(/[‘'"“]\s*[’'"”]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
}

interface Base2Work { workId: string; origin: "carryover" | "new"; split: string; stratum: string; title: string; canonicalSynopsis: string; canonicalSynopsisInputsHash: string; tags: string[]; tagContextType: string }
interface B2r1Work { workId: string; reviewsAfterDedupe: number; reviewCorpusSignature: string; digestSelectionSignature: string }
interface Pilot2Slot { slotKey: string; workId: string; split: string; stratum: string; origin: string; isRepeat: boolean; repeatOf: string | null }
interface DigestArtifact { workId: string; status: string; digest?: TextOnlyDigest; digestOutputSignature?: string; digestInputSignature?: string; digestContractSignature?: string; digestImplementationSignature?: string }
interface Enriched1Work { workId: string; contextualTags: string[]; reviewContext: EnrichedReviewContext; sanitizedDigest: SanitizedDigest | null }

interface Enriched2Work {
  workId: string
  origin: "carryover" | "new"
  split: string
  stratum: string
  tagContextType: string
  synopsis: string
  contextualTags: string[]
  reviewContext: EnrichedReviewContext
  sanitizedDigest: SanitizedDigest | null
  sanitizedDigestSignature: string | null
  baseInputSignature: string
  labelDisplaySignature: string
}

/** Constrói o enriched-2 + assinaturas + comparação de carryovers + pacote, em MEMÓRIA (determinístico). */
function build() {
  const base2 = read(resolve(PILOT2, "base-2-snapshot.json")) as { carryoverCount: number; newCount: number; base2Signature: string; works: Base2Work[] }
  const b2r1 = read(resolve(B2R1, "base-2r1-snapshot.json")) as { base2r1Signature: string; works: B2r1Work[] }
  const manifestPilot2 = read(resolve(PILOT2, "pilot-2-manifest.json")) as { slots: Pilot2Slot[] }
  const enriched1 = read(resolve(ROOT, "enriched-1", "golden-snapshot-enriched.json")) as { enrichedSnapshotSignature: string; works: Enriched1Work[] }
  const base1 = read(resolve(ROOT, "base-1", "golden-snapshot-base.json")) as { works: Array<{ workId: string; canonicalSynopsis: string }> }
  const runManifest = read(resolve(WORKS, "..", "run-manifest.json")) as { planSignature: string; manifestSignature: string; counts: Record<string, number>; perWork: Array<{ workId: string; status: string; digestOutputSignature: string | null }>; digestContractSignature: string; digestImplementationSignature: string; base2r1Signature: string }
  const plan = read(resolve(B2R1, "digest-execution-plan.json")) as { entries: Array<{ workId: string; digestInputSignature: string }> }

  const contractSig = computeDigestContractSignature()
  const implSig = computeDigestImplementationSignature()

  // ── §2 GATES iniciais (estado congelado) ──
  if (b2r1.base2r1Signature !== AUTH_BASE2R1) die("DIGEST_OUTPUT_INVALID", "base2r1Signature divergente")
  if (runManifest.planSignature !== AUTH_PLAN_SIG) die("DIGEST_OUTPUT_INVALID", "run-manifest planSignature divergente")
  if (runManifest.manifestSignature !== AUTH_RUN_MANIFEST_SIG) die("DIGEST_OUTPUT_INVALID", "run-manifest manifestSignature divergente (no disco)")
  if (b2r1.works.length !== 90) die("DIGEST_OUTPUT_INVALID", `base-2r1 tem ${b2r1.works.length} obras (≠90)`)

  const b2r1ById = new Map(b2r1.works.map((w) => [w.workId, w]))
  const planInputByWork = new Map(plan.entries.map((e) => [e.workId, e.digestInputSignature]))
  const digestAvailIds = b2r1.works.filter((w) => w.reviewsAfterDedupe > 0).map((w) => w.workId)
  const noReviewsIds = b2r1.works.filter((w) => w.reviewsAfterDedupe === 0).map((w) => w.workId)
  if (digestAvailIds.length !== 71) die("DIGEST_OUTPUT_INVALID", `digest_available=${digestAvailIds.length} (≠71)`)
  if (noReviewsIds.length !== 19) die("DIGEST_OUTPUT_INVALID", `no_reviews_available=${noReviewsIds.length} (≠19)`)

  // 71 digests: presentes, succeeded, assinaturas compatíveis com o plano + contrato/impl.
  const digestByWork = new Map<string, DigestArtifact>()
  for (const id of digestAvailIds) {
    const p = resolve(WORKS, `${id}.json`)
    if (!existsSync(p)) die("DIGEST_OUTPUT_INVALID", `digest ausente: ${id}`)
    const a = read(p) as DigestArtifact
    if (a.status !== "succeeded") die("DIGEST_OUTPUT_INVALID", `${id}: status=${a.status}`)
    if (!a.digest || typeof a.digest.consensus !== "string" || !Array.isArray(a.digest.recurring_positives)) die("DIGEST_OUTPUT_INVALID", `${id}: digest inválido`)
    if (!a.digestOutputSignature) die("DIGEST_OUTPUT_INVALID", `${id}: sem outputSignature`)
    if (a.digestContractSignature !== contractSig) die("DIGEST_OUTPUT_INVALID", `${id}: digestContractSignature ≠`)
    if (a.digestImplementationSignature !== implSig) die("DIGEST_OUTPUT_INVALID", `${id}: digestImplementationSignature ≠`)
    if (a.digestInputSignature !== planInputByWork.get(id)) die("DIGEST_OUTPUT_INVALID", `${id}: digestInputSignature ≠ plano`)
    digestByWork.set(id, a)
  }
  // manifestSignature reproduzível (recomputa do perWork do run-manifest).
  const reproManifestSig = sha({
    kind: "digest-run-manifest",
    planSignature: runManifest.planSignature,
    base2r1Signature: runManifest.base2r1Signature,
    digestContractSignature: runManifest.digestContractSignature,
    digestImplementationSignature: runManifest.digestImplementationSignature,
    perWork: [...runManifest.perWork].sort((a, b) => (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0)).map((w) => [w.workId, w.status, w.digestOutputSignature]),
  })
  if (reproManifestSig !== AUTH_RUN_MANIFEST_SIG) die("DIGEST_OUTPUT_INVALID", `manifestSignature NÃO reproduzível (${reproManifestSig.slice(0, 16)}…)`)
  if ((runManifest.counts.succeeded ?? 0) !== 71 || (runManifest.counts.failed ?? 0) !== 0) die("DIGEST_OUTPUT_INVALID", "counts do run-manifest ≠ 71/0")

  // ── tag → grupo (catálogo ESTÁTICO; sem banco) ──
  // CASE-INSENSITIVE: as tags do base-2 têm casing MISTO (algumas obras minúsculas, outras
  // capitalizadas). Lookup exato deixaria ~metade das obras sem grupo → exclusão de format/other E
  // priorização falhariam silenciosamente (caía tudo em alfabético/LOW). Chaveia por lowercase.
  const nameToGroup = new Map<string, string>()
  for (const g of TAG_GROUPS_CATALOG) for (const v of g.values) { const k = v.toLowerCase(); if (!nameToGroup.has(k)) nameToGroup.set(k, g.groupSlug) }
  const tagGroupOf = (n: string): string | null => nameToGroup.get((n ?? "").toLowerCase()) ?? null

  // ── §5 enriched-2 (90 obras) ──
  const base1Syn = new Map(base1.works.map((w) => [w.workId, w.canonicalSynopsis]))
  const enriched1ById = new Map(enriched1.works.map((w) => [w.workId, w]))
  // Títulos do golden (≥5 chars) — para raspar cross-referências do digest (anti-leak §9).
  const allTitles = base2.works.map((w) => w.title).filter((t) => t && t.length >= 5)
  const works: Enriched2Work[] = base2.works
    .map((w): Enriched2Work => {
      const b = b2r1ById.get(w.workId)
      if (!b) die("DIGEST_OUTPUT_INVALID", `obra ${w.workId} ausente do base-2r1`)
      const reviewContext: EnrichedReviewContext = b!.reviewsAfterDedupe > 0 ? "digest_available" : "no_reviews_available"
      const contextualTags = selectContextualTagsByPriority(w.tags.map((n) => ({ name: n, group: tagGroupOf(n) } as ContextualTag))).map((t) => t.name)
      let sanitizedDigest: SanitizedDigest | null = null
      if (reviewContext === "digest_available") {
        const a = digestByWork.get(w.workId)!
        const s = sanitizeTextOnlyDigestForLabeling(a.digest!)
        // Anti-leak §9: raspa títulos de OUTRAS obras (cross-ref) — preserva nomes inerentes à própria sinopse.
        const foreign = allTitles.filter((t) => !w.canonicalSynopsis.includes(t))
        sanitizedDigest = {
          consensus: stripForeignTitles(s.consensus, foreign),
          divergence: stripForeignTitles(s.divergence, foreign),
          execution: stripForeignTitles(s.execution, foreign),
          traits: s.traits.map((t) => ({ ...t, trait: stripForeignTitles(t.trait, foreign) })).filter((t) => t.trait),
          contentWarnings: s.contentWarnings.map((c) => stripForeignTitles(c, foreign)).filter(Boolean),
        }
        const hasContent = !!(sanitizedDigest.consensus || sanitizedDigest.divergence || sanitizedDigest.execution || sanitizedDigest.traits.length || sanitizedDigest.contentWarnings.length)
        if (!hasContent) die("DIGEST_OUTPUT_INVALID", `${w.workId}: digest sanitizado VAZIO`)
      }
      const sanitizedDigestSignature = sanitizedDigest ? sha(sanitizedDigest) : null
      const baseInputSignature = sha({ workId: w.workId, synopsisInputsHash: w.canonicalSynopsisInputsHash, tags: [...w.tags].sort(), reviewCorpusSignature: b!.reviewCorpusSignature, corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION })
      const labelDisplaySignature = computeLabelDisplaySignature(labelDisplayContentFromWork({ synopsis: w.canonicalSynopsis, contextualTags, reviewContextType: reviewContext, sanitizedDigest }))
      return { workId: w.workId, origin: w.origin, split: w.split, stratum: w.stratum, tagContextType: w.tagContextType, synopsis: w.canonicalSynopsis, contextualTags, reviewContext, sanitizedDigest, sanitizedDigestSignature, baseInputSignature, labelDisplaySignature }
    })
    .sort((a, b) => (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0))

  const enrichedSnapshotSignature = sha({
    base2Signature: base2.base2Signature,
    base2r1Signature: b2r1.base2r1Signature,
    enrichedSnapshotVersion: ENRICHED2_VERSION,
    targetConstruct: TARGET_CONSTRUCT,
    digestVersion: EXPERIMENT_DIGEST_VERSION,
    selectionPolicyVersion: EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
    works: works.map((w) => ({ workId: w.workId, baseInputSignature: w.baseInputSignature, reviewContext: w.reviewContext, contextualTags: [...w.contextualTags].sort(), sanitizedDigestSignature: w.sanitizedDigestSignature, labelDisplaySignature: w.labelDisplaySignature })),
  })
  const sanitizedDigestCorpusSignature = sha(works.filter((w) => w.sanitizedDigestSignature).map((w) => [w.workId, w.sanitizedDigestSignature]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)))
  const labelDisplayCorpusSignature = sha(works.map((w) => [w.workId, w.labelDisplaySignature]).sort((a, b) => (a[0] < b[0] ? -1 : 1)))

  // ── §6 comparação dos 51 carryovers (labelDisplaySignature enriched-1 × enriched-2) ──
  const carryovers = works.filter((w) => w.origin === "carryover")
  const comparison = carryovers.map((w) => {
    const e2sig = w.labelDisplaySignature
    const e1 = enriched1ById.get(w.workId)
    if (!e1) return { workId: w.workId, classification: "display_changed_relabel" as const, reason: "not_in_enriched_1", enriched1Signature: null as string | null, enriched2Signature: e2sig }
    const e1Syn = base1Syn.get(w.workId) ?? ""
    const e1sig = computeLabelDisplaySignature(labelDisplayContentFromWork({ synopsis: e1Syn, contextualTags: e1.contextualTags, reviewContextType: e1.reviewContext, sanitizedDigest: e1.sanitizedDigest }))
    const same = e1sig === e2sig
    return { workId: w.workId, classification: (same ? "reuse_eligible" : "display_changed_relabel") as "reuse_eligible" | "display_changed_relabel", reason: same ? "display_identical" : "display_changed", enriched1Signature: e1sig, enriched2Signature: e2sig }
  }).sort((a, b) => (a.workId < b.workId ? -1 : 1))
  const reuseEligible = comparison.filter((c) => c.classification === "reuse_eligible").map((c) => c.workId)
  const relabel = comparison.filter((c) => c.classification === "display_changed_relabel").map((c) => c.workId)
  const relabelSet = new Set(relabel)

  // ── §7 escopo do contextual-2: new + repeats + carryovers changed; exclui reuse_eligible ──
  const includedSlots = manifestPilot2.slots.filter((s) => s.origin === "new" || s.isRepeat || (s.origin === "carryover" && relabelSet.has(s.workId)))
  // blind re-keying determinístico (ordem por sha(slotKey) — não revela origem/repeat/split).
  const shuffled = [...includedSlots].sort((a, b) => (sha(a.slotKey) < sha(b.slotKey) ? -1 : 1))
  const blindOf = new Map<string, { blindKey: string; shuffleOrder: number }>()
  shuffled.forEach((s, i) => blindOf.set(s.slotKey, { blindKey: `C${String(i + 1).padStart(3, "0")}`, shuffleOrder: i }))

  const enrById = new Map(works.map((w) => [w.workId, w]))
  const cards: ContextualCard[] = includedSlots.map((s) => {
    const e = enrById.get(s.workId)!
    const bk = blindOf.get(s.slotKey)!
    // "usadas de total": usadas = min(úteis,cap) (o que alimentou o digest); total = úteis deduplicadas.
    const total = b2r1ById.get(s.workId)!.reviewsAfterDedupe
    const reviewCount = e.reviewContext === "digest_available" ? { used: Math.min(total, EXPERIMENT_DIGEST_CAP), total } : null
    return { slotKey: bk.blindKey, shuffleOrder: bk.shuffleOrder, synopsis: e.synopsis, tagContextType: e.tagContextType as ContextualCard["tagContextType"], contextualTags: e.contextualTags, reviewContext: e.reviewContext, sanitizedDigest: e.sanitizedDigest, reviewCount }
  })

  const html = buildContextualHtml(cards, { experimentVersion: "digest-exp-1", goldenVersion: "pilot-2", enrichedVersion: ENRICHED2_VERSION })
  const csv = buildContextualLabelsTemplateCsv(cards)
  const blindKeys = cards.map((c) => c.slotKey).sort()
  const htmlSha = sha(html)
  const csvSha = sha(csv)
  const contextualPackageSignature = computeContextualPackageSignature({
    experimentVersion: "digest-exp-1", goldenVersion: "pilot-2", enrichedSnapshotVersion: ENRICHED2_VERSION, contextualPackageVersion: CONTEXTUAL2_VERSION,
    enrichedSnapshotSignature, sanitizedDigestCorpusSignature, slotKeys: blindKeys, contextualHtmlSha256: htmlSha, contextualLabelsTemplateSha256: csvSha,
  })
  const labelReusePlanSignature = sha({ version: LABEL_REUSE_PLAN_VERSION, base2r1Signature: b2r1.base2r1Signature, enriched1SnapshotSignature: enriched1.enrichedSnapshotSignature, carryovers: comparison.map((c) => [c.workId, c.classification]) })

  return {
    base2, b2r1, works, enrichedSnapshotSignature, sanitizedDigestCorpusSignature, labelDisplayCorpusSignature,
    comparison, reuseEligible, relabel, includedSlots, blindOf, cards, html, csv, htmlSha, csvSha,
    contextualPackageSignature, labelReusePlanSignature, contractSig, implSig,
    digestAvail: digestAvailIds.length, noReviews: noReviewsIds.length, enriched1Sig: enriched1.enrichedSnapshotSignature,
  }
}

function main(): void {
  const a = build()

  // ── §10 determinismo: rebuild e comparar as 5 assinaturas ──
  const b = build()
  const sigs = (x: ReturnType<typeof build>) => [x.enrichedSnapshotSignature, x.sanitizedDigestCorpusSignature, x.labelDisplayCorpusSignature, x.contextualPackageSignature, x.labelReusePlanSignature]
  if (JSON.stringify(sigs(a)) !== JSON.stringify(sigs(b))) die("BLOQUEADO", "NÃO determinístico (assinaturas divergiram entre 2 builds)")

  // ── §9 leakage (HTML/CSV cegos) ──
  const allWorkIds = a.base2.works.map((w) => w.workId)
  const titles = a.base2.works.map((w) => w.title).filter((t) => t && t.length >= 6)
  const issues: string[] = []
  // Shell (URLs/scripts/handlers/tokens técnicos) + work_ids no HTML inteiro.
  const off = assertContextualHtmlOffline(a.html, { workIds: allWorkIds })
  if (!off.ok) issues.push(...off.issues)
  // slotKeys ORIGINAIS (S###/R### revelam estrutura/repeat) NÃO podem aparecer.
  for (const s of a.includedSlots) {
    if (a.html.includes(s.slotKey)) issues.push(`slotKey original vazado no HTML: ${s.slotKey}`)
    if (a.csv.includes(s.slotKey)) issues.push(`slotKey original vazado no CSV: ${s.slotKey}`)
  }
  // Títulos: vazariam SE aparecessem no DIGEST exibido (contexto de leitores). A SINOPSE é o
  // conteúdo próprio da obra (inerente, permitido) e por isso NÃO entra nesta checagem.
  for (const c of a.cards) {
    if (!c.sanitizedDigest) continue
    const d = c.sanitizedDigest
    const digestText = [d.consensus, d.divergence, d.execution, ...d.traits.map((t) => t.trait), ...d.contentWarnings].join("  ")
    for (const t of titles) if (!c.synopsis.includes(t) && digestText.includes(t)) issues.push(`título estrangeiro "${t}" vazado no digest do slot ${c.slotKey}`)
  }
  // CSV: só "blindKey," (sem work_id, sem label pré-preenchido).
  for (const id of allWorkIds) if (a.csv.includes(id)) issues.push(`work_id vazado no CSV: ${id}`)
  if (/♥/.test(a.csv.replace(/^slot_key,label\n/, ""))) issues.push("CSV com valor de label pré-preenchido")
  const leakageOk = issues.length === 0
  if (!leakageOk) { console.error("⛔ BLOQUEADO — leakage detectado:"); for (const i of issues.slice(0, 20)) console.error("   - " + i); process.exit(1) }

  // ── escrita atômica (temp → rename), sem sobrescrever enriched-1/contextual-1 ──
  const capturedAt = new Date().toISOString()
  mkdirSync(OUT_ENRICHED, { recursive: true })
  mkdirSync(OUT_CONTEXTUAL, { recursive: true })
  const writeAtomic = (p: string, content: string) => { const tmp = `${p}.tmp`; writeFileSync(tmp, content); renameSync(tmp, p) }

  const enrichedSnapshot = {
    versions: { experimentVersion: "digest-exp-1", goldenVersion: "pilot-2", baseSnapshotVersion: "base-2r1", enrichedSnapshotVersion: ENRICHED2_VERSION, contextualPackageVersion: CONTEXTUAL2_VERSION, targetConstruct: TARGET_CONSTRUCT, digestVersion: EXPERIMENT_DIGEST_VERSION, corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION, selectionPolicyVersion: EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION },
    capturedAt,
    base2Signature: a.base2.base2Signature,
    base2r1Signature: a.b2r1.base2r1Signature,
    enrichedSnapshotSignature: a.enrichedSnapshotSignature,
    sanitizedDigestCorpusSignature: a.sanitizedDigestCorpusSignature,
    labelDisplayCorpusSignature: a.labelDisplayCorpusSignature,
    digestContractSignature: a.contractSig,
    digestImplementationSignature: a.implSig,
    uniqueWorks: a.works.length,
    digest_available: a.digestAvail,
    no_reviews_available: a.noReviews,
    works: a.works,
  }
  writeAtomic(resolve(OUT_ENRICHED, "pilot-2-snapshot-enriched.json"), stringify(enrichedSnapshot))
  writeAtomic(resolve(OUT_ENRICHED, "manifest.json"), stringify({
    kind: "enriched-2-manifest", versions: enrichedSnapshot.versions, base2r1Signature: a.b2r1.base2r1Signature,
    enrichedSnapshotSignature: a.enrichedSnapshotSignature, sanitizedDigestCorpusSignature: a.sanitizedDigestCorpusSignature,
    labelDisplayCorpusSignature: a.labelDisplayCorpusSignature, uniqueWorks: a.works.length, digest_available: a.digestAvail, no_reviews_available: a.noReviews, generatedAt: capturedAt,
  }))

  writeAtomic(resolve(OUT_CONTEXTUAL, "pilot-2-contextual-labeling.html"), a.html)
  writeAtomic(resolve(OUT_CONTEXTUAL, "pilot-2-labels-template.csv"), a.csv)
  writeAtomic(resolve(OUT_CONTEXTUAL, "carryover-display-comparison.json"), stringify({
    kind: "carryover-display-comparison", base2r1Signature: a.b2r1.base2r1Signature, enriched1SnapshotSignature: a.enriched1Sig, enriched2SnapshotSignature: a.enrichedSnapshotSignature,
    carryovers: a.comparison, counts: { total: a.comparison.length, reuse_eligible: a.reuseEligible.length, display_changed_relabel: a.relabel.length },
  }))
  writeAtomic(resolve(OUT_CONTEXTUAL, "label-reuse-plan.json"), stringify({
    kind: "label-reuse-plan", version: LABEL_REUSE_PLAN_VERSION, labelReusePlanSignature: a.labelReusePlanSignature,
    base2r1Signature: a.b2r1.base2r1Signature, enriched1SnapshotSignature: a.enriched1Sig,
    reuse_eligible: a.reuseEligible, display_changed_relabel: a.relabel,
    counts: { carryovers: a.comparison.length, reuse_eligible: a.reuseEligible.length, display_changed_relabel: a.relabel.length },
    note: "Plano de ELEGIBILIDADE — NÃO contém valores de label. Reaproveitamento só por assinatura de display idêntica.",
  }))
  // Mapa técnico blindKey → slot original (NÃO entregue ao avaliador).
  const blindMap = a.includedSlots.map((s) => ({ blindKey: a.blindOf.get(s.slotKey)!.blindKey, pilot2SlotKey: s.slotKey, workId: s.workId, origin: s.origin, isRepeat: s.isRepeat, repeatOf: s.repeatOf, split: s.split, stratum: s.stratum })).sort((x, y) => (x.blindKey < y.blindKey ? -1 : 1))
  writeAtomic(resolve(OUT_CONTEXTUAL, "manifest.json"), stringify({
    kind: "contextual-2-manifest", versions: enrichedSnapshot.versions, contextualPackageSignature: a.contextualPackageSignature, labelReusePlanSignature: a.labelReusePlanSignature,
    enrichedSnapshotSignature: a.enrichedSnapshotSignature, sanitizedDigestCorpusSignature: a.sanitizedDigestCorpusSignature, labelDisplayCorpusSignature: a.labelDisplayCorpusSignature,
    contextualHtmlSha256: a.htmlSha, contextualLabelsTemplateSha256: a.csvSha,
    slots: { newWorks: 39, repeatSlots: 10, changedCarryovers: a.relabel.length, reusableCarryovers: a.reuseEligible.length, totalSlotsToLabel: a.cards.length },
    blindKeyMap: blindMap, leakageOk, generatedAt: capturedAt,
    reviewCountsShown: { enabled: true, format: "usadas de total (N de M; N=min(úteis,40), M=úteis)", rationale: "pedido humano 2026-06-22 — reverte a regra §9 '0 review counts'; exibido SÓ no HTML, NÃO entra na labelDisplaySignature/labelReusePlan (não afeta elegibilidade de reuso)" },
    note: "Manifesto TÉCNICO (IDs/assinaturas) — NÃO é arquivo de rotulagem. HTML/CSV são cegos (sem título/workId/fonte/score; contagem de reviews exibida por pedido humano).",
  }))

  // ── relatório ──
  console.log("=== enriched-2 + contextual-2 (local, $0, sem LLM/DB) ===")
  console.log(`digest_available=${a.digestAvail}  no_reviews_available=${a.noReviews}`)
  console.log(`enrichedSnapshotSignature:      ${a.enrichedSnapshotSignature}`)
  console.log(`sanitizedDigestCorpusSignature: ${a.sanitizedDigestCorpusSignature}`)
  console.log(`labelDisplayCorpusSignature:    ${a.labelDisplayCorpusSignature}`)
  console.log(`carryovers: reuse_eligible=${a.reuseEligible.length}  display_changed_relabel=${a.relabel.length}  (total ${a.comparison.length})`)
  console.log(`slots no pacote: 39 new + 10 repeats + ${a.relabel.length} changed = ${a.cards.length}`)
  console.log(`contextualPackageSignature: ${a.contextualPackageSignature}`)
  console.log(`labelReusePlanSignature:    ${a.labelReusePlanSignature}`)
  console.log(`leakage: ${leakageOk ? "LIMPO ✅" : "FALHOU ⛔"}  | determinismo: OK ✅`)
  console.log(`artefatos: ${OUT_ENRICHED}/ + ${OUT_CONTEXTUAL}/`)
  console.log(`enriched-1/contextual-1/base-* intocados. 0 LLM, 0 DB, 0 label importada.`)
}

main()
