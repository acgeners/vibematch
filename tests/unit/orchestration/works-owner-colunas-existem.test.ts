import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante: quem lê `works_owner` só pode pedir coluna que a VIEW expõe.
 *
 * 🔴 O que isto pega, medido em 2026-08-18: `computeLowCoverage` pedia
 * `works_owner.genres` — coluna que não existe em lugar nenhum desde a migration **024**,
 * que dropou o array legado `works.genres` em favor de `work_genres` + `genres`. O erro do
 * PostgREST vinha em `{ data: null, error }`, o chamador lia só o `data`, e o cálculo saía
 * sobre ZERO linhas: guard 2 em "unknown" e o badge ⚠ de baixa cobertura do `/ranking` nunca
 * acendendo. Nada quebrava — a página abria certa, só sem o aviso. Foi a paginação
 * (`fetchAllRows`, que LANÇA no erro do PostgREST) que transformou isso em Runtime Error e
 * denunciou o defeito.
 *
 * ⚠️ A view lista as colunas de `works` UMA A UMA (ver o comentário da migration 184), então
 * a divergência é nos DOIS sentidos: coluna nova em `works` nasce invisível aqui, e coluna
 * dropada de `works` continua sendo pedida por quem não foi avisado. Os dois lados são
 * derivados — a lista sai da migration vigente e as colunas saem do source.
 *
 * ⚠️ ABERTO: a varredura cobre os `.select("literal")` de `calibration-guards.ts`. Os demais
 * consumidores montam o select em template literal com embeds ou numa constante condicional,
 * e extrair isso pede um parser de argumento com parênteses balanceados — vale PR próprio.
 * Um teste que checasse só o que sabe parsear e não dissesse quanto pulou daria falso conforto.
 */

const ROOT = join(__dirname, "../../..")
const MIGRATIONS = join(ROOT, "supabase/migrations")

/** As colunas da definição MAIS RECENTE da view (a que está em vigor). */
function colunasDaView(view: string): { arquivo: string; colunas: string[] } {
  for (const nome of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().reverse()) {
    const sql = readFileSync(join(MIGRATIONS, nome), "utf8")
    // Só a definição REAL conta — os comentários citam a view o tempo todo.
    const m = sql.match(
      new RegExp(`create\\s+or\\s+replace\\s+view\\s+(?:public\\.)?${view}\\s+as([\\s\\S]*?)\\bFROM\\s+works\\s+w\\b`, "i"),
    )
    if (!m) continue
    const corpo = m[1].replace(/^\s*SELECT/i, "").replace(/--[^\n]*/g, "")
    const colunas = corpo
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const apelido = t.match(/\bAS\s+([a-z_][a-z0-9_]*)\s*$/i) // COALESCE(...) AS is_favorite
        if (apelido) return apelido[1]
        const simples = t.match(/^[a-z]\.([a-z_][a-z0-9_]*)$/i) // w.title / s.user_score
        return simples ? simples[1] : null
      })
      .filter((c): c is string => Boolean(c))
    return { arquivo: nome, colunas }
  }
  return { arquivo: "", colunas: [] }
}

const VIEW = colunasDaView("works_owner")

describe("contrato de colunas da view works_owner", () => {
  it("a definição vigente é legível (senão o teste passa por vacuidade)", () => {
    expect(VIEW.arquivo).not.toBe("")
    expect(VIEW.colunas.length).toBeGreaterThan(40)
    expect(VIEW.colunas).toContain("id")
    expect(VIEW.colunas).toContain("user_score")
  })

  it("🔴 NÃO expõe `genres` — o array legado morreu na migration 024", () => {
    expect(VIEW.colunas).not.toContain("genres")
  })

  it("calibration-guards só pede colunas que a view tem", () => {
    const src = readFileSync(join(ROOT, "server/queries/calibration-guards.ts"), "utf8")
    const selects = [...src.matchAll(/\.from\("works_owner"\)\s*\.select\(\s*"([^"()]*)"/g)]
    // Contraprova de vacuidade: sem isto, um regex quebrado deixaria o teste verde pra sempre.
    expect(selects.length).toBeGreaterThan(0)

    const pedidas = selects.flatMap((m) => m[1].split(",").map((c) => c.trim()).filter(Boolean))
    const forasteiras = pedidas.filter((c) => c !== "*" && !VIEW.colunas.includes(c))
    expect(
      forasteiras,
      `calibration-guards pede ${forasteiras.join(", ")} de works_owner, e a view (${VIEW.arquivo}) ` +
        `não expõe isso. O PostgREST devolve erro no lugar de dado — e quem ignorar o \`error\` ` +
        `calcula sobre zero linhas, em silêncio.`,
    ).toEqual([])
  })

  it("🔴 a cobertura de gênero sai de `work_genres`, nunca de uma coluna da obra", () => {
    const src = readFileSync(join(ROOT, "server/queries/calibration-guards.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    expect(src).toMatch(/\.from\("work_genres"\)/)
  })
})
