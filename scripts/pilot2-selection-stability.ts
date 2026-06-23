/**
 * CLI — GATE de estabilidade da seleção cap40 sob a troca de comparador (Plano 3 Fase B2.2R).
 * READ-ONLY no banco (só SELECT via loaders canônicos). NÃO chama LLM, NÃO gera plano/custo, NÃO
 * escreve digests. Mede, por obra, se a troca de `localeCompare` (locale/ICU-dependente) pelo
 * comparador code-unit (`compareCanonicalText`) muda:
 *   - a ORDEM das ≤cap selecionadas (permitido — só reordena), e
 *   - o CONJUNTO das ≤cap selecionadas (BLOQUEANTE — só possível em obras acima do cap).
 *
 * O conjunto de textos normalizados deduplicados é extraído de forma ORDEM-INDEPENDENTE (Set), e
 * o top-cap é recomputado AQUI sob os dois comparadores — então o resultado independe de qual
 * comparador o código de produção usa no momento (robusto à ordem das edições).
 *
 * exit 0  → só ordem muda (ou nada muda): seguro trocar o comparador.
 * exit 1  → SELECTION_SET_CHANGED: algum conjunto cap40 mudou ⇒ PARAR (não trocar/regerar).
 *
 * Uso: npm run pilot2:selection-stability
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import {
  readScrapedExternalReviews,
  readManuallyEnteredExternalReviews,
} from "@/lib/synopsis-interest/digest-corpus"
import {
  buildCanonicalReviewCorpus,
  normalizeReviewText,
  computeNormalizedTextHash,
  compareCanonicalText,
  CANONICAL_REVIEW_CAP,
} from "@/lib/synopsis-interest/canonical-review-corpus"

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2"
const BASE2 = resolve(DIR, "base-2-snapshot.json")
const OUT = resolve(DIR, "base-2r1")
const OLD_SNAP = resolve(OUT, "base-2r1-snapshot.json")
const DRIFT_WORK_ID = "889a02ce-f50a-44c5-9c44-e4b2b70b44cd" // The Sword-Bearing Flower (1→35; sob cap)

/**
 * Mudanças de CONJUNTO cap40 EXPLICITAMENTE autorizadas pela usuária (decisão (a), 2026-06-21):
 * trocar localeCompare→code-unit aceitando que estas 3 obras over-cap troquem reviews na fronteira
 * do top-40. NÃO bloquear por elas. Bloquear se QUALQUER outra obra mudar de conjunto.
 */
