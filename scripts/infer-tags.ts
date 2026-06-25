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
import { buildTagMenu, inferTagsFromText } from "@/lib/tags/infer-from-text"
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
  for (const [workId, w] of byWork) {
    if (!EXECUTE) { console.log(`  ~ "${w.title}" (${w.before}) → +${w.tags.length}: ${w.tags.map((t) => t.name).join(", ")}`); continue }
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
  console.log(`\n=== ${EXECUTE ? "GRAVADO" : "PREVIEW"} (from-csv) ===`)
  console.log(`obras: ${byWork.size} | inseridas: ${written} | falhas: ${failed}`)
  if (EXECUTE) console.log(`Rode 'npm run recalc:scores' pra propagar nas features.`)
}

async function main() {
  const sb = createAdminClient()
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

  console.log(`\n=== ${EXECUTE ? "GRAVADO" : "DRY-RUN"} ===`)
  console.log(`obras: ${targets.length} | com proposta: ${withAny} | tags propostas: ${proposed} | ${EXECUTE ? `inseridas: ${written}` : `CSV: ${OUT}`} | falhas: ${failed}`)
  if (!EXECUTE) console.log(`Revise ${OUT}; depois rode com --execute --min-confidence=alta --reversal=<path> (migration 117 aplicada).`)
  else console.log(`Rode 'npm run recalc:scores' pra propagar nas features.`)
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : String(e)); process.exit(1) })
