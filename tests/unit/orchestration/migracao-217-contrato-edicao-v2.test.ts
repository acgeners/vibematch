import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"
import { EDITION_AWARE_SCORING_CONTRACTS } from "@/lib/editions/mixed-edition"

/**
 * Migration 217 — PREPARAÇÃO do contrato `s9-fantasy-b-edicao-v2` (etapa A da publicação). Ela só
 * ACRESCENTA a v2: o código ainda publicado (`edicao-v1`) tem de continuar aceito enquanto o novo não
 * sobe, e com `enforce` ligado (como em produção) recusar a v1 aqui pararia o recálculo de produção.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/217_contrato_edicao_v2.sql"), "utf8").replace(/--[^\n]*/g, "")
const rollback = readFileSync(join(process.cwd(), "scripts/rollback/217_rollback.sql"), "utf8").replace(/--[^\n]*/g, "")

describe("migration 217 — aceita a v2 sem recusar as antigas", () => {
  it("o código grava a v2, e a v2 é lida como previsão por edição (como a v1 de edição)", () => {
    expect(SCORING_CONTRACT).toBe("s9-fantasy-b-edicao-v2")
    expect(EDITION_AWARE_SCORING_CONTRACTS.has("s9-fantasy-b-edicao-v2")).toBe(true)
    expect(EDITION_AWARE_SCORING_CONTRACTS.has("s9-fantasy-b-edicao-v1")).toBe(true)
    expect(EDITION_AWARE_SCORING_CONTRACTS.has("s9-fantasy-b-v1")).toBe(false)
  })
  it("o estado final mantém as DUAS antigas e acrescenta a v2", () => {
    const m = sql.match(/set scoring_contracts = array\[([^\]]*)\]/)
    expect(m).not.toBeNull()
    expect([...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1])).toEqual(["s9-fantasy-b-v1", "s9-fantasy-b-edicao-v1", "s9-fantasy-b-edicao-v2"])
  })
  it("só aplica sobre o estado esperado; fora dele ABORTA", () => {
    expect(sql).toMatch(/where id = 1 and scoring_contracts = '\{s9-fantasy-b-v1,s9-fantasy-b-edicao-v1\}'::text\[\]/)
    expect(sql).toMatch(/raise exception/)
  })
  it("não toca enforce, versões de prompt nem nenhuma outra tabela", () => {
    expect(sql).not.toMatch(/enforce/)
    expect(sql).not.toMatch(/eval_prompt_versions/)
    expect(sql.match(/update public\.(\w+)/g)).toEqual(["update public.canonical_contract"])
    expect(sql).not.toMatch(/insert into|delete from|alter table|drop /i)
  })
  it("o rollback recusa quando já há linha gravada com a v2, e só tira a v2", () => {
    expect(rollback).toMatch(/scoring_contract = 's9-fantasy-b-edicao-v2'[\s\S]*user_calculated_scores[\s\S]*raise exception/)
    expect(rollback).toMatch(/array_remove\(scoring_contracts, 's9-fantasy-b-edicao-v2'\)/)
    expect(rollback).not.toMatch(/enforce/)
  })
})
