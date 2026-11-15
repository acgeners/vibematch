// @vitest-environment node
// Classificação etária (migration 223): a regra de exibição por versão, o 18+ ligado pela faixa 18
// (`official_rating`) e o plano da carga. Decisões da curadora (15/11/2026): faixas Livre a 14 · 16 · 18;
// versão com conteúdo explícito é 18 SEMPRE; "ocultar 18+" esconde idade 18 E explícito pela mesma
// coluna; o override manual continua vencendo; conflito vai para a fila em vez de ganhar faixa baixa.
import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "../tags/fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }) }))

import { ageRatingFor, ageRatingExplanation } from "@/lib/age-rating/age-rating"
import type { AgeRatingRow } from "@/lib/age-rating/age-rating"
import { decideAdultAuto, planAdultAuto, recomputeAdultAuto } from "@/lib/tags/adult-classify"
import { planejarCarga, planejarGate } from "@/scripts/lib/classificacao-etaria"
import type { LinhaCarga, LinhaGravada, ObraAtual } from "@/scripts/lib/classificacao-etaria"
import { resolveAgeRatingConflict } from "@/server/actions/age-rating"

const row = (versao: AgeRatingRow["versao"], faixa: AgeRatingRow["faixa"], extra: Partial<AgeRatingRow> = {}): AgeRatingRow => ({
  versao,
  faixa,
  conflito: null,
  decidido_por: "auditoria",
  ...extra,
})

describe("ageRatingFor — a faixa exibida para a versão aberta", () => {
  it("obra não-mixed: a linha `obra`, com a origem", () => {
    expect(ageRatingFor({ isMixed: false, isAdult: false, activeEdition: null, rows: [row("obra", 16)] })).toEqual({
      faixa: 16,
      origem: "oficial",
      pendente: false,
    })
    expect(
      ageRatingFor({ isMixed: false, isAdult: false, activeEdition: null, rows: [row("obra", 14, { decidido_por: "curadoria" })] }).origem,
    ).toBe("curadoria")
  })

  it("sem linha: SEM classificação — nunca uma faixa inventada", () => {
    expect(ageRatingFor({ isMixed: false, isAdult: false, activeEdition: null, rows: [] })).toEqual({ faixa: null, origem: "sem", pendente: false })
  })

  it("🔴 versão explícita é 18 SEMPRE, mesmo com faixa oficial baixa na linha", () => {
    const v = ageRatingFor({ isMixed: false, isAdult: true, activeEdition: null, rows: [row("obra", 14, { conflito: "x" })] })
    expect(v.faixa).toBe(18)
    expect(v.origem).toBe("conteudo_adulto")
    expect(v.pendente).toBe(true)
    expect(ageRatingFor({ isMixed: false, isAdult: true, activeEdition: null, rows: [] }).faixa).toBe(18)
  })

  it("obra 18+ pela faixa oficial: origem oficial", () => {
    expect(ageRatingFor({ isMixed: false, isAdult: true, activeEdition: null, rows: [row("obra", 18)] }).origem).toBe("oficial")
  })

  it("mixed: a R18 é 18; a normal usa a linha `normal` e IGNORA a linha `obra`", () => {
    const rows = [row("obra", 18), row("normal", 16)]
    expect(ageRatingFor({ isMixed: true, isAdult: false, activeEdition: "r18", rows }).faixa).toBe(18)
    expect(ageRatingFor({ isMixed: true, isAdult: false, activeEdition: "normal", rows }).faixa).toBe(16)
    expect(ageRatingFor({ isMixed: true, isAdult: false, activeEdition: "normal", rows: [row("obra", 18)] }).faixa).toBeNull()
  })

  it("o tooltip diz de onde veio e quando está em revisão", () => {
    expect(ageRatingExplanation({ faixa: 16, origem: "oficial", pendente: true })).toMatch(/oficial.*Em revisão/)
    expect(ageRatingExplanation({ faixa: null, origem: "sem", pendente: false })).toMatch(/^Sem classificação/)
  })
})

