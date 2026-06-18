/**
 * Parse + validação dos rótulos da rotulagem cega (Plano 3 Fase B). PURO,
 * testável. CSV simples `slot_key,label` (sem a sinopse → sem campos multilinha).
 */

import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"

export interface LabelRow {
  slotKey: string
  label: string
}

/** Parse de um CSV `slot_key,label` (cabeçalho obrigatório). Tolerante a CRLF. */
export function parseLabelCsv(text: string): LabelRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0]!.split(",").map((c) => c.trim().toLowerCase())
  const si = header.indexOf("slot_key")
  const li = header.indexOf("label")
  if (si === -1 || li === -1) throw new Error("CSV precisa de colunas slot_key,label")
  return lines.slice(1).map((line) => {
    const cols = line.split(",")
    return { slotKey: (cols[si] ?? "").trim(), label: (cols[li] ?? "").trim() }
  })
}

export interface LabelValidation {
  valid: Array<{ slotKey: string; label: SynopsisQuality }>
  errors: string[]
  unlabeled: string[]
  /** slot_keys esperados que não apareceram no CSV. */
  missing: string[]
}

const QUALITY_SET = new Set<string>(SYNOPSIS_QUALITIES)

/**
 * Valida as linhas contra os slot_keys esperados. `valid` só inclui rótulos
 * preenchidos e válidos; `unlabeled` = vazios; `errors` = inválidos/duplicados/
 * desconhecidos; `missing` = esperados ausentes.
 */
export function validateLabelRows(rows: LabelRow[], expectedSlotKeys: string[]): LabelValidation {
  const expected = new Set(expectedSlotKeys)
  const seen = new Set<string>()
  const valid: Array<{ slotKey: string; label: SynopsisQuality }> = []
  const errors: string[] = []
  const unlabeled: string[] = []

  for (const r of rows) {
    if (!r.slotKey) continue
    if (!expected.has(r.slotKey)) { errors.push(`slot desconhecido: ${r.slotKey}`); continue }
    if (seen.has(r.slotKey)) { errors.push(`slot duplicado: ${r.slotKey}`); continue }
    seen.add(r.slotKey)
    if (r.label === "") { unlabeled.push(r.slotKey); continue }
    if (!QUALITY_SET.has(r.label)) { errors.push(`rótulo inválido em ${r.slotKey}: "${r.label}"`); continue }
    valid.push({ slotKey: r.slotKey, label: r.label as SynopsisQuality })
  }
  const missing = expectedSlotKeys.filter((k) => !seen.has(k))
  return { valid, errors, unlabeled, missing }
}
