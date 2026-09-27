import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regra da curadora (2026-09-26): obra com edição R15 E R19 aparece nos DOIS filtros —
 * não some em "ocultar 18+" e aparece em "só 18+". São duas metades em dois lugares
 * (a expressão de `works.is_adult` no banco e o ramo "only" do getRanking), e cada uma
 * sozinha quebra a regra em silêncio: sem a primeira a obra some pra quem oculta; sem
 * a segunda ela some do "só 18+".
 */

const ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS = join(ROOT, "supabase", "migrations")

/** A expressão de is_adult vigente = a da migration MAIS RECENTE que a define. */
function expressaoVigenteDeIsAdult(): { arquivo: string; expr: string } {
  const arquivos = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
  let vigente: { arquivo: string; expr: string } | null = null
  const re =
    /is_adult\s+(?:BOOLEAN\s+GENERATED\s+ALWAYS\s+AS|SET\s+EXPRESSION\s+AS)\s*\(([\s\S]*?)\)\s*(?:STORED)?\s*;/gi
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8").replace(/--[^\n]*/g, "")
    for (const m of sql.matchAll(re)) vigente = { arquivo, expr: m[1].replace(/\s+/g, " ").trim() }
  }
  if (!vigente) throw new Error("nenhuma migration define works.is_adult")
  return vigente
}

describe("obra com as duas edições aparece nos dois filtros 18+", () => {
  it("is_adult (quem OCULTA) não inclui obra com r19_edition, salvo decisão manual", () => {
    const { arquivo, expr } = expressaoVigenteDeIsAdult()
    // A decisão humana continua vencendo: o override fica FORA do "AND NOT".
    expect(expr, arquivo).toMatch(/^COALESCE\(adult_override,\s*adult_auto AND NOT r19_edition\)?$/i)
  })

  it('o ramo "only" do getRanking inclui r19_edition', () => {
    const src = readFileSync(join(ROOT, "server", "queries", "ranking.ts"), "utf8")
    const ramo = src.split("\n").find((l) => /adultFilter\s*===\s*"only"/.test(l) && !l.trim().startsWith("//"))
    expect(ramo, 'não achei o ramo adultFilter === "only"').toBeDefined()
    expect(ramo).toMatch(/is_adult\.eq\.true/)
    expect(ramo).toMatch(/r19_edition\.eq\.true/)
  })
})
