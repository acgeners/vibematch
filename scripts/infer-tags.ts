/**
 * Inferência de tags a partir da sinopse (ver PLANO-TAGS-IA.md).
 * DEFAULT = dry-run (read-only, gera CSV de revisão). --execute grava (aditivo,
 * source='ai_inferred') e exige a migration 117 aplicada.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/infer-tags.ts \
 *     [--limit=N] [--max-tags=9] [--out=path.csv]
 *   ... --execute --min-confidence=alta --reversal=path.jsonl
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { buildTagMenu, inferTagsFromText, verifyTagsFromText } from "@/lib/tags/infer-from-text"
import { resolveOrCreateTags } from "@/lib/tags/ingest"
import fs from "node:fs"

const EXECUTE = process.argv.includes("--execute")
const arg = (k: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1]
const REVERSAL = arg("--reversal")
const OUT = arg("--out") ?? "infer-tags-proposals.csv"
const MIN_CONF = arg("--min-confidence") ?? "alta" // alta | media
const THRESHOLD = Number(arg("--max-tags") ?? "9") // obras com tagCount <= THRESHOLD (default ≤9 = "<10")
const LIMIT = arg("--limit") ? Number(arg("--limit")) : Infinity
const FROM_CSV = arg("--from-csv") // grava a partir de um CSV de dry-run (editado), sem LLM
const VERIFY = process.argv.includes("--verify") // re-verifica as "média" do CSV com Sonnet
const WITH_REVIEWS = process.argv.includes("--with-reviews") // passada incremental usando review_summary/digest
const REVIEWS_OPTIONAL = process.argv.includes("--reviews-optional") // processa TODAS do escopo (review só onde houver)

const csv = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`
const minConfNum = /m[eé]dia/i.test(MIN_CONF) ? 0.6 : 0.9

/** Parser CSV mínimo (campos entre aspas, "" escapado, vírgulas/quebras dentro de aspas). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = "", row: string[] = [], inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = "" }
    else if (c !== "\r") field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift() ?? []
  return rows
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])))
}

/** Monta contexto textual a partir do digest (rico) ou do resumo de reviews. */
function buildReviewContext(summary: unknown, digest: unknown): string | undefined {
  const parts: string[] = []
  const join = (v: unknown) => (Array.isArray(v) ? v.map(String).join("; ") : v ? String(v) : "")
  if (digest && typeof digest === "object") {
    const d = digest as Record<string, unknown>
    if (d.consensus) parts.push(`Consenso dos leitores: ${String(d.consensus)}`)
    if (d.salient_traits) parts.push(`Traços salientes: ${join(d.salient_traits)}`)
    if (d.content_warnings) parts.push(`Avisos de conteúdo: ${join(d.content_warnings)}`)
  }
  if (parts.length === 0 && summary && String(summary).trim()) parts.push(`Resumo das reviews: ${String(summary).trim()}`)
  return parts.length ? parts.join("\n") : undefined
}

/**
 * Passada incremental: re-infere usando sinopse + reviews (digest/resumo) só nas
 * obras (do escopo --from-csv) que têm review. Gera CSV só com tags NOVAS (não já
 * presentes). Gravação/verificação reusam --from-csv (alta) e --verify (média).
 */
