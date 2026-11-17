import { describe, it, expect } from "vitest"
import { chipStateFromRows, chipTagNames, planChipTastes } from "@/lib/onboarding/chip-tastes"
import type { TagStanceRow } from "@/lib/onboarding/chip-tastes"
import { LOVED_CHIPS, VETO_CHIPS } from "@/lib/onboarding/chips"

/**
 * As boas-vindas podem ser refeitas, e a pessoa pode ter ajustado as tags em Preferências no meio.
 * A gravação só mexe nos chips que MUDARAM. Até 2026-11 ela delegava num replace-all, e refazer o
 * fluxo apagava toda tag que nenhum chip cobre.
 */

const love = (tagName: string): TagStanceRow => ({ tagName, stance: "love" })
const avoid = (tagName: string): TagStanceRow => ({ tagName, stance: "avoid" })

describe("estado dos chips a partir do banco", () => {
  it("chip de gosto liga pela tag amada; o de veto, por QUALQUER tag dele evitada", () => {
    const estado = chipStateFromRows([love("Romance"), avoid("Physical Abuse"), love("Isekai")])
    expect(estado.loved).toEqual(["Romance"])
    expect(estado.vetos).toEqual(["Abuso"])
  })

  it("chip de gênero sem tag nunca aparece ligado", () => {
    const semTag = LOVED_CHIPS.filter((c) => c.tag == null).map((c) => c.label)
    expect(semTag.length).toBeGreaterThan(0)
    expect(chipStateFromRows([]).loved.some((l) => semTag.includes(l))).toBe(false)
  })
})

describe("o que gravar", () => {
  it("conta nova: grava cada chip escolhido", () => {
    const plano = planChipTastes([], ["Romance", "Fantasia", "Ação"], ["Harém"])
    expect(plano.remove).toEqual([])
    expect(plano.insert).toEqual([love("Romance"), love("Fantasy"), avoid("Harem"), avoid("Reverse Harem")])
  })

  it("passar pela tela sem mudar nada não grava nada — nem o veto parcial vindo de Preferências", () => {
    const banco = [love("Romance"), avoid("Physical Abuse"), love("Villainess"), avoid("Gore")]
    const estado = chipStateFromRows(banco)
    expect(planChipTastes(banco, estado.loved, estado.vetos)).toEqual({ remove: [], insert: [] })
  })

  it("tag que nenhum chip cobre nunca entra no plano", () => {
    const universo = new Set(chipTagNames())
    const banco = [love("Villainess"), avoid("Webtoon")]
    const plano = planChipTastes(banco, [], [])
    for (const r of [...plano.remove, ...plano.insert]) expect(universo.has(r.tagName)).toBe(true)
    expect(plano).toEqual({ remove: [], insert: [] })
  })

  it("desligar um chip tira só as linhas dele, com a stance dele", () => {
    const banco = [love("Romance"), love("Drama"), avoid("Physical Abuse")]
    const plano = planChipTastes(banco, ["Romance"], [])
    expect(plano.remove).toEqual([love("Drama"), avoid("Physical Abuse")])
    expect(plano.insert).toEqual([])
  })

  it("rótulo desconhecido é ignorado", () => {
    expect(planChipTastes([], ["Inventado"], ["Também inventado"])).toEqual({ remove: [], insert: [] })
  })

  it("nenhuma tag é ao mesmo tempo de gosto e de veto (uma stance por tag no banco)", () => {
    const gostos = new Set(LOVED_CHIPS.map((c) => c.tag).filter(Boolean))
    for (const v of VETO_CHIPS) for (const t of v.tags) expect(gostos.has(t), t).toBe(false)
  })
})
