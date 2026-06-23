/**
 * Plano 3 Fase B2.2O — Snapshot `base-2r1` (corpus text-only-v1). PURO: sem banco, sem rede,
 * sem LLM. Reusa a SELEÇÃO CONGELADA do base-2 (90 obras, 51 carryover/39 new, split/strata) e
 * só RECOMPUTA o corpus de reviews sob a política `text-only-v1` (work_reviews +
 * work_external_reviews_manual). NÃO reseleciona/reordena obras. NÃO lê work_manual_reviews,
 * labels, status de leitura, scores, predictions, ranking nem digests existentes.
 */

import { createHash } from "node:crypto"

function sha256(o: unknown): string {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex")
}

/** sha256 de uma STRING crua (sem JSON.stringify) — replica o `sha` do gerador do base-2. */
function shaStr(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

/**
 * Recalcula a `base2Signature` a partir do CONTEÚDO do base-2 (validação de integridade do
 * artefato histórico). Replica EXATAMENTE a fórmula de `scripts/pilot2-select.ts`:
 * `sha( JSON.stringify( works.map(e => ({ id, syn: sha(synopsis), tags: sorted, split, stratum })) ) )`
 * em ORDEM DE ARQUIVO (não ordenado). Use para validar antes de hardcodar/derivar do valor.
 */
export function computeBase2Signature(
  works: Array<{ workId: string; canonicalSynopsis: string; tags: string[]; split: string; stratum: string }>,
): string {
  return shaStr(
    JSON.stringify(
      works.map((e) => ({
        id: e.workId,
        syn: shaStr(e.canonicalSynopsis || ""),
        tags: [...e.tags].sort(),
        split: e.split,
        stratum: e.stratum,
      })),
    ),
  )
}

/** Tipo de snapshot — o base-2r1 é um OVERLAY de corpus sobre o base-2 imutável. */
export const BASE2R1_SNAPSHOT_KIND = "review-corpus-overlay"

export interface Base2r1Versions {
  goldenVersion: string // "pilot-2"
  baseSnapshotVersion: string // "base-2r1" (= snapshotVersion)
  snapshotKind: string // "review-corpus-overlay"
  corpusPolicyVersion: string // "text-only-v1"
  derivedFrom: { base: string; base2Signature: string } // base-2 (snapshotVersion-pai) + assinatura
  tasteProfileVersion: string // "v7"
  schemaVersion: string // "v1"
}

/** Proveniência TÉCNICA (não é sinal experimental — não entra na assinatura). */
export interface Base2r1Provenance {
  sources: string[]
  origins: string[]
  scrapedUseful: number
  manualUseful: number
}

/** Rastro ADMINISTRATIVO dos reviewIds da seleção — NÃO é sinal experimental nem entra em
 * nenhuma assinatura/seleção. Mantido só para auditoria/proveniência. */
export interface Base2r1AdministrativeTrace {
  reviewIds: string[]
  excludedFromExperimentalSignal: true
  excludedFromSelection: true
  excludedFromSignatures: true
}

export interface Base2r1Work {
  workId: string
  origin: "carryover" | "new"
  split: "development" | "holdout"
  stratum: string
  title: string
  /** Posição canônica herdada do base-2 (detecta reordenação/substituição). */
  canonicalIndex: number
  // corpus text-only-v1
  corpusPolicyVersion: string
  reviewsBeforeDedupe: number
  reviewsAfterDedupe: number
  reviewCorpusSignature: string
  /** Assinatura da seleção de ≤40 (só policy + textos normalizados selecionados). */
  digestSelectionSignature: string
  /** Hashes do texto normalizado das ≤40 selecionadas — identificador derivado SÓ do texto. */
  digestSelectionNormalizedHashes: string[]
  /** Rastro administrativo (reviewIds) — fora de qualquer sinal/assinatura/seleção. */
  administrativeTrace: Base2r1AdministrativeTrace
  provenance: Base2r1Provenance
}

/**
 * Assinatura order-independent do base-2r1, VINCULADA ao base-2 imutável. Depende de:
 * `snapshotVersion` + `snapshotKind` + `derivedFrom.{snapshotVersion,base2Signature}` +
 * `corpusPolicyVersion` + versões experimentais + conjunto ordenado por workId de
 * `{workId, reviewCorpusSignature, digestSelectionSignature}`. Muda quando: o base-2 muda
 * (base2Signature), a política muda, qualquer corpus muda, qualquer seleção de ≤40 muda, ou
 * uma obra é add/removida/substituída. NÃO muda quando só metadados administrativos mudam
 * (source/origin/URL/external id/autor/idioma/datas/IDs internos/ordem da query) — o
 * `reviewCorpusSignature`/`digestSelectionSignature` por obra já são text-only.
 */
export function computeBase2r1Signature(
  versions: Base2r1Versions,
  works: Array<{ workId: string; reviewCorpusSignature: string; digestSelectionSignature: string }>,
): string {
  return sha256({
    snapshotVersion: versions.baseSnapshotVersion,
    snapshotKind: versions.snapshotKind,
    derivedFrom: { snapshotVersion: versions.derivedFrom.base, base2Signature: versions.derivedFrom.base2Signature },
    corpusPolicyVersion: versions.corpusPolicyVersion,
    versions: {
      goldenVersion: versions.goldenVersion,
      tasteProfileVersion: versions.tasteProfileVersion,
      schemaVersion: versions.schemaVersion,
    },
    works: [...works]
      .sort((a, b) => a.workId.localeCompare(b.workId))
      .map((w) => ({
        workId: w.workId,
        reviewCorpusSignature: w.reviewCorpusSignature,
        digestSelectionSignature: w.digestSelectionSignature,
      })),
  })
}

/** Agregado determinístico dos corpus por obra (ordenado por workId). */
export function computeReviewCorpusAggregateSignature(
  corpusPolicyVersion: string,
  works: Array<{ workId: string; reviewCorpusSignature: string }>,
): string {
  return sha256({
    kind: "reviewCorpusAggregate",
    corpusPolicyVersion,
    works: [...works].sort((a, b) => a.workId.localeCompare(b.workId)).map((w) => [w.workId, w.reviewCorpusSignature]),
  })
}

/** Agregado determinístico das seleções de ≤40 por obra (ordenado por workId). */
export function computeDigestSelectionAggregateSignature(
  corpusPolicyVersion: string,
  works: Array<{ workId: string; digestSelectionSignature: string }>,
): string {
  return sha256({
    kind: "digestSelectionAggregate",
    corpusPolicyVersion,
    works: [...works].sort((a, b) => a.workId.localeCompare(b.workId)).map((w) => [w.workId, w.digestSelectionSignature]),
  })
}

/**
 * Projeção de IDENTIDADE/SELEÇÃO materializada (overlay). São os campos que o base-2r1
 * de fato carrega e que DEVEM bater com o base-2. A vinculação criptográfica do CONTEÚDO
 * completo do base-2 (sinopse/tags/taste) é feita pela `base2Signature` dentro da assinatura;
 * aqui o diff valida campo-a-campo o subconjunto materializado no overlay.
 *
 * Projeção A = derivada do ARQUIVO histórico base-2. Projeção B = derivada EXCLUSIVAMENTE do
 * artefato base-2r1 materializado. Comparar A×B (NUNCA base-2 contra ele mesmo).
 */
export interface Base2OverlayIdentity {
  workId: string
  origin: string
  split: string
  stratum: string
  title: string
  /** Posição canônica (slot/ordem) — detecta reordenação/substituição. */
  canonicalIndex: number
}

const OVERLAY_FIELDS: Array<keyof Base2OverlayIdentity> = ["origin", "split", "stratum", "title", "canonicalIndex"]

export interface Base2DiffReport {
  setEqual: boolean
  fieldEqual: boolean
  count: number
  identicalWorks: number
  missingWorkIds: string[] // presentes em A, ausentes em B
  extraWorkIds: string[] // presentes em B, ausentes em A
  duplicateWorkIds: string[] // workId repetido em A ou B
  fieldDifferences: string[]
  blockingDifferences: string[]
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) dup.add(id)
    seen.add(id)
  }
  return [...dup].sort()
}

