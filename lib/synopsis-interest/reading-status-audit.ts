/**
 * Plano 3 — Auditoria do STATUS DE LEITURA das 80 obras do golden pilot-1
 * (Fase B2.2D, Parte C). PURO: schema Zod + validador do CSV de classificação manual,
 * contagens e aritmética de planejamento do pilot-2. Sem banco, sem rede, sem
 * `server-only`, sem LLM.
 *
 * IMPORTANTE: este módulo opera SOMENTE no eixo de LEITURA (final_reading_status).
 * NUNCA lê, cruza ou agrega os LABELS contextuais de interesse (que seguem sob embargo).
 */

import { z } from "zod"

// ── Vocabulário congelado ────────────────────────────────────────────────────

/** As CINCO categorias finais permitidas (ordem canônica). */
export const READING_STATUS_VALUES = [
  "unread_unfamiliar",
  "unread_familiar",
  "partially_read",
  "fully_read",
  "uncertain",
] as const
export type ReadingStatus = (typeof READING_STATUS_VALUES)[number]

/** Elegíveis à métrica PROSPECTIVA principal (familiaridade NÃO exclui). */
export const PROSPECTIVE_ELIGIBLE: readonly ReadingStatus[] = ["unread_unfamiliar", "unread_familiar"]
/** Excluídas da prospectiva → trilha RETROSPECTIVA preservada. */
export const RETROSPECTIVE: readonly ReadingStatus[] = ["partially_read", "fully_read"]

/** Alvo de obras únicas NÃO LIDAS do pilot-2. `new_works_needed = 90 − confirmed_unread`. */
export const PILOT2_TARGET_UNIQUE_UNREAD = 90

export const readingStatusSchema = z.enum(READING_STATUS_VALUES)

/** Linha do CSV. `final_reading_status` vazio é permitido (bloqueado só no modo completo). */
export const readingStatusRowSchema = z.object({
  work_id: z.string().min(1),
  final_reading_status: z.union([readingStatusSchema, z.literal("")]),
  notes: z.string().optional().default(""),
})
export type ReadingStatusRow = z.infer<typeof readingStatusRowSchema>

// ── Parser de CSV (`;` ou `,`, campos com aspas) ─────────────────────────────

/** Registro bruto extraído do CSV (apenas as 3 colunas de interesse). */
export interface RawReadingStatusRecord {
  work_id: string
  final_reading_status: string
  notes: string
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === delim) { out.push(cur); cur = "" }
    else cur += ch
  }
  out.push(cur)
  return out
}

export interface ParsedReadingStatusCsv {
  records: RawReadingStatusRecord[]
  /** colunas presentes no header (para diagnóstico). */
  header: string[]
  /** erros de parsing/estrutura de colunas (não de vocabulário). */
  parseErrors: string[]
}

/**
 * Faz o parse do CSV de classificação. Aceita delimitador `;` ou `,` (detectado pelo
 * header) e os aliases de coluna `work_id`/`workId`. Ignora colunas extras (ex.: title,
 * split — que NÃO são lidas como conteúdo). Exige `work_id` e `final_reading_status`.
 */
export function parseReadingStatusCsv(text: string): ParsedReadingStatusCsv {
  const parseErrors: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { records: [], header: [], parseErrors: ["CSV vazio"] }
  const headerLine = lines[0]
  const delim = headerLine.includes(";") ? ";" : ","
  const header = splitCsvLine(headerLine, delim).map((h) => h.trim())
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h))
  const iId = idx(["work_id", "workId"])
  const iStatus = idx(["final_reading_status"])
  const iNotes = idx(["notes"])
  if (iId < 0) parseErrors.push("coluna obrigatória ausente: work_id (ou workId)")
  if (iStatus < 0) parseErrors.push("coluna obrigatória ausente: final_reading_status")
  const records: RawReadingStatusRecord[] = []
  if (iId >= 0 && iStatus >= 0) {
    for (let r = 1; r < lines.length; r++) {
      const cells = splitCsvLine(lines[r], delim)
      records.push({
        work_id: (cells[iId] ?? "").trim(),
        final_reading_status: (cells[iStatus] ?? "").trim(),
        notes: iNotes >= 0 ? (cells[iNotes] ?? "").trim() : "",
      })
    }
  }
  return { records, header, parseErrors }
}

// ── Contagens + derivados ────────────────────────────────────────────────────

export type ReadingStatusCounts = Record<ReadingStatus, number> & { empty: number }

export function emptyCounts(): ReadingStatusCounts {
  return {
    unread_unfamiliar: 0,
    unread_familiar: 0,
    partially_read: 0,
    fully_read: 0,
    uncertain: 0,
    empty: 0,
  }
}

