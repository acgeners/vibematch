import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

/**
 * O apêndice de evidência de ARTE (v32/art4) e a FORÇA da evidência.
 *
 * O que se defende aqui: o apêndice só ACRESCENTA — as ≤30 reviews dos 11 ficam byte-idênticas,
 * produção nunca o desenha — e a força só INFORMA — nunca muda um rótulo.
 */

vi.mock("server-only", () => ({}))

import {
  ART_APPENDIX_MAX,
  ART_APPENDIX_TRECHO_MAX,
  selecionarApendiceArte,
} from "@/lib/ai-evaluation/art-appendix"
import type { ArtAppendixItem } from "@/lib/ai-evaluation/art-appendix"
import { forcaDaMudanca, forcaDaQualidade, normalizarArte } from "@/lib/ai-evaluation/art-signal"
import {
  buildUserPrompt,
  PRODUCTION_VARIANT,
  INSTRUCAO_APENDICE_ARTE,
  interpretarRespostaDaTool,
  prepareReviews,
  VARIANTE_V30,
} from "@/lib/ai-evaluation/service"
import type { AiEvaluationRequest } from "@/lib/ai-evaluation/service"
import { classificarEvidenciaDeArte } from "@/lib/art/signal"
import type { SourcedReview } from "@/lib/external/types"
import { CRITERION_SLUGS } from "@/types/domain"

const rev = (text: string, source = "mangaupdates", textLength?: number): SourcedReview =>
  ({ source, sourceTitle: "Obra", matchScore: 0.95, text, textLength: textLength ?? text.length }) as SourcedReview

/** Texto neutro e único: sem termo de arte, e distinto o bastante para o dedup não juntar. */
const neutra = (i: number) =>
  `Review number ${i} talks about the plot pacing, character ${i}, the romance arc and chapter ${i * 7} twists without any visual comment at all.`

describe("classificarEvidenciaDeArte", () => {
  it("julgamento: termo de arte com avaliação perto", () => {
    expect(classificarEvidenciaDeArte("The art is absolutely gorgeous in every chapter.")).toMatchObject({ mencao: true, julga: true })
  })
  it("nota numérica de arte conta como julgamento", () => {
    expect(classificarEvidenciaDeArte("Story 7/10. Art: 9/10. Characters 8/10.").julga).toBe(true)
  })
  it("mudança: termo de arte com trajetória perto", () => {
    expect(classificarEvidenciaDeArte("The art gradually improves after chapter 40.").mudanca).toBe(true)
  })
  it('"drawn together" é atração, não desenho', () => {
    expect(classificarEvidenciaDeArte("They are still drawn together despite everything, great story.")).toMatchObject({ mencao: false, julga: false })
  })
  it("menção solta não é julgamento", () => {
    expect(classificarEvidenciaDeArte("I read it for the art and stayed for the plot.")).toMatchObject({ mencao: true, julga: false, mudanca: false })
  })
  it("o trecho funde janelas próximas e não corta palavra no começo", () => {
    const t = `${"x ".repeat(200)}The art is lovely and the art style is clean.${" y".repeat(200)}`
    const e = classificarEvidenciaDeArte(t)
    expect(e.trecho.split(" … ")).toHaveLength(1)
    expect(e.trecho).toContain("The art is lovely and the art style is clean.")
  })
})