const HUMAN_ACCEPTED_SET_CHANGES: Record<string, string> = {
  "4e5c14ac-7260-477f-afb1-504a30f72d51": "Miss Not-So Sidekick (66; Δ2/2)",
  "4690c262-c1f6-4622-982e-eb9c56e8ed02": "The Villainess Is a Marionette (61; Δ1/1)",
  "1d2c5b07-407e-472e-a970-f69209f5cfc7": "It Was All a Mistake (45; Δ1/1)",
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

/** Comparador ANTIGO — replica exatamente `String.prototype.localeCompare` (locale/ICU default). */
const oldLocale = (a: string, b: string): number => a.localeCompare(b)

interface WorkStability {
  workId: string
  title: string
  usefulDeduped: number
  overCap: boolean
  orderChanged: boolean
  setChanged: boolean
  /** Conjunto COMPLETO (ordem-independente) de hashes normalizados úteis — para o gate de drift. */
  fullHashes: string[]
  /** Detalhe da diferença simétrica do conjunto cap40 (só quando setChanged). */
  setDiff?: {
    droppedCount: number // saíram do top-40 sob code-unit (estavam sob localeCompare)
    addedCount: number // entraram no top-40 sob code-unit
    droppedPrefixes: string[] // prefixos (60 chars) dos textos normalizados que saíram
    addedPrefixes: string[] // prefixos (60 chars) dos textos normalizados que entraram
  }
}

const PREFIX = (s: string): string => s.slice(0, 60).replace(/\n/g, "·")

async function main(): Promise<void> {
  const base2 = JSON.parse(readFileSync(BASE2, "utf8")) as { works: Array<{ workId: string; title: string }> }

  const rows: WorkStability[] = await Promise.all(
    base2.works.map(async (w): Promise<WorkStability> => {
      const [scraped, manual] = await Promise.all([
        readScrapedExternalReviews(w.workId, sb),
        readManuallyEnteredExternalReviews(w.workId, sb),
      ])
      // dedup + filtro de utilidade pela MESMA lógica de produção; só extraímos o conjunto.
      const corpus = buildCanonicalReviewCorpus([...scraped, ...manual])
      const norms = [...new Set(corpus.reviews.map((r) => normalizeReviewText(r.text)))]

      const oldTop = [...norms].sort(oldLocale).slice(0, CANONICAL_REVIEW_CAP)
      const newTop = [...norms].sort(compareCanonicalText).slice(0, CANONICAL_REVIEW_CAP)

      const orderChanged = JSON.stringify(oldTop) !== JSON.stringify(newTop)
      const oldSet = new Set(oldTop)
      const newSet = new Set(newTop)
      const dropped = oldTop.filter((t) => !newSet.has(t)) // saíram do top-40 sob code-unit
      const added = newTop.filter((t) => !oldSet.has(t)) // entraram no top-40 sob code-unit
      const setChanged = dropped.length > 0 || added.length > 0

      return {
        workId: w.workId,
        title: w.title,
        usefulDeduped: norms.length,
        overCap: norms.length > CANONICAL_REVIEW_CAP,
        orderChanged,
        setChanged,
        fullHashes: [...new Set(norms.map((t) => computeNormalizedTextHash(t)))].sort(compareCanonicalText),
        setDiff: setChanged
          ? { droppedCount: dropped.length, addedCount: added.length, droppedPrefixes: dropped.map(PREFIX), addedPrefixes: added.map(PREFIX) }
          : undefined,
      }
    }),
  )

  const orderChangedWorks = rows.filter((r) => r.orderChanged)
  const setChangedWorks = rows.filter((r) => r.setChanged)
  const unauthorizedSetChanges = setChangedWorks.filter((r) => !HUMAN_ACCEPTED_SET_CHANGES[r.workId])
  const overCapWorks = rows.filter((r) => r.overCap)

  // ── Gate de DRIFT de corpus (§8): comparação contra o base-2r1 ANTERIOR ──────────────────────
  // Para obras SOB o cap no snapshot antigo, `digestSelectionNormalizedHashes` = conjunto COMPLETO
  // (comparação de CONTEÚDO exata). Para obras ACIMA do cap no antigo, os hashes gravados são só o
  // top-40 → comparamos por CONTAGEM (não dá pra provar conteúdo a partir do artefato truncado).
  interface OldWork { workId: string; reviewsAfterDedupe: number; digestSelectionNormalizedHashes: string[] }
  const oldSnap = existsSync(OLD_SNAP)
    ? (JSON.parse(readFileSync(OLD_SNAP, "utf8")) as { works: OldWork[] })
    : { works: [] as OldWork[] }
  const oldById = new Map(oldSnap.works.map((w) => [w.workId, w]))
  type DriftKind = "identical" | "content_changed" | "count_changed" | "count_only_compare" | "missing_in_old"
  const drift = rows.map((r) => {
    const old = oldById.get(r.workId)
    if (!old) return { workId: r.workId, title: r.title, kind: "missing_in_old" as DriftKind, oldN: null as number | null, newN: r.usefulDeduped }
    const oldUnderCap = old.reviewsAfterDedupe <= CANONICAL_REVIEW_CAP
    const newUnderCap = r.usefulDeduped <= CANONICAL_REVIEW_CAP
    let kind: DriftKind
    if (oldUnderCap && newUnderCap) {
      const oldSet = new Set(old.digestSelectionNormalizedHashes)
      const same = oldSet.size === r.fullHashes.length && r.fullHashes.every((h) => oldSet.has(h))
      kind = same ? "identical" : "content_changed"
    } else {
      kind = old.reviewsAfterDedupe === r.usefulDeduped ? "count_only_compare" : "count_changed"
    }
    return { workId: r.workId, title: r.title, kind, oldN: old.reviewsAfterDedupe, newN: r.usefulDeduped }
  })
  const drifted = drift.filter((d) => d.kind === "content_changed" || d.kind === "count_changed")
  const additionalDrift = drifted.filter((d) => d.workId !== DRIFT_WORK_ID)
  const driftWorkSeen = drift.find((d) => d.workId === DRIFT_WORK_ID)

  // Artefato de auditoria (local, $0).
  const report = {
    kind: "selection-cap40-stability",
    comparatorOld: "String.prototype.localeCompare (locale/ICU default)",
    comparatorNew: "compareCanonicalText (UTF-16 code-unit)",
    cap: CANONICAL_REVIEW_CAP,
    totals: {
      works: rows.length,
      overCap: overCapWorks.length,
      orderChanged: orderChangedWorks.length,
      setChanged: setChangedWorks.length,
    },
    driftWorkId: DRIFT_WORK_ID,
    overCap: overCapWorks
      .map((r) => ({ workId: r.workId, title: r.title, usefulDeduped: r.usefulDeduped, orderChanged: r.orderChanged, setChanged: r.setChanged }))
      .sort((a, b) => compareCanonicalText(a.workId, b.workId)),
    orderChangedWorkIds: orderChangedWorks.map((r) => r.workId).sort(compareCanonicalText),
    setChangedWorkIds: setChangedWorks.map((r) => r.workId).sort(compareCanonicalText),
    humanAcceptedExpectedChanges: setChangedWorks
      .filter((r) => HUMAN_ACCEPTED_SET_CHANGES[r.workId])
      .map((r) => ({ workId: r.workId, label: HUMAN_ACCEPTED_SET_CHANGES[r.workId], setDiff: r.setDiff, authorizedBy: "human-decision-(a)-2026-06-21" }))
      .sort((a, b) => compareCanonicalText(a.workId, b.workId)),
    unauthorizedSetChangedWorkIds: unauthorizedSetChanges.map((r) => r.workId).sort(compareCanonicalText),
    drift: {
      knownDriftWork: driftWorkSeen ?? null,
      driftedWorks: drifted.sort((a, b) => compareCanonicalText(a.workId, b.workId)),
      additionalDriftCount: additionalDrift.length,
      gate: additionalDrift.length === 0 ? "DRIFT_AS_EXPECTED" : "CORPUS_DRIFT_ADDITIONAL",
    },
    gate: unauthorizedSetChanges.length === 0 ? "ACCEPTED_OR_ORDER_ONLY" : "SELECTION_SET_CHANGED",
  }
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  const final = resolve(OUT, "selection-stability.json")
  const tmp = `${final}.tmp`
  writeFileSync(tmp, JSON.stringify(report, null, 2) + "\n")
  renameSync(tmp, final)

  console.log("=== GATE estabilidade cap40 (localeCompare → code-unit) · read-only DB · $0 ===")
  console.log(`obras=${rows.length}  overCap=${overCapWorks.length}  ordemMudou=${orderChangedWorks.length}  conjuntoMudou=${setChangedWorks.length}`)
  console.log("obras acima do cap (únicas que podem mudar de conjunto):")
  for (const r of overCapWorks.sort((a, b) => b.usefulDeduped - a.usefulDeduped)) {
    console.log(`   ${r.workId.slice(0, 8)} n=${r.usefulDeduped} ordem=${r.orderChanged ? "MUDOU" : "igual"} conjunto=${r.setChanged ? "MUDOU ⛔" : "igual ✅"}  ${r.title}`)
    if (r.setDiff) {
      console.log(`      ↳ Δconjunto: ${r.setDiff.droppedCount} saíram / ${r.setDiff.addedCount} entraram (de ${r.usefulDeduped} para 40)`)
      for (const p of r.setDiff.droppedPrefixes) console.log(`         − ${p}`)
      for (const p of r.setDiff.addedPrefixes) console.log(`         + ${p}`)
    }
  }
  console.log("drift de corpus vs base-2r1 anterior (§8):")
  console.log(`   obra de drift conhecida ${DRIFT_WORK_ID.slice(0, 8)} (Sword-Bearing Flower): ${driftWorkSeen ? `${driftWorkSeen.oldN}→${driftWorkSeen.newN} (${driftWorkSeen.kind})` : "AUSENTE"}`)
  for (const d of drifted) console.log(`   drift: ${d.workId.slice(0, 8)} ${d.oldN}→${d.newN} (${d.kind})  ${d.title}`)
  console.log(`   drift adicional (além da conhecida): ${additionalDrift.length} → gate ${additionalDrift.length === 0 ? "DRIFT_AS_EXPECTED ✅" : "CORPUS_DRIFT_ADDITIONAL ⛔"}`)
  console.log(`artefato: ${final}`)

  console.log(`mudanças de conjunto: ${setChangedWorks.length} total — ${setChangedWorks.length - unauthorizedSetChanges.length} AUTORIZADAS (decisão (a)) / ${unauthorizedSetChanges.length} não-autorizadas`)

  if (additionalDrift.length > 0) {
    console.error("⛔ CORPUS_DRIFT_ADDITIONAL — obra(s) divergente(s) além da conhecida: " + additionalDrift.map((d) => d.workId).join(", "))
    process.exit(1)
  }
  if (unauthorizedSetChanges.length > 0) {
    console.error("⛔ SELECTION_SET_CHANGED — conjunto cap40 mudou em obra NÃO autorizada: " + unauthorizedSetChanges.map((r) => r.workId).join(", "))
    process.exit(1)
  }
  console.log("✅ ACCEPTED_OR_ORDER_ONLY — só ordem muda OU as 3 mudanças de conjunto autorizadas; 0 mudança não-autorizada, 0 drift adicional. Seguro regenerar.")
}

main().catch((e) => { console.error("[selection-stability] erro:", e instanceof Error ? e.message : String(e)); process.exit(1) })
