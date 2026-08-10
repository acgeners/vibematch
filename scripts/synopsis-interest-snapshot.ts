/**
 * Materializa o SNAPSHOT-BASE imutável + o PACOTE CEGO de rotulagem do Plano 3
 * (Fase B2.1C). READ-ONLY no banco (SELECT). NÃO chama provider, NÃO gera digest,
 * NÃO escreve no banco. Escreve apenas artefatos LOCAIS em .local-experiments/
 * (gitignored) e imprime os agregados/hashes para o manifesto versionado.
 *
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/synopsis-interest-snapshot.ts
 *
 * Idempotente/determinístico: a mesma base do banco ⇒ o mesmo snapshotBaseSignature.
 * NÃO importável por rotas/build (efeito só ao rodar como CLI).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { computeProfileSignature, loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { hashReviewInputs, parseReviewSummaryMeta, isMaterialReviewChange } from "@/lib/ai-recommendation/review-summarizer"
import {
  buildSnapshotBase,
  buildSnapshotManifest,
  SNAPSHOT_VERSIONS,
  type SnapshotBaseWorkInput,
} from "@/lib/synopsis-interest/snapshot"
import {
  buildBlindHtml,
  buildLabelsTemplateCsv,
  assertBlindHtmlOffline,
  computeLabelingPackageSignature,
  type BlindSlot,
} from "@/lib/synopsis-interest/blind-package"

interface WorkRow {
  id: string
  title: string | null
  is_archived: boolean | null
  canonical_synopsis: string | null
  review_summary: string | null
  review_summary_inputs_hash: string | null
  review_digest: unknown
  review_digest_version: string | null
  review_digest_n: number | null
  work_tags?: Array<{ tags?: { name?: string | null } | null }> | null
  work_genres?: Array<{ genre_id?: string | null }> | null
}
interface ReviewRow { work_id: string; source: string | null; text: string | null; user_rating: number | null; fetched_at: string | null }
interface ExtRow { work_id: string; is_rejected: boolean | null }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const OUT_DIR = resolve(process.cwd(), ".local-experiments/plan3/digest-exp-1/base-1")
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
function fileSha256(p: string): string { return createHash("sha256").update(readFileSync(p)).digest("hex") }

interface Slot { slotKey: string; workId: string; split: "development" | "holdout"; stratum: string; isRepeat: boolean; repeatOf: string | null; shuffleOrder: number }

async function main() {
  const dir = resolve(process.cwd(), "lib/synopsis-interest")
  const fixture = JSON.parse(readFileSync(resolve(dir, "golden-sample.pilot-1.json"), "utf8")) as { sample_version: string; slots: Slot[] }
  const slots = fixture.slots
  const uniqueIds = [...new Set(slots.filter((s) => !s.isRepeat).map((s) => s.workId))]
  if (uniqueIds.length !== 80) throw new Error(`esperado 80 obras únicas; achei ${uniqueIds.length}`)
  if (slots.length !== 90) throw new Error(`esperado 90 slots; achei ${slots.length}`)

  const profileRow = await loadCurrentTasteProfile()
  if (!profileRow || profileRow.is_stub) throw new Error("taste_profile corrente ausente/stub")
  if (profileRow.version !== 7) throw new Error(`esperado perfil v7; achei v${profileRow.version}`)
  const profileSig = computeProfileSignature(profileRow.profile)

  // works
  const works = new Map<string, WorkRow>()
  for (const c of chunk(uniqueIds, 40)) {
    const { data, error } = await sb.from("works")
      .select("id, title, is_archived, canonical_synopsis, review_summary, review_summary_inputs_hash, review_digest, review_digest_version, review_digest_n, work_tags(tags(name)), work_genres(genre_id)")
      .in("id", c)
    if (error) throw new Error("works: " + error.message)
    for (const w of (data ?? []) as unknown as WorkRow[]) works.set(w.id, w)
  }
  // reviews
  const reviewsByWork = new Map<string, Array<{ source: string; text: string; userRating: number | null; fetched_at: string | null }>>()
  for (const c of chunk(uniqueIds, 60)) {
    const { data, error } = await sb.from("work_reviews").select("work_id, source, text, user_rating, fetched_at").in("work_id", c)
    if (error) throw new Error("reviews: " + error.message)
    for (const r of (data ?? []) as unknown as ReviewRow[]) {
      if (!reviewsByWork.has(r.work_id)) reviewsByWork.set(r.work_id, [])
      reviewsByWork.get(r.work_id)!.push({ source: String(r.source ?? ""), text: String(r.text ?? ""), userRating: r.user_rating ?? null, fetched_at: r.fetched_at ?? null })
    }
  }
  // accepted external ids (for tagsRecoverable)
  const acceptedExtByWork = new Map<string, number>()
  for (const c of chunk(uniqueIds, 60)) {
    const { data, error } = await sb.from("work_external_ids").select("work_id, is_rejected").in("work_id", c)
    if (error) throw new Error("ext: " + error.message)
    for (const r of (data ?? []) as unknown as ExtRow[]) if (!r.is_rejected) acceptedExtByWork.set(r.work_id, (acceptedExtByWork.get(r.work_id) ?? 0) + 1)
  }

  const slotsByWork = new Map<string, Slot[]>()
  for (const s of slots) { if (!slotsByWork.has(s.workId)) slotsByWork.set(s.workId, []); slotsByWork.get(s.workId)!.push(s) }

  const inputs: SnapshotBaseWorkInput[] = []
  for (const id of uniqueIds) {
    const w = works.get(id)
    if (!w) throw new Error(`obra do golden não encontrada: ${id}`)
    const canonical = (w.canonical_synopsis ?? "").trim()
    if (!canonical) throw new Error(`obra sem canonical (não-fresh inesperado): ${id}`)
    const tagNames = (w.work_tags ?? []).map((t) => t.tags?.name).filter((n): n is string => Boolean(n))
    const genres = (w.work_genres ?? []).length
    const tagsRecoverable = tagNames.length === 0 && (genres > 0 || (acceptedExtByWork.get(id) ?? 0) > 0)

    const revs = reviewsByWork.get(id) ?? []
    const useful = revs.filter((r) => r.text.trim().length >= 40)
    // summary freshness (replica ensureReviewSummary)
    let summaryFresh = false
    if (useful.length > 0 && w.review_summary != null) {
      const ordered = useful.map((r) => ({ text: r.text.trim(), userRating: r.userRating ?? null })).sort((a, b) => a.text.localeCompare(b.text))
      const cur = hashReviewInputs(ordered)
      const { hash: prev, n: prevN } = parseReviewSummaryMeta(w.review_summary_inputs_hash ?? null)
      summaryFresh = prev === cur || !isMaterialReviewChange(prevN, ordered.length)
    }
    const fetched = revs.map((r) => r.fetched_at).filter(Boolean) as string[]
    inputs.push({
      workId: id,
      slots: (slotsByWork.get(id) ?? []).map((s) => ({ slotKey: s.slotKey, isRepeat: s.isRepeat, repeatOf: s.repeatOf })),
      split: (slotsByWork.get(id) ?? [])[0]!.split,
      stratum: (slotsByWork.get(id) ?? [])[0]!.stratum,
      title: String(w.title ?? ""),
      canonicalSynopsis: canonical,
      tags: tagNames,
      tagsRecoverable,
      tasteProfileSignature: profileSig,
      reviews: useful.map((r) => ({ source: r.source, text: r.text })),
      reviewSources: [...new Set(useful.map((r) => r.source))],
      summaryPresent: w.review_summary != null,
      summaryFresh,
      digestPresent: w.review_digest != null, // todos false no golden
      digestFresh: false,
      latestFetchedAt: fetched.length ? fetched.reduce((a, b) => (a > b ? a : b)) : null,
    })
  }

  const capturedAt = new Date().toISOString()
  const snapshot = buildSnapshotBase(inputs, capturedAt)
  const manifest = buildSnapshotManifest(snapshot)

  // Blind package: slots (90) com a sinopse congelada do snapshot por workId.
  const synByWork = new Map(snapshot.works.map((w) => [w.workId, w.canonicalSynopsis]))
  const blindSlots: BlindSlot[] = slots.map((s) => ({ slotKey: s.slotKey, synopsis: synByWork.get(s.workId) ?? "", shuffleOrder: s.shuffleOrder }))
  const html = buildBlindHtml(blindSlots, { experimentVersion: SNAPSHOT_VERSIONS.experimentVersion, goldenVersion: SNAPSHOT_VERSIONS.goldenVersion, snapshotVersion: SNAPSHOT_VERSIONS.snapshotVersion })
  const csv = buildLabelsTemplateCsv(blindSlots)
  const offline = assertBlindHtmlOffline(html, { workIds: uniqueIds })
  if (!offline.ok) throw new Error("HTML cego FALHOU validação offline: " + offline.issues.join("; "))

  // write local artifacts
  mkdirSync(OUT_DIR, { recursive: true })
  const snapPath = resolve(OUT_DIR, "golden-snapshot-base.json")
  const htmlPath = resolve(OUT_DIR, "golden-labeling.html")
  const csvPath = resolve(OUT_DIR, "golden-labels-template.csv")
  const manifestPath = resolve(OUT_DIR, "manifest.json")
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2))
  writeFileSync(htmlPath, html)
  writeFileSync(csvPath, csv)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  const blindHtmlSha256 = fileSha256(htmlPath)
  const labelsTemplateSha256 = fileSha256(csvPath)
  const snapshotJsonSha256 = fileSha256(snapPath)
  const labelingPackageSignature = computeLabelingPackageSignature({
    experimentVersion: SNAPSHOT_VERSIONS.experimentVersion,
    goldenVersion: SNAPSHOT_VERSIONS.goldenVersion,
    snapshotVersion: SNAPSHOT_VERSIONS.snapshotVersion,
    snapshotBaseSignature: snapshot.snapshotBaseSignature,
    slotKeys: slots.map((s) => s.slotKey),
    blindHtmlSha256,
    labelsTemplateSha256,
  })

  console.log(JSON.stringify({
    versions: SNAPSHOT_VERSIONS,
    capturedAt,
    profileVersion: profileRow.version,
    profileSignature: profileSig.slice(0, 16) + "…",
    uniqueWorks: manifest.uniqueWorks,
    totalSlots: manifest.totalSlots,
    repeats: manifest.repeats,
    splitCounts: manifest.splitCounts,
    stratumCounts: manifest.stratumCounts,
    tagContextCounts: manifest.tagContextCounts,
    reviewStateCounts: manifest.reviewStateCounts,
    snapshotBaseSignature: snapshot.snapshotBaseSignature,
    reviewCorpusSignature: snapshot.reviewCorpusSignature,
    snapshotJsonSha256,
    snapshotJsonBytes: statSync(snapPath).size,
    blindHtmlSha256,
    blindHtmlBytes: statSync(htmlPath).size,
    labelsTemplateSha256,
    labelsTemplateBytes: statSync(csvPath).size,
    labelingPackageSignature,
    offlineOk: offline.ok,
    s078: (() => { const w = snapshot.works.find((x) => x.slots.some((s) => s.slotKey === "S078")); return w ? { workId: w.workId, tagContextType: w.tagContextType, tags: w.tags.length, tagsSignature: w.tagsSignature.slice(0, 12) } : null })(),
  }, null, 2))
  console.log(`\nArtefatos (gitignored): ${OUT_DIR}`)
}

main().catch((e) => { console.error("[snapshot] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
