import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Migration 216 — a versão da avaliação (`user_work_state.read_edition`) + o backfill de UMA conta.
 * Lida do SQL: o que precisa valer é que o backfill só alcance as 55 avaliações mixed da conta
 * principal, ABORTE em vez de fazer backfill parcial, e que o rollback devolva o estado anterior.
 * (O comportamento contra o banco foi ensaiado numa cópia local de produção — ver o relatório.)
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/216_read_edition.sql"), "utf8")
const rollback = readFileSync(join(process.cwd(), "scripts/rollback/216_rollback.sql"), "utf8")
const semComentarios = (s: string) => s.replace(/--[^\n]*/g, "")
const codigo = semComentarios(sql)
const backfill = codigo.slice(codigo.indexOf("do $b$"), codigo.indexOf("$b$;"))

describe("schema", () => {
  it("duas colunas novas, aditivas, com CHECK de valores e do PAR", () => {
    expect(codigo).toMatch(/add column if not exists read_edition text/)
    expect(codigo).toMatch(/add column if not exists read_edition_source text/)
    expect(codigo).toMatch(/read_edition is null or read_edition in \('normal', 'r18'\)/)
    expect(codigo).toMatch(/\(read_edition is null\) = \(read_edition_source is null\)/)
  })
  it("não toca a chave: continua UMA avaliação por pessoa + obra", () => {
    expect(codigo).not.toMatch(/primary key|unique/i)
  })
})

describe("backfill: só as 55 da conta principal, com guardas que ABORTAM", () => {
  it("a conta é a do app (linha mais antiga de user_settings) e tem de ser curador", () => {
    expect(backfill).toMatch(/from public\.user_settings order by created_at asc limit 1/)
    expect(backfill).toMatch(/v_papel is distinct from 'curador'/)
  })
  it("o alvo é contagem + HASH do conjunto do levantamento, conferidos ANTES do update", () => {
    const antes = backfill.slice(0, backfill.indexOf("update public.user_work_state"))
    expect(antes).toMatch(/n_alvo <> 55/)
    expect(antes).toMatch(/v_hash <> '37aadc0f9aa149f14610601b0196933b'/)
    expect(antes).toMatch(/raise exception/)
  })
  it("recusa piloto/atributo da conta fora do alvo e versão pré-existente fora dele", () => {
    expect(backfill).toMatch(/pilot_taste_scores[\s\S]*user_attribute_assessment[\s\S]*raise exception/)
    expect(backfill).toMatch(/where read_edition is not null[\s\S]{0,200}raise exception/)
  })
  it("UM update, só na conta principal, só r18 + explicit_user_decision, só onde ainda não há versão", () => {
    expect(backfill.match(/update public\./g)).toHaveLength(1)
    const upd = backfill.slice(backfill.indexOf("update public.user_work_state"), backfill.indexOf("get diagnostics"))
    expect(upd).toMatch(/set read_edition = 'r18', read_edition_source = 'explicit_user_decision'/)
    expect(upd).toMatch(/u\.user_id = v_dona/)
    expect(upd).toMatch(/u\.read_edition is null/)
    expect(upd).not.toMatch(/user_score|quick_score|post_/)
  })
  it("depois do update: exatamente 55 linhas com versão no banco inteiro, senão aborta", () => {
    const depois = backfill.slice(backfill.indexOf("get diagnostics"))
    expect(depois).toMatch(/where read_edition is not null\) <> 55/)
    expect(depois).toMatch(/raise exception/)
  })
  it("nenhuma outra tabela é escrita (o resto é leitura)", () => {
    expect(codigo.match(/(insert into|delete from|update) public\.(\w+)/g)?.map((m) => m.split(".")[1])).toEqual(["user_work_state"])
  })
})

describe("rollback", () => {
  it("remove as três constraints e as duas colunas — e só elas", () => {
    const r = semComentarios(rollback)
    for (const c of ["user_work_state_read_edition_par", "user_work_state_read_edition_source_check", "user_work_state_read_edition_check"]) {
      expect(r).toMatch(new RegExp(`drop constraint if exists ${c}`))
    }
    expect(r).toMatch(/drop column if exists read_edition_source/)
    expect(r).toMatch(/drop column if exists read_edition;/)
    expect(r.match(/drop column/g)).toHaveLength(2)
  })
})