describe("selecionarApendiceArte", () => {
  // Vocabulário EXCLUSIVO por review (8 termos de 4+ letras): o dedup compara o conjunto dessas
  // palavras (Jaccard ≥ 0,75), e frases parecidas seriam juntadas — corretamente.
  const artes = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      rev(`About ${Array.from({ length: 8 }, (_, k) => `termo${i}x${k}`).join(" ")}: the art is beautiful and detailed.`),
    )

  it(`teto de ${ART_APPENDIX_MAX} itens, ids A1…An, e o resto contado como fora pelo teto`, () => {
    const s = selecionarApendiceArte(artes(14), [])
    expect(s.itens.map((i) => i.id)).toEqual(Array.from({ length: ART_APPENDIX_MAX }, (_, i) => `A${i + 1}`))
    expect(s.candidatasNoPool).toBe(14)
    expect(s.foraPeloTeto).toBe(4)
  })

  it("não repete review que JÁ está nas enviadas (mesma régua do prepareReviews)", () => {
    const pool = artes(5)
    const s = selecionarApendiceArte(pool, [pool[1], pool[3]])
    expect(s.jaNoPrompt).toBe(2)
    expect(s.itens).toHaveLength(3)
    for (const i of s.itens) expect([pool[1].text, pool[3].text].some((t) => t.includes(i.trecho))).toBe(false)
  })

  it("deduplica DENTRO do pool (review repetida entre fontes entra uma vez)", () => {
    const a = rev("The art is beautiful and the colors are stunning throughout the whole story.", "mangadex")
    const b = rev("The art is beautiful and the colors are stunning throughout the whole story.", "comix")
    const s = selecionarApendiceArte([a, b], [])
    expect(s.itens).toHaveLength(1)
    // a contagem de candidatas é a base da cobertura reportada: repetida não pode contar duas vezes
    expect(s.candidatasNoPool).toBe(1)
  })

  it("só entra review com EVIDÊNCIA (julga ou mudança) — menção solta e review sem arte ficam de fora", () => {
    const s = selecionarApendiceArte([rev(neutra(1)), rev("I came for the art, stayed for the plot."), ...artes(1)], [])
    expect(s.candidatasNoPool).toBe(1)
    expect(s.itens).toHaveLength(1)
  })

  it("ordem: julga+mudança, depois julga, depois só mudança; empate pela mais longa", () => {
    const soMuda = rev("Honestly the art changes a lot after chapter 50, which I noticed.")
    const julgaCurta = rev("The art is gorgeous.")
    const julgaLonga = rev("The art is gorgeous, and every single page of this long story is a pleasure to look at.")
    const ambas = rev("The art is gorgeous and it improves after chapter 20.")
    const ids = selecionarApendiceArte([soMuda, julgaCurta, julgaLonga, ambas], []).itens.map((i) => i.trecho)
    expect(ids[0]).toContain("improves after chapter 20")
    expect(ids[1]).toContain("pleasure to look at")
    expect(ids[2]).toBe("The art is gorgeous.")
    expect(ids[3]).toContain("changes a lot")
  })

  it(`trecho limitado a ${ART_APPENDIX_TRECHO_MAX} chars`, () => {
    const longo = Array.from({ length: 30 }, (_, i) => `The art in part ${i} is beautiful and detailed.`).join(" ")
    const [item] = selecionarApendiceArte([rev(longo)], []).itens
    expect(item.trecho.length).toBeLessThanOrEqual(ART_APPENDIX_TRECHO_MAX)
  })

  it("é determinística: a mesma entrada dá a mesma saída", () => {
    const pool = [...artes(12), rev(neutra(2))]
    expect(selecionarApendiceArte(pool, [pool[0]])).toEqual(selecionarApendiceArte([...pool], [pool[0]]))
  })
})

// ── Registro: as 16 obras do gate ─────────────────────────────────────────────────────────────

type ObraFixture = {
  celula: string
  poolTotal: number
  candidatas: Array<{ source: string; textLength: number; text: string }>
  enviadasQueColidem: Array<{ text: string }>
  esperado: {
    candidatasNoPool: number
    jaNoPrompt: number
    foraPeloTeto: number
    itens: Array<{ id: string; source: string; julga: boolean; mudanca: boolean; chars: number; sha: string }>
  }
}
const GATE = JSON.parse(readFileSync("tests/fixtures/ai-evaluation/apendice-arte-gate16.json", "utf8")) as { obras: ObraFixture[] }

