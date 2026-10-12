import { describe, it, expect, vi } from "vitest"
import {
  editionContextFrom,
  EVALUATION_COLUMNS,
  planReadEdition,
  READ_EDITION_SOURCES,
  touchesEvaluation,
} from "@/lib/editions/read-edition"
import type { CurrentEvaluationRow, ReadEditionContext } from "@/lib/editions/read-edition"

/**
 * A versão que a AVALIAÇÃO de uma obra mixed descreve (mig 216, decisão D1 de 2026-10-12): uma
 * avaliação por obra, com a versão registrada nela. A regra pura — o que gravar em `read_edition`.
 */
vi.mock("server-only", () => ({}))

const ATIVA_R18: ReadEditionContext = { kind: "active", edition: "r18" }
const ATIVA_NORMAL: ReadEditionContext = { kind: "active", edition: "normal" }
const plano = (over: Partial<Parameters<typeof planReadEdition>[0]>) =>
  planReadEdition({ isMixed: true, current: null, patch: {}, context: { kind: "default" }, defaultEdition: null, ...over })
const avaliada = (readEdition: CurrentEvaluationRow["readEdition"], values: CurrentEvaluationRow["values"] = { user_score: 8 }): CurrentEvaluationRow => ({
  readEdition,
  values,
})

describe("avaliação NOVA em obra mixed grava a versão EFETIVA do contexto", () => {
  it("vista na R18 ⇒ r18 (active_version)", () => {
    expect(plano({ patch: { user_score: 8 }, context: ATIVA_R18 })).toEqual({ read_edition: "r18", read_edition_source: "active_version" })
  })
  it("vista na normal ⇒ normal (active_version) — a versão da TELA, não a preferência global", () => {
    expect(plano({ patch: { user_score: 8 }, context: ATIVA_NORMAL, defaultEdition: "r18" })).toEqual({
      read_edition: "normal",
      read_edition_source: "active_version",
    })
  })
  it("linha que já existia SEM avaliação (só status/capítulos) também é avaliação nova", () => {
    expect(plano({ current: avaliada(null, {}), patch: { user_score: 7 }, context: ATIVA_R18 })?.read_edition).toBe("r18")
  })
  it("qualquer parte da avaliação conta: nota rápida, pós-leitura", () => {
    expect(plano({ patch: { quick_score: 6 }, context: ATIVA_NORMAL })?.read_edition).toBe("normal")
    expect(plano({ patch: { post_story_score: 6 }, context: ATIVA_R18 })?.read_edition).toBe("r18")
  })
  it("sem tela da obra (onboarding, wizard): a versão padrão da CONTA naquela obra", () => {
    expect(plano({ patch: { user_score: 8 }, context: { kind: "default" }, defaultEdition: "r18" })?.read_edition).toBe("r18")
    expect(plano({ patch: { user_score: 8 }, context: { kind: "default" }, defaultEdition: "normal" })?.read_edition).toBe("normal")
  })
})

describe("avaliação EXISTENTE preserva a versão — editar a nota não troca nem 'descobre' a versão", () => {
  it("r18 editada vendo a normal continua r18", () => {
    expect(plano({ current: avaliada("r18"), patch: { user_score: 9 }, context: ATIVA_NORMAL })).toBeNull()
  })
  it("normal editada vendo a R18 continua normal", () => {
    expect(plano({ current: avaliada("normal"), patch: { user_score: 6 }, context: ATIVA_R18 })).toBeNull()
  })
  it("histórica SEM versão (null) continua desconhecida ao ser editada", () => {
    expect(plano({ current: avaliada(null), patch: { user_score: 9 }, context: ATIVA_R18 })).toBeNull()
  })
  it("apagar só a nota mantendo a pós-leitura não apaga a versão", () => {
    expect(plano({ current: avaliada("r18", { user_score: 8, post_story_score: 7 }), patch: { user_score: null }, context: ATIVA_NORMAL })).toBeNull()
  })
})

describe("troca EXPLÍCITA muda só a versão", () => {
  it("r18 → normal grava user_choice", () => {
    expect(plano({ current: avaliada("r18"), context: { kind: "explicit", edition: "normal" } })).toEqual({
      read_edition: "normal",
      read_edition_source: "user_choice",
    })
  })
  it("registrar a versão de uma avaliação histórica (null → r18)", () => {
    expect(plano({ current: avaliada(null), context: { kind: "explicit", edition: "r18" } })?.read_edition).toBe("r18")
  })
  it("escolher a mesma versão não grava nada", () => {
    expect(plano({ current: avaliada("r18"), context: { kind: "explicit", edition: "r18" } })).toBeNull()
  })
  it("sem avaliação não há o que trocar (não cria versão de avaliação inexistente)", () => {
    expect(plano({ current: null, context: { kind: "explicit", edition: "r18" } })).toBeNull()
    expect(plano({ current: avaliada(null, {}), context: { kind: "explicit", edition: "r18" } })).toBeNull()
  })
})

