import { describe, it, expect } from "vitest"
import {
  DERIVED_READING_STATUS_VALUES,
  tryDeriveReadingStatus,
  deriveReadingStatus,
  computeDiagnosticFlags,
  buildAutoClassification,
  autoRowsToCsv,
  buildAutoManifest,
  guardAutoOutput,
  type BaseWorkLite,
  type DbWorkLite,
  type StatusLite,
} from "@/lib/synopsis-interest/reading-status-auto"
import { PILOT2_TARGET_UNIQUE_UNREAD } from "@/lib/synopsis-interest/reading-status-audit"

const STATUS_TABLE: StatusLite[] = [
  { id: 1, status: "Completed", slug: "completed" },
  { id: 2, status: "Reading", slug: "reading" },
  { id: 3, status: "Started", slug: "started" },
  { id: 4, status: "Stalled", slug: "stalled" },
  { id: 6, status: "Hiatus", slug: "hiatus" },
  { id: 7, status: "On-hold", slug: "on-hold" },
  { id: 8, status: "Want to Read", slug: "want-to-read" },
  { id: 9, status: "Dropped", slug: "dropped" },
  { id: 10, status: "Untracked", slug: "untracked" },
]
const statusById = new Map(STATUS_TABLE.map((s) => [s.id, s]))

describe("reading-status-auto — mapeamento de status", () => {
  it("vocabulário das 3 categorias (sem familiaridade, sem uncertain)", () => {
    expect([...DERIVED_READING_STATUS_VALUES]).toEqual(["unread", "partially_read", "fully_read"])
  })

  it("1. Unknown → unread (regra explícita)", () => {
    expect(deriveReadingStatus({ name: "Unknown" })).toBe("unread")
    expect(deriveReadingStatus({ slug: "unknown" })).toBe("unread")
  })
  it("2. Untracked → unread", () => {
    expect(deriveReadingStatus({ slug: "untracked", name: "Untracked" })).toBe("unread")
  })
  it("3. Want to Read → unread", () => {
    expect(deriveReadingStatus({ slug: "want-to-read", name: "Want to Read" })).toBe("unread")
  })
  it("4. null / sem status → unread", () => {
    expect(deriveReadingStatus({ slug: null, name: null })).toBe("unread")
    expect(deriveReadingStatus({})).toBe("unread")
  })
  it("5. Completed → fully_read", () => {
    expect(deriveReadingStatus({ slug: "completed", name: "Completed" })).toBe("fully_read")
  })
  it("6. Reading → partially_read", () => {
    expect(deriveReadingStatus({ slug: "reading", name: "Reading" })).toBe("partially_read")
  })
  it("7. Paused / On Hold / On-hold → partially_read", () => {
    expect(deriveReadingStatus({ name: "Paused" })).toBe("partially_read")
    expect(deriveReadingStatus({ name: "On Hold" })).toBe("partially_read")
    expect(deriveReadingStatus({ slug: "on-hold", name: "On-hold" })).toBe("partially_read")
  })
  it("8. Dropped → partially_read", () => {
    expect(deriveReadingStatus({ slug: "dropped", name: "Dropped" })).toBe("partially_read")
  })
  it("Started / Stalled / Hiatus → partially_read (regra semântica 'leitura iniciada')", () => {
    expect(deriveReadingStatus({ slug: "started", name: "Started" })).toBe("partially_read")
    expect(deriveReadingStatus({ slug: "stalled", name: "Stalled" })).toBe("partially_read")
    expect(deriveReadingStatus({ slug: "hiatus", name: "Hiatus" })).toBe("partially_read")
  })
  it("9. status não mapeado causa ERRO explícito (não inventa)", () => {
    expect(tryDeriveReadingStatus({ slug: "wishlist-priority", name: "Wishlist Priority" })).toBeNull()
    expect(() => deriveReadingStatus({ slug: "wishlist-priority", name: "Wishlist Priority" })).toThrow(/não mapeado/)
  })
})

describe("reading-status-auto — diagnóstico (não altera classificação)", () => {
  it("10. chapters_read NÃO sobrescreve a regra do status (Unknown+chapters>0 segue unread)", () => {
    // status manda
    expect(deriveReadingStatus({ slug: "want-to-read" })).toBe("unread")
    // mas a inconsistência é registrada
    const flags = computeDiagnosticFlags({ derived: "unread", chaptersRead: 12, lastReadAt: null })
    expect(flags).toContain("unread_with_chapters_read")
  })
  it("11. inconsistências geram flags diagnósticas", () => {
    expect(computeDiagnosticFlags({ derived: "unread", chaptersRead: 0, lastReadAt: "2026-01-01" })).toContain("unread_with_last_read_at")
    expect(computeDiagnosticFlags({ derived: "fully_read", chaptersRead: null, lastReadAt: null })).toContain("fully_read_without_chapters_read")
    expect(computeDiagnosticFlags({ derived: "partially_read", chaptersRead: null, lastReadAt: null })).toContain("partially_read_without_reading_evidence")
    // caso consistente → sem flags
    expect(computeDiagnosticFlags({ derived: "fully_read", chaptersRead: 100, lastReadAt: "2026-01-01" })).toEqual([])
  })
})

// ── classificação das 80 ─────────────────────────────────────────────────────

