/**
 * Plano 3 — Classificação AUTOMÁTICA do status de leitura do pilot-1 (Fase B2.2D, nova
 * decisão metodológica 2026-06-20). PURO: deriva a elegibilidade prospectiva das 80 obras
 * EXCLUSIVAMENTE de `works.personal_status_id` (fonte de verdade = tabela `personal_status`
 * do Supabase). Sem banco, sem rede, sem `server-only`, sem LLM.
 *
 * SUBSTITUI o preenchimento manual (familiaridade REMOVIDA; sem `uncertain`). As 3 categorias:
 *   unread · partially_read · fully_read
 *
 * O status de leitura é só um critério PONTUAL de elegibilidade para compor o benchmark
 * CONGELADO pilot-2 — NÃO entra em prompt/candidato/input signature/ranking, NÃO é exigido
 * de obras novas no uso real e NÃO acompanha o crescimento do catálogo. NUNCA lê labels
 * contextuais.
 */

import { PILOT2_TARGET_UNIQUE_UNREAD } from "./reading-status-audit"

// ── Vocabulário (3 categorias) ───────────────────────────────────────────────

export const DERIVED_READING_STATUS_VALUES = ["unread", "partially_read", "fully_read"] as const
export type DerivedReadingStatus = (typeof DERIVED_READING_STATUS_VALUES)[number]

/** Elegível ao golden prospectivo (entra no pilot-2). */
export const DERIVED_PROSPECTIVE_ELIGIBLE: readonly DerivedReadingStatus[] = ["unread"]
/** Fora da prospectiva → retrospectivo preservado. */
export const DERIVED_RETROSPECTIVE: readonly DerivedReadingStatus[] = ["partially_read", "fully_read"]

// ── Mapeamento aprovado (por slug e por nome; chave normalizada) ──────────────

