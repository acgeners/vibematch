interface WorkSynopsisRow {
  text?: string | null
  is_primary?: boolean | null
  position?: number | null
}

interface SynopsisEntryRow {
  source?: string | null
  text?: string | null
  isPrimary?: boolean | null
}

interface WorkCoverRow {
  url?: string | null
  is_primary?: boolean | null
  position?: number | null
}

export const SYNOPSIS_SEPARATOR = "---------------------------------------------------------------------------------------------"
const SYNOPSIS_SEPARATOR_RE = /(?:\r?\n)?-{10,}(?:\r?\n)?/g

function normalizeSynopsisKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function dedupeSynopsisTexts(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const text = (value ?? "").trim()
    const key = normalizeSynopsisKey(text)
    if (!text || !key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

export function sortWorkSynopses<T extends WorkSynopsisRow>(rows: T[] | null | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => {
    if (a.is_primary === b.is_primary) return (a.position ?? 0) - (b.position ?? 0)
    return a.is_primary ? -1 : 1
  })
}

export function dedupeWorkSynopses<T extends WorkSynopsisRow>(rows: T[] | null | undefined): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of sortWorkSynopses(rows)) {
    const text = (row.text ?? "").trim()
    const key = normalizeSynopsisKey(text)
    if (!text || !key || seen.has(key)) continue
    seen.add(key)
    out.push({ ...row, text } as T)
  }
  return out
}

export function dedupeSynopsisEntries<T extends SynopsisEntryRow>(
  rows: T[] | null | undefined
): Array<T & { source: string; text: string; isPrimary: boolean }> {
  const seen = new Set<string>()
  const out: Array<T & { source: string; text: string; isPrimary: boolean }> = []
  let primaryKey: string | null = null

  for (const row of rows ?? []) {
    const text = (row.text ?? "").trim()
    const key = normalizeSynopsisKey(text)
    if (!text || !key) continue
    if (row.isPrimary) primaryKey = key
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      ...row,
      source: (row.source ?? "manual").trim() || "manual",
      text,
      isPrimary: Boolean(row.isPrimary),
    })
  }

  const primaryIdx = primaryKey ? out.findIndex((row) => normalizeSynopsisKey(row.text) === primaryKey) : -1
  const canonicalPrimaryIdx = primaryIdx === -1 ? 0 : primaryIdx
  return out.map((row, index) => ({ ...row, isPrimary: index === canonicalPrimaryIdx }))
}

/** Sinopse "primária" para list/detail. Prefere is_primary=true; senão menor position. */
export function pickPrimarySynopsis(rows: WorkSynopsisRow[] | null | undefined): string | null {
  if (!rows?.length) return null
  const sorted = dedupeWorkSynopses(rows)
  const text = sorted[0]?.text?.trim()
  return text ? text : null
}

export function joinSynopsisBlocks(texts: Array<string | null | undefined>): string {
  return dedupeSynopsisTexts(texts).join(`\n${SYNOPSIS_SEPARATOR}\n`)
}

export function joinSynopsesForDisplay(rows: WorkSynopsisRow[] | null | undefined): string {
  return joinSynopsisBlocks(dedupeWorkSynopses(rows).map((row) => row.text))
}

export function splitSynopsesFromText(text: string | null | undefined): string[] {
  return dedupeSynopsisTexts((text ?? "").split(SYNOPSIS_SEPARATOR_RE))
}

/** Capa "primária" para list/detail. Prefere is_primary=true; senão menor position. */
export function pickPrimaryCover(rows: WorkCoverRow[] | null | undefined): string | null {
  if (!rows?.length) return null
  const sorted = [...rows].sort((a, b) => {
    if (a.is_primary === b.is_primary) return (a.position ?? 0) - (b.position ?? 0)
    return a.is_primary ? -1 : 1
  })
  return sorted[0]?.url ?? null
}
