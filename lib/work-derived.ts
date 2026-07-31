import {
  cleanSynopsisText,
  dedupeByMeaning,
  isSameSynopsis,
  normalizeSynopsisForComparison,
} from "@/lib/synopsis-text"

interface WorkSynopsisRow {
  source?: string | null
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

function dedupeSynopsisTexts(values: Array<string | null | undefined>): string[] {
  const trimmed = values.map((value) => (value ?? "").trim()).filter((text) => text.length > 0)
  return dedupeByMeaning(trimmed, (text) => text)
}

export function sortWorkSynopses<T extends WorkSynopsisRow>(rows: T[] | null | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => {
    if (a.is_primary === b.is_primary) return (a.position ?? 0) - (b.position ?? 0)
    return a.is_primary ? -1 : 1
  })
}

/**
 * LEITURA: colapsa as quase-idênticas (a principal vem primeiro na ordenação e por
 * isso é a que sobrevive), mas NÃO reescreve o texto — quem limpa é o gravador
 * (`dedupeSynopsisEntries`). Exibir uma coisa e ter outra no banco seria pior que o
 * texto sujo.
 */
export function dedupeWorkSynopses<T extends WorkSynopsisRow>(rows: T[] | null | undefined): T[] {
  const trimmed = sortWorkSynopses(rows)
    .map((row) => ({ ...row, text: (row.text ?? "").trim() }) as T)
    .filter((row) => (row.text ?? "").length > 0)
  return dedupeByMeaning(trimmed, (row) => row.text)
}

/**
 * ESCRITA: limpa cada texto e só então deduplica pelo significado. É o ponto único
 * onde as duas regras valem — o picker chama pra MOSTRAR, o `syncWorkSynopses` chama
 * pra GRAVAR, e os dois chegam no mesmo resultado.
 */
export function dedupeSynopsisEntries<T extends SynopsisEntryRow>(
  rows: T[] | null | undefined
): Array<T & { source: string; text: string; isPrimary: boolean }> {
  const cleaned = (rows ?? [])
    .map((row) => ({
      ...row,
      source: (row.source ?? "manual").trim() || "manual",
      text: cleanSynopsisText(row.text),
      isPrimary: Boolean(row.isPrimary),
    }))
    .filter((row) => row.text.length > 0 && normalizeSynopsisForComparison(row.text).length > 0)

  // A principal é lembrada ANTES do dedup: quando ela é a que sai (por ser quase
  // igual a outra), quem a absorveu herda o posto. Sem isto a obra ficaria sem
  // principal e o gravador escolheria a posição 0 no lugar dela.
  const primaryText = cleaned.find((row) => row.isPrimary)?.text ?? null
  const out = dedupeByMeaning(cleaned, (row) => row.text)

  const primaryIdx = primaryText ? out.findIndex((row) => isSameSynopsis(row.text, primaryText)) : -1
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

export interface EvaluationSynopses {
  primary: string | null
  primaryIsManual: boolean
  additional: Array<{ text: string; source: string | null; isManual: boolean }>
}

/**
 * Divide as sinopses persistidas pra avaliação IA: a primária segue como referência
 * principal do prompt e TODAS as demais (deduplicadas por significado) viram blocos
 * adicionais com a procedência preservada — `isManual` marca as escritas/editadas
 * pelo usuário, que o prompt trata com autoridade alta.
 */
export function splitSynopsesForEvaluation(
  rows: WorkSynopsisRow[] | null | undefined
): EvaluationSynopses {
  const deduped = dedupeWorkSynopses(rows ?? [])
  const primaryRow = deduped[0] ?? null
  return {
    primary: primaryRow?.text?.trim() || null,
    primaryIsManual: primaryRow?.source === "manual",
    additional: deduped.slice(1).map((row) => ({
      text: row.text ?? "",
      source: row.source ?? null,
      isManual: row.source === "manual",
    })),
  }
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
  return pickCoverUrls(rows)[0] ?? null
}

/**
 * Todas as capas em ordem de preferência (is_primary primeiro, depois position),
 * deduplicadas. Serve como lista de candidatas pro `<CoverImage urls>`: se a
 * primária for link morto/hotlink bloqueado, ele cai pra próxima.
 */
export function pickCoverUrls(rows: WorkCoverRow[] | null | undefined): string[] {
  if (!rows?.length) return []
  const sorted = [...rows].sort((a, b) => {
    if (a.is_primary === b.is_primary) return (a.position ?? 0) - (b.position ?? 0)
    return a.is_primary ? -1 : 1
  })
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of sorted) {
    if (r.url && !seen.has(r.url)) {
      seen.add(r.url)
      out.push(r.url)
    }
  }
  return out
}