/** Normaliza slug/nome: minúsculo, espaços→hífen, colapsa separadores. */
function normKey(s: string): string {
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

/** `Unknown = unread` (regra explícita aprovada), + Untracked/Neutral/Want to Read/To Read. */
const UNREAD_KEYS = new Set(["want-to-read", "untracked", "unknown", "neutral", "to-read"])
const FULLY_READ_KEYS = new Set(["completed", "finished"])
/** "leitura iniciada, independente de conclusão" (regra semântica aprovada). */
const PARTIALLY_READ_KEYS = new Set([
  "reading", "started", "stalled", "hiatus", "on-hold", "paused", "dropped", "abandoned",
])

export interface PersonalStatusRef {
  /** slug do `personal_status` (preferido). */
  slug?: string | null
  /** nome (`status`) como fallback. */
  name?: string | null
}

/**
 * Deriva a categoria a partir do status (sem `null`). `null`/vazio = `unread` (sem status).
 * Retorna `null` se o status NÃO se encaixa em nenhuma regra (não inventa).
 * A classificação vem PRIORITARIAMENTE do status; capítulos/datas NÃO entram aqui.
 */
export function tryDeriveReadingStatus(ref: PersonalStatusRef): DerivedReadingStatus | null {
  const slug = ref.slug ? normKey(ref.slug) : ""
  const name = ref.name ? normKey(ref.name) : ""
  if (!slug && !name) return "unread" // sem status / null
  for (const key of [slug, name]) {
    if (!key) continue
    if (UNREAD_KEYS.has(key)) return "unread"
    if (FULLY_READ_KEYS.has(key)) return "fully_read"
    if (PARTIALLY_READ_KEYS.has(key)) return "partially_read"
  }
  return null
}

/** Como `tryDeriveReadingStatus`, mas LANÇA em status não mapeado (erro explícito). */
export function deriveReadingStatus(ref: PersonalStatusRef): DerivedReadingStatus {
  const r = tryDeriveReadingStatus(ref)
  if (r === null) throw new Error(`status de leitura não mapeado: slug=${JSON.stringify(ref.slug)} name=${JSON.stringify(ref.name)}`)
  return r
}

// ── Diagnóstico de consistência (NÃO altera a classificação) ─────────────────

export interface ReadingSignals {
  derived: DerivedReadingStatus
  chaptersRead: number | null
  lastReadAt: string | null
}

/**
 * Flags de INCONSISTÊNCIA entre o status e os sinais auxiliares. Apenas registro — NÃO
 * mudam a classificação (decisão atual: status manda). Lista para revisão futura.
 */
export function computeDiagnosticFlags(s: ReadingSignals): string[] {
  const flags: string[] = []
  const hasChapters = typeof s.chaptersRead === "number" && s.chaptersRead > 0
  const hasLast = Boolean(s.lastReadAt)
  if (s.derived === "unread" && hasChapters) flags.push("unread_with_chapters_read")
  if (s.derived === "unread" && hasLast) flags.push("unread_with_last_read_at")
  if (s.derived === "fully_read" && !hasChapters) flags.push("fully_read_without_chapters_read")
  if (s.derived === "partially_read" && !hasChapters && !hasLast) flags.push("partially_read_without_reading_evidence")
  return flags
}

// ── Classificação das 80 obras ───────────────────────────────────────────────

export interface BaseWorkLite {
  workId: string
  title: string
  split: "development" | "holdout"
}
export interface DbWorkLite {
  personal_status_id: number | null
  chapters_read: number | null
  total_chapters: number | null
  last_read_at: string | null
}
export interface StatusLite {
  id: number
  status: string
  slug: string | null
}

export interface AutoRow {
  work_id: string
  title: string
  personal_status_id: number | null
  personal_status_name: string | null
  derived_reading_status: DerivedReadingStatus | "unmapped"
  chapters_read: number | null
  total_chapters: number | null
  last_read_at: string | null
  diagnostic_flags: string[]
}

export interface StatusMappingEntry {
  id: number | null
  name: string | null
  slug: string | null
  category: DerivedReadingStatus | "unmapped"
  presentCount: number
}

export interface UnmappedStatus {
  id: number | null
  name: string | null
  count: number
}

export type SplitCoverage = Record<DerivedReadingStatus, { development: number; holdout: number }>

export interface AutoClassification {
  rows: AutoRow[]
  counts: Record<DerivedReadingStatus, number>
  confirmedUnread: number
  retrospective: number
  newWorksNeeded: number
  splitCoverage: SplitCoverage
  inconsistencies: Array<{ work_id: string; title: string; status: string | null; flags: string[] }>
  statusMapping: StatusMappingEntry[]
  unmappedStatuses: UnmappedStatus[]
  structuralErrors: string[]
}

function emptyCoverage(): SplitCoverage {
  return {
    unread: { development: 0, holdout: 0 },
    partially_read: { development: 0, holdout: 0 },
    fully_read: { development: 0, holdout: 0 },
  }
}

/**
 * Classifica as 80 obras canônicas (snapshot base-1) cruzando com o status do banco.
 * Determinística e INDEPENDENTE DA ORDEM de entrada (ordena por `work_id`). Valida o
 * conjunto exato (sem duplicado/ausente). NUNCA toca em labels contextuais.
 */
export function buildAutoClassification(input: {
  baseWorks: BaseWorkLite[]
  dbByWorkId: Map<string, DbWorkLite>
  statusById: Map<number, StatusLite>
}): AutoClassification {
  const { baseWorks, dbByWorkId, statusById } = input
  const structuralErrors: string[] = []

  // conjunto exato / sem duplicado
  const seen = new Set<string>()
  const dups: string[] = []
  for (const w of baseWorks) {
    if (seen.has(w.workId)) dups.push(w.workId)
    seen.add(w.workId)
  }
  if (dups.length) structuralErrors.push(`work_id duplicado na base: ${[...new Set(dups)].join(", ")}`)

  const sorted = [...baseWorks].sort((a, b) => a.workId.localeCompare(b.workId))
  const rows: AutoRow[] = []
  const counts: Record<DerivedReadingStatus, number> = { unread: 0, partially_read: 0, fully_read: 0 }
  const coverage = emptyCoverage()
  const inconsistencies: AutoClassification["inconsistencies"] = []
  const mappingByStatusKey = new Map<string, StatusMappingEntry>()
  const unmappedByKey = new Map<string, UnmappedStatus>()

  for (const w of sorted) {
    const db = dbByWorkId.get(w.workId)
    if (!db) structuralErrors.push(`work_id sem linha no banco: ${w.workId}`)
    const statusId = db?.personal_status_id ?? null
    const statusRow = statusId != null ? statusById.get(statusId) ?? null : null
    const name = statusRow?.status ?? null
    const slug = statusRow?.slug ?? null
    const chaptersRead = typeof db?.chapters_read === "number" ? db!.chapters_read : null
    const totalChapters = typeof db?.total_chapters === "number" ? db!.total_chapters : null
    const lastReadAt = db?.last_read_at ? String(db.last_read_at).slice(0, 10) : null

    // statusId null = sem status → unread. statusId presente sem linha na tabela = órfão
    // (não identificável) → unmapped (NÃO finge unread). Caso normal: deriva do slug/nome.
    let derivedOrNull: DerivedReadingStatus | null
    if (statusId == null) derivedOrNull = "unread"
    else if (!statusRow) derivedOrNull = null
    else derivedOrNull = tryDeriveReadingStatus({ slug, name })
    const derived: DerivedReadingStatus | "unmapped" = derivedOrNull ?? "unmapped"

    // provenance + unmapped tracking (por status)
    const mapKey = `${statusId ?? "null"}`
    const mEntry = mappingByStatusKey.get(mapKey)
    if (mEntry) mEntry.presentCount++
    else mappingByStatusKey.set(mapKey, { id: statusId, name, slug, category: derived, presentCount: 1 })
    if (derivedOrNull === null) {
      const u = unmappedByKey.get(mapKey)
      if (u) u.count++
      else unmappedByKey.set(mapKey, { id: statusId, name, count: 1 })
    }

    const flags = derivedOrNull ? computeDiagnosticFlags({ derived: derivedOrNull, chaptersRead, lastReadAt }) : []
    if (flags.length) inconsistencies.push({ work_id: w.workId, title: w.title, status: name, flags })

    if (derivedOrNull) {
      counts[derivedOrNull]++
      coverage[derivedOrNull][w.split]++
    }

    rows.push({
      work_id: w.workId,
      title: w.title,
      personal_status_id: statusId,
      personal_status_name: name,
      derived_reading_status: derived,
      chapters_read: chaptersRead,
      total_chapters: totalChapters,
      last_read_at: lastReadAt,
      diagnostic_flags: flags,
    })
  }

  const confirmedUnread = counts.unread
  const retrospective = counts.partially_read + counts.fully_read
  const newWorksNeeded = PILOT2_TARGET_UNIQUE_UNREAD - confirmedUnread

  return {
    rows,
    counts,
    confirmedUnread,
    retrospective,
    newWorksNeeded,
    splitCoverage: coverage,
    inconsistencies,
    statusMapping: [...mappingByStatusKey.values()].sort((a, b) => (b.presentCount - a.presentCount)),
    unmappedStatuses: [...unmappedByKey.values()],
    structuralErrors,
  }
}

// ── Serialização (CSV/JSON/manifesto) — sem labels contextuais ───────────────

const AUTO_CSV_COLUMNS = [
  "work_id",
  "title",
  "personal_status_id",
  "personal_status_name",
  "derived_reading_status",
  "chapters_read",
  "total_chapters",
  "last_read_at",
  "diagnostic_flags",
] as const

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v)
  return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV `;`-separado (abre no Numbers). `diagnostic_flags` juntado por `|`. */
