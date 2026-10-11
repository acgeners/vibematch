// @vitest-environment node
// A classificação final das tags que a consolidação de 2026-10-10 decidiu (Ana), LIDA da própria
// migration 210 (tabela `mig210_tags`) — o teste não pode divergir do que vai para o banco — e o efeito
// de cada uma no gate pela régua REAL (`recomputeAdultAuto`), contra um banco em memória.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect, vi } from "vitest"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))

import { recomputeAdultAuto } from "@/lib/tags/adult-classify"

const SQL = readFileSync(resolve(__dirname, "../../../supabase/migrations/210_tags_adultas_coerencia.sql"), "utf8")
const ini = SQL.indexOf("insert into mig210_tags values")
const bloco = SQL.slice(ini, SQL.indexOf(";\n", ini))
const DECIDIDO = new Map(
  [...bloco.matchAll(/\('([^']+)', '(?:[^']|'')+', (true|false), (true|false), (?:null|'\w+'), (true|false), (true|false), '/g)].map((m) => [
    m[1], { indAntes: m[2] === "true", forteAntes: m[3] === "true", ind: m[4] === "true", forte: m[5] === "true" },
  ]),
)
const sinal = (slug: string) => {
  const d = DECIDIDO.get(slug)
  if (!d) throw new Error(`a 210 não decide ${slug}`)
  return d.forte ? "forte" : d.ind ? "fraca" : "nenhum"
}

async function gateComSo(slug: string) {
  const d = DECIDIDO.get(slug)!
  h.db = new FakeDb()
  h.db.tables.tags = [{ id: "t", slug, name: slug, adult_indicator: d.ind, adult_indicator_strong: d.forte }]
  // começa LIGADA pela tag (como estava quando ela era forte): a régua tem de desligar
  h.db.tables.works = [{ id: "w", adult_auto: true, adult_reason: "tag_explicit", adult_override: null }]
  h.db.tables.work_tags = [{ work_id: "w", tag_id: "t" }]
  h.db.tables.category_scores = [{ work_id: "w", criterion_slug: "adult_content", score: 10 }]
  await recomputeAdultAuto(h.db.client() as never, "w")
  return h.db.rows("works")[0].adult_auto as boolean
}

describe("classificação final decidida na consolidação (lida da migration 210)", () => {
  it("a 210 decide 108 tags", () => expect(DECIDIDO.size).toBe(108))

  const ESPERADO: Array<[string, "forte" | "fraca" | "nenhum"]> = [
    ["necrophilia", "fraca"], ["somnophilia", "fraca"], ["sleep-intercourse", "fraca"], ["bestiality", "fraca"],
    ["cousin-cousin-incest", "fraca"], ["big-penis", "fraca"], ["pubic-hair", "fraca"],
    ["realistic-breasts", "fraca"], ["big-breasted-female-lead", "nenhum"], ["condom-s", "fraca"],
    ["blindfold", "nenhum"], ["asphyxiation", "nenhum"],
  ]
  for (const [slug, esperado] of ESPERADO) it(`${slug} → ${esperado}`, () => expect(sinal(slug)).toBe(esperado))

  it("D4 citadas e anatomia genital eram FORTES antes (a mudança é real, não no-op)", () => {
    for (const slug of ["necrophilia", "somnophilia", "sleep-intercourse", "bestiality", "cousin-cousin-incest", "big-penis", "pubic-hair"])
      expect(DECIDIDO.get(slug)?.forteAntes, slug).toBe(true)
  })

  it("D4 NÃO citadas não entram na 210 (não expandir sozinho)", () => {
    for (const slug of ["incest", "twincest", "brother-sister-incest", "wanko"]) expect(DECIDIDO.has(slug), slug).toBe(false)
  })
})

describe("nenhuma delas liga o gate sozinha (nem com adult_content 10)", () => {
  for (const slug of ["necrophilia", "somnophilia", "sleep-intercourse", "bestiality", "cousin-cousin-incest", "big-penis", "pubic-hair", "realistic-breasts", "condom-s", "big-breasted-female-lead", "blindfold", "asphyxiation"])
    it(slug, async () => expect(await gateComSo(slug)).toBe(false))

  it("contraprova: uma tag que segue FORTE (Sex Toy/s) liga", async () => {
    expect(sinal("sex-toy-s")).toBe("forte")
    expect(await gateComSo("sex-toy-s")).toBe(true)
  })
})
