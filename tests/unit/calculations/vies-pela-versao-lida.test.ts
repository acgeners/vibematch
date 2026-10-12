import { describe, it, expect } from "vitest"
import { biasReferenceValue, recomputeAttributeBias, type BiasEditionContext } from "@/lib/calculations/attribute-bias"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * `attribute_bias` (o offset da pós-leitura de atributos) pela VERSÃO LIDA (mig 216): a amostra de
 * `adult_content` de uma obra mixed compara a leitura da pessoa com a nota de IA DA VERSÃO que ela leu —
 * nunca com a nota misturada, e nunca com a da outra versão. Versão desconhecida mantém o histórico.
 */
const row = (slug: string, ia: number) => ({ attribute_slug: slug, ia_value_at_assessment: ia })
const ctx = (over: Partial<BiasEditionContext>): BiasEditionContext => ({ isMixed: true, readEdition: "r18", editionScore: null, ...over })

describe("biasReferenceValue — a nota de IA contra a qual a pessoa julgou", () => {
  it("fora de adult_content, ou obra não-mixed, ou versão desconhecida: o snapshot de sempre", () => {
    expect(biasReferenceValue(row("romance", 7), ctx({ editionScore: { score: 2, source: "ai_evaluated" } }))).toBe(7)
    expect(biasReferenceValue(row("adult_content", 9), null)).toBe(9)
    expect(biasReferenceValue(row("adult_content", 9), ctx({ isMixed: false }))).toBe(9)
    expect(biasReferenceValue(row("adult_content", 9), ctx({ readEdition: null, editionScore: null }))).toBe(9)
  })
  it("versão lida com a nota legada reaproveitada (reused_existing) ⇒ o snapshot (é a mesma nota de IA)", () => {
    expect(biasReferenceValue(row("adult_content", 9), ctx({ editionScore: { score: 9.5, source: "reused_existing" } }))).toBe(9)
  })
  it("a IA avaliou a versão lida (ai_evaluated) ⇒ a nota DELA", () => {
    expect(biasReferenceValue(row("adult_content", 9), ctx({ readEdition: "normal", editionScore: { score: 4, source: "ai_evaluated" } }))).toBe(4)
  })
  it("versão lida SEM nota ⇒ fora (nunca a da outra versão nem a misturada)", () => {
    expect(biasReferenceValue(row("adult_content", 9), ctx({ editionScore: { score: null, source: "not_rated" } }))).toBeNull()
    expect(biasReferenceValue(row("adult_content", 9), ctx({ editionScore: null }))).toBeNull()
  })
  it("nota da versão que NÃO é de IA (baseline provisório, curadoria) ⇒ fora: o viés mede o erro da IA", () => {
    expect(biasReferenceValue(row("adult_content", 9), ctx({ readEdition: "normal", editionScore: { score: 5, source: "inferred_base" } }))).toBeNull()
    expect(biasReferenceValue(row("adult_content", 9), ctx({ editionScore: { score: 8, source: "curator_confirmed" } }))).toBeNull()
  })
})

