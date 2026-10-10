import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * O ESCOPO da migration 203 (aviso de violência/abuso sexual não liga o gate 18+), lido do SQL.
 *
 * O comportamento é provado contra um Postgres de verdade por `npm run test:db-gate-aviso-sexual`
 * (cenários, idempotência, rollback, guardas). Este teste existe porque aquele precisa do stack
 * local de pé e não roda na suíte: aqui fica, sempre, a parte que um descuido de edição quebraria
 * sem ninguém ver — a migration escrever em coluna que a decisão NÃO autoriza (nota, override,
 * edição R19, piso de nota) ou abrir transação própria.
 */

const ROOT = resolve(__dirname, "../../..")
const ler = (p: string) => readFileSync(resolve(ROOT, p), "utf8")
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, "")

const MIG = semComentarios(ler("supabase/migrations/203_aviso_sexual_nao_liga_gate_18.sql"))
const ROLLBACK = semComentarios(ler("scripts/rollback/203_rollback.sql"))
const CHECAGEM = semComentarios(ler("scripts/sql/divergencias-nota-adulta-x-18.sql"))

/** Cada `update <tabela> set <atribuições> (from|where)` → tabela e colunas atribuídas. */
function updates(sql: string): Array<{ tabela: string; colunas: string[] }> {
  return [...sql.matchAll(/\bupdate\s+([a-z_.]+)\s+(?:[a-z]\s+)?set\s+([\s\S]*?)\s+(?:from|where)\b/gi)].map((m) => ({
    tabela: m[1].toLowerCase(),
    colunas: m[2].split(",").map((a) => a.split("=")[0].trim().toLowerCase()),
  }))
}

describe("migration 203 — o que ela pode e não pode escrever", () => {
  it("as 13 tags decididas, e nenhuma outra", () => {
    const slugs = [...MIG.matchAll(/\('([a-z-]+)',\s+'[^']+',\s+(?:true|false)\)/g)].map((m) => m[1]).sort()
    expect(slugs).toEqual(
      [
        "attempted-gang-rape", "attempted-reverse-rape", "chikan", "child-sexual-abuse", "drugging-roofing",
        "gang-rape", "groping", "non-consensual-relationship", "pedophilia", "rape-as-a-start-of-relationship",
        "rape-by-lover", "reverse-rape", "sleep-molestation",
      ].sort(),
    )
  })

  it("só escreve as flags do GATE nas tags e adult_auto/adult_reason nas obras", () => {
    const u = updates(MIG)
    expect(u.length).toBeGreaterThan(0)
    for (const { tabela, colunas } of u) {
      if (tabela === "public.tags") expect(colunas.sort()).toEqual(["adult_indicator", "adult_indicator_strong"])
      else if (tabela === "public.works") expect(colunas.sort()).toEqual(["adult_auto", "adult_reason"])
      else throw new Error(`a 203 não pode dar update em ${tabela}`)
    }
  })

  it("não toca nota, override, edição R19 nem piso de nota — e não apaga nada", () => {
    // Atribuição (`coluna =` depois de SET) é o que conta: LER essas colunas para as guardas é esperado.
    for (const proibida of ["adult_score_tier", "adult_override", "r19_edition", "score", "marks_r19_edition"]) {
      for (const { colunas } of updates(MIG)) expect(colunas, proibida).not.toContain(proibida)
    }
    expect(MIG).not.toMatch(/\bupdate\s+public\.category_scores\b/i)
    expect(MIG).not.toMatch(/\bdelete\s+from\b/i)
    expect(MIG).not.toMatch(/\balter\s+table\s+public\./i)
    expect(MIG).not.toMatch(/\binsert\s+into\s+public\./i)
  })

  it("não abre nem fecha transação própria (a Management API e o teste de banco já envolvem numa)", () => {
    expect(MIG).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im)
  })

  it("guarda o estado anterior antes de escrever, e o rollback o lê", () => {
    expect(MIG.indexOf("insert into bkp.mig203_tags_antes")).toBeGreaterThan(-1)
    expect(MIG.indexOf("insert into bkp.mig203_tags_antes")).toBeLessThan(MIG.indexOf("update public.tags"))
    expect(MIG.indexOf("insert into bkp.mig203_works_antes")).toBeLessThan(MIG.indexOf("update public.works"))
    expect(ROLLBACK).toContain("bkp.mig203_tags_antes")
    expect(ROLLBACK).toContain("bkp.mig203_works_antes")
    // O rollback só restaura obra que continua como a 203 a deixou.
    expect(ROLLBACK).toMatch(/adult_auto\s*=\s*b\.adult_auto_depois/)
  })
})

describe("a checagem nota × 18+ é SÓ LEITURA", () => {
  it("roda numa transação read only e não tem DML nem DDL", () => {
    expect(CHECAGEM).toMatch(/^\s*begin\s+read\s+only\s*;/im)
    expect(CHECAGEM).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|create\s|alter\s|drop\s|truncate\s)/i)
  })
})
