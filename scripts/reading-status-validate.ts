/**
 * ⚠️ SUPERSEDED (2026-06-20) — NÃO é gate do pilot-2. A classificação de leitura passou a ser
 * AUTOMÁTICA via `npm run reading-status:auto`. Este validador do fluxo MANUAL fica preservado
 * como ferramenta histórica.
 *
 * CLI — valida o CSV de classificação de status de leitura do pilot-1 (Plano 3 Fase
 * B2.2D, Parte C). READ-ONLY: lê o CSV preenchido + o snapshot base-1 (assinatura, os
 * 80 work_ids canônicos e o split). NUNCA lê os labels contextuais. NÃO escreve no
 * banco, NÃO chama LLM, NÃO calcula métricas/concordância/distribuição de labels.
 *
 * Dois modos:
 *   --mode=structural  (default) — pode rodar com o formulário incompleto
 *   --mode=complete    — exige 80/80 preenchidos e 0 'uncertain' p/ liberar o pilot-2
 *
 * Gera um manifesto JSON local (sem labels). Casca fina sobre
 * `lib/synopsis-interest/reading-status-audit` (lógica pura/testada).
 *
 * Uso:
 *   npm run reading-status:validate -- --input=<csv> --mode=structural|complete
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import {
  parseReadingStatusCsv,
  validateReadingStatusAudit,
  computeUnreadSplitCoverage,
  buildAuditManifest,
  type ValidationMode,
} from "@/lib/synopsis-interest/reading-status-audit"

const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex")

const BASE = ".local-experiments/plan3/digest-exp-1/base-1/golden-snapshot-base.json"
const OUT_DIR = ".local-experiments/plan3/digest-exp-1/pilot-1-audit"
const EXPECTED_BASE_SIG_PREFIX = "634571c2"

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"]
  }),
) as Record<string, string>

const input = String(args.input ?? `${OUT_DIR}/pilot-1-reading-status-filled.csv`)
const mode: ValidationMode = args.mode === "complete" ? "complete" : "structural"
const manifestOut = String(args["manifest-out"] ?? `${OUT_DIR}/pilot-1-reading-status-manifest.json`)

if (!existsSync(resolve(input))) {
  console.error(`CSV não encontrado: ${input}`)
  console.error("Preencha o formulário e exporte primeiro (npm run reading-status:form → abrir o HTML → Exportar CSV).")
  process.exit(2)
}

interface BaseWork {
  workId: string
  split: "development" | "holdout"
}
const snap = JSON.parse(readFileSync(resolve(BASE), "utf8")) as { snapshotBaseSignature: string; works: BaseWork[] }
if (!String(snap.snapshotBaseSignature ?? "").startsWith(EXPECTED_BASE_SIG_PREFIX)) {
  console.error(`assinatura base-1 inesperada (esperado ${EXPECTED_BASE_SIG_PREFIX}…): ${snap.snapshotBaseSignature}`)
  process.exit(2)
}
const canonicalWorkIds = snap.works.map((w) => w.workId)
const splitByWorkId = new Map<string, "development" | "holdout">(snap.works.map((w) => [w.workId, w.split]))

const csvText = readFileSync(resolve(input), "utf8")
const worksheetSha256 = sha256Hex(csvText)
const parsed = parseReadingStatusCsv(csvText)
for (const e of parsed.parseErrors) console.error("parse:", e)

const validation = validateReadingStatusAudit(parsed.records, { canonicalWorkIds, mode })
const coverage = computeUnreadSplitCoverage(parsed.records, splitByWorkId)

console.log(`\n=== Validação (${mode}) — ${input} ===`)
console.log(`worksheet sha256: ${worksheetSha256.slice(0, 16)}…`)
console.log(`structuralOk=${validation.structuralOk} · completeOk=${validation.completeOk} · validForPilot2Planning=${validation.validForPilot2Planning}`)
if (validation.errors.length) console.log("ERROS:\n - " + validation.errors.join("\n - "))
if (validation.warnings.length) console.log("AVISOS:\n - " + validation.warnings.join("\n - "))
console.log("contagens (eixo de leitura, NÃO são labels):", validation.counts)
if (validation.derived) {
  const d = validation.derived
  console.log(`confirmed_unread=${d.confirmedUnread} · retrospective=${d.retrospective} · uncertain=${d.uncertain} · new_works_needed=${d.newWorksNeeded}`)
  console.log("cobertura dev/holdout das não-lidas (planejamento):", coverage)
}

const validatedAt = new Date().toISOString()
const manifest = buildAuditManifest({
  baseSnapshotSignature: snap.snapshotBaseSignature,
  worksheetSha256,
  validatedAt,
  validation,
  unreadCoverage: coverage,
})
writeFileSync(resolve(manifestOut), JSON.stringify(manifest, null, 2) + "\n")
console.log(`manifesto: ${manifestOut}`)

process.exit(validation.ok ? 0 : 1)
