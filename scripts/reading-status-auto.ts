/**
 * CLI — classificação AUTOMÁTICA do status de leitura do pilot-1 (Plano 3 Fase B2.2D,
 * nova decisão 2026-06-20). READ-ONLY: lê o snapshot base-1 (assinatura + 80 obras + split)
 * + `SELECT` em `personal_status` e `works`. Deriva `unread`/`partially_read`/`fully_read`
 * EXCLUSIVAMENTE de `works.personal_status_id`. NÃO escreve no banco, NÃO toca nos labels
 * contextuais, NÃO chama LLM, NÃO cria pilot-2, NÃO gera custo.
 *
 * Casca fina sobre `lib/synopsis-interest/reading-status-auto` (lógica pura/testada).
 *
 * PROTEÇÃO: aborta antes do banco se algum artefato de saída já existir, salvo `--force`.
 * Se houver status NÃO mapeado, para ANTES de gerar e lista os casos (decisão manual).
 *
 * Uso:
 *   npm run reading-status:auto
 *   npm run reading-status:auto -- --force
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import {
  buildAutoClassification,
  autoRowsToCsv,
  buildAutoManifest,
  guardAutoOutput,
  type BaseWorkLite,
  type DbWorkLite,
  type StatusLite,
} from "@/lib/synopsis-interest/reading-status-auto"

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
const force = args.force === "true"
const outDir = args["out-dir"] ? args["out-dir"] : OUT_DIR
const outCsv = resolve(outDir, "pilot-1-reading-status-auto.csv")
const outJson = resolve(outDir, "pilot-1-reading-status-auto.json")
const outManifest = resolve(outDir, "pilot-1-reading-status-auto-manifest.json")

async function main(): Promise<void> {
  // 1) Proteção contra sobrescrita — ANTES de qualquer acesso ao banco.
  const anyOutputExists = [outCsv, outJson, outManifest].some((p) => existsSync(p))
  const guard = guardAutoOutput({ anyOutputExists, force })
  if (!guard.allowed) {
    console.error(`⛔ ${guard.reason}`)
    console.error(`   saídas: ${outCsv}\n           ${outJson}\n           ${outManifest}`)
    process.exit(2)
  }

  // 2) snapshot base-1 (80 obras canônicas + split), assinatura verificada
  const snap = JSON.parse(readFileSync(resolve(BASE), "utf8")) as {
    snapshotBaseSignature: string
    works: Array<{ workId: string; title: string; split: "development" | "holdout" }>
  }
  if (!String(snap.snapshotBaseSignature ?? "").startsWith(EXPECTED_BASE_SIG_PREFIX)) {
    throw new Error(`assinatura base-1 inesperada (esperado ${EXPECTED_BASE_SIG_PREFIX}…): ${snap.snapshotBaseSignature}`)
  }
  const baseWorks: BaseWorkLite[] = snap.works.map((w) => ({ workId: w.workId, title: w.title, split: w.split }))
  const ids = baseWorks.map((w) => w.workId)

  // 3) SELECT read-only: tabela de status + works
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { data: statuses, error: e1 } = await sb.from("personal_status").select("id, status, slug")
  if (e1) throw e1
  const statusById = new Map<number, StatusLite>((statuses ?? []).map((s) => [s.id as number, s as StatusLite]))

  const { data: works, error: e2 } = await sb
    .from("works")
    .select("id, personal_status_id, chapters_read, total_chapters, last_read_at")
    .in("id", ids)
  if (e2) throw e2
  const dbByWorkId = new Map<string, DbWorkLite>((works ?? []).map((r) => [r.id as string, r as unknown as DbWorkLite]))

  // 4) derivar
  const c = buildAutoClassification({ baseWorks, dbByWorkId, statusById })

  // 5) status não mapeado → PARAR antes de gerar (não inventar)
  if (c.unmappedStatuses.length > 0) {
    console.error("⛔ status NÃO mapeado(s) — parando antes de gerar (decisão manual necessária):")
    for (const u of c.unmappedStatuses) console.error(`   id=${u.id} name=${JSON.stringify(u.name)} count=${u.count}`)
    process.exit(3)
  }
  if (c.structuralErrors.length > 0) {
    console.error("⛔ erros estruturais:\n - " + c.structuralErrors.join("\n - "))
    process.exit(4)
  }

  // 6) gerar CSV / JSON / manifesto
  const csv = autoRowsToCsv(c.rows)
  const json = JSON.stringify(
    {
      goldenVersion: "pilot-1",
      baseSnapshotVersion: "base-1",
      baseSnapshotSignature: snap.snapshotBaseSignature,
      source: "works.personal_status_id (Supabase personal_status)",
      rows: c.rows,
      counts: c.counts,
      confirmedUnread: c.confirmedUnread,
      retrospective: c.retrospective,
      newWorksNeeded: c.newWorksNeeded,
      splitCoverage: c.splitCoverage,
      statusMapping: c.statusMapping,
      inconsistencies: c.inconsistencies,
    },
    null,
    2,
  )
  const generatedAt = new Date().toISOString()
  const manifest = JSON.stringify(
    buildAutoManifest({ baseSnapshotSignature: snap.snapshotBaseSignature, generatedAt, classification: c }),
    null,
    2,
  )

  writeFileSync(outCsv, csv)
  writeFileSync(outJson, json + "\n")
  writeFileSync(outManifest, manifest + "\n")

  console.log("✅ classificação automática gerada:")
  console.log(`   ${outCsv}   sha256 ${sha256Hex(csv).slice(0, 16)}…`)
  console.log(`   ${outJson}  sha256 ${sha256Hex(json + "\n").slice(0, 16)}…`)
  console.log(`   ${outManifest}  sha256 ${sha256Hex(manifest + "\n").slice(0, 16)}…`)
  console.log("\n=== contagens (eixo de leitura — NÃO são labels) ===")
  console.log(`   unread=${c.counts.unread} · partially_read=${c.counts.partially_read} · fully_read=${c.counts.fully_read}`)
  console.log(`   confirmed_unread=${c.confirmedUnread} · retrospective=${c.retrospective} · new_works_needed=${c.newWorksNeeded}`)
  console.log("   cobertura por split:", JSON.stringify(c.splitCoverage))
  console.log(`   inconsistências diagnósticas: ${c.inconsistencies.length}`)
  for (const i of c.inconsistencies) console.log(`     - ${i.title} [${i.status}] → ${i.flags.join(", ")}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