describe("registro: o apêndice nas 16 obras congeladas do gate", () => {
  it("são as 16 obras (E01–E12, S1–S4)", () => {
    expect(GATE.obras.map((o) => o.celula)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`),
      "S1",
      "S2",
      "S3",
      "S4",
    ])
  })

  for (const o of GATE.obras) {
    it(`${o.celula}: entram exatamente os itens registrados (${o.esperado.itens.length}), e os que ficaram de fora estão contados`, () => {
      const s = selecionarApendiceArte(
        o.candidatas.map((c) => rev(c.text, c.source, c.textLength)),
        o.enviadasQueColidem.map((e) => rev(e.text)),
      )
      expect(s.candidatasNoPool).toBe(o.esperado.candidatasNoPool)
      expect(s.jaNoPrompt).toBe(o.esperado.jaNoPrompt)
      expect(s.foraPeloTeto).toBe(o.esperado.foraPeloTeto)
      expect(
        s.itens.map((i) => ({
          id: i.id,
          source: i.source,
          julga: i.julga,
          mudanca: i.mudanca,
          chars: i.trecho.length,
          sha: createHash("sha256").update(i.trecho).digest("hex").slice(0, 16),
        })),
      ).toEqual(o.esperado.itens)
    })
  }

  it("cobertura da evidência de arte do pool: 34% antes → 89% depois (medida em 2026-10-01)", () => {
    const pool = GATE.obras.reduce((s, o) => s + o.esperado.candidatasNoPool, 0)
    const antes = GATE.obras.reduce((s, o) => s + o.esperado.jaNoPrompt, 0)
    const depois = antes + GATE.obras.reduce((s, o) => s + o.esperado.itens.length, 0)
    expect([pool, antes, depois]).toEqual([204, 69, 182])
  })
})

// ── Prompt: produção intacta, as 30 intactas ──────────────────────────────────────────────────

const pedido = (extra: Partial<AiEvaluationRequest> = {}): AiEvaluationRequest =>
  ({
    workId: "00000000-0000-0000-0004-000000000001",
    title: "Obra",
    synopsis: "Sinopse.",
    genres: ["Romance"],
    tags: [],
    sourcedReviews: [rev("The art is gorgeous and detailed in every chapter of this story."), rev(neutra(1))],
    platformRatings: [],
    externalContext: ["Contexto."],
    ...extra,
  }) as unknown as AiEvaluationRequest

const APENDICE: ArtAppendixItem[] = [
  { id: "A1", source: "comix", trecho: "The art is stunning ===== and the colors pop.", julga: true, mudanca: false },
  { id: "A2", source: "mangadex", trecho: "The art got noticeably worse after chapter 80.", julga: false, mudanca: true },
]

describe("prompt", () => {
  it("PRODUÇÃO ignora o apêndice: o prompt v30 é o mesmo com e sem ele", () => {
    const r = pedido()
    expect(buildUserPrompt({ ...r, artAppendix: APENDICE }, prepareReviews(r), VARIANTE_V30)).toBe(
      buildUserPrompt(r, prepareReviews(r), VARIANTE_V30),
    )
  })

  it("candidata: tirando o bloco do apêndice, o prompt é byte a byte o de antes — as reviews principais não mudam", () => {
    const r = pedido()
    const sem = buildUserPrompt(r, prepareReviews(r), PRODUCTION_VARIANT)
    const com = buildUserPrompt({ ...r, artAppendix: APENDICE }, prepareReviews(r), PRODUCTION_VARIANT)
    const ini = com.indexOf(`\n\n${INSTRUCAO_APENDICE_ARTE}`)
    const fim = com.indexOf("===== FIM REVIEW A2 =====") + "===== FIM REVIEW A2 =====".length
    expect(ini).toBeGreaterThan(0)
    expect(com.slice(0, ini) + com.slice(fim)).toBe(sem)
  })

  it("candidata: cada item vai na fronteira textual, com o id A…, a fonte, e o `=====` do texto escapado", () => {
    const r = pedido({ artAppendix: APENDICE })
    const p = buildUserPrompt(r, prepareReviews(r), PRODUCTION_VARIANT)
    expect(p).toContain('===== INÍCIO REVIEW A1 · fonte: "comix" · origem: "apendice_arte" =====')
    expect(p).toContain("The art is stunning ＝＝＝＝＝ and the colors pop.")
    expect(p).toContain("===== FIM REVIEW A2 =====")
  })

  it("sem itens, não há cabeçalho de apêndice (o B é o v32 do gate anterior)", () => {
    const r = pedido({ artAppendix: [] })
    expect(buildUserPrompt(r, prepareReviews(r), PRODUCTION_VARIANT)).not.toContain(INSTRUCAO_APENDICE_ARTE)
  })
})

// ── Validação: ids A… e isolamento dos 11 ─────────────────────────────────────────────────────

const onze = () => ({
  summary: "Resumo válido.",
  confidence: 0.8,
  scores: CRITERION_SLUGS.map((criterion, i) => ({ criterion, score: 4 + (i % 5), justification: "Faixa 4-6: presente." })),
})

describe("validação da Arte com o apêndice", () => {
  const pool = [
    rev("The art is gorgeous and detailed in every chapter of this story."),
    rev("Beautiful art, the coloring is stunning.", "comix"),
    rev("Lovely art and pretty character designs everywhere.", "kitsu"),
  ]
  const req = pedido({ sourcedReviews: [pool[0]] })
  const apendice = selecionarApendiceArte(pool, prepareReviews(req).sourcedReviews ?? []).itens
  const reqB = { ...req, artAppendix: apendice }
  const art = {
    judging_reviews: [
      { review_id: "R1", stance: "positive" },
      { review_id: "A1", stance: "positive" },
      { review_id: "A2", stance: "positive" },
    ],
    quality_signal: "ABOVE_AVERAGE",
    quality_evidence: [{ review_id: "A1", excerpt: apendice[0].trecho.slice(0, 30) }],
    change_signal: "NO_CLEAR_SIGNAL",
    change_evidence: [],
    justification: "Elogio consistente.",
  }

  it("ids A… contam como reviews DISTINTAS e citação literal do trecho enviado é aceita", () => {
    expect(apendice.map((a) => a.id)).toEqual(["A1", "A2"])
    const r = interpretarRespostaDaTool({ ...onze(), art }, reqB, prepareReviews(reqB), "claude-sonnet-5", "h", PRODUCTION_VARIANT)
    expect(r.tipo).toBe("aceita")
    if (r.tipo !== "aceita") return
    expect(r.resposta.art?.quality_signal).toBe("ABOVE_AVERAGE")
    expect(r.resposta.art?.contagens.total).toBe(3)
    expect(r.resposta.art?.evidence_strength.quality).toBe("LOW")
  })

  it("SEM o apêndice no request, os mesmos ids A… não existem: o piso cai e o rótulo vira INCONCLUSIVE", () => {
    const r = interpretarRespostaDaTool({ ...onze(), art }, req, prepareReviews(req), "claude-sonnet-5", "h", PRODUCTION_VARIANT)
    expect(r.tipo === "aceita" && r.resposta.art?.quality_signal).toBe("INCONCLUSIVE")
  })

  it("os 11 são os mesmos com e sem apêndice, e iguais aos da produção", () => {
    const notas = (x: ReturnType<typeof interpretarRespostaDaTool>) =>
      x.tipo === "aceita" ? x.resposta.scores.map((s) => [s.criterionSlug, s.suggestedScore, s.justification]) : null
    const prod = notas(interpretarRespostaDaTool(onze(), req, prepareReviews(req), "claude-sonnet-5", "h", VARIANTE_V30))
    const comAp = notas(interpretarRespostaDaTool({ ...onze(), art }, reqB, prepareReviews(reqB), "claude-sonnet-5", "h", PRODUCTION_VARIANT))
    const artInvalida = notas(
      interpretarRespostaDaTool({ ...onze(), art: { lixo: 1 } }, reqB, prepareReviews(reqB), "claude-sonnet-5", "h", PRODUCTION_VARIANT),
    )
    expect(comAp).toEqual(prod)
    expect(artInvalida).toEqual(prod)
  })
})

// ── Força da evidência ────────────────────────────────────────────────────────────────────────

const contagens = (positive: number, negative = 0, competent = 0, mixed = 0) => ({
  positive,
  negative,
  competent,
  mixed,
  total: positive + negative + competent + mixed,
})

describe("força da evidência (qualidade)", () => {
  it("LOW com 3–4, MEDIUM com 5–9, HIGH com ≥10 e concordância ≥70%", () => {
    expect(forcaDaQualidade("ABOVE_AVERAGE", contagens(3)).quality).toBe("LOW")
    expect(forcaDaQualidade("ABOVE_AVERAGE", contagens(4)).quality).toBe("LOW")
    expect(forcaDaQualidade("ABOVE_AVERAGE", contagens(5)).quality).toBe("MEDIUM")
    expect(forcaDaQualidade("ABOVE_AVERAGE", contagens(9)).quality).toBe("MEDIUM")
    expect(forcaDaQualidade("ABOVE_AVERAGE", contagens(7, 3)).quality).toBe("HIGH") // 10, 70%
  })

  it("≥10 SEM 70% de concordância não vira HIGH: fica MEDIUM", () => {
    const f = forcaDaQualidade("ABOVE_AVERAGE", contagens(6, 2, 2)) // 10, 60%
    expect(f.quality).toBe("MEDIUM")
    expect(f.quality_agreement).toBeCloseTo(0.6)
  })

  it("a concordância segue a posição do rótulo (competent para AVERAGE, negative para BELOW)", () => {
    expect(forcaDaQualidade("AVERAGE", contagens(1, 1, 3)).quality_agreement).toBeCloseTo(0.6)
    expect(forcaDaQualidade("BELOW_AVERAGE", contagens(1, 4)).quality_agreement).toBeCloseTo(0.8)
  })

  it("INCONCLUSIVE não tem força (null)", () => {
    expect(forcaDaQualidade("INCONCLUSIVE", contagens(12))).toEqual({ quality: null, quality_agreement: null })
  })
})

describe("força da evidência (mudança)", () => {
  const ev = (...ids: string[]) => ids.map((review_id) => ({ review_id, excerpt: "the art got worse later" }))
  it("LOW com 1 review distinta, MEDIUM com 2–3, HIGH com ≥4; repetida conta uma vez", () => {
    expect(forcaDaMudanca("CHANGE_NOTED", ev("R1")).change).toBe("LOW")
    expect(forcaDaMudanca("CHANGE_NOTED", ev("R1", "R1")).change).toBe("LOW")
    expect(forcaDaMudanca("CHANGE_NOTED", ev("R1", "A2")).change).toBe("MEDIUM")
    expect(forcaDaMudanca("PROBLEMATIC_CHANGE", ev("R1", "R2", "R3", "A1")).change).toBe("HIGH")
  })
  it("NO_CLEAR_SIGNAL não tem força", () => {
    expect(forcaDaMudanca("NO_CLEAR_SIGNAL", ev()).change).toBeNull()
  })
})

describe("a força NUNCA muda o rótulo", () => {
  const REVIEWS = Array.from({ length: 12 }, (_, i) => ({ id: `R${i + 1}`, text: `Review ${i}: the art is beautiful and detailed.` }))
  const raw = (pos: number, neg: number) => ({
    judging_reviews: [
      ...Array.from({ length: pos }, (_, i) => ({ review_id: `R${i + 1}`, stance: "positive" })),
      ...Array.from({ length: neg }, (_, i) => ({ review_id: `R${pos + i + 1}`, stance: "negative" })),
    ],
    quality_signal: "ABOVE_AVERAGE",
    quality_evidence: [{ review_id: "R1", excerpt: "the art is beautiful and detailed" }],
    change_signal: "NO_CLEAR_SIGNAL",
    change_evidence: [],
    justification: "x",
  })

  it("o mesmo ABOVE sai com força LOW, MEDIUM ou HIGH — o rótulo não muda com a força", () => {
    const casos = [raw(3, 0), raw(6, 0), raw(11, 1)].map((r) => normalizarArte(r, REVIEWS))
    expect(casos.map((a) => a.quality_signal)).toEqual(["ABOVE_AVERAGE", "ABOVE_AVERAGE", "ABOVE_AVERAGE"])
    expect(casos.map((a) => a.evidence_strength.quality)).toEqual(["LOW", "MEDIUM", "HIGH"])
    expect(casos.every((a) => a.rebaixamentos.length === 0)).toBe(true)
  })

  it("Arte ausente, inválida ou abstida: força nula nos dois eixos", () => {
    for (const a of [normalizarArte(undefined, REVIEWS), normalizarArte({ quality_signal: 1 }, REVIEWS), normalizarArte(raw(2, 0), REVIEWS)]) {
      expect(a.evidence_strength.quality).toBeNull()
      expect(a.evidence_strength.change).toBeNull()
    }
  })
})