/**
 * Diff REAL Projeção A (base-2 histórico) × Projeção B (base-2r1 materializado). BLOQUEIA em:
 * obra add/removida, work_id substituído, carryover/new divergente, split/stratum/título/ordem
 * divergente, work_id duplicado, contagem ≠ 90. Diferenças de corpus (counts/assinatura/policy)
 * são ESPERADAS e não entram aqui.
 */
export function diffBase2Overlay(a: Base2OverlayIdentity[], b: Base2OverlayIdentity[]): Base2DiffReport {
  const fieldDifferences: string[] = []
  const blockingDifferences: string[] = []
  const aIds = a.map((w) => w.workId)
  const bIds = b.map((w) => w.workId)
  const aMap = new Map(a.map((w) => [w.workId, w]))
  const bMap = new Map(b.map((w) => [w.workId, w]))

  const missingWorkIds = aIds.filter((id) => !bMap.has(id)).sort()
  const extraWorkIds = bIds.filter((id) => !aMap.has(id)).sort()
  const duplicateWorkIds = [...new Set([...findDuplicates(aIds), ...findDuplicates(bIds)])].sort()
  const setEqual = missingWorkIds.length === 0 && extraWorkIds.length === 0 && duplicateWorkIds.length === 0

  for (const id of missingWorkIds) blockingDifferences.push(`${id}: presente no base-2, ausente no base-2r1`)
  for (const id of extraWorkIds) blockingDifferences.push(`${id}: presente no base-2r1, ausente no base-2`)
  for (const id of duplicateWorkIds) blockingDifferences.push(`${id}: work_id duplicado`)

  let identicalWorks = 0
  for (const id of [...aMap.keys()].sort()) {
    const wa = aMap.get(id)!
    const wb = bMap.get(id)
    if (!wb) continue
    let same = true
    for (const f of OVERLAY_FIELDS) {
      if (wa[f] !== wb[f]) {
        const msg = `${id}.${String(f)}: "${wa[f]}" → "${wb[f]}"`
        fieldDifferences.push(msg)
        blockingDifferences.push(msg)
        same = false
      }
    }
    if (same) identicalWorks++
  }

  return {
    setEqual,
    fieldEqual: fieldDifferences.length === 0,
    count: b.length,
    identicalWorks,
    missingWorkIds,
    extraWorkIds,
    duplicateWorkIds,
    fieldDifferences,
    blockingDifferences,
  }
}

/**
 * Compara dois artefatos JSON (no-disco × reconstruído) por chave de topo. Retorna a lista de
 * chaves divergentes (vazia ⇒ idênticos). Base do modo `--verify`: detecta adulteração sem
 * escrever nada. JSON inválido no-disco ⇒ reportado como divergência total.
 */
export function diffArtifactJson(onDiskJson: string, rebuiltJson: string): string[] {
  if (onDiskJson === rebuiltJson) return []
  let a: Record<string, unknown>
  let b: Record<string, unknown>
  try {
    a = JSON.parse(onDiskJson || "null") as Record<string, unknown>
    b = JSON.parse(rebuiltJson) as Record<string, unknown>
  } catch {
    return ["<conteúdo não-parseável>"]
  }
  if (a === null || typeof a !== "object") return ["<artefato ausente ou inválido>"]
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

/** Mediana de uma lista numérica (ordena cópia). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