/** Conta por `final_reading_status` (eixo de LEITURA — NÃO são os labels de interesse). */
export function computeReadingStatusCounts(records: RawReadingStatusRecord[]): ReadingStatusCounts {
  const c = emptyCounts()
  for (const r of records) {
    const s = r.final_reading_status
    if (s === "") c.empty++
    else if ((READING_STATUS_VALUES as readonly string[]).includes(s)) c[s as ReadingStatus]++
    // valores fora do vocabulário não entram nas contagens (são reportados como erro pela validação)
  }
  return c
}

export interface AuditDerived {
  uniqueWorks: number
  /** unread_unfamiliar + unread_familiar (familiaridade NÃO exclui). */
  confirmedUnread: number
  /** partially_read + fully_read (preservadas, fora da prospectiva). */
  retrospective: number
  uncertain: number
  empty: number
  /** 90 − confirmedUnread (autoritativo só quando completo e 0 uncertain). */
  newWorksNeeded: number
}

export function computeAuditDerived(counts: ReadingStatusCounts, uniqueWorks: number): AuditDerived {
  const confirmedUnread = counts.unread_unfamiliar + counts.unread_familiar
  return {
    uniqueWorks,
    confirmedUnread,
    retrospective: counts.partially_read + counts.fully_read,
    uncertain: counts.uncertain,
    empty: counts.empty,
    newWorksNeeded: PILOT2_TARGET_UNIQUE_UNREAD - confirmedUnread,
  }
}

// ── Validador (estrutural / completo) ────────────────────────────────────────

export type ValidationMode = "structural" | "complete"

export interface ReadingStatusValidation {
  ok: boolean
  mode: ValidationMode
  structuralOk: boolean
  /** 80/80 preenchidos (sem vazios). */
  completeOk: boolean
  /** completo E 0 uncertain. */
  validForPilot2Planning: boolean
  errors: string[]
  warnings: string[]
  counts: ReadingStatusCounts
  filled: number
  /** derivados (presentes quando estruturalmente válido). */
  derived: AuditDerived | null
}

export interface ValidateOptions {
  mode?: ValidationMode
  /** Conjunto EXATO de work_ids do pilot-1 (80). */
  canonicalWorkIds: string[]
}

/**
 * Valida os registros contra o conjunto canônico das 80 obras.
 *
 * Modo `structural` (pode rodar com o formulário incompleto):
 *   80 linhas · 80 work_ids únicos · conjunto exato · sem extra · sem ausente ·
 *   categorias preenchidas ∈ vocabulário · vazio permitido.
 * Modo `complete` (além do estrutural):
 *   80/80 preenchidos · 0 uncertain para liberar o planejamento do pilot-2.
 */
export function validateReadingStatusAudit(
  records: RawReadingStatusRecord[],
  opts: ValidateOptions,
): ReadingStatusValidation {
  const mode = opts.mode ?? "structural"
  const errors: string[] = []
  const warnings: string[] = []
  const canonical = new Set(opts.canonicalWorkIds)

  // vocabulário das categorias preenchidas
  for (const r of records) {
    if (r.final_reading_status === "") continue
    const parsed = readingStatusSchema.safeParse(r.final_reading_status)
    if (!parsed.success) errors.push(`status inválido para ${r.work_id || "(sem work_id)"}: "${r.final_reading_status}"`)
  }

  // work_ids: duplicados, extras, ausentes, contagem
  const seen = new Set<string>()
  const dups: string[] = []
  for (const r of records) {
    if (!r.work_id) { errors.push("linha sem work_id"); continue }
    if (seen.has(r.work_id)) dups.push(r.work_id)
    seen.add(r.work_id)
  }
  if (dups.length) errors.push(`work_id duplicado: ${[...new Set(dups)].join(", ")}`)

  const extra = [...seen].filter((id) => !canonical.has(id))
  const missing = [...canonical].filter((id) => !seen.has(id))
  if (extra.length) errors.push(`work_id fora do pilot-1 (extra): ${extra.length} (${extra.slice(0, 5).join(", ")}${extra.length > 5 ? "…" : ""})`)
  if (missing.length) errors.push(`work_id do pilot-1 ausente: ${missing.length} (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""})`)
  if (seen.size !== canonical.size) errors.push(`esperado ${canonical.size} work_ids únicos, encontrado ${seen.size}`)

  const counts = computeReadingStatusCounts(records)
  const filled = records.length - counts.empty
  const structuralOk = errors.length === 0
  const completeOk = structuralOk && counts.empty === 0
  const validForPilot2Planning = completeOk && counts.uncertain === 0

  if (structuralOk && counts.empty > 0) warnings.push(`${counts.empty} obra(s) ainda sem classificação (final_reading_status vazio)`)
  if (completeOk && counts.uncertain > 0) warnings.push(`${counts.uncertain} obra(s) 'uncertain' — estruturalmente válido, mas BLOQUEADO para o planejamento do pilot-2`)

  const derived = structuralOk ? computeAuditDerived(counts, canonical.size) : null

  const ok = mode === "complete" ? validForPilot2Planning : structuralOk

  return { ok, mode, structuralOk, completeOk, validForPilot2Planning, errors, warnings, counts, filled, derived }
}