/** Banco falso com `.order().range()` (o paginador) e `.in()/.eq()` (os lotes de contexto). */
function fakeDb(tabelas: Record<string, Array<Record<string, unknown>>>, gravado: Array<Record<string, unknown>>) {
  return {
    from(t: string) {
      const filtros: Array<(r: Record<string, unknown>) => boolean> = []
      let faixa: [number, number] | null = null
      const ordem: string[] = []
      const exec = () => {
        let rows = (tabelas[t] ?? []).filter((r) => filtros.every((f) => f(r)))
        if (ordem.length) rows = [...rows].sort((a, b) => ordem.map((c) => String(a[c]).localeCompare(String(b[c]))).find((x) => x !== 0) ?? 0)
        // O PostgREST corta em 1.000 por resposta MESMO com range (db-max-rows); sem range, o corte é calado.
        rows = faixa ? rows.slice(faixa[0], Math.min(faixa[1] + 1, faixa[0] + 1000)) : rows.slice(0, 1000)
        return { data: rows, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), chain),
        in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), chain),
        order: (c: string) => (ordem.push(c), chain),
        range: (a: number, b: number) => ((faixa = [a, b]), chain),
        upsert: (rows: Array<Record<string, unknown>>) => (gravado.push(...rows), Promise.resolve({ error: null })),
        then: (ok: (v: unknown) => void) => ok(exec()),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe("recomputeAttributeBias — lê TUDO e respeita a versão lida", () => {
  const U = "u1"
  // 1.200 amostras de romance (acima do corte de 1.000) com delta +1, e 3 de adult_content.
  const amostras = [
    ...Array.from({ length: 1200 }, (_, i) => ({ user_id: U, work_id: `w${String(i).padStart(4, "0")}`, attribute_slug: "romance", user_value: 6, ia_value_at_assessment: 7 })),
    { user_id: U, work_id: "mixR18", attribute_slug: "adult_content", user_value: 8, ia_value_at_assessment: 9 }, // r18 reaproveitada ⇒ +1
    { user_id: U, work_id: "mixSemNota", attribute_slug: "adult_content", user_value: 8, ia_value_at_assessment: 9 }, // r18 not_rated ⇒ fora
    { user_id: U, work_id: "single", attribute_slug: "adult_content", user_value: 5, ia_value_at_assessment: 7 }, // não-mixed ⇒ +2
  ]
  const catalogo = {
    work_edition_state: [{ work_id: "mixR18", state: "mixed" }, { work_id: "mixSemNota", state: "mixed" }],
    work_edition_scores: [
      { work_id: "mixR18", edition: "r18", criterion_slug: "adult_content", score: 9.5, source: "reused_existing" },
      { work_id: "mixSemNota", edition: "r18", criterion_slug: "adult_content", score: null, source: "not_rated" },
      { work_id: "mixSemNota", edition: "normal", criterion_slug: "adult_content", score: 4, source: "ai_evaluated" },
    ],
  }
  const sessao = {
    user_attribute_assessment: amostras,
    user_work_state: [
      { user_id: U, work_id: "mixR18", read_edition: "r18" },
      { user_id: U, work_id: "mixSemNota", read_edition: "r18" },
    ],
  }

  it("as 1.200 amostras de romance entram todas (o corte de 1.000 não morde)", async () => {
    const gravado: Array<Record<string, unknown>> = []
    const r = await recomputeAttributeBias(U, fakeDb(sessao, gravado), fakeDb(catalogo, []))
    expect(r.find((c) => c.attributeSlug === "romance")!.nSamples).toBe(1200)
  })

  it("adult_content: a R18 sem nota fica fora; a reaproveitada e a não-mixed entram", async () => {
    const gravado: Array<Record<string, unknown>> = []
    const r = await recomputeAttributeBias(U, fakeDb(sessao, gravado), fakeDb(catalogo, []))
    const adulto = r.find((c) => c.attributeSlug === "adult_content")!
    expect(adulto.nSamples).toBe(2)
    expect(adulto.meanBiasRaw).toBeCloseTo(1.5, 6)
    expect(gravado.find((g) => g.attribute_slug === "adult_content")?.n_samples).toBe(2)
  })

  it("versão desconhecida ⇒ o histórico (o snapshot entra)", async () => {
    const semVersao = { ...sessao, user_work_state: [] }
    const r = await recomputeAttributeBias(U, fakeDb(semVersao, []), fakeDb(catalogo, []))
    expect(r.find((c) => c.attributeSlug === "adult_content")!.nSamples).toBe(3)
  })

  it("o catálogo vem do cliente de CATÁLOGO: lido pela sessão (0 linhas), a correção sumiria calada", async () => {
    // Se o código lesse work_edition_state pela SESSÃO, nenhuma obra seria mixed e a R18 sem nota entraria.
    const r = await recomputeAttributeBias(U, fakeDb(sessao, []), fakeDb({}, []))
    expect(r.find((c) => c.attributeSlug === "adult_content")!.nSamples).toBe(3)
    const certo = await recomputeAttributeBias(U, fakeDb(sessao, []), fakeDb(catalogo, []))
    expect(certo.find((c) => c.attributeSlug === "adult_content")!.nSamples).toBe(2)
  })
})