export function autoRowsToCsv(rows: AutoRow[]): string {
  const header = AUTO_CSV_COLUMNS.join(";")
  const body = rows.map((r) =>
    AUTO_CSV_COLUMNS.map((c) => (c === "diagnostic_flags" ? csvCell(r.diagnostic_flags.join("|")) : csvCell(r[c]))).join(";"),
  )
  return [header, ...body].join("\n") + "\n"
}

export interface AutoManifest {
  artifact: "pilot-1-reading-status-auto"
  goldenVersion: "pilot-1"
  baseSnapshotVersion: "base-1"
  baseSnapshotSignature: string
  generatedAt: string
  source: "works.personal_status_id (Supabase personal_status)"
  benchmarkNote: string
  uniqueWorks: number
  statusMapping: StatusMappingEntry[]
  counts: Record<DerivedReadingStatus, number>
  confirmedUnread: number
  retrospective: number
  newWorksNeeded: number
  splitCoverage: SplitCoverage
  inconsistencyCount: number
}

export function buildAutoManifest(input: {
  baseSnapshotSignature: string
  generatedAt: string
  classification: AutoClassification
}): AutoManifest {
  const c = input.classification
  return {
    artifact: "pilot-1-reading-status-auto",
    goldenVersion: "pilot-1",
    baseSnapshotVersion: "base-1",
    baseSnapshotSignature: input.baseSnapshotSignature,
    generatedAt: input.generatedAt,
    source: "works.personal_status_id (Supabase personal_status)",
    benchmarkNote:
      "Elegibilidade pontual para o benchmark CONGELADO pilot-2. NÃO entra no runtime do " +
      "produto (não alimenta previsão, ordenação nem entradas do modelo) e NÃO acompanha o " +
      "crescimento do catálogo.",
    uniqueWorks: c.rows.length,
    statusMapping: c.statusMapping,
    counts: c.counts,
    confirmedUnread: c.confirmedUnread,
    retrospective: c.retrospective,
    newWorksNeeded: c.newWorksNeeded,
    splitCoverage: c.splitCoverage,
    inconsistencyCount: c.inconsistencies.length,
  }
}

// ── Proteção de saída (reutilizada do guard do formulário) ───────────────────

export interface OutputGuard {
  allowed: boolean
  reason: string
}

/** Não sobrescreve artefato existente sem `--force`. Pura/determinística. */
export function guardAutoOutput(opts: { anyOutputExists: boolean; force: boolean }): OutputGuard {
  if (!opts.anyOutputExists) return { allowed: true, reason: "saída inexistente — geração permitida" }
  if (opts.force) return { allowed: true, reason: "--force: sobrescreve os artefatos existentes" }
  return {
    allowed: false,
    reason: "artefato(s) de saída já existe(m) — abortado para não sobrescrever. Use --force ou --out-dir=<outro>.",
  }
}
