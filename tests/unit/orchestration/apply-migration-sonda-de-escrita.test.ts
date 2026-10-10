import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * `scripts/apply-migration.mjs` sonda se o token PODE escrever antes de mandar a migration.
 *
 * Medido em 2026-10-10: com um token que só tem `database_read`, a Management API executa como
 * `supabase_read_only_user` mesmo com `read_only: false` no corpo, e a migration 203 voltou
 * `25006` no meio. Nada foi aplicado — mas a mensagem do Postgres não dizia que a causa era a
 * permissão do token. Estes casos travam as decisões que impedem o script de mandar às cegas.
 */

const ROOT = resolve(__dirname, "../../..")

describe("apply-migration — sonda de escrita", () => {
  it("o corpo declara read_only:false explicitamente", async () => {
    const { buildQueryBody } = await import("../../../scripts/apply-migration.mjs")
    expect(JSON.parse(buildQueryBody("select 1"))).toEqual({ query: "select 1", read_only: false })
  })

  it("recusa quando a API executa como o usuário só-leitura", async () => {
    const { diagnosticarEscrita } = await import("../../../scripts/apply-migration.mjs")
    const d = diagnosticarEscrita([{ usr: "supabase_read_only_user", tx_ro: "on" }])
    expect(d.ok).toBe(false)
    expect(d.motivo).toMatch(/database_read/)
    expect(d.motivo).toMatch(/Nada foi enviado/)
  })

  it("recusa transação só-leitura mesmo com outro usuário", async () => {
    const { diagnosticarEscrita } = await import("../../../scripts/apply-migration.mjs")
    expect(diagnosticarEscrita([{ usr: "postgres", tx_ro: "on" }]).ok).toBe(false)
  })

  it("zero linha é recusa, não sucesso", async () => {
    const { diagnosticarEscrita } = await import("../../../scripts/apply-migration.mjs")
    expect(diagnosticarEscrita([]).ok).toBe(false)
    expect(diagnosticarEscrita("texto solto").ok).toBe(false)
  })

  it("aceita quando a transação aceita escrita", async () => {
    const { diagnosticarEscrita } = await import("../../../scripts/apply-migration.mjs")
    expect(diagnosticarEscrita([{ usr: "postgres", tx_ro: "off" }])).toEqual({ ok: true, usr: "postgres" })
  })

  it("a sonda só lê", async () => {
    const { SONDA_ESCRITA_SQL } = await import("../../../scripts/apply-migration.mjs")
    expect(SONDA_ESCRITA_SQL).toMatch(/^\s*select\b/i)
    expect(SONDA_ESCRITA_SQL).not.toMatch(/\b(insert|update|delete|create|drop|alter|truncate)\b/i)
  })

  it("a sonda roda ANTES da migration, e a recusa sai sem enviá-la", () => {
    const src = readFileSync(resolve(ROOT, "scripts/apply-migration.mjs"), "utf8")
    const main = src.slice(src.indexOf("async function main()"))
    const sonda = main.indexOf("runSql(SONDA_ESCRITA_SQL")
    const recusa = main.indexOf("process.exit(2)")
    const envio = main.indexOf("runSql(sql, cfg)")
    expect(sonda).toBeGreaterThan(-1)
    expect(envio).toBeGreaterThan(-1)
    expect(sonda).toBeLessThan(recusa)
    expect(recusa).toBeLessThan(envio)
  })

  it("importar o módulo não executa nada", async () => {
    // Se o main rodasse na importação, ele leria o .env.local e chamaria a nuvem.
    const mod = await import("../../../scripts/apply-migration.mjs")
    expect(typeof mod.runSql).toBe("function")
  })
})