async function runWithReviews(sb: ReturnType<typeof createAdminClient>) {
  if (!FROM_CSV) throw new Error("--with-reviews requer --from-csv=<dryrun.csv> (define o escopo da cauda)")
  const scope = [...new Set(parseCsv(fs.readFileSync(FROM_CSV, "utf8")).map((r) => r.work_id).filter(Boolean))]

  const works: Array<{ id: string; title: string; canonical_synopsis: string | null; review_summary: unknown; review_digest: unknown }> = []
  const curNames = new Map<string, Set<string>>()
  for (let i = 0; i < scope.length; i += 200) {
    const chunk = scope.slice(i, i + 200)
    const { data: w } = await sb.from("works").select("id, title, canonical_synopsis, review_summary, review_digest").in("id", chunk)
    works.push(...((w ?? []) as typeof works))
    const { data: wt } = await sb.from("work_tags").select("work_id, tags(name)").in("work_id", chunk)
    for (const r of (wt ?? []) as Array<{ work_id: string; tags: { name?: string } | null }>) {
      const s = curNames.get(r.work_id) ?? new Set<string>()
      if (r.tags?.name) s.add(String(r.tags.name).toLowerCase())
      curNames.set(r.work_id, s)
    }
  }

  const menu = await buildTagMenu(sb)
  // Default: só obras com review. Com --reviews-optional: todas do escopo (review onde houver).
  let targets = works.filter((w) => w.canonical_synopsis && String(w.canonical_synopsis).trim() && (REVIEWS_OPTIONAL || buildReviewContext(w.review_summary, w.review_digest)))
  if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT)
  const nRev = targets.filter((w) => buildReviewContext(w.review_summary, w.review_digest)).length
  console.log(`with-reviews${REVIEWS_OPTIONAL ? " (todas, review onde houver)" : ""}: ${targets.length} obras (${nRev} com review) | menu ${menu.count} tags | OUT: ${OUT}`)
  fs.writeFileSync(OUT, "work_id,title,current_tags,tag,confidence,evidence\n")

  let totalNew = 0, withNew = 0, failed = 0
  for (const w of targets) {
    const ctx = buildReviewContext(w.review_summary, w.review_digest)
    let proposals
    try { proposals = await inferTagsFromText({ supabase: sb, synopsis: String(w.canonical_synopsis), menu, reviewContext: ctx }) }
    catch (e) { failed++; console.log(`  ✗ "${w.title}": ${e instanceof Error ? e.message : String(e)}`); continue }
    const cur = curNames.get(w.id) ?? new Set<string>()
    const fresh = proposals.filter((p) => !cur.has(p.name.toLowerCase())) // só tags que a obra ainda NÃO tem
    if (fresh.length) { withNew++; totalNew += fresh.length }
    for (const p of fresh) fs.appendFileSync(OUT, [csv(w.id), csv(w.title), cur.size, csv(p.name), p.confidence, csv(p.evidence)].join(",") + "\n")
    console.log(`  ~ "${w.title}" (${cur.size}) → +${fresh.length}: ${fresh.map((p) => p.name).join(", ")}`)
  }
  console.log(`\n=== WITH-REVIEWS (dry) ===`)
  console.log(`obras: ${targets.length} | com tag nova: ${withNew} | tags novas (alta+média): ${totalNew} | CSV: ${OUT} | falhas: ${failed}`)
  console.log(`Depois: alta → --execute --from-csv=${OUT} --min-confidence=alta ; média → --verify --execute --from-csv=${OUT}`)
}

