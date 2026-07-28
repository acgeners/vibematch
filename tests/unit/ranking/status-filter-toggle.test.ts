import { describe, expect, it } from "vitest"
import { toggleStatusParam } from "@/lib/status-filter-toggle"

const PUB = ["Completed", "Ongoing", "Hiatus", "Cancelled", "Unknown"] as const
const PUB_DEFAULT = ["Completed"] as const

/** Ordem-insensível: o valor é um CSV de conjunto, não uma lista ordenada. */
const asSet = (value: string) => new Set(value.split(","))

describe("toggleStatusParam", () => {
  describe('a partir de "todos"', () => {
    it("DESMARCA só o chip clicado (era o bug: virava seleção única)", () => {
      const next = toggleStatusParam("all", "Completed", PUB, PUB_DEFAULT)
      expect(asSet(next)).toEqual(new Set(["Ongoing", "Hiatus", "Cancelled", "Unknown"]))
    })

    it("desmarcar dois deixa os outros três", () => {
      const one = toggleStatusParam("all", "Hiatus", PUB, PUB_DEFAULT)
      const two = toggleStatusParam(one, "Unknown", PUB, PUB_DEFAULT)
      expect(asSet(two)).toEqual(new Set(["Completed", "Ongoing", "Cancelled"]))
    })
  })

  describe("a partir do padrão (parâmetro ausente)", () => {
    it("marcar outro status SOMA ao padrão", () => {
      const next = toggleStatusParam(null, "Ongoing", PUB, PUB_DEFAULT)
      expect(asSet(next)).toEqual(new Set(["Completed", "Ongoing"]))
    })

    it("desmarcar o único do padrão esvazia → vira todos", () => {
      expect(toggleStatusParam(null, "Completed", PUB, PUB_DEFAULT)).toBe("all")
    })
  })

  describe("a partir de uma seleção explícita", () => {
    it("marcar um status ausente adiciona", () => {
      const next = toggleStatusParam("Ongoing,Hiatus", "Cancelled", PUB, PUB_DEFAULT)
      expect(asSet(next)).toEqual(new Set(["Ongoing", "Hiatus", "Cancelled"]))
    })

    it("desmarcar um status presente remove", () => {
      const next = toggleStatusParam("Ongoing,Hiatus", "Hiatus", PUB, PUB_DEFAULT)
      expect(asSet(next)).toEqual(new Set(["Ongoing"]))
    })

    it("desmarcar o último esvazia → vira todos (sem filtro)", () => {
      expect(toggleStatusParam("Ongoing", "Ongoing", PUB, PUB_DEFAULT)).toBe("all")
    })

    it('cobrir todas as opções colapsa pra "all", a forma canônica', () => {
      const next = toggleStatusParam("Completed,Ongoing,Hiatus,Cancelled", "Unknown", PUB, PUB_DEFAULT)
      expect(next).toBe("all")
    })

    it("ignora espaços e itens vazios no CSV", () => {
      const next = toggleStatusParam(" Ongoing , , Hiatus ", "Hiatus", PUB, PUB_DEFAULT)
      expect(asSet(next)).toEqual(new Set(["Ongoing"]))
    })
  })

  describe("ida e volta", () => {
    it("clicar duas vezes no mesmo chip volta ao estado anterior", () => {
      const once = toggleStatusParam("all", "Hiatus", PUB, PUB_DEFAULT)
      expect(toggleStatusParam(once, "Hiatus", PUB, PUB_DEFAULT)).toBe("all")
    })
  })

  describe("status pessoal — os terminais não viram chip mas contam", () => {
    // `options` é a lista COMPLETA; Finished/Dropped ficam fora da UI. Se o toggle
    // materializasse só os visíveis, sair de "todos" sumiria com essas obras.
    const PER = [
      "Want to Read",
      "Reading",
      "Finished",
      "Dropped",
      "Untracked",
    ] as const
    const PER_DEFAULT = ["Want to Read", "Untracked"] as const

    it('sair de "todos" preserva os terminais na seleção', () => {
      const next = toggleStatusParam("all", "Reading", PER, PER_DEFAULT)
      expect(asSet(next)).toEqual(new Set(["Want to Read", "Finished", "Dropped", "Untracked"]))
    })

    it("selecionar todos os VISÍVEIS não colapsa pra all (não inclui terminais)", () => {
      const next = toggleStatusParam("Want to Read,Untracked", "Reading", PER, PER_DEFAULT)
      expect(next).not.toBe("all")
      expect(asSet(next)).toEqual(new Set(["Want to Read", "Untracked", "Reading"]))
    })
  })
})
