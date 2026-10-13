import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"
import { EDITION_AWARE_SCORING_CONTRACTS } from "@/lib/editions/mixed-edition"

/**
 * Migration 218 — RETIRADA de `s9-fantasy-b-v1` e `s9-fantasy-b-edicao-v1` (etapa E da publicação da
 * 217). Depois dela o banco só aceita GRAVAR scoring com `s9-fantasy-b-edicao-v2`: um checkout antigo
 * deixa de conseguir regravar a Nota Prevista. O comportamento no banco real (sondas, guardas,
 * rollback) é coberto por `npm run test:db-retirada-contratos`; aqui fica o que o source tem de dizer.
 */
const semComentarios = (s: string) => s.replace(/--[^\n]*/g, "")
const sql = semComentarios(readFileSync(join(process.cwd(), "supabase/migrations/218_retira_contratos_antigos.sql"), "utf8"))
const rollbackBruto = readFileSync(join(process.cwd(), "scripts/rollback/218_rollback.sql"), "utf8")
const rollback = semComentarios(rollbackBruto)
const literais = (s: string) => [...s.matchAll(/'([^']*)'/g)].map((x) => x[1])

describe("migration 218 — só edicao-v2 continua aceito", () => {
  it("o código grava a v2; a leitura de linha edicao-v1 (histórico) continua", () => {
    expect(SCORING_CONTRACT).toBe("s9-fantasy-b-edicao-v2")
    expect(EDITION_AWARE_SCORING_CONTRACTS.has("s9-fantasy-b-edicao-v2")).toBe(true)
    // Retirar da LISTA bloqueia a escrita; ler linha antiga não reabre nada.
    expect(EDITION_AWARE_SCORING_CONTRACTS.has("s9-fantasy-b-edicao-v1")).toBe(true)
  })

  it("o estado final é EXATAMENTE {s9-fantasy-b-edicao-v2}, numa atribuição só", () => {
    const atribuicoes = [...sql.matchAll(/scoring_contracts\s*=\s*array\s*\[([^\]]*)\]/gi)]
    expect(atribuicoes).toHaveLength(1)
    expect(literais(atribuicoes[0][1])).toEqual([SCORING_CONTRACT])
  })

  it("guardas: enforce, prompt {v32}, lista de antes exata, sem linha v1/edicao-v1, v2 em uso, sem contrato inesperado", () => {
    expect(sql).toMatch(/c\.enforce is distinct from true[\s\S]*?raise exception/)
    expect(sql).toMatch(/c\.eval_prompt_versions is distinct from '\{v32\}'::text\[\][\s\S]*?raise exception/)
    expect(sql).toMatch(/cardinality\(c\.scoring_contracts\) <> 3/)
    expect(sql).toMatch(/'\{s9-fantasy-b-edicao-v1,s9-fantasy-b-edicao-v2,s9-fantasy-b-v1\}'::text\[\]/)
    for (const tabela of ["calculated_scores", "user_calculated_scores"]) {
      expect(sql).toMatch(new RegExp(`from public\\.${tabela} where scoring_contract in \\('s9-fantasy-b-v1', 's9-fantasy-b-edicao-v1'\\)`))
      expect(sql).toMatch(new RegExp(`from public\\.${tabela} where scoring_contract is not null and scoring_contract <> 's9-fantasy-b-edicao-v2'`))
    }
    expect(sql).toMatch(/if v2_calc = 0 then\s+raise exception/)
  })

  it("histórico NULO não bloqueia: nenhuma guarda conta `scoring_contract is null`", () => {
    expect(sql).not.toMatch(/scoring_contract is null/)
  })

  it("trava as duas tabelas de score durante a checagem (writer antigo não grava v1 entre a guarda e o COMMIT)", () => {
    expect(sql).toMatch(/lock table public\.calculated_scores, public\.user_calculated_scores in share mode/)
    expect(sql).toMatch(/from public\.canonical_contract where id = 1 for update/)
  })

  it("já aplicada ⇒ não faz nada (idempotente)", () => {
    expect(sql).toMatch(/if c\.scoring_contracts = '\{s9-fantasy-b-edicao-v2\}'::text\[\] then[\s\S]*?return;/)
  })

  it("não toca enforce, versões de prompt nem nenhuma outra tabela", () => {
    expect(sql).not.toMatch(/set[^;]*\benforce\s*=/i)
    expect(sql).not.toMatch(/eval_prompt_versions\s*=\s*(array|')/i)
    expect(sql.match(/update public\.(\w+)/g)).toEqual(["update public.canonical_contract"])
    expect(sql).not.toMatch(/insert into|delete from|alter table|drop |truncate/i)
  })

  it("o rollback devolve EXATAMENTE {v1, edicao-v1, edicao-v2}, só a partir do estado da 218, sem tocar enforce/prompt", () => {
    const atribuicoes = [...rollback.matchAll(/scoring_contracts\s*=\s*array\s*\[([^\]]*)\]/gi)]
    expect(atribuicoes).toHaveLength(1)
    expect(literais(atribuicoes[0][1])).toEqual(["s9-fantasy-b-v1", "s9-fantasy-b-edicao-v1", "s9-fantasy-b-edicao-v2"])
    expect(rollback).toMatch(/c\.scoring_contracts is distinct from '\{s9-fantasy-b-edicao-v2\}'::text\[\] then\s+raise exception/)
    expect(rollback).not.toMatch(/set[^;]*\benforce\s*=/i)
    expect(rollback).not.toMatch(/eval_prompt_versions\s*=\s*(array|')/i)
    expect(rollback.match(/update public\.(\w+)/g)).toEqual(["update public.canonical_contract"])
  })

  it("o rollback documenta que voltar o APP para a v48 exige rodá-lo ANTES", () => {
    expect(rollbackBruto).toMatch(/ANTES de voltar o APP para a v48/)
  })
})