// ── Cobertura dev/holdout das confirmadas não-lidas (só planejamento) ─────────

export interface UnreadSplitCoverage {
  development: number
  holdout: number
  unknown: number
}

/**
 * Cobertura por split das obras CONFIRMADAS como não lidas (unread_*). Usa o split do
 * snapshot (NÃO do formulário — o formulário não mostra split). Só para planejamento.
 */
export function computeUnreadSplitCoverage(
  records: RawReadingStatusRecord[],
  splitByWorkId: Map<string, "development" | "holdout">,
): UnreadSplitCoverage {
  const cov: UnreadSplitCoverage = { development: 0, holdout: 0, unknown: 0 }
  for (const r of records) {
    if (r.final_reading_status !== "unread_unfamiliar" && r.final_reading_status !== "unread_familiar") continue
    const sp = splitByWorkId.get(r.work_id)
    if (sp === "development") cov.development++
    else if (sp === "holdout") cov.holdout++
    else cov.unknown++
  }
  return cov
}

// ── Seed objetivo do banco (sugestão NÃO autoritativa) ───────────────────────

/** Vocabulário de 4 valores do seed do banco (mapeia depois p/ as 5 categorias finais). */
export type DbReadingSeed = "unread" | "partially_read" | "fully_read" | "uncertain"

/**
 * Seed DETERMINÍSTICO a partir dos sinais objetivos do banco. Apenas SUGESTÃO — a
 * classificação final (incl. familiar/unfamiliar) é manual. `chaptersRead > 0` é o
 * sinal mais forte de leitura real.
 */
export function suggestReadingStatusFromDb(input: { personalStatus: string; chaptersRead: number | null }): DbReadingSeed {
  const read = typeof input.chaptersRead === "number" && input.chaptersRead > 0
  if (input.personalStatus === "Completed") return "fully_read"
  if (["Reading", "Started", "Stalled", "On-hold", "Hiatus", "Dropped"].includes(input.personalStatus)) {
    return read ? "partially_read" : "uncertain"
  }
  if (input.personalStatus === "Want to Read" || input.personalStatus === "Untracked") return "unread"
  return "uncertain"
}

// ── Manifesto (sem labels contextuais) ───────────────────────────────────────

export interface AuditManifest {
  artifact: "pilot-1-reading-status-audit"
  goldenVersion: "pilot-1"
  baseSnapshotVersion: "base-1"
  baseSnapshotSignature: string
  worksheetSha256: string
  validatedAt: string
  mode: ValidationMode
  uniqueWorks: number
  readingStatusCounts: ReadingStatusCounts
  confirmedUnread: number
  retrospective: number
  uncertain: number
  newWorksNeeded: number
  validForPilot2Planning: boolean
  unreadCoverage?: UnreadSplitCoverage
}

export interface BuildManifestInput {
  baseSnapshotSignature: string
  worksheetSha256: string
  validatedAt: string
  validation: ReadingStatusValidation
  unreadCoverage?: UnreadSplitCoverage
}

/** Constrói o manifesto local. NUNCA inclui labels contextuais. */
export function buildAuditManifest(input: BuildManifestInput): AuditManifest {
  const v = input.validation
  const d = v.derived ?? computeAuditDerived(v.counts, v.counts.empty + v.filled)
  return {
    artifact: "pilot-1-reading-status-audit",
    goldenVersion: "pilot-1",
    baseSnapshotVersion: "base-1",
    baseSnapshotSignature: input.baseSnapshotSignature,
    worksheetSha256: input.worksheetSha256,
    validatedAt: input.validatedAt,
    mode: v.mode,
    uniqueWorks: d.uniqueWorks,
    readingStatusCounts: v.counts,
    confirmedUnread: d.confirmedUnread,
    retrospective: d.retrospective,
    uncertain: d.uncertain,
    newWorksNeeded: d.newWorksNeeded,
    validForPilot2Planning: v.validForPilot2Planning,
    unreadCoverage: input.unreadCoverage,
  }
}
