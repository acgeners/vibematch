import { describe, it, expect } from "vitest"
import { effectiveSortLevels, hasAlignmentSignal, resolveSortBasis } from "@/lib/ranking/sort-basis"

/**
 * Sem as 20 notas não há Nota Prevista. Até 2026-11 a lista caía inteira na média externa — até
 * para quem tinha acabado de dizer, nas boas-vindas, o que gosta e o que evita. O Alinhamento só
 * precisa das tags, então ele ocupa o lugar da Nota Prevista, e a média externa desempata.
 */

const L = (field: string, dir: "asc" | "desc" = "desc") => ({ field, dir })
const campos = (ls: Array<{ field: string }>) => ls.map((l) => l.field)

describe("qual régua ordena", () => {
  it("modelo vence; sem modelo, tags; sem as duas, a comunidade", () => {
    expect(resolveSortBasis({ hasModel: true, hasAlignment: false })).toBe("expected")
    expect(resolveSortBasis({ hasModel: false, hasAlignment: true })).toBe("alignment")
    expect(resolveSortBasis({ hasModel: false, hasAlignment: false })).toBe("platform")
    expect(resolveSortBasis({ hasModel: false }), "leitor sem o campo = sem Alinhamento").toBe("platform")
  })
})

describe("o Alinhamento só conta quando separa obras", () => {
  it("sem tags (nulo) ou sem variação (0,5 em todas), não ordena nada", () => {
    expect(hasAlignmentSignal([null, null, undefined])).toBe(false)
    expect(hasAlignmentSignal([0.5, 0.5, 0.5])).toBe(false)
    expect(hasAlignmentSignal([])).toBe(false)
  })

  it("dois valores distintos bastam — inclusive vindos como texto (`numeric`)", () => {
    expect(hasAlignmentSignal([0.5, null, 0.7])).toBe(true)
    expect(hasAlignmentSignal(["0.250", "0.750"])).toBe(true)
  })
})

describe("os níveis que valem", () => {
  const PADRAO_FREE = [L("expected_score"), L("personal_fit")]

  it("com modelo, nada muda", () => {
    expect(effectiveSortLevels(PADRAO_FREE, "expected")).toEqual(PADRAO_FREE)
  })

  it("Alinhamento no lugar da Nota Prevista, e a média externa desempata no fim", () => {
    expect(campos(effectiveSortLevels(PADRAO_FREE, "alignment"))).toEqual(["personal_fit", "platform_avg"])
    expect(campos(effectiveSortLevels([L("decision"), L("chance_score")], "alignment"))).toEqual([
      "personal_fit",
      "platform_avg",
    ])
  })

  it("o 2º nível escolhido pela pessoa continua decidindo antes do desempate", () => {
    expect(campos(effectiveSortLevels([L("expected_score"), L("total_votes")], "alignment"))).toEqual([
      "personal_fit",
      "total_votes",
      "platform_avg",
    ])
  })

  it("a direção pedida é mantida", () => {
    expect(effectiveSortLevels([L("expected_score", "asc")], "alignment")[0]).toEqual(L("personal_fit", "asc"))
  })

  it("sem tags, tudo que é pessoal vai para a média externa (o comportamento de antes)", () => {
    expect(campos(effectiveSortLevels(PADRAO_FREE, "platform"))).toEqual(["platform_avg"])
    expect(campos(effectiveSortLevels([L("art"), L("alignment_score"), L("title")], "platform"))).toEqual([
      "platform_avg",
      "title",
    ])
  })

  it("ordenação que não depende de modelo não é tocada", () => {
    const porTitulo = [L("title", "asc"), L("year")]
    expect(effectiveSortLevels(porTitulo, "alignment")).toEqual(porTitulo)
    expect(effectiveSortLevels(porTitulo, "platform")).toEqual(porTitulo)
  })
})