describe("decideAdultAuto — a faixa 18 liga o 18+ (official_rating)", () => {
  const off = { adult_auto: false, adult_reason: null }
  it("faixa 18 sem tag forte liga com official_rating", () => {
    expect(decideAdultAuto(off, false, true)).toEqual({ adult_auto: true, adult_reason: "official_rating" })
  })
  it("tag forte tem precedência no motivo", () => {
    expect(decideAdultAuto(off, true, true)).toEqual({ adult_auto: true, adult_reason: "tag_explicit" })
    expect(decideAdultAuto({ adult_auto: true, adult_reason: "official_rating" }, true, true)).toEqual({
      adult_auto: true,
      adult_reason: "tag_explicit",
    })
  })
  it("perder a faixa 18 desliga o que a faixa ligou", () => {
    expect(decideAdultAuto({ adult_auto: true, adult_reason: "official_rating" }, false, false)).toEqual({ adult_auto: false, adult_reason: null })
  })
  it("estável: já ligada por official_rating não regrava", () => {
    expect(decideAdultAuto({ adult_auto: true, adult_reason: "official_rating" }, false, true)).toBeNull()
  })
  it("a 2ª opinião `ai_review` segue intocada; a 'limpa' perde para a faixa oficial", () => {
    expect(decideAdultAuto({ adult_auto: true, adult_reason: "ai_review" }, false, false)).toBeNull()
    expect(decideAdultAuto({ adult_auto: false, adult_reason: "ai_review_clean" }, false, true)).toEqual({
      adult_auto: true,
      adult_reason: "official_rating",
    })
  })
  it("sem o 3º argumento, a régua antiga (só tag) não muda", () => {
    expect(decideAdultAuto(off, false)).toBeNull()
    expect(decideAdultAuto(off, true)).toEqual({ adult_auto: true, adult_reason: "tag_explicit" })
  })
})

function seed() {
  h.db = new FakeDb()
  const d = h.db.tables
  d.works = [{ id: "w1", title: "Obra", adult_auto: false, adult_reason: null, adult_override: null }]
  d.tags = [{ id: "t-forte", name: "Cunnilingus", adult_indicator: true, adult_indicator_strong: true }]
  d.work_tags = []
  d.work_age_rating = []
}

describe("recomputeAdultAuto lê a classificação (mesma régua no formulário e na fila)", () => {
  beforeEach(seed)
  it("faixa 18 na linha `obra` liga; faixa 16 não", async () => {
    h.db.tables.work_age_rating = [{ work_id: "w1", versao: "obra", faixa: 18, conflito: null, decidido_por: "auditoria" }]
    await recomputeAdultAuto(h.db.client() as never, "w1")
    expect(h.db.rows("works")[0]).toMatchObject({ adult_auto: true, adult_reason: "official_rating" })
    h.db.tables.work_age_rating[0].faixa = 16
    await recomputeAdultAuto(h.db.client() as never, "w1")
    expect(h.db.rows("works")[0]).toMatchObject({ adult_auto: false, adult_reason: null })
  })
  it("a linha `normal` (mixed) não liga o gate da obra", async () => {
    h.db.tables.work_age_rating = [{ work_id: "w1", versao: "normal", faixa: 18, conflito: "x", decidido_por: "auditoria" }]
    expect(await planAdultAuto(h.db.client() as never, "w1")).toBeNull()
  })
  it("🔴 erro ao ler a classificação NÃO vira 'sem sinal': nada é gravado", async () => {
    h.db.tables.works[0] = { ...h.db.tables.works[0], adult_auto: true, adult_reason: "official_rating" }
    h.db.failWhen = (q) => (q.table === "work_age_rating" ? "boom" : null)
    await expect(planAdultAuto(h.db.client() as never, "w1")).rejects.toThrow(/work_age_rating: boom/)
    await recomputeAdultAuto(h.db.client() as never, "w1")
    expect(h.db.rows("works")[0]).toMatchObject({ adult_auto: true, adult_reason: "official_rating" })
  })
})

