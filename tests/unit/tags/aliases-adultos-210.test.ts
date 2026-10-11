// @vitest-environment node
// Aliases adultos da migration 210, exercitados pelo `resolveOrCreateTags` REAL — a função por onde
// TODA string de fonte entra no catálogo. A tabela de aliases é LIDA da própria migration (bloco
// `mig210_aliases`), para o teste não poder divergir do que vai para o banco.
//
// Decisões fechadas (Ana): smut → Smut · hentai → Hentai · ecchi NÃO vira Smut · erotica à parte ·
// mature NÃO vira Adult sexual · alias que inventa ato (multiple-sexual-partners → Gangbang,
// urination → Squirting) deixa de existir · `r15` não inventa "baseado em novel R19" · e a régua geral
// (consolidação de 2026-10-10): alias só existe quando os dois termos significam essencialmente a
// MESMA coisa — conceito apenas relacionado (submission → BDSM, spanking → Whipping…) sai.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/server", () => ({ after: vi.fn() }))

import { resolveOrCreateTags } from "@/lib/tags/ingest"

const SQL = readFileSync(resolve(__dirname, "../../../supabase/migrations/210_tags_adultas_coerencia.sql"), "utf8")
const bloco = SQL.slice(SQL.indexOf("insert into mig210_aliases values"), SQL.indexOf(";", SQL.indexOf("insert into mig210_aliases values")))
const ALIASES = [...bloco.matchAll(/\('([^']+)',\s*'([^']+)',\s*(?:'([^']+)'|null)\)/g)].map((m) => ({
  alias: m[1], antes: m[2], depois: m[3] ?? null,
}))

// Tags-destino com os sinais que têm na nuvem (retrato de 2026-10-10); "mature" é a que a 210 cria.
const TAGS: Array<[string, string, boolean, boolean]> = [
  ["smut", "Smut", true, true], ["hentai", "Hentai", true, true], ["ecchi", "Ecchi", true, false],
  ["erotica", "Erotica", true, false], ["sexual-content", "Sexual Content", true, false], ["adult", "Adult", true, false],
  ["gangbang", "Gangbang", true, true], ["squirting", "Squirting", true, true], ["public-sex", "Public Sex", true, true],
  ["anal-sex", "Anal Sex", true, true], ["condom-s", "Condom/s", false, false],
  ["nakadashi-creampie", "Nakadashi / Creampie", true, true], ["orgy-ies", "Orgy/ies", true, true],
  ["mature", "Mature", false, false], ["r15-but-based-on-a-r19-novel", "R15 but Based on a R19 Novel", false, false],
  // destinos ANTIGOS dos 14 aliases relacionados (flags como ficam depois da 210)
  ["bdsm", "BDSM", true, true], ["whipping", "Whipping", true, false], ["sexual-abuse", "Sexual Abuse", false, false],
  ["asphyxiation", "Asphyxiation", false, false], ["torture", "Torture", false, false], ["physical-abuse", "Physical Abuse", false, false],
  ["fetish-es", "Fetish/es", true, false], ["nipples", "Nipples", true, false], ["friends-become-lovers", "Friends Become Lovers", false, false],
  ["sexual-teasing", "Sexual Teasing", true, false],
  ["uncensored-version-available", "Uncensored Version Available", false, false], ["abusive-family-member-s", "Abusive Family Member/s", false, false],
]

function seed(lado: "antes" | "depois") {
  h.db = new FakeDb()
  h.db.tables.tags = TAGS.map(([slug, name, ind, strong]) => ({ id: `t-${slug}`, slug, name, tag_group_id: "g", adult_indicator: ind, adult_indicator_strong: strong }))
  h.db.tables.tag_alias = ALIASES.filter((a) => a[lado]).map((a) => ({ alias_slug: a.alias, canonical_tag_id: `t-${a[lado]}` }))
}
async function destino(nome: string) {
  const { ids, createdIds } = await resolveOrCreateTags(h.db.client() as never, [nome], "external")
  const t = h.db.rows("tags").find((x) => x.id === ids[0])!
  return { slug: t.slug as string, criada: createdIds.length > 0, forte: t.adult_indicator_strong, sinal: t.adult_indicator }
}