/** Re-verifica as "média" do CSV com Sonnet (juiz estrito). --execute grava as confirmadas (conf 0.7). */
async function runVerify(sb: ReturnType<typeof createAdminClient>) {
  if (!FROM_CSV) throw new Error("--verify requer --from-csv=<dryrun.csv>")
  const lines = parseCsv(fs.readFileSync(FROM_CSV, "utf8"))
  const byWork = new Map<string, { title: string; before: number; cands: string[] }>()
  for (const r of lines) {
    if (r.confidence !== "0.6") continue // só as "média"
    const w = byWork.get(r.work_id) ?? { title: r.title, before: Number(r.current_tags) || 0, cands: [] }
    w.cands.push(r.tag); byWork.set(r.work_id, w)
  }
  let entries = [...byWork.entries()]
  if (Number.isFinite(LIMIT)) entries = entries.slice(0, LIMIT)

  const ids = entries.map(([id]) => id)
  const synById = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("works").select("id, canonical_synopsis").in("id", ids.slice(i, i + 200))
    for (const w of data ?? []) synById.set(w.id, w.canonical_synopsis)
  }
  console.log(`verify (Sonnet): ${entries.length} obras com média | modo: ${EXECUTE ? "EXECUTE" : "DRY (só CSV)"}`)
  fs.writeFileSync(OUT, "work_id,title,current_tags,tag,confidence,evidence\n")
  if (REVERSAL && EXECUTE) fs.writeFileSync(REVERSAL, "")

  let cand = 0, kept = 0, written = 0, failed = 0
  for (const [workId, w] of entries) {
    const syn = synById.get(workId)
    if (!syn || !String(syn).trim()) continue
    cand += w.cands.length
    let confirmed
    try { confirmed = await verifyTagsFromText({ synopsis: String(syn), candidates: w.cands }) }
    catch (e) { failed++; console.log(`  ✗ "${w.title}": ${e instanceof Error ? e.message : String(e)}`); continue }
    kept += confirmed.length
    for (const p of confirmed) {
      fs.appendFileSync(OUT, [csv(workId), csv(w.title), w.before, csv(p.name), p.confidence, csv(p.evidence)].join(",") + "\n")
    }
    if (!EXECUTE) { console.log(`  ~ "${w.title}": ${w.cands.length}→${confirmed.length}  [${confirmed.map((p) => p.name).join(", ")}]`); continue }
    if (!confirmed.length) { console.log(`  · "${w.title}": 0 confirmadas`); continue }
    const { ids: tids } = await resolveOrCreateTags(sb, confirmed.map((p) => p.name))
    const { data: cur } = await sb.from("work_tags").select("tag_id").eq("work_id", workId)
    const existing = new Set((cur ?? []).map((r) => r.tag_id))
    const newIds = [...new Set(tids)].filter((id) => !existing.has(id))
    if (!newIds.length) { console.log(`  · "${w.title}": nada novo`); continue }
    const rows = newIds.map((id) => ({ work_id: workId, tag_id: id, source: "ai_inferred", confidence: 0.7 }))
    const { error: upErr } = await sb.from("work_tags").upsert(rows, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
    if (upErr) { failed++; console.log(`  ✗ "${w.title}": ${upErr.message}`); continue }
    if (REVERSAL) for (const r of rows) fs.appendFileSync(REVERSAL, JSON.stringify({ work_id: r.work_id, tag_id: r.tag_id }) + "\n")
    written += rows.length
    console.log(`  ✓ "${w.title}" ${w.before} → ${w.before + rows.length}  (+${rows.length} de ${w.cands.length} média)`)
  }
  const pct = cand ? ((kept / cand) * 100).toFixed(0) : "0"
  console.log(`\n=== VERIFY ${EXECUTE ? "GRAVADO" : "(dry)"} ===`)
  console.log(`média candidatas: ${cand} | confirmadas: ${kept} (${pct}%) | ${EXECUTE ? `inseridas: ${written}` : `CSV: ${OUT}`} | falhas: ${failed}`)
  if (EXECUTE) console.log(`Rode 'npm run recalc:scores' pra propagar.`)
}

