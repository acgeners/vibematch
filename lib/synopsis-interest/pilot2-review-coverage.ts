/**
 * Plano 3 — Painel de COBERTURA das 13 obras com <2 reviews úteis (Fase B2.2M §9). PURO:
 * sem banco, sem rede, sem LLM. Reutiliza o artefato congelado da B2.2G
 * (`review-coverage-under-2.csv`) — NÃO adiciona reviews, só visualiza o estado.
 *
 * Meta FUTURA (não executada nesta fase): mínimo de 2 reviews úteis e não-duplicadas por
 * obra, preferencialmente de fontes distintas.
 */

/** Alvo mínimo de reviews úteis por obra. */
export const MIN_USEFUL_TARGET = 2

/** Quantidade de obras-alvo (as 13 da B2.2G com <2 úteis no baseline). */
export const COVERAGE_TARGET_WORKS = 13

/**
 * Baseline HISTÓRICO congelado (pré-migração 113 / pré-cadastro). Preservado como referência —
 * NÃO é mais o gate de aprovação. O progresso autorizado (B2.2O) NÃO é divergência.
 */
export const HISTORICAL_COVERAGE_BASELINE = {
  zeroUseful: 9,
  oneUseful: 4,
  twoPlus: 0,
  totalMissing: 22,
  manualRows: 0,
} as const

export interface CoverageLiveRow {
  workId: string
  usefulBeforeDedupe: number
  usefulAfterDedupe: number
}

export interface CoverageInvariant {
  name: string
  pass: boolean
  detail: string
}

export interface LiveCoverageResult {
  current: { zeroUseful: number; oneUseful: number; twoPlus: number; totalMissing: number; canonicalDups: number }
  invariants: CoverageInvariant[]
  ok: boolean
}

/**
 * Avalia o estado LIVE das obras-alvo separando **progresso autorizado** de **divergência real**.
 * Após a meta ratificada (B2.2O), as INVARIANTES reais (que bloqueiam) são: nº de obras-alvo = 13;
 * agregado == soma individual; 0 duplicatas canônicas inesperadas; toda obra-alvo ≥2; 0 faltantes.
 * O baseline histórico (9/4/0) NÃO é invariante — é só referência. PURO (não lê DB).
 */
export function evaluateLiveCoverage(
  rows: CoverageLiveRow[],
  opts: { ratified?: boolean } = {},
): LiveCoverageResult {
  const ratified = opts.ratified ?? true
  const zeroUseful = rows.filter((r) => r.usefulAfterDedupe === 0).length
  const oneUseful = rows.filter((r) => r.usefulAfterDedupe === 1).length
  const twoPlus = rows.filter((r) => r.usefulAfterDedupe >= MIN_USEFUL_TARGET).length
  const totalMissing = rows.reduce((n, r) => n + Math.max(0, MIN_USEFUL_TARGET - r.usefulAfterDedupe), 0)
  // duplicata canônica = texto perdido no dedupe (antes > depois)
  const canonicalDups = rows.filter((r) => r.usefulBeforeDedupe > r.usefulAfterDedupe).length

  const invariants: CoverageInvariant[] = [
    { name: `obras-alvo = ${COVERAGE_TARGET_WORKS}`, pass: rows.length === COVERAGE_TARGET_WORKS, detail: `${rows.length}` },
    {
      name: "agregado == soma individual",
      pass: zeroUseful + oneUseful + twoPlus === rows.length,
      detail: `${zeroUseful}+${oneUseful}+${twoPlus} vs ${rows.length}`,
    },
    { name: "0 duplicatas canônicas inesperadas", pass: canonicalDups === 0, detail: `${canonicalDups} obra(s)` },
  ]
  if (ratified) {
    invariants.push({
      name: "toda obra-alvo ≥2 úteis (meta ratificada)",
      pass: zeroUseful === 0 && oneUseful === 0,
      detail: `0úteis=${zeroUseful} · 1útil=${oneUseful}`,
    })
    invariants.push({ name: "0 reviews faltantes", pass: totalMissing === 0, detail: `${totalMissing}` })
  }

  return {
    current: { zeroUseful, oneUseful, twoPlus, totalMissing, canonicalDups },
    invariants,
    ok: invariants.every((i) => i.pass),
  }
}

export interface CoverageRowInput {
  title: string
  workId: string
  usefulReviewCount: number
  acceptedExternalSources: string[]
  split: string
  stratum: string
}

export interface CoveragePanelRow {
  title: string
  workId: string
  /** Rota LOCAL da obra (dev). */
  localRoute: string
  usefulReviewCount: number
  /** Quantas reviews úteis faltam para chegar a `MIN_USEFUL_TARGET`. */
  missingToTarget: number
  /** Fontes externas aceitas disponíveis (potencialmente cadastráveis). */
  availableExternalSources: string[]
  split: string
  stratum: string
}

export interface CoveragePanel {
  target: number
  rows: CoveragePanelRow[]
  summary: { zeroUseful: number; oneUseful: number; total: number; totalMissing: number }
}

export function buildPilot2CoveragePanel(inputs: CoverageRowInput[]): CoveragePanel {
  const rows: CoveragePanelRow[] = inputs
    .map((r) => ({
      title: r.title,
      workId: r.workId,
      localRoute: `/titles/${r.workId}`,
      usefulReviewCount: r.usefulReviewCount,
      missingToTarget: Math.max(0, MIN_USEFUL_TARGET - r.usefulReviewCount),
      availableExternalSources: [...r.acceptedExternalSources],
      split: r.split,
      stratum: r.stratum,
    }))
    .sort((a, b) => a.usefulReviewCount - b.usefulReviewCount || a.title.localeCompare(b.title))
  return {
    target: MIN_USEFUL_TARGET,
    rows,
    summary: {
      zeroUseful: rows.filter((r) => r.usefulReviewCount === 0).length,
      oneUseful: rows.filter((r) => r.usefulReviewCount === 1).length,
      total: rows.length,
      totalMissing: rows.reduce((n, r) => n + r.missingToTarget, 0),
    },
  }
}

/**
 * Parser tolerante do CSV `;`-delimitado da B2.2G (campo `tech_note` é `"`-quotado e
 * contém `;`). Retorna as linhas estruturadas necessárias ao painel.
 */
export function parseCoverageUnder2Csv(csv: string): CoverageRowInput[] {
  const lines = csv.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "")
  if (lines.length <= 1) return []
  const header = splitCsvLine(lines[0])
  const idx = (name: string) => header.indexOf(name)
  const iTitle = idx("title")
  const iUseful = idx("useful_review_count")
  const iAccepted = idx("accepted_external_sources")
  const iSplit = idx("split")
  const iStratum = idx("stratum")
  const iWorkId = idx("work_id")
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line)
    return {
      title: cols[iTitle] ?? "",
      workId: cols[iWorkId] ?? "",
      usefulReviewCount: Number(cols[iUseful] ?? "0") || 0,
      acceptedExternalSources: (cols[iAccepted] ?? "").split("|").map((s) => s.trim()).filter(Boolean),
      split: cols[iSplit] ?? "",
      stratum: cols[iStratum] ?? "",
    }
  })
}

/** Split de UMA linha CSV com delimitador `;` respeitando aspas duplas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ";") {
      out.push(cur); cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out
}
