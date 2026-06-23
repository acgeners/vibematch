/**
 * CLI — CONSOLIDAÇÃO LOCAL das labels do pacote contextual-2 (Plano 3 Fase B2.2V). PURO/LOCAL:
 * sem banco, sem rede, sem LLM, sem candidatos/métricas/predictions/ranking. NÃO regenera o pacote
 * (HTML/CSV/blindKeyMap intactos). Faz: (1) backup IMUTÁVEL do CSV preenchido + SHA-256; (2) importa
 * via blindKeyMap; (3) analisa os 10 repeats (preserva as 2 respostas, NÃO autocorrige); (4) consolida
 * 89 do pacote + 1 carryover reuse_eligible (label do pilot-1) = 90 finais; (5) assinaturas.
 *
 * Uso: npm run pilot2:consolidate-labels
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, copyFileSync, chmodSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

const ROOT = ".local-experiments/plan3/digest-exp-1"
const CTX = resolve(ROOT, "pilot-2", "contextual-2")
const CSV = resolve(CTX, "pilot-2-labels-template.csv")
const MANIFEST = resolve(CTX, "manifest.json")
const REUSE_PLAN = resolve(CTX, "label-reuse-plan.json")
const OUT = resolve(CTX, "consolidated")
const PILOT1_LABELS = resolve(ROOT, "enriched-1", "golden-contextual-labels-working.csv")
const PILOT1_SAMPLE = resolve("lib/synopsis-interest/golden-sample.pilot-1.json")

const VALID = new Set(["♥", "♥♥", "♥♥♥", "♥♥♥♥"])
const level = (lbl: string): number => [...lbl].length // nº de ♥ (todos validados ∈ VALID)
const sha = (o: unknown): string => createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex")
const shaFile = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex")
const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"
const die = (m: string): never => { console.error("⛔ " + m); process.exit(1) }
const writeAtomic = (p: string, c: string): void => { const t = `${p}.tmp`; writeFileSync(t, c); renameSync(t, p) }

/** Parser robusto: separador `;` OU `,`, tolera CRLF e linha final sem \n. */
function parseCsv(raw: string): Array<{ key: string; label: string }> {
  return raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(1)
    .map((l) => { const i = l.search(/[;,]/); const key = (i < 0 ? l : l.slice(0, i)).trim(); const label = (i < 0 ? "" : l.slice(i + 1)).trim(); return { key, label } })
}

interface BlindEntry { blindKey: string; pilot2SlotKey: string; workId: string; origin: string; isRepeat: boolean; repeatOf: string | null; split: string; stratum: string }

