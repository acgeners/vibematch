import { describe, it, expect } from "vitest"
import { parseLabelCsv, validateLabelRows } from "@/lib/synopsis-interest/labels"

describe("parseLabelCsv", () => {
  it("parseia slot_key,label (tolerante a CRLF e espaços)", () => {
    const rows = parseLabelCsv("slot_key,label\r\nS001,♥♥♥\nS002, ♥ \nR001,\n")
    expect(rows).toEqual([
      { slotKey: "S001", label: "♥♥♥" },
      { slotKey: "S002", label: "♥" },
      { slotKey: "R001", label: "" },
    ])
  })
  it("exige as colunas", () => {
    expect(() => parseLabelCsv("a,b\n1,2")).toThrow()
  })
})

describe("validateLabelRows", () => {
  const expected = ["S001", "S002", "S003", "R001"]

  it("separa válidos / sem rótulo / ausentes", () => {
    const rows = parseLabelCsv("slot_key,label\nS001,♥♥♥\nS002,\nS003,♥♥♥♥")
    const v = validateLabelRows(rows, expected)
    expect(v.valid).toEqual([{ slotKey: "S001", label: "♥♥♥" }, { slotKey: "S003", label: "♥♥♥♥" }])
    expect(v.unlabeled).toEqual(["S002"])
    expect(v.missing).toEqual(["R001"])
    expect(v.errors).toEqual([])
  })

  it("acusa rótulo inválido, slot desconhecido e duplicado", () => {
    const rows = parseLabelCsv("slot_key,label\nS001,X\nZ999,♥\nS002,♥\nS002,♥♥")
    const v = validateLabelRows(rows, expected)
    expect(v.errors.some((e) => e.includes("inválido") && e.includes("S001"))).toBe(true)
    expect(v.errors.some((e) => e.includes("desconhecido") && e.includes("Z999"))).toBe(true)
    expect(v.errors.some((e) => e.includes("duplicado") && e.includes("S002"))).toBe(true)
    // 1ª ocorrência de S002 é válida; a 2ª vira erro de duplicado
    expect(v.valid).toEqual([{ slotKey: "S002", label: "♥" }])
  })
})
