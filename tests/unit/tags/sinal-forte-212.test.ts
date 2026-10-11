// @vitest-environment node
// Migration 212: Smut nas 10 obras com evidência de gênero e Pornographic nas 2 cuja única evidência é a
// classificação da própria fonte. Lê a lista da migration (o teste não pode divergir do que vai pro banco).
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const SQL = readFileSync(resolve(__dirname, "../../../supabase/migrations/212_sinal_forte_por_evidencia_auditada.sql"), "utf8")
const ini = SQL.indexOf("insert into mig212_tags values")
const LISTA = [...SQL.slice(ini, SQL.indexOf(";\n", ini)).matchAll(/\('([0-9a-f-]{36})', '((?:[^']|'')+)', '(smut|pornographic)', '((?:[^']|'')+)', '((?:[^']|'')+)'\)/g)]
  .map((m) => ({ id: m[1], titulo: m[2].replace(/''/g, "'"), tag: m[3], evidencia: m[4], auditoria: m[5] }))
const secao = (de: string, ate: string) => SQL.slice(SQL.indexOf(de), SQL.indexOf(ate))
const semComentario = (s: string) => s.replace(/--.*$/gm, "")

describe("migration 212 — sinal forte por evidência auditada", () => {
  it("12 obras, sem repetição", () => {
    expect(LISTA).toHaveLength(12)
    expect(new Set(LISTA.map((x) => x.id)).size).toBe(12)
  })
  it("Smut nas 10 de evidência de gênero", () => {
    expect(LISTA.filter((x) => x.tag === "smut").map((x) => x.titulo).sort()).toEqual([
      "A Monster’s Mate", "A Taste for Being Treated Roughly", "Curse of the Saintess", "Is This Marriage Okay?",
      "My First XXX: The Marquess Is Wild for His Princess", "Prince Snow White Is Taken by the Queen",
      "Ring of Bondage - Confinement", "Solstice", "The Demon King Wants Peace", "The Saint Dreams of Secret Love",
    ])
  })
  it("Pornographic SÓ em Samo e Savage Witch — a evidência delas é a classificação da fonte, não gênero", () => {
    const porn = LISTA.filter((x) => x.tag === "pornographic")
    expect(porn.map((x) => x.titulo).sort()).toEqual(["Samo", "Savage Witch"])
    for (const x of porn) expect(x.evidencia, x.titulo).toMatch(/pornographic/)
  })
  it("toda linha carrega evidência e auditoria (procedência)", () => {
    for (const x of LISTA) {
      expect(x.evidencia.length, x.titulo).toBeGreaterThan(20)
      expect(x.auditoria, x.titulo).toMatch(/^revisao-(23|4) · 2026-10-1[01]$/)
    }
  })
  it("Siren NÃO entra e nenhum override é criado", () => {
    expect(LISTA.some((x) => x.titulo.startsWith("Siren"))).toBe(false)
    expect(semComentario(SQL)).not.toMatch(/adult_override\s*=\s*true/)
    expect(semComentario(secao("-- ── 4) Aplicar", "-- ── 5) Guardas de SAÍDA"))).not.toMatch(/adult_override/)
  })
  it("o vínculo leva a procedência no próprio work_tags (source = 'curadoria')", () => {
    expect(secao("-- ── 4) Aplicar", "-- ── 5) Guardas de SAÍDA")).toMatch(/'curadoria'/)
  })
  it("a nota não entra: plano e aplicação não leem category_scores nem adult_content", () => {
    const corpo = semComentario(secao("-- ── 3) O PLANO", "-- ── 5) Guardas de SAÍDA"))
    expect(corpo).not.toMatch(/category_scores|adult_content/)
  })
})
