// @vitest-environment node
// Migration 211: só os vínculos R19 `script_only` (injetados pela nota em 2026-07-09, sem confirmação
// independente) saem. Lê a lista congelada da própria migration e confere a fronteira das classes da
// auditoria (Auditoria/tags-adultas-e-geral-2026-10-10/r19/classificacao-r19.csv).
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const SQL = readFileSync(resolve(__dirname, "../../../supabase/migrations/211_r19_injetado_pela_nota.sql"), "utf8")
const ini = SQL.indexOf("insert into mig211_remover values")
const LISTA = [...SQL.slice(ini, SQL.indexOf(";\n", ini)).matchAll(/\('([0-9a-f-]{36})', '((?:[^']|'')+)', '((?:[^']|'')+)'\)/g)]
  .map((m) => ({ id: m[1], titulo: m[2].replace(/''/g, "'"), motivo: m[3].replace(/''/g, "'") }))
const titulos = new Set(LISTA.map((x) => x.titulo))
const secao = (de: string, ate: string) => SQL.slice(SQL.indexOf(de), SQL.indexOf(ate))

describe("migration 211 — R19 inventado pela nota", () => {
  it("a lista tem as 49 obras script_only, sem repetição", () => {
    expect(LISTA).toHaveLength(49)
    expect(new Set(LISTA.map((x) => x.id)).size).toBe(49)
  })
  it("fonte que classifica a obra como 'pornographic' tira o vínculo da lista (é evidência independente)", () => {
    for (const t of ["The Magicians", "The Saint Dreams of Secret Love"]) expect(titulos.has(t), t).toBe(false)
  })
  it("script-only com evidência CONTRÁRIA entra (R15 baseado em novel R19; leitor diz 'não é R19')", () => {
    expect(titulos.has("The Problematic Prince")).toBe(true)
    expect(titulos.has("The Hidden Muse")).toBe(true)
  })
  it("confirmado por fonte externa NÃO entra", () => {
    for (const t of ["A Winter Cabin of Serenity and Insanity", "A Lady's Risqué Hobby", "The Queen's Secret Lessons"]) expect(titulos.has(t), t).toBe(false)
  })
  it("ambíguo NÃO entra (outra tag forte, só leitor, fontes contraditórias, edição por reviews)", () => {
    for (const t of ["A Foxy Affair", "Beatrice", "Rod of Love", "Sip of Poison", "Teach Me How to Desire"]) expect(titulos.has(t), t).toBe(false)
  })
  it("apaga só o vínculo injetado: tag r19, source NULL, criado no minuto 2026-07-09 03:49 UTC", () => {
    const apagar = secao("-- ── 4) Aplicar", "update public.works")
    expect(apagar).toMatch(/t\.slug = 'r19'/)
    expect(apagar).toMatch(/wt\.source is null/)
    expect(apagar).toMatch(/2026-07-09 03:49:00\+00/)
    expect(apagar).toMatch(/mig211_remover/)
  })
  it("o plano do gate não lê a nota", () => {
    const plano = secao("-- ── 3) O PLANO", "-- ── 4) Aplicar")
    expect(plano).not.toMatch(/category_scores|adult_content/)
  })
  it("não toca nota, edição, override, flags de tag nem aliases (guardas de saída declaradas)", () => {
    const saida = SQL.slice(SQL.indexOf("-- ── 5) Guardas de SAÍDA"))
    for (const g of ["category_scores mudou", "work_edition_state mudou", "uma tag mudou", "tag_alias mudou", "mexeu em override"]) expect(saida, g).toContain(g)
  })
})
