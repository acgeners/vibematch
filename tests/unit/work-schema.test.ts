import { describe, it, expect } from "vitest"
import { workFormSchema, workFormBase, workUpdateSchema } from "@/lib/validations/work.schema"

// Guarda a regra de campo cruzado year_end >= year. year_end < year é impossível
// (fim antes do início) e virava RunLength negativo = outlier que inflava a Nota
// Prevista. Ver server/actions/calculations.ts:256 e lib/external/index.ts.
describe("workFormSchema — year_end não pode ser anterior a year", () => {
  it("REJEITA year_end anterior ao year, com erro no campo year_end", () => {
    const r = workFormSchema.safeParse({ title: "X", year: 2025, year_end: 2015 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("year_end"))).toBe(true)
    }
  })

  it("ACEITA year_end igual ou posterior ao year", () => {
    expect(workFormSchema.safeParse({ title: "X", year: 2025, year_end: 2025 }).success).toBe(true)
    expect(workFormSchema.safeParse({ title: "X", year: 2020, year_end: 2025 }).success).toBe(true)
  })

  it("ACEITA year_end nulo (em andamento) e year nulo (regra só vale com ambos)", () => {
    expect(workFormSchema.safeParse({ title: "X", year: 2025, year_end: null }).success).toBe(true)
    expect(workFormSchema.safeParse({ title: "X", year: null, year_end: 2015 }).success).toBe(true)
  })

  it("workUpdateSchema aplica a MESMA regra", () => {
    expect(workUpdateSchema.safeParse({ title: "X", year: 2025, year_end: 2015 }).success).toBe(false)
  })

  it("workFormBase (loader de edição) NÃO rejeita — pra abrir e corrigir obra já corrompida", () => {
    expect(workFormBase.safeParse({ title: "X", year: 2025, year_end: 2015 }).success).toBe(true)
  })
})