describe("resolveAgeRatingConflict — a curadoria decide e o conflito sai da fila", () => {
  beforeEach(seed)
  it("definir 18 grava como curadoria, limpa o conflito e liga o 18+", async () => {
    h.db.tables.work_age_rating = [{ work_id: "w1", versao: "obra", faixa: null, conflito: "x", decidido_por: "auditoria" }]
    expect(await resolveAgeRatingConflict("w1", "obra", 18)).toEqual({})
    expect(h.db.rows("work_age_rating")[0]).toMatchObject({ faixa: 18, conflito: null, decidido_por: "curadoria" })
    expect(h.db.rows("works")[0]).toMatchObject({ adult_auto: true, adult_reason: "official_rating" })
  })
  it("'sem classificação' também resolve; faixa fora da régua é recusada", async () => {
    h.db.tables.work_age_rating = [{ work_id: "w1", versao: "obra", faixa: 18, conflito: "x", decidido_por: "auditoria" }]
    expect((await resolveAgeRatingConflict("w1", "obra", 15)).error).toMatch(/faixa inválida/)
    expect(await resolveAgeRatingConflict("w1", "obra", null)).toEqual({})
    expect(h.db.rows("work_age_rating")[0]).toMatchObject({ faixa: null, conflito: null, decidido_por: "curadoria" })
  })
  it("linha inexistente é erro, não sucesso calado", async () => {
    expect((await resolveAgeRatingConflict("w1", "obra", 16)).error).toMatch(/não encontrada/)
  })
})

describe("planejarCarga — o que a carga grava", () => {
  const linha = (work_id: string, versao: "obra" | "normal", faixa: number | null, extra: Partial<LinhaCarga> = {}): LinhaCarga => ({
    work_id,
    title: work_id,
    versao,
    faixa,
    conflito: null,
    evidencia: { produtos: [] },
    edition_state_auditado: versao === "normal" ? "mixed" : null,
    ...extra,
  })
  const obra = (id: string, edition_state: string | null = null): [string, ObraAtual] => [
    id,
    { id, edition_state, adult_auto: false, adult_reason: null },
  ]

  it("pula obra que sumiu, estrutura que mudou e decisão da curadoria; não regrava o igual", () => {
    const obras = new Map([obra("a"), obra("b", "mixed"), obra("c"), obra("d", "single"), obra("e")])
    const gravadas = new Map<string, LinhaGravada>([
      ["c:obra", { work_id: "c", versao: "obra", faixa: 14, conflito: null, evidencia: {}, decidido_por: "curadoria" }],
      ["e:obra", { work_id: "e", versao: "obra", faixa: 16, conflito: null, evidencia: { produtos: [] }, decidido_por: "auditoria" }],
    ])
    const p = planejarCarga(
      [
        linha("a", "obra", 16),
        linha("sumiu", "obra", 14),
        linha("b", "obra", 18), // virou mixed depois da auditoria
        linha("c", "obra", 18), // a curadoria já decidiu
        linha("d", "normal", 16), // deixou de ser mixed
        linha("e", "obra", 16), // igual
      ],
      obras,
      gravadas,
    )
    expect(p.gravar.map((g) => g.work_id)).toEqual(["a"])
    expect(p.iguais).toBe(1)
    expect(p.puladas.map((x) => x.work_id).sort()).toEqual(["b", "c", "d", "sumiu"])
    expect([p.lidas, p.existentes, p.versaoCompativel, p.livresDeCuradoria]).toEqual([6, 5, 3, 2])
  })

  it("faixa fora da régua ou linha repetida no arquivo derrubam a carga inteira", () => {
    const obras = new Map([obra("a")])
    expect(() => planejarCarga([linha("a", "obra", 15)], obras, new Map())).toThrow(/faixa inválida/)
    expect(() => planejarCarga([linha("a", "obra", 14), linha("a", "obra", 16)], obras, new Map())).toThrow(/repetida/)
  })
})

describe("planejarGate — a carga usa a régua do app", () => {
  it("liga a faixa 18, desliga quem perdeu a faixa, respeita tag forte", () => {
    const obras = new Map<string, ObraAtual>([
      ["a", { id: "a", edition_state: null, adult_auto: false, adult_reason: null }],
      ["b", { id: "b", edition_state: null, adult_auto: true, adult_reason: "official_rating" }],
      ["c", { id: "c", edition_state: null, adult_auto: true, adult_reason: "tag_explicit" }],
    ])
    const g = planejarGate(["a", "b", "c"], obras, new Set(["c"]), new Map([["a", 18], ["b", 16], ["c", 18]]))
    expect(g).toEqual([
      { work_id: "a", antes: { adult_auto: false, adult_reason: null }, depois: { adult_auto: true, adult_reason: "official_rating" } },
      { work_id: "b", antes: { adult_auto: true, adult_reason: "official_rating" }, depois: { adult_auto: false, adult_reason: null } },
    ])
  })
})