/** Grava tags a partir do CSV (editado pelo humano). Sem LLM. --execute gate o write. */
async function runFromCsv(sb: ReturnType<typeof createAdminClient>) {
  const lines = parseCsv(fs.readFileSync(FROM_CSV!, "utf8"))
  const byWork = new Map<string, { title: string; before: number; tags: Array<{ name: string; confidence: number }> }>()
  for (const r of lines) {
    const conf = Number(r.confidence)
    if (!Number.isFinite(conf) || conf < minConfNum) continue
    const w = byWork.get(r.work_id) ?? { title: r.title, before: Number(r.current_tags) || 0, tags: [] }
    w.tags.push({ name: r.tag, confidence: conf })
    byWork.set(r.work_id, w)
  }
  console.log(`from-csv: ${lines.length} linhas | obras: ${byWork.size} | min-conf: ${MIN_CONF} | modo: ${EXECUTE ? "EXECUTE" : "PREVIEW"}`)
  if (REVERSAL && EXECUTE) fs.writeFileSync(REVERSAL, "")

  let written = 0, failed = 0
  const ran: string[] = [] // obras cuja inferência foi aplicada (p/ tags_inferred_at)
  for (const [workId, w] of byWork) {
    if (!EXECUTE) { console.log(`  ~ "${w.title}" (${w.before}) → +${w.tags.length}: ${w.tags.map((t) => t.name).join(", ")}`); continue }
    ran.push(workId)
    const { ids } = await resolveOrCreateTags(sb, w.tags.map((t) => t.name))
    const confByName = new Map(w.tags.map((t) => [t.name.toLowerCase(), t.confidence]))
    const { data: cur } = await sb.from("work_tags").select("tag_id").eq("work_id", workId)
    const existing = new Set((cur ?? []).map((r) => r.tag_id))
    const newIds = [...new Set(ids)].filter((id) => !existing.has(id))
    if (!newIds.length) { console.log(`  · "${w.title}" — nada novo`); continue }
    const { data: tagRows } = await sb.from("tags").select("id, name").in("id", newIds)
    const insertRows = (tagRows ?? []).map((t) => ({
      work_id: workId, tag_id: t.id, source: "ai_inferred",
      confidence: confByName.get(t.name.toLowerCase()) ?? minConfNum,
    }))
    const { error: upErr } = await sb.from("work_tags").upsert(insertRows, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
    if (upErr) { failed++; console.log(`  ✗ "${w.title}": ${upErr.message}`); continue }
    if (REVERSAL) for (const r of insertRows) fs.appendFileSync(REVERSAL, JSON.stringify({ work_id: r.work_id, tag_id: r.tag_id }) + "\n")
    written += insertRows.length
    console.log(`  ✓ "${w.title}" ${w.before} → ${w.before + insertRows.length}  (+${insertRows.length})`)
  }
  if (EXECUTE && ran.length) {
    const { error: tsErr } = await sb.from("works").update({ tags_inferred_at: new Date().toISOString() }).in("id", ran)
    if (tsErr) console.log(`  ! falha ao marcar tags_inferred_at: ${tsErr.message}`)
    else console.log(`  · tags_inferred_at marcado em ${ran.length} obras`)
  }

  console.log(`\n=== ${EXECUTE ? "GRAVADO" : "PREVIEW"} (from-csv) ===`)
  console.log(`obras: ${byWork.size} | inseridas: ${written} | falhas: ${failed}`)
  if (EXECUTE) console.log(`Rode 'npm run recalc:scores' pra propagar nas features.`)
}

async function main() {
  const sb = createAdminClient()
  if (WITH_REVIEWS) { await runWithReviews(sb); return }
  if (VERIFY) { await runVerify(sb); return }
  if (FROM_CSV) { await runFromCsv(sb); return }
  const menu = await buildTagMenu(sb)
  console.log(
    `Menu: ${menu.count} tags | modo: ${EXECUTE ? "EXECUTE" : "DRY-RUN"} | limiar: ≤${THRESHOLD} tags | min-conf: ${MIN_CONF}`,
  )

  // contagem de tags por obra
  const tagCount = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("work_tags").select("work_id").range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) tagCount.set(r.work_id, (tagCount.get(r.work_id) ?? 0) + 1)
    if (!data || data.length < 1000) break
  }

  const { data: works, error } = await sb
    .from("works").select("id, title, canonical_synopsis").eq("is_archived", false)
  if (error) throw new Error(error.message)
  let targets = (works ?? []).filter(
    (w) => (tagCount.get(w.id) ?? 0) <= THRESHOLD && w.canonical_synopsis && String(w.canonical_synopsis).trim(),
  )
  targets.sort((a, b) => (tagCount.get(a.id) ?? 0) - (tagCount.get(b.id) ?? 0))
  if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT)
  console.log(`Obras alvo: ${targets.length}`)

  if (!EXECUTE) fs.writeFileSync(OUT, "work_id,title,current_tags,tag,confidence,evidence\n")
  if (REVERSAL && EXECUTE) fs.writeFileSync(REVERSAL, "")

  let proposed = 0, written = 0, withAny = 0, failed = 0
  const ran: string[] = [] // obras onde a inferência efetivamente rodou (p/ tags_inferred_at)
  for (const w of targets) {
    const before = tagCount.get(w.id) ?? 0
    let proposals
    try {
      proposals = await inferTagsFromText({ supabase: sb, synopsis: String(w.canonical_synopsis), menu })
    } catch (e) {
      failed++; console.log(`  ✗ "${w.title}": ${e instanceof Error ? e.message : String(e)}`); continue
    }
    if (proposals.length) withAny++
    proposed += proposals.length
    if (EXECUTE) ran.push(w.id) // rodou (mesmo que nada seja gravado abaixo)

    if (!EXECUTE) {
      for (const p of proposals) {
        fs.appendFileSync(OUT, [csv(w.id), csv(w.title), before, csv(p.name), p.confidence, csv(p.evidence)].join(",") + "\n")
      }
      console.log(`  ~ "${w.title}" (${before}) → ${proposals.length}: ${proposals.map((p) => p.name).join(", ")}`)
      continue
    }

    // EXECUTE: filtra por confiança, resolve ids e insere os que faltam
    const keep = proposals.filter((p) => p.confidence >= minConfNum)
    if (!keep.length) { console.log(`  · "${w.title}" — nada ≥ ${MIN_CONF}`); continue }
    const { ids } = await resolveOrCreateTags(sb, keep.map((p) => p.name))
    const confByName = new Map(keep.map((p) => [p.name.toLowerCase(), p.confidence]))
    const { data: cur } = await sb.from("work_tags").select("tag_id").eq("work_id", w.id)
    const existing = new Set((cur ?? []).map((r) => r.tag_id))
    const newIds = [...new Set(ids)].filter((id) => !existing.has(id))
    if (!newIds.length) { console.log(`  · "${w.title}" — nada novo`); continue }
    const { data: tagRows } = await sb.from("tags").select("id, name").in("id", newIds)
    const rows = (tagRows ?? []).map((t) => ({
      work_id: w.id, tag_id: t.id,
      source: "ai_inferred",
      confidence: confByName.get(t.name.toLowerCase()) ?? minConfNum,
    }))
    const { error: upErr } = await sb.from("work_tags").upsert(rows, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
    if (upErr) { failed++; console.log(`  ✗ "${w.title}" upsert: ${upErr.message}`); continue }
    if (REVERSAL) for (const r of rows) fs.appendFileSync(REVERSAL, JSON.stringify({ work_id: r.work_id, tag_id: r.tag_id }) + "\n")
    written += rows.length
    console.log(`  ✓ "${w.title}" ${before} → ${before + rows.length}  (+${rows.length})`)
  }

  if (EXECUTE && ran.length) {
    const { error: tsErr } = await sb.from("works").update({ tags_inferred_at: new Date().toISOString() }).in("id", ran)
    if (tsErr) console.log(`  ! falha ao marcar tags_inferred_at: ${tsErr.message}`)
    else console.log(`  · tags_inferred_at marcado em ${ran.length} obras`)
  }

  console.log(`\n=== ${EXECUTE ? "GRAVADO" : "DRY-RUN"} ===`)
  console.log(`obras: ${targets.length} | com proposta: ${withAny} | tags propostas: ${proposed} | ${EXECUTE ? `inseridas: ${written}` : `CSV: ${OUT}`} | falhas: ${failed}`)
  if (!EXECUTE) console.log(`Revise ${OUT}; depois rode com --execute --min-confidence=alta --reversal=<path> (migration 117 aplicada).`)
  else console.log(`Rode 'npm run recalc:scores' pra propagar nas features.`)
}

main()
  .then(async () => {
    // O6: uma passada de escrita mudou as tags → marca a base como recálculo pendente,
    // como faz o fluxo de create/update (markRecalcPending → RPC `touch_recalc_pending`).
    // markRecalcPending é server-only e não importa em script, então chamamos a RPC direto.
    // Só nos modos que GRAVAM (WITH_REVIEWS só gera CSV, não escreve tags). A Nota Prevista
    // recalcula no próximo auto-recalc em vez de depender do operador rodar `recalc:scores`.
    if (EXECUTE && !WITH_REVIEWS) {
      const sb = createAdminClient()
      const { error } = await sb.rpc("touch_recalc_pending")
      if (error) console.log(`! recalc_pending não marcado: ${error.message}`)
      else console.log(`· recalc_pending marcado — Nota Prevista recalcula no próximo auto-recalc.`)
    }
  })
  .catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : String(e)); process.exit(1) })