describe("aliases adultos (migration 210)", () => {
  it("a migration declara os 28 aliases decididos", () => {
    expect(ALIASES.map((a) => a.alias).sort()).toEqual([
      "abuse", "abused-family-member-s", "child-abuse", "choking", "dubious-consent", "ecchi", "english-company-added-censorship",
      "erotic-asphyxiation", "erotic-torture", "erotica", "exhibitionism", "hentai", "mature", "multiple-sexual-partners",
      "nakadashi", "nipple-piercing-s", "nipple-play", "orgy", "r15", "rimjob", "sex-friends-become-lovers", "sexual-curiosity",
      "smut", "spanking", "stockings", "submission", "tail-plug", "urination",
    ])
  })

  it("os 2 aliases de sentido INVERTIDO são removidos (não redirecionados)", () => {
    expect(ALIASES.find((x) => x.alias === "english-company-added-censorship")).toMatchObject({ antes: "uncensored-version-available", depois: null })
    expect(ALIASES.find((x) => x.alias === "abused-family-member-s")).toMatchObject({ antes: "abusive-family-member-s", depois: null })
  })

  it("os 14 aliases de conceito apenas relacionado são REMOVIDOS, nunca redirecionados", () => {
    const relacionados = ["submission", "spanking", "dubious-consent", "choking", "erotic-asphyxiation", "erotic-torture", "abuse",
      "child-abuse", "stockings", "tail-plug", "nipple-piercing-s", "nipple-play", "sex-friends-become-lovers", "sexual-curiosity"]
    for (const a of relacionados) expect(ALIASES.find((x) => x.alias === a)?.depois, a).toBeNull()
  })

  it("ANTES: a string 'Smut' da fonte virava Sexual Content (o defeito que a 210 corrige)", async () => {
    seed("antes")
    expect((await destino("Smut")).slug).toBe("sexual-content")
    expect((await destino("Mature")).slug).toBe("adult")
    expect((await destino("Urination")).slug).toBe("squirting")
    expect((await destino("R15")).slug).toBe("r15-but-based-on-a-r19-novel")
    expect(await destino("Submission")).toMatchObject({ slug: "bdsm", forte: true }) // conceito geral virava prática sexual FORTE
    expect((await destino("Dubious Consent")).slug).toBe("sexual-abuse") // inventava abuso
    expect((await destino("English Company Added Censorship")).slug).toBe("uncensored-version-available") // censurada virava "sem censura"
    expect((await destino("Abused Family Member/s")).slug).toBe("abusive-family-member-s") // vítima virava agressor
  })

  describe("DEPOIS", () => {
    beforeEach(() => seed("depois"))
    it("Smut → Smut (forte)", async () => expect(await destino("Smut")).toMatchObject({ slug: "smut", forte: true }))
    it("Hentai → Hentai (forte)", async () => expect(await destino("Hentai")).toMatchObject({ slug: "hentai", forte: true }))
    it("Ecchi NÃO vira Smut nem Sexual Content", async () => expect(await destino("Ecchi")).toMatchObject({ slug: "ecchi", forte: false }))
    it("Erotica fica à parte (não é fundida em Smut)", async () => expect((await destino("Erotica")).slug).toBe("erotica"))
    it("Mature NÃO vira Adult sexual: rótulo sem sinal 18+", async () =>
      expect(await destino("Mature")).toMatchObject({ slug: "mature", sinal: false, forte: false }))
    it("alias que inventava ato deixa de existir: a string vira tag própria (e passa pelo enriquecimento)", async () => {
      for (const [nome, inventado] of [["Multiple Sexual Partners", "gangbang"], ["Urination", "squirting"], ["Exhibitionism", "public-sex"], ["Rimjob", "anal-sex"]]) {
        const d = await destino(nome)
        expect(d.slug, nome).not.toBe(inventado)
        expect(d.criada, nome).toBe(true)
        expect(d.sinal, nome).toBe(false) // nasce sem sinal; quem decide é o enricher (status pending)
      }
    })
    it("'R15' sozinho não vira 'R15 but Based on a R19 Novel': vira tag própria", async () => {
      const d = await destino("R15")
      expect(d.slug).not.toBe("r15-but-based-on-a-r19-novel")
      expect(d.criada).toBe(true)
    })
    it("conceito relacionado não é sinônimo: a string vira tag própria, sem sinal, em vez de herdar o destino", async () => {
      const casos: Array<[string, string]> = [
        ["Submission", "bdsm"], // geral → prática sexual forte (ligaria o gate)
        ["Spanking", "whipping"], // ato diferente
        ["Dubious Consent", "sexual-abuse"], // inventava abuso
        ["Choking", "asphyxiation"], // não há equivalência literal
        ["Erotic Asphyxiation", "asphyxiation"], // prática sexual virava conceito geral
        ["Abuse", "physical-abuse"], // geral virava violência física
        ["Child Abuse", "physical-abuse"],
        ["Stockings", "fetish-es"], // roupa virava fetiche
        ["Tail Plug", "fetish-es"],
        ["Nipple Play", "nipples"], // ato virava anatomia
        ["Sexual Curiosity", "sexual-teasing"], // traço virava ato
      ]
      for (const [nome, antigo] of casos) {
        const d = await destino(nome)
        expect(d.slug, nome).not.toBe(antigo)
        expect(d.criada, nome).toBe(true)
        expect(d.forte, nome).toBe(false)
      }
    })
    it("sentido invertido: 'added censorship' não produz 'uncensored', e vítima não vira agressor", async () => {
      const censura = await destino("English Company Added Censorship")
      expect(censura.slug).not.toBe("uncensored-version-available")
      expect(censura.criada).toBe(true)
      const vitima = await destino("Abused Family Member/s")
      expect(vitima.slug).not.toBe("abusive-family-member-s")
      expect(vitima.criada).toBe(true)
    })
    it("nakadashi → Nakadashi / Creampie (ia para Condom/s) e orgy → Orgy/ies (ia para Gangbang)", async () => {
      expect((await destino("Nakadashi")).slug).toBe("nakadashi-creampie")
      expect((await destino("Orgy")).slug).toBe("orgy-ies")
    })
  })
})
