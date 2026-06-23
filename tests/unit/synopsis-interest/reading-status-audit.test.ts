import { describe, it, expect } from "vitest"
import {
  READING_STATUS_VALUES,
  PROSPECTIVE_ELIGIBLE,
  RETROSPECTIVE,
  PILOT2_TARGET_UNIQUE_UNREAD,
  validateReadingStatusAudit,
  computeReadingStatusCounts,
  computeAuditDerived,
  parseReadingStatusCsv,
  suggestReadingStatusFromDb,
  computeUnreadSplitCoverage,
  buildAuditManifest,
  type RawReadingStatusRecord,
} from "@/lib/synopsis-interest/reading-status-audit"

const IDS = Array.from({ length: 80 }, (_, i) => `w${String(i + 1).padStart(2, "0")}`)

function rec(id: string, status: string, notes = ""): RawReadingStatusRecord {
  return { work_id: id, final_reading_status: status, notes }
}
function allRecords(statusFor: (i: number) => string): RawReadingStatusRecord[] {
  return IDS.map((id, i) => rec(id, statusFor(i)))
}

describe("reading-status-audit — vocabulário", () => {
  it("1. as 5 categorias permitidas são exatamente estas (ordem canônica)", () => {
    expect([...READING_STATUS_VALUES]).toEqual([
      "unread_unfamiliar",
      "unread_familiar",
      "partially_read",
      "fully_read",
      "uncertain",
    ])
  })
})

describe("reading-status-audit — validação estrutural", () => {
  it("2. detecta linha AUSENTE (work_id do pilot-1 faltando)", () => {
    const v = validateReadingStatusAudit(allRecords(() => "unread_unfamiliar").slice(0, 79), { canonicalWorkIds: IDS })
    expect(v.structuralOk).toBe(false)
    expect(v.errors.some((e) => /ausente/.test(e))).toBe(true)
  })

  it("3. detecta linha EXTRA (work_id fora do pilot-1)", () => {
    const recs = [...allRecords(() => "unread_familiar"), rec("w_extra", "unread_familiar")]
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS })
    expect(v.structuralOk).toBe(false)
    expect(v.errors.some((e) => /extra/.test(e))).toBe(true)
  })

  it("4. detecta work_id DUPLICADO", () => {
    const recs = allRecords(() => "fully_read")
    recs[1] = rec(IDS[0], "fully_read") // duplica w01 (e remove w02)
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS })
    expect(v.structuralOk).toBe(false)
    expect(v.errors.some((e) => /duplicado/.test(e))).toBe(true)
  })

  it("5. rejeita STATUS fora do vocabulário", () => {
    const recs = allRecords(() => "unread_familiar")
    recs[0] = rec(IDS[0], "lido")
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS })
    expect(v.structuralOk).toBe(false)
    expect(v.errors.some((e) => /status inválido/.test(e))).toBe(true)
  })

  it("6. status VAZIO é permitido no modo estrutural", () => {
    const recs = allRecords((i) => (i < 40 ? "unread_familiar" : ""))
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS, mode: "structural" })
    expect(v.structuralOk).toBe(true)
    expect(v.ok).toBe(true)
    expect(v.completeOk).toBe(false)
    expect(v.counts.empty).toBe(40)
  })
})

describe("reading-status-audit — modo completo + liberação", () => {
  it("7. status VAZIO bloqueia o modo completo", () => {
    const recs = allRecords((i) => (i < 79 ? "unread_unfamiliar" : ""))
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS, mode: "complete" })
    expect(v.structuralOk).toBe(true)
    expect(v.completeOk).toBe(false)
    expect(v.ok).toBe(false)
  })

  it("8. 'uncertain' bloqueia a liberação do pilot-2 mesmo 80/80 preenchidos", () => {
    const recs = allRecords((i) => (i === 0 ? "uncertain" : "unread_familiar"))
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS, mode: "complete" })
    expect(v.completeOk).toBe(true)
    expect(v.validForPilot2Planning).toBe(false)
    expect(v.ok).toBe(false)
    expect(v.warnings.some((w) => /uncertain/.test(w))).toBe(true)
  })

  it("9. calcula new_works_needed = 90 − confirmed_unread", () => {
    const recs = allRecords((i) =>
      i < 30 ? "unread_unfamiliar" : i < 50 ? "unread_familiar" : i < 70 ? "fully_read" : "partially_read",
    )
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS, mode: "complete" })
    expect(v.validForPilot2Planning).toBe(true)
    expect(v.derived?.confirmedUnread).toBe(50)
    expect(v.derived?.retrospective).toBe(30)
    expect(v.derived?.newWorksNeeded).toBe(PILOT2_TARGET_UNIQUE_UNREAD - 50)
  })

  it("10. familiaridade (prospectivo) ≠ leitura (retrospectivo)", () => {
    expect([...PROSPECTIVE_ELIGIBLE]).toEqual(["unread_unfamiliar", "unread_familiar"])
    expect([...RETROSPECTIVE]).toEqual(["partially_read", "fully_read"])
    const recs = allRecords((i) =>
      i < 10 ? "unread_familiar" : i < 20 ? "unread_unfamiliar" : i < 50 ? "fully_read" : i < 60 ? "partially_read" : "uncertain",
    )
    const c = computeReadingStatusCounts(recs)
    const d = computeAuditDerived(c, 80)
    expect(d.confirmedUnread).toBe(20) // familiar conta como NÃO lida
    expect(d.retrospective).toBe(40)
    expect(d.uncertain).toBe(20)
  })
})

