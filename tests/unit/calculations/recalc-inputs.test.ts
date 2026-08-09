import { describe, it, expect } from "vitest"
import {
  CATALOG_RECALC_INPUTS,
  PERSONAL_RECALC_INPUTS,
  changedInputs,
  decideMarkRecalc,
  isPersonalRecalcInput,
  needsOwnerToDecide,
  sameRecalcValue,
} from "@/lib/calculations/recalc-inputs"

const OWNER = "owner-uuid"
const LEITORA = "leitora-uuid"

describe("sameRecalcValue — igualdade tolerante ao PostgREST", () => {
  it("numeric volta como STRING: '8.5' e 8.5 são o MESMO valor", () => {
    // Este é o caso que decide se o diff serve pra alguma coisa. Sem ele, toda
    // comparação de nota diz "mudou" e o gate marca sempre — igual a não existir.
    expect(sameRecalcValue("8.5", 8.5)).toBe(true)
    expect(sameRecalcValue("0", 0)).toBe(true)
    expect(sameRecalcValue("8.5", 8.6)).toBe(false)
  })

  it("null e undefined são o mesmo ausente; ausente ≠ zero", () => {
    expect(sameRecalcValue(null, undefined)).toBe(true)
    expect(sameRecalcValue(null, 0)).toBe(false)
    expect(sameRecalcValue(undefined, "")).toBe(false)
  })

  it("string não-numérica compara como texto", () => {
    expect(sameRecalcValue("Ongoing", "Ongoing")).toBe(true)
    expect(sameRecalcValue("Ongoing", "Completed")).toBe(false)
  })

  it("booleano não passa pela conversão numérica (false ≠ 0 aqui)", () => {
    expect(sameRecalcValue(false, false)).toBe(true)
    expect(sameRecalcValue(false, true)).toBe(false)
    expect(sameRecalcValue(false, 0)).toBe(false)
  })
})

describe("changedInputs", () => {
  it("devolve só o que mudou, sem repetir a entrada", () => {
    expect(
      changedInputs([
        ["year", 2019, 2019],
        ["year", null, 2024], // year_end entrou → a MESMA entrada
        ["total_chapters", "120", 120],
        ["user_score", 8, 9],
      ]),
    ).toEqual(["year", "user_score"])
  })

  it("nada mudou ⇒ array vazio (é o que faz o gate PULAR)", () => {
    expect(changedInputs([["user_score", 8, 8]])).toEqual([])
  })
})

describe("decideMarkRecalc — o gate", () => {
  it("não declarou nada ⇒ marca (comportamento histórico, à prova de falha)", () => {
    expect(decideMarkRecalc(undefined)).toEqual({ mark: true })
  })

  it("declarou vazio ⇒ NÃO marca", () => {
    expect(decideMarkRecalc([])).toMatchObject({ mark: false })
  })

  it("entrada de CATÁLOGO de um não-dono ⇒ marca (o catálogo é compartilhado)", () => {
    expect(decideMarkRecalc(["category_scores"], LEITORA, OWNER)).toEqual({ mark: true })
  })

  it("entrada PESSOAL de um não-dono ⇒ NÃO marca", () => {
    expect(decideMarkRecalc(["tag_preferences"], LEITORA, OWNER)).toMatchObject({ mark: false })
  })

  it("entrada pessoal do PRÓPRIO dono ⇒ marca", () => {
    expect(decideMarkRecalc(["tag_preferences"], OWNER, OWNER)).toEqual({ mark: true })
  })

  it("mistura catálogo + pessoal de um não-dono ⇒ marca (o lado catálogo vale)", () => {
    expect(decideMarkRecalc(["work_tags", "user_score"], LEITORA, OWNER)).toEqual({ mark: true })
  })

  it("dono desconhecido (null) ⇒ marca — o gate falha ABERTO", () => {
    // Falhar fechado aqui devolveria nota velha em silêncio, que é o modo caro.
    expect(decideMarkRecalc(["tag_preferences"], LEITORA, null)).toEqual({ mark: true })
  })

  it("sem actorId ⇒ marca (não dá pra afirmar que não é o dono)", () => {
    expect(decideMarkRecalc(["attribute_bias"], undefined, OWNER)).toEqual({ mark: true })
  })
})

describe("needsOwnerToDecide — evita pagar getOwnerUserId à toa", () => {
  it("só quando é tudo pessoal E há actor", () => {
    expect(needsOwnerToDecide(["tag_preferences"], LEITORA)).toBe(true)
    expect(needsOwnerToDecide(["tag_preferences"], undefined)).toBe(false)
    expect(needsOwnerToDecide(["category_scores"], LEITORA)).toBe(false)
    expect(needsOwnerToDecide(["work_tags", "user_score"], LEITORA)).toBe(false)
    expect(needsOwnerToDecide(undefined, LEITORA)).toBe(false)
    expect(needsOwnerToDecide([], LEITORA)).toBe(false)
  })
})

describe("a régua em si", () => {
  it("catálogo e pessoal são conjuntos disjuntos", () => {
    for (const input of CATALOG_RECALC_INPUTS) expect(isPersonalRecalcInput(input)).toBe(false)
    for (const input of PERSONAL_RECALC_INPUTS) expect(isPersonalRecalcInput(input)).toBe(true)
  })

  it("as colunas que NÃO entram no cálculo continuam fora da régua", () => {
    // Guarda a conferência feita contra o `select` do recalculateAll e as features
    // de expected.ts: status de leitura, capítulos lidos, ♥ e as 8 pós-leitura não
    // são feature nem rótulo. Se alguma virar feature, ela entra aqui NO MESMO PR.
    const all = [...CATALOG_RECALC_INPUTS, ...PERSONAL_RECALC_INPUTS] as string[]
    for (const fora of [
      "personal_status",
      "chapters_read",
      "last_read_at",
      "is_favorite",
      "post_scores",
      "synopsis",
      "covers",
      "work_genres",
    ]) {
      expect(all).not.toContain(fora)
    }
  })
})
