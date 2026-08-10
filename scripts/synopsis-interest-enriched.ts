/**
 * Materializa o snapshot ENRIQUECIDO (`enriched-1`) + o PACOTE CEGO CONTEXTUAL do
 * golden (Plano 3 Fase B2.2C). READ-ONLY no banco. NÃO chama provider, NÃO gera
 * digest, NÃO cria job, NÃO escreve no banco. Escreve só em .local-experiments/
 * (gitignored). Deriva ESTRITAMENTE de base-1 + os digests já gerados (sanitizados).
 *
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/synopsis-interest-enriched.ts
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { computeReviewCorpusSignature, type FrozenReview, type SnapshotBaseWork } from "@/lib/synopsis-interest/snapshot"
import { isUsefulReviewText } from "@/lib/reviews/useful-review"
import { buildEnrichedSnapshot, type BaseWorkRef } from "@/lib/synopsis-interest/enriched"
import { buildContextualHtml, buildContextualLabelsTemplateCsv, assertContextualHtmlOffline, computeContextualPackageSignature, type ContextualCard } from "@/lib/synopsis-interest/contextual-html"
import { TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BASE_DIR = resolve(process.cwd(), ".local-experiments/plan3/digest-exp-1/base-1")
const OUT_DIR = resolve(process.cwd(), ".local-experiments/plan3/digest-exp-1/enriched-1")
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
function fileSha(p: string): string { return createHash("sha256").update(readFileSync(p)).digest("hex") }

const EXPECT_BASE = "634571c2faa0292394b38f12235beff8ba67ed51a98bf8e04b57056234fa681d"
const EXPECT_CORPUS = "8776419ed4006810b832613e5df606d52077838ce00c3e77190a461880b5c45e"

async function main() {
  const snap = JSON.parse(readFileSync(resolve(BASE_DIR, "golden-snapshot-base.json"), "utf8")) as {
    snapshotBaseSignature: string; reviewCorpusSignature: string; works: SnapshotBaseWork[]
  }
  const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "lib/synopsis-interest/golden-sample.pilot-1.json"), "utf8")) as { slots: Array<{ slotKey: string; workId: string; shuffleOrder: number }> }
  const shuffleOf = new Map(fixture.slots.map((s) => [s.slotKey, s.shuffleOrder]))

  // ---- PRÉ-VERIFICAÇÃO ----
  if (snap.snapshotBaseSignature !== EXPECT_BASE) throw new Error(`snapshotBaseSignature divergente: ${snap.snapshotBaseSignature}`)
  if (snap.reviewCorpusSignature !== EXPECT_CORPUS) throw new Error(`reviewCorpusSignature divergente: ${snap.reviewCorpusSignature}`)
  if (snap.works.length !== 80) throw new Error(`esperado 80 obras; achei ${snap.works.length}`)
  const { count: labeled } = await sb.from("synopsis_interest_golden").select("*", { count: "exact", head: true }).not("human_label", "is", null)
  if ((labeled ?? 0) !== 0) throw new Error(`labels != 0 (${labeled})`)

  const ids = snap.works.map((w) => w.workId)
  const frozen = snap.works.filter((w) => w.reviewState === "frozen_current").map((w) => w.workId)
  // digests + reviews (corpus recheck)
  const digestRow = new Map<string, { digest: unknown; version: string | null }>()
  for (const c of chunk(frozen, 40)) {
    const { data, error } = await sb.from("works").select("id, review_digest, review_digest_version").in("id", c)
    if (error) throw new Error("works: " + error.message)
    for (const w of (data ?? []) as Array<{ id: string; review_digest: unknown; review_digest_version: string | null }>) digestRow.set(w.id, { digest: w.review_digest, version: w.review_digest_version })
  }
  const reviewsByWork = new Map<string, FrozenReview[]>()
  for (const c of chunk(ids, 60)) {
    const { data, error } = await sb.from("work_reviews").select("work_id, source, text").in("work_id", c)
    if (error) throw new Error("reviews: " + error.message)
    for (const r of (data ?? []) as Array<{ work_id: string; source: string | null; text: string | null }>) {
      if (!reviewsByWork.has(r.work_id)) reviewsByWork.set(r.work_id, [])
      if (isUsefulReviewText(r.text)) reviewsByWork.get(r.work_id)!.push({ source: String(r.source ?? ""), text: String(r.text ?? "") })
    }
  }

  // BLOQUEIOS
  const blocks: string[] = []
  for (const w of snap.works) {
    const curCorpus = computeReviewCorpusSignature(reviewsByWork.get(w.workId) ?? [])
    if (curCorpus !== w.reviewCorpusSignature) blocks.push(`${w.workId}: corpus_changed`)
  }
  const digestByWork = new Map<string, ReviewDigest | null>()
  for (const id of frozen) {
    const d = digestRow.get(id)
    if (!d || d.digest == null) { blocks.push(`${id}: digest ausente`); continue }
    if (d.version !== "digest-v1") { blocks.push(`${id}: digest ${d.version} (incompatível)`); continue }
    let parsed: unknown = d.digest
    try { if (typeof parsed === "string") parsed = JSON.parse(parsed) } catch { blocks.push(`${id}: digest não-parseável`); continue }
    const p = parsed as Partial<ReviewDigest> | null
    const ok = p && typeof p.consensus === "string" && Array.isArray(p.salient_traits) && typeof p.execution === "string"
    if (!ok) { blocks.push(`${id}: campos faltando`); continue }
    digestByWork.set(id, parsed as ReviewDigest)
  }
  if (blocks.length > 0) {
    console.error("⛔ BLOQUEADO — NÃO materializar enriched-1:")
    for (const b of blocks.slice(0, 20)) console.error("  " + b)
    process.exit(1)
  }

  // ---- name→group (catálogo ESTÁTICO) ----
  const nameToGroup = new Map<string, string>()
  for (const g of TAG_GROUPS_CATALOG) for (const v of g.values) if (!nameToGroup.has(v)) nameToGroup.set(v, g.groupSlug)
  const tagGroupOf = (name: string): string | null => nameToGroup.get(name) ?? null

  // ---- ENRICHED-1 ----
  const baseWorks: BaseWorkRef[] = snap.works.map((w) => ({
    workId: w.workId, slots: w.slots, split: w.split, stratum: w.stratum,
    title: w.title, canonicalSynopsis: w.canonicalSynopsis, tags: w.tags, tagContextType: w.tagContextType,
    titleSignature: w.titleSignature, synopsisSignature: w.synopsisSignature, tagsSignature: w.tagsSignature,
    tasteProfileSignature: w.tasteProfileSignature, reviewCorpusSignature: w.reviewCorpusSignature,
    baseInputSignature: w.baseInputSignature, reviewState: w.reviewState,
  }))
  const capturedAt = new Date().toISOString()
  const enriched = buildEnrichedSnapshot(baseWorks, digestByWork, tagGroupOf, { snapshotBaseSignature: snap.snapshotBaseSignature, reviewCorpusSignature: snap.reviewCorpusSignature }, capturedAt)

  // ---- PACOTE CONTEXTUAL ----
  const synByWork = new Map(snap.works.map((w) => [w.workId, w.canonicalSynopsis as string]))
  const enrByWork = new Map(enriched.works.map((w) => [w.workId, w]))
  const cards: ContextualCard[] = fixture.slots.map((s) => {
    const e = enrByWork.get(s.workId)!
    return {
      slotKey: s.slotKey,
      shuffleOrder: shuffleOf.get(s.slotKey) ?? 0,
      synopsis: synByWork.get(s.workId) ?? "",
      tagContextType: e.tagContextType,
      contextualTags: e.contextualTags,
      reviewContext: e.reviewContext,
      sanitizedDigest: e.sanitizedDigest,
    }
  })
  const html = buildContextualHtml(cards, { experimentVersion: "digest-exp-1", goldenVersion: "pilot-1", enrichedVersion: "enriched-1" })
  const csv = buildContextualLabelsTemplateCsv(cards)
  const offline = assertContextualHtmlOffline(html, { workIds: ids })
  if (!offline.ok) throw new Error("HTML contextual FALHOU offline: " + offline.issues.join("; "))

  // ---- escrever artefatos ----
  mkdirSync(OUT_DIR, { recursive: true })
  const snapPath = resolve(OUT_DIR, "golden-snapshot-enriched.json")
  const htmlPath = resolve(OUT_DIR, "golden-contextual-labeling.html")
  const csvPath = resolve(OUT_DIR, "golden-contextual-labels-template.csv")
  writeFileSync(snapPath, JSON.stringify(enriched, null, 2))
  writeFileSync(htmlPath, html)
  writeFileSync(csvPath, csv)
  const htmlSha = fileSha(htmlPath), csvSha = fileSha(csvPath), snapSha = fileSha(snapPath)
  const pkgSig = computeContextualPackageSignature({
    experimentVersion: "digest-exp-1", goldenVersion: "pilot-1", enrichedSnapshotVersion: "enriched-1", contextualPackageVersion: "contextual-1",
    enrichedSnapshotSignature: enriched.enrichedSnapshotSignature, sanitizedDigestCorpusSignature: enriched.sanitizedDigestCorpusSignature,
    slotKeys: fixture.slots.map((s) => s.slotKey), contextualHtmlSha256: htmlSha, contextualLabelsTemplateSha256: csvSha,
  })
  const labelingManifest = {
    versions: enriched.versions,
    enrichedSnapshotSignature: enriched.enrichedSnapshotSignature,
    sanitizedDigestCorpusSignature: enriched.sanitizedDigestCorpusSignature,
    contextualPackageSignature: pkgSig,
    slotKeys: fixture.slots.map((s) => s.slotKey).sort(),
    contextualHtmlSha256: htmlSha, contextualLabelsTemplateSha256: csvSha,
    generatedAt: capturedAt,
  }
  writeFileSync(resolve(OUT_DIR, "golden-contextual-labeling-manifest.json"), JSON.stringify(labelingManifest, null, 2))

  // counts
  const digestAvail = enriched.works.filter((w) => w.reviewContext === "digest_available").length
  const noReviews = enriched.works.filter((w) => w.reviewContext === "no_reviews_available").length
  const tagCtx: Record<string, number> = {}
  for (const w of enriched.works) tagCtx[w.tagContextType] = (tagCtx[w.tagContextType] ?? 0) + 1
  const emptyContextualTags = enriched.works.filter((w) => w.contextualTags.length === 0)

  console.log(JSON.stringify({
    versions: enriched.versions,
    blocks: blocks.length,
    enrichedSnapshotSignature: enriched.enrichedSnapshotSignature,
    sanitizedDigestCorpusSignature: enriched.sanitizedDigestCorpusSignature,
    baseSnapshotSignature: enriched.baseSnapshotSignature,
    reviewCorpusSignature: enriched.reviewCorpusSignature,
    contextualPackageSignature: pkgSig,
    uniqueWorks: enriched.works.length,
    totalSlots: cards.length,
    digest_available: digestAvail,
    no_reviews_available: noReviews,
    tagContextCounts: tagCtx,
    emptyContextualTags: emptyContextualTags.map((w) => ({ id: w.workId.slice(0, 8), tagCtx: w.tagContextType })),
    offlineOk: offline.ok,
    files: {
      snapshot: { sha256: snapSha, bytes: statSync(snapPath).size },
      html: { sha256: htmlSha, bytes: statSync(htmlPath).size },
      csv: { sha256: csvSha, bytes: statSync(csvPath).size },
    },
    outDir: OUT_DIR,
  }, null, 2))
}
main().catch((e) => { console.error("[enriched] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
