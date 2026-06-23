/**
 * CLI — GATE de ESTABILIDADE do corpus (Plano 3 Fase B2.2S). READ-ONLY no banco (SELECT via
 * loaders canônicos). NÃO chama LLM, NÃO escreve nada, NÃO gera plano/custo. Após pausar os
 * escritores, lê o corpus das 90 obras TRÊS vezes (com intervalo curto e LIMITADO, em-processo)
 * e confirma que NÃO há mais escrita acontecendo: estável só se as 3 leituras forem idênticas em
 *   - conjunto dos 90 work_ids,
 *   - contagem útil por obra,
 *   - reviewCorpusSignature por obra,
 *   - digestSelectionSignature por obra,
 *   - assinaturas agregadas.
 *
 * exit 0 = ESTÁVEL (3 leituras idênticas). exit 1 = INSTÁVEL (escritor ainda ativo) — reporta o
 * que mudou. Tentativas FIXAS (3), sem loop indefinido.
 *
 * Uso: npm run pilot2:corpus-stability
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { readCanonicalReviewCorpus } from "@/lib/synopsis-interest/digest-corpus"
import { REVIEW_CORPUS_POLICY_VERSION, compareCanonicalText } from "@/lib/synopsis-interest/canonical-review-corpus"
import {
  computeReviewCorpusAggregateSignature,
  computeDigestSelectionAggregateSignature,
} from "@/lib/synopsis-interest/base2r1"

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2"
const BASE2 = resolve(DIR, "base-2-snapshot.json")
const READS = 3
const GAP_MS = 5000 // intervalo curto e LIMITADO entre leituras (em-processo, não shell sleep)

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})
const sha = (o: unknown): string => createHash("sha256").update(JSON.stringify(o)).digest("hex")
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface PerWork { workId: string; usefulCount: number; reviewCorpusSignature: string; digestSelectionSignature: string }
interface Read {
  workIdsHash: string
  perWork: PerWork[]
  reviewCorpusAggregateSignature: string
  digestSelectionAggregateSignature: string
  totalUseful: number
  readSignature: string
}

async function readOnce(workIds: string[]): Promise<Read> {
  const perWork: PerWork[] = await Promise.all(
    workIds.map(async (workId) => {
      const c = await readCanonicalReviewCorpus(workId, sb)
      return { workId, usefulCount: c.usefulReviewCount, reviewCorpusSignature: c.reviewCorpusSignature, digestSelectionSignature: c.digestSelectionSignature }
    }),
  )
  perWork.sort((a, b) => compareCanonicalText(a.workId, b.workId))
  const reviewCorpusAggregateSignature = computeReviewCorpusAggregateSignature(REVIEW_CORPUS_POLICY_VERSION, perWork)
  const digestSelectionAggregateSignature = computeDigestSelectionAggregateSignature(REVIEW_CORPUS_POLICY_VERSION, perWork)
  const workIdsHash = sha([...workIds].sort(compareCanonicalText))
  const totalUseful = perWork.reduce((n, w) => n + w.usefulCount, 0)
  const readSignature = sha({
    workIdsHash,
    perWork: perWork.map((w) => [w.workId, w.usefulCount, w.reviewCorpusSignature, w.digestSelectionSignature]),
    reviewCorpusAggregateSignature,
    digestSelectionAggregateSignature,
  })
  return { workIdsHash, perWork, reviewCorpusAggregateSignature, digestSelectionAggregateSignature, totalUseful, readSignature }
}

/** Diferenças entre duas leituras (campo a campo) — para reportar qual escritor segue ativo. */
function diffReads(a: Read, b: Read): string[] {
  const out: string[] = []
  if (a.workIdsHash !== b.workIdsHash) out.push("conjunto de work_ids mudou")
  const am = new Map(a.perWork.map((w) => [w.workId, w]))
  for (const wb of b.perWork) {
    const wa = am.get(wb.workId)
    if (!wa) { out.push(`${wb.workId}: ausente na leitura anterior`); continue }
    if (wa.usefulCount !== wb.usefulCount) out.push(`${wb.workId}: usefulCount ${wa.usefulCount}→${wb.usefulCount}`)
    else if (wa.reviewCorpusSignature !== wb.reviewCorpusSignature) out.push(`${wb.workId}: reviewCorpusSignature mudou (mesmo count)`)
    else if (wa.digestSelectionSignature !== wb.digestSelectionSignature) out.push(`${wb.workId}: digestSelectionSignature mudou`)
  }
  if (a.reviewCorpusAggregateSignature !== b.reviewCorpusAggregateSignature) out.push("reviewCorpusAggregateSignature mudou")
  if (a.digestSelectionAggregateSignature !== b.digestSelectionAggregateSignature) out.push("digestSelectionAggregateSignature mudou")
  return out
}

async function main(): Promise<void> {
  const base2 = JSON.parse(readFileSync(BASE2, "utf8")) as { works: Array<{ workId: string }> }
  const workIds = base2.works.map((w) => w.workId)

  const reads: Read[] = []
  for (let i = 0; i < READS; i++) {
    if (i > 0) await delay(GAP_MS)
    const r = await readOnce(workIds)
    reads.push(r)
    console.log(`leitura ${i + 1}/${READS}: readSignature=${r.readSignature.slice(0, 16)}…  totalUseful=${r.totalUseful}  reviewCorpusAggregate=${r.reviewCorpusAggregateSignature.slice(0, 12)}…  digestSelectionAggregate=${r.digestSelectionAggregateSignature.slice(0, 12)}…`)
  }

  const stable = reads.every((r) => r.readSignature === reads[0].readSignature)
  console.log("\n=== GATE estabilidade do corpus (read-only DB, $0) ===")
  console.log(`obras: ${workIds.length}  leituras: ${READS}  intervalo: ${GAP_MS}ms`)
  console.log(`ESTÁVEL: ${stable ? "SIM ✅" : "NÃO ⛔"}`)

  if (!stable) {
    for (let i = 1; i < reads.length; i++) {
      const d = diffReads(reads[i - 1], reads[i])
      if (d.length) { console.error(`⛔ leitura ${i}→${i + 1} divergiu:`); for (const x of d.slice(0, 20)) console.error("   - " + x) }
    }
    console.error("⛔ INSTÁVEL — um escritor de reviews ainda está ativo. NÃO regenerar.")
    process.exit(1)
  }

  console.log(`reviewCorpusAggregateSignature: ${reads[0].reviewCorpusAggregateSignature}`)
  console.log(`digestSelectionAggregateSignature: ${reads[0].digestSelectionAggregateSignature}`)
  console.log(`totalUseful (90 obras): ${reads[0].totalUseful}`)
  console.log("✅ Corpus ESTÁVEL nas 3 leituras — seguro regenerar o base-2r1.")
}

main().catch((e) => { console.error("[corpus-stability] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