function main(): void {
  if (!existsSync(CSV)) die(`CSV ausente: ${CSV}`)
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { blindKeyMap: BlindEntry[]; contextualPackageSignature: string; enrichedSnapshotSignature: string }
  const reusePlan = JSON.parse(readFileSync(REUSE_PLAN, "utf8")) as { reuse_eligible: string[]; labelReusePlanSignature: string }
  const blindMap = manifest.blindKeyMap
  const byBlind = new Map(blindMap.map((b) => [b.blindKey, b]))
  const csvRaw = readFileSync(CSV, "utf8")
  const rows = parseCsv(csvRaw)
  const labelOf = new Map(rows.map((r) => [r.key, r.label]))

  // ── 1. BACKUP imutável + SHA-256 (sem tocar no original) ──
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const backupDir = resolve(CTX, `labels-backup-${ts}`)
  mkdirSync(backupDir, { recursive: true })
  const backupCsv = resolve(backupDir, "pilot-2-labels-template.filled.csv")
  copyFileSync(CSV, backupCsv)
  const csvSha = shaFile(CSV)
  chmodSync(backupCsv, 0o444)
  writeFileSync(resolve(backupDir, "BACKUP.md"), `# Backup imutável — labels contextual-2\nfonte: ${CSV}\ncriado: ${ts}\nsha256: ${csvSha}\nlinhas (com header): ${csvRaw.replace(/\r/g, "").split("\n").filter(Boolean).length}\nNÃO editar. Cópia read-only (chmod 444).\n`)
  chmodSync(resolve(backupDir, "BACKUP.md"), 0o444)

  // ── 2. IMPORT + VALIDAÇÃO ──
  const errs: string[] = []
  if (rows.length !== 99) errs.push(`linhas de dados ${rows.length} ≠ 99`)
  const csvKeys = rows.map((r) => r.key)
  if (new Set(csvKeys).size !== csvKeys.length) errs.push("chaves duplicadas no CSV")
  for (const b of blindMap) if (!labelOf.has(b.blindKey)) errs.push(`slot ausente no CSV: ${b.blindKey}`)
  for (const k of csvKeys) if (!byBlind.has(k)) errs.push(`chave do CSV fora do blindKeyMap: ${k}`)
  for (const r of rows) if (!VALID.has(r.label)) errs.push(`label inválida em ${r.key}: "${r.label}"`)
  const primaries = blindMap.filter((b) => !b.isRepeat)
  const repeats = blindMap.filter((b) => b.isRepeat)
  if (primaries.length !== 89) errs.push(`primary ${primaries.length} ≠ 89`)
  if (repeats.length !== 10) errs.push(`repeats ${repeats.length} ≠ 10`)
  if (errs.length) { for (const e of errs.slice(0, 20)) console.error("  ⛔ " + e); die("VALIDAÇÃO FALHOU") }

  // raw labels (todos os 99 slots, com proveniência do blindKeyMap)
  const rawLabels = blindMap.map((b) => ({ blindKey: b.blindKey, pilot2SlotKey: b.pilot2SlotKey, workId: b.workId, origin: b.origin, isRepeat: b.isRepeat, repeatOf: b.repeatOf, split: b.split, stratum: b.stratum, label: labelOf.get(b.blindKey)! }))
    .sort((a, b) => (a.blindKey < b.blindKey ? -1 : 1))

  // ── 3. REPEATS (10 pares) — preserva as 2 respostas, NÃO autocorrige ──
  const byPilot2Slot = new Map(blindMap.map((b) => [b.pilot2SlotKey, b]))
  const repeatPairs = repeats.map((rep) => {
    const orig = byPilot2Slot.get(rep.repeatOf!)
    if (!orig) die(`repeat ${rep.pilot2SlotKey}: original ${rep.repeatOf} não encontrado`)
    if (orig!.workId !== rep.workId) die(`repeat ${rep.pilot2SlotKey}: workId ≠ do original`)
    const repeatLabel = labelOf.get(rep.blindKey)!
    const primaryLabel = labelOf.get(orig!.blindKey)!
    const diff = Math.abs(level(repeatLabel) - level(primaryLabel))
    return { workId: rep.workId, originalSlot: rep.repeatOf, repeatBlindKey: rep.blindKey, primaryBlindKey: orig!.blindKey, primaryLabel, repeatLabel, levelDiff: diff }
  }).sort((a, b) => (a.workId < b.workId ? -1 : 1))
  const diffs = repeatPairs.map((p) => p.levelDiff)
  const repeatsSummary = {
    pairs: repeatPairs.length,
    exact: diffs.filter((d) => d === 0).length,
    within1: diffs.filter((d) => d <= 1).length,
    diffOf1: diffs.filter((d) => d === 1).length,
    meanAbsDiff: Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 1000) / 1000,
    maxDiff: Math.max(...diffs),
  }

  // ── 4. LABEL REAPROVEITADA (1 carryover reuse_eligible — label do pilot-1, leitura NARROW) ──
  if (reusePlan.reuse_eligible.length !== 1) die(`reuse_eligible ${reusePlan.reuse_eligible.length} ≠ 1`)
  const reuseWorkId = reusePlan.reuse_eligible[0]
  const p1sample = JSON.parse(readFileSync(PILOT1_SAMPLE, "utf8")) as { slots: Array<{ slotKey: string; workId: string; isRepeat: boolean }> }
  const p1rows = parseCsv(readFileSync(PILOT1_LABELS, "utf8"))
  const p1label = new Map(p1rows.map((r) => [r.key, r.label]))
  const p1slots = p1sample.slots.filter((s) => s.workId === reuseWorkId)
  if (p1slots.length === 0) die(`reuse ${reuseWorkId}: ausente no golden pilot-1`)
  const p1primary = p1slots.find((s) => !s.isRepeat) ?? p1slots[0]
  const reusedLabel = p1label.get(p1primary.slotKey)
  if (!reusedLabel || !VALID.has(reusedLabel)) die(`reuse ${reuseWorkId}: label do pilot-1 ausente/inválida (slot ${p1primary.slotKey})`)
  const reused = { workId: reuseWorkId, pilot1SlotKey: p1primary.slotKey, label: reusedLabel, source: "pilot-1-reused" as const }

  // ── 5. LABELS FINAIS (89 do pacote + 1 reuse = 90) ──
  const finalFromPackage = primaries.map((b) => ({ workId: b.workId, label: labelOf.get(b.blindKey)!, source: "pilot-2" as const, split: b.split, stratum: b.stratum, origin: b.origin }))
  const finalWorkIds = new Set(finalFromPackage.map((f) => f.workId))
  if (finalWorkIds.size !== 89) die(`workIds primary distintos ${finalWorkIds.size} ≠ 89`)
  if (finalWorkIds.has(reuseWorkId)) die(`reuse ${reuseWorkId} já está no pacote (não deveria)`)
  const finalLabels = [...finalFromPackage, { workId: reused.workId, label: reused.label, source: reused.source, split: null as string | null, stratum: null as string | null, origin: "carryover" as string }]
    .sort((a, b) => (a.workId < b.workId ? -1 : 1))
  if (finalLabels.length !== 90) die(`labels finais ${finalLabels.length} ≠ 90`)
  if (new Set(finalLabels.map((f) => f.workId)).size !== 90) die("workIds finais não-distintos")

  const dist: Record<string, number> = { "♥": 0, "♥♥": 0, "♥♥♥": 0, "♥♥♥♥": 0 }
  for (const f of finalLabels) { if (f.label) dist[f.label] = (dist[f.label] ?? 0) + 1 }

  // ── 6. ASSINATURAS (sem timestamps) ──
  const rawLabelsSignature = sha({ kind: "raw-labels", items: rawLabels.map((r) => [r.blindKey, r.workId, r.label]) })
  const repeatsSignature = sha({ kind: "repeats", pairs: repeatPairs.map((p) => [p.workId, p.primaryLabel, p.repeatLabel]), summary: repeatsSummary })
  const finalLabelsSignature = sha({ kind: "final-labels", items: finalLabels.map((f) => [f.workId, f.label, f.source]) })
  const consolidationSignature = sha({
    kind: "label-consolidation-v1",
    base2r1Signature: "b9dc2f2751af6ae738d79801d46f4aedd72c45e330a60bd49194c979233436a6",
    contextualPackageSignature: manifest.contextualPackageSignature,
    labelReusePlanSignature: reusePlan.labelReusePlanSignature,
    rawLabelsSignature, repeatsSignature, finalLabelsSignature, csvSha,
  })

  // ── escrita atômica dos artefatos (NÃO toca o pacote) ──
  mkdirSync(OUT, { recursive: true })
  const capturedAt = new Date().toISOString()
  writeAtomic(resolve(OUT, "raw-labels.json"), stringify({ kind: "contextual-2-raw-labels", capturedAt, count: rawLabels.length, rawLabelsSignature, csvSha, items: rawLabels }))
  writeAtomic(resolve(OUT, "repeats.json"), stringify({ kind: "contextual-2-repeats", capturedAt, repeatsSignature, summary: repeatsSummary, pairs: repeatPairs }))
  writeAtomic(resolve(OUT, "reused-label.json"), stringify({ kind: "contextual-2-reused-label", capturedAt, labelReusePlanSignature: reusePlan.labelReusePlanSignature, reused, note: "Leitura NARROW: só o label do pilot-1 desta 1 obra reuse_eligible (embargo respeitado nos demais)." }))
  writeAtomic(resolve(OUT, "final-labels.json"), stringify({ kind: "contextual-2-final-labels", capturedAt, count: finalLabels.length, fromPackage: 89, reused: 1, finalLabelsSignature, distribution: dist, labels: finalLabels }))
  writeAtomic(resolve(OUT, "manifest.json"), stringify({
    kind: "contextual-2-consolidation-manifest", capturedAt,
    consolidationSignature, rawLabelsSignature, repeatsSignature, finalLabelsSignature,
    contextualPackageSignature: manifest.contextualPackageSignature, enrichedSnapshotSignature: manifest.enrichedSnapshotSignature, labelReusePlanSignature: reusePlan.labelReusePlanSignature,
    counts: { csvRows: rows.length, primary: primaries.length, repeats: repeats.length, finalLabels: finalLabels.length, fromPackage: 89, reused: 1 },
    distribution: dist, repeatsSummary,
    backup: { dir: backupDir.replace(process.cwd() + "/", ""), file: "pilot-2-labels-template.filled.csv", sha256: csvSha, readOnly: true },
    note: "Consolidação LOCAL. 0 banco/LLM/candidatos/métricas/predictions. Pacote contextual-2 intocado.",
  }))

  // ── relatório ──
  console.log("=== consolidação labels contextual-2 (local, $0) ===")
  console.log(`BACKUP: ${backupDir.replace(process.cwd() + "/", "")}/pilot-2-labels-template.filled.csv  (read-only)`)
  console.log(`  csvSha256: ${csvSha}`)
  console.log(`IMPORT: ${rows.length}/99 slots | primary ${primaries.length} | repeats ${repeats.length} | inválidos 0 | duplicados 0 | ausentes 0 ✅`)
  console.log(`REPEATS (10 pares): exatos=${repeatsSummary.exact} | ±1 nível=${repeatsSummary.within1} (sendo ${repeatsSummary.diffOf1} de diff 1) | diff médio abs=${repeatsSummary.meanAbsDiff} | diff máx=${repeatsSummary.maxDiff}`)
  console.log(`REUSE: ${reuseWorkId.slice(0, 8)} ← pilot-1 slot ${reused.pilot1SlotKey} = ${reused.label}`)
  console.log(`FINAIS: ${finalLabels.length} (89 pacote + 1 reuse) | distribuição ${JSON.stringify(dist)}`)
  console.log(`assinaturas: final=${finalLabelsSignature.slice(0, 16)} raw=${rawLabelsSignature.slice(0, 16)} repeats=${repeatsSignature.slice(0, 16)} consolidation=${consolidationSignature.slice(0, 16)}`)
  console.log(`artefatos: ${OUT.replace(process.cwd() + "/", "")}/`)
  console.log(`0 banco/LLM/candidatos/métricas/predictions/commit. Pacote/CSV originais intocados.`)
}

main()