describe("escritores secundários não apagam nem trocam a versão", () => {
  it.each([
    ["status/capítulos", { personal_status_id: 3, chapters_read: 40 }],
    ["favorito", { is_favorite: true }],
    ["Interesse ♥", { synopsis_quality: "♥♥♥", synopsis_quality_source: "human_manual" }],
    ["observações", { observations: "x", observation_adjustment: 0.1 }],
  ])("%s", (_nome, patch) => {
    expect(touchesEvaluation(patch)).toBe(false)
    expect(plano({ current: avaliada("r18"), patch, context: ATIVA_NORMAL })).toBeNull()
  })
})

describe("apagar a avaliação inteira apaga a versão junto", () => {
  it("todas as colunas da avaliação a null ⇒ versão null", () => {
    const tudoNull = Object.fromEntries(EVALUATION_COLUMNS.map((c) => [c, null]))
    expect(plano({ current: avaliada("r18", { user_score: 8, quick_score: 7 }), patch: tudoNull, context: { kind: "default" } })).toEqual({
      read_edition: null,
      read_edition_source: null,
    })
  })
  it("sem versão gravada, apagar não grava nada", () => {
    const tudoNull = Object.fromEntries(EVALUATION_COLUMNS.map((c) => [c, null]))
    expect(plano({ current: avaliada(null), patch: tudoNull })).toBeNull()
  })
})

describe("importação de lista: versão desconhecida", () => {
  const IMPORT: ReadEditionContext = { kind: "unknown" }
  it("avaliação nova importada fica sem versão", () => {
    expect(plano({ patch: { user_score: 8 }, context: IMPORT, defaultEdition: "r18" })).toBeNull()
  })
  it("nota importada que SUBSTITUI a de uma avaliação com versão ⇒ a versão vira desconhecida", () => {
    expect(plano({ current: avaliada("r18", { user_score: 8 }), patch: { user_score: 6 }, context: IMPORT })).toEqual({
      read_edition: null,
      read_edition_source: null,
    })
  })
  it("reimportar a MESMA nota não apaga a versão (numeric do PostgREST vem como string)", () => {
    expect(plano({ current: avaliada("r18", { user_score: "8.0" }), patch: { user_score: 8 }, context: IMPORT })).toBeNull()
  })
  it("importação que só traz status/capítulos não toca a versão", () => {
    expect(plano({ current: avaliada("r18"), patch: { chapters_read: 10 }, context: IMPORT })).toBeNull()
  })
})

describe("obra NÃO-mixed não tem versão", () => {
  it("nenhum plano, em nenhum contexto", () => {
    for (const context of [ATIVA_R18, { kind: "explicit", edition: "r18" } as const, { kind: "default" } as const]) {
      expect(planReadEdition({ isMixed: false, current: null, patch: { user_score: 8 }, context, defaultEdition: "r18" })).toBeNull()
    }
  })
})

describe("contratos", () => {
  it("EVALUATION_COLUMNS = nota + nota rápida + as 8 pós-leitura do escritor (sem lista paralela)", async () => {
    const { POST_READING_COLUMNS } = await import("@/server/queries/user-work-state")
    expect([...EVALUATION_COLUMNS]).toEqual(["user_score", "quick_score", ...POST_READING_COLUMNS])
  })
  it("as origens são as mesmas do CHECK da migration 216", async () => {
    const { readFileSync } = await import("node:fs")
    const sql = readFileSync("supabase/migrations/216_read_edition.sql", "utf8")
    const m = sql.match(/read_edition_source in \(([^)]+)\)/)
    expect(m).not.toBeNull()
    expect(m![1].split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([...READ_EDITION_SOURCES])
  })
  it("editionContextFrom valida o valor vindo do cliente (a action é endpoint público)", () => {
    expect(editionContextFrom("r18")).toEqual({ kind: "active", edition: "r18" })
    expect(editionContextFrom("normal")).toEqual({ kind: "active", edition: "normal" })
    expect(editionContextFrom("ambas")).toEqual({ kind: "default" })
    expect(editionContextFrom(null)).toEqual({ kind: "default" })
    expect(editionContextFrom(undefined)).toEqual({ kind: "default" })
  })
})