describe("reading-status-audit — parser, seed, manifesto, cobertura", () => {
  it("parseReadingStatusCsv aceita ';' e a coluna notes opcional", () => {
    const csv = "work_id;title;final_reading_status;notes\nw01;Algo;unread_familiar;ok\nw02;Outro;;"
    const p = parseReadingStatusCsv(csv)
    expect(p.parseErrors).toEqual([])
    expect(p.records).toHaveLength(2)
    expect(p.records[0]).toMatchObject({ work_id: "w01", final_reading_status: "unread_familiar", notes: "ok" })
    expect(p.records[1].final_reading_status).toBe("")
  })

  it("parseReadingStatusCsv aceita 'workId' camelCase e delimitador ','", () => {
    const p = parseReadingStatusCsv("workId,final_reading_status\nw01,fully_read")
    expect(p.parseErrors).toEqual([])
    expect(p.records[0]).toMatchObject({ work_id: "w01", final_reading_status: "fully_read" })
  })

  it("parseReadingStatusCsv reporta coluna obrigatória ausente", () => {
    const p = parseReadingStatusCsv("foo;bar\n1;2")
    expect(p.parseErrors.length).toBeGreaterThan(0)
  })

  it("suggestReadingStatusFromDb mapeia sinais objetivos (chapters_read é o mais forte)", () => {
    expect(suggestReadingStatusFromDb({ personalStatus: "Completed", chaptersRead: null })).toBe("fully_read")
    expect(suggestReadingStatusFromDb({ personalStatus: "Want to Read", chaptersRead: null })).toBe("unread")
    expect(suggestReadingStatusFromDb({ personalStatus: "Untracked", chaptersRead: null })).toBe("unread")
    expect(suggestReadingStatusFromDb({ personalStatus: "Dropped", chaptersRead: 5 })).toBe("partially_read")
    expect(suggestReadingStatusFromDb({ personalStatus: "On-hold", chaptersRead: 0 })).toBe("uncertain")
  })

  it("computeUnreadSplitCoverage conta só as confirmadas não-lidas por split", () => {
    const recs = [
      rec("w01", "unread_familiar"),
      rec("w02", "unread_unfamiliar"),
      rec("w03", "fully_read"),
      rec("w04", "unread_familiar"),
    ]
    const split = new Map<string, "development" | "holdout">([
      ["w01", "development"],
      ["w02", "holdout"],
      ["w03", "development"],
      ["w04", "development"],
    ])
    expect(computeUnreadSplitCoverage(recs, split)).toEqual({ development: 2, holdout: 1, unknown: 0 })
  })

  it("buildAuditManifest carrega derivados e NÃO inclui labels contextuais", () => {
    const recs = allRecords((i) => (i < 50 ? "unread_familiar" : "fully_read"))
    const v = validateReadingStatusAudit(recs, { canonicalWorkIds: IDS, mode: "complete" })
    const m = buildAuditManifest({
      baseSnapshotSignature: "634571c2faa0",
      worksheetSha256: "abc123",
      validatedAt: "2026-06-20T00:00:00.000Z",
      validation: v,
    })
    expect(m.confirmedUnread).toBe(50)
    expect(m.newWorksNeeded).toBe(40)
    expect(m.validForPilot2Planning).toBe(true)
    expect(JSON.stringify(m)).not.toMatch(/♥|contextual.?label|human.?label/i)
  })
})