function baseWork(i: number, statusId: number | null, split: "development" | "holdout" = "development"): {
  base: BaseWorkLite
  db: [string, DbWorkLite]
} {
  const workId = `w${String(i).padStart(2, "0")}`
  return {
    base: { workId, title: `Obra ${i}`, split },
    db: [workId, { personal_status_id: statusId, chapters_read: null, total_chapters: null, last_read_at: null }],
  }
}
function makeSet(statusIds: Array<number | null>, splits?: Array<"development" | "holdout">) {
  const baseWorks: BaseWorkLite[] = []
  const dbEntries: Array<[string, DbWorkLite]> = []
  statusIds.forEach((sid, i) => {
    const { base, db } = baseWork(i + 1, sid, splits?.[i] ?? "development")
    baseWorks.push(base)
    dbEntries.push(db)
  })
  return { baseWorks, dbByWorkId: new Map(dbEntries) }
}

describe("reading-status-auto — classificação das 80", () => {
  // 51 unread(8) + 12 fully(1) + 17 partial(7) = 80
  const statusIds = [
    ...Array(51).fill(8),
    ...Array(12).fill(1),
    ...Array(17).fill(7),
  ]
  const { baseWorks, dbByWorkId } = makeSet(statusIds)

  it("12. conjunto exato de 80 obras (sem erro estrutural)", () => {
    const c = buildAutoClassification({ baseWorks, dbByWorkId, statusById })
    expect(c.rows).toHaveLength(80)
    expect(c.structuralErrors).toEqual([])
    expect(new Set(c.rows.map((r) => r.work_id)).size).toBe(80)
  })

  it("13. nenhuma obra duplicada → erro estrutural se houver", () => {
    const dup = [...baseWorks, baseWorks[0]]
    const c = buildAutoClassification({ baseWorks: dup, dbByWorkId, statusById })
    expect(c.structuralErrors.some((e) => /duplicado/.test(e))).toBe(true)
  })

  it("14. new_works_needed = 90 − confirmed_unread", () => {
    const c = buildAutoClassification({ baseWorks, dbByWorkId, statusById })
    expect(c.counts).toEqual({ unread: 51, partially_read: 17, fully_read: 12 })
    expect(c.confirmedUnread).toBe(51)
    expect(c.retrospective).toBe(29)
    expect(c.newWorksNeeded).toBe(PILOT2_TARGET_UNIQUE_UNREAD - 51)
  })

  it("15. saída (CSV/JSON/manifesto) sem labels contextuais", () => {
    const c = buildAutoClassification({ baseWorks, dbByWorkId, statusById })
    const csv = autoRowsToCsv(c.rows)
    const manifest = buildAutoManifest({ baseSnapshotSignature: "634571c2…", generatedAt: "2026-06-20T00:00:00.000Z", classification: c })
    expect(csv).not.toMatch(/♥|contextual.?label|human.?label|prediction|alignment|ranking/i)
    expect(JSON.stringify(manifest)).not.toMatch(/♥|contextual.?label|human.?label|prediction|alignment|ranking/i)
    expect(csv.split("\n")[0]).toBe("work_id;title;personal_status_id;personal_status_name;derived_reading_status;chapters_read;total_chapters;last_read_at;diagnostic_flags")
  })

  it("16. arquivo existente protegido contra sobrescrita", () => {
    expect(guardAutoOutput({ anyOutputExists: false, force: false }).allowed).toBe(true)
    expect(guardAutoOutput({ anyOutputExists: true, force: false }).allowed).toBe(false)
    expect(guardAutoOutput({ anyOutputExists: true, force: true }).allowed).toBe(true)
  })

  it("17. independe da ORDEM das linhas recebidas (saída ordenada por work_id)", () => {
    const shuffled = [...baseWorks].reverse()
    const a = buildAutoClassification({ baseWorks, dbByWorkId, statusById })
    const b = buildAutoClassification({ baseWorks: shuffled, dbByWorkId, statusById })
    expect(b.rows.map((r) => r.work_id)).toEqual(a.rows.map((r) => r.work_id))
    expect(autoRowsToCsv(a.rows)).toBe(autoRowsToCsv(b.rows))
  })

  it("status não mapeado entre as obras → coletado em unmappedStatuses (script para)", () => {
    const withUnknown = new Map(dbByWorkId)
    withUnknown.set("w01", { personal_status_id: 999, chapters_read: null, total_chapters: null, last_read_at: null })
    const c = buildAutoClassification({ baseWorks, dbByWorkId: withUnknown, statusById })
    expect(c.unmappedStatuses.length).toBeGreaterThan(0)
    expect(c.unmappedStatuses[0].id).toBe(999)
  })

  it("split coverage por categoria", () => {
    const ids = [8, 8, 1, 7]
    const splits: Array<"development" | "holdout"> = ["development", "holdout", "holdout", "development"]
    const set = makeSet(ids, splits)
    const c = buildAutoClassification({ ...set, statusById })
    expect(c.splitCoverage.unread).toEqual({ development: 1, holdout: 1 })
    expect(c.splitCoverage.fully_read).toEqual({ development: 0, holdout: 1 })
    expect(c.splitCoverage.partially_read).toEqual({ development: 1, holdout: 0 })
  })
})
