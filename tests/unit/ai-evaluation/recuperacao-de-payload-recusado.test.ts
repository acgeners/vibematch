import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { coerceToolPayload, evaluationToolPayloadSchema } from "@/lib/ai-evaluation/service"
import { recoverEvaluationToolPayload } from "@/lib/ai-evaluation/tool-payload-recovery"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * Os DOIS payloads recusados com conteúdo preservado na nuvem (v31, 2026-09-27), byte a byte.
 * Tudo aqui parte deles ou de mutações deles — nenhum caso "mais fácil" que o real.
 *
 * 🔴 A linha que este arquivo defende: recuperar SÓ a forma exata observada, e continuar
 * recusando qualquer variação. Uma recuperação frouxa trocaria uma retentativa paga (barata)
 * por uma nota plausível e errada no catálogo (cara).
 */

type Caso = { caso: string; bruto: string }
const fixture = JSON.parse(
  readFileSync("tests/fixtures/ai-evaluation/payloads-recusados-v31.json", "utf8"),
) as { casos: Caso[] }
const bruto = (nome: string) => {
  const c = fixture.casos.find((x) => x.caso === nome)
  if (!c) throw new Error(`fixture sem ${nome}`)
  return JSON.parse(c.bruto) as Record<string, unknown>
}
const VAZOU = () => bruto("confidence_vazou_no_summary")
const ASPAS = () => bruto("scores_com_aspas_cruas")
const LEAK = '</parameter>\n<parameter name="confidence">'

/** O caminho de produção até a decisão: coerção, schema, e só então a recuperação. */
function pipeline(input: unknown) {
  const { value } = coerceToolPayload(input)
  const antes = evaluationToolPayloadSchema.safeParse(value)
  const { value: recuperado, recovered } = recoverEvaluationToolPayload(value, CRITERION_SLUGS)
  const depois = evaluationToolPayloadSchema.safeParse(recuperado)
  return { value, antes, recuperado, recovered, depois }
}

describe("antes: o código de hoje RECUSA os dois payloads reais", () => {
  it("caso 1 — reprovado por `confidence` ausente (vazou para dentro do summary)", () => {
    const { antes } = pipeline(VAZOU())
    expect(antes.success).toBe(false)
    expect(antes.error!.issues.map((i) => i.path.join("."))).toEqual(["confidence"])
  })

  it("caso 2 — reprovado por `scores` string: a coerção não desembrulha JSON inválido", () => {
    const { value, antes } = pipeline(ASPAS())
    expect(typeof (value as { scores: unknown }).scores).toBe("string")
    expect(() => JSON.parse((value as { scores: string }).scores)).toThrow()
    expect(antes.success).toBe(false)
    expect(antes.error!.issues.map((i) => i.path.join("."))).toEqual(["scores"])
  })
})

describe("caso 1 — confidence vazado no fim do summary", () => {
  it("recupera: summary = só o texto antes do vazamento; confidence = o número vazado", () => {
    const original = VAZOU()
    const { recuperado, recovered, depois } = pipeline(original)
    expect(recovered).toEqual(["confidence_leaked_into_summary"])
    expect(depois.success).toBe(true)

    const summary = original.summary as string
    const r = recuperado as Record<string, unknown>
    expect(r.summary).toBe(summary.slice(0, summary.indexOf(LEAK)))
    expect(r.summary).toMatch(/"dark romance"\.$/)
    expect(r.confidence).toBe(0.75)
    // Os outros campos não são tocados.
    expect(r.scores).toEqual(original.scores)
  })

  const mutar = (summary: string, extra: Record<string, unknown> = {}) => ({ ...VAZOU(), summary, ...extra })
  const head = () => (VAZOU().summary as string).split(LEAK)[0]

  const negativos: Array<[string, Record<string, unknown>]> = [
    ["confidence não numérico", mutar(`${head()}${LEAK}alta`)],
    ["confidence acima de 1", mutar(`${head()}${LEAK}1.5`)],
    ["confidence negativo", mutar(`${head()}${LEAK}-0.2`)],
    ["confidence em notação científica", mutar(`${head()}${LEAK}7.5e-1`)],
    ["confidence com espaço", mutar(`${head()}${LEAK}0.75 `)],
    ["confidence vazio (estrutura incompleta)", mutar(`${head()}${LEAK}`)],
    ["vazamento NÃO está no fim", mutar(`${head()}${LEAK}0.75</parameter> e mais texto`)],
    ["summary vazio antes do vazamento", mutar(`${LEAK}0.75`)],
    ["vazamento duplicado (dois confidences conflitantes)", mutar(`${head()}${LEAK}0.75${LEAK}0.4`)],
    ["`<parameter>` legítimo no meio do texto", mutar(`Fala de <parameter> na sinopse. ${head()}${LEAK}0.75`)],
    ["outro campo vazando", mutar(`${head()}</parameter>\n<parameter name="reviewsRejectedReason">0.75`)],
    ["só o fechamento, sem a abertura", mutar(`${head()}</parameter>0.75`)],
    ["sem a quebra de linha entre as tags", mutar(`${head()}</parameter><parameter name="confidence">0.75`)],
    ["a chave confidence JÁ existe (valor inválido)", mutar(`${head()}${LEAK}0.75`, { confidence: "0.75" })],
  ]

  it("a chave confidence JÁ existe e é válida: a regra NÃO decide entre os dois valores", () => {
    // ⚠️ Este payload já passa no schema HOJE (o summary é só uma string), então em produção ele
    // nem chega à recuperação — e seria salvo com o vazamento no summary. Isso é anterior a este
    // arquivo e fica registrado aqui; o que se trava é que a recuperação não escolhe um lado.
    const payload = mutar(`${head()}${LEAK}0.75`, { confidence: 0.4 })
    const { value, recovered } = recoverEvaluationToolPayload(payload, CRITERION_SLUGS)
    expect(recovered).toEqual([])
    expect(value).toBe(payload)
  })

  for (const [nome, payload] of negativos) {
    it(`recusa: ${nome}`, () => {
      const { recovered, depois } = pipeline(payload)
      expect(recovered).not.toContain("confidence_leaked_into_summary")
      expect(depois.success).toBe(false)
    })
  }

  it("`<` legítimo ANTES do vazamento fica no summary — o corte é no vazamento, não no 1º `<`", () => {
    const texto = "Romance <3 com nota < 5 em humor e tag <b>Smut</b>."
    const { recuperado, recovered, depois } = pipeline(mutar(`${texto}${LEAK}0.6`))
    expect(recovered).toEqual(["confidence_leaked_into_summary"])
    expect(depois.success).toBe(true)
    expect((recuperado as Record<string, unknown>).summary).toBe(texto)
    expect((recuperado as Record<string, unknown>).confidence).toBe(0.6)
  })

  it("texto normal que menciona XML/HTML não é tocado", () => {
    const payload = { ...VAZOU(), summary: "Traz <b>negrito</b> e cita a tag <parameter> da API.", confidence: 0.8 }
    const { recovered, antes } = pipeline(payload)
    expect(antes.success).toBe(true) // já era válido — nunca chegaria à recuperação
    expect(recovered).toEqual([])
  })
})

describe("caso 2 — scores com aspas cruas dentro da justificativa", () => {
  it("recupera: 11 critérios, e a ÚNICA diferença para o original é o escape das aspas", () => {
    const original = ASPAS()
    const { recuperado, recovered, depois } = pipeline(original)
    expect(recovered).toEqual(["scores_unescaped_quotes"])
    expect(depois.success).toBe(true)

    const scores = (recuperado as { scores: Array<{ criterion: string; justification: string }> }).scores
    expect(scores.map((s) => s.criterion).sort()).toEqual([...CRITERION_SLUGS].sort())
    // A prova de que nada foi adivinhado: re-serializando e desfazendo SÓ o escape das aspas,
    // volta-se byte a byte à string que o modelo mandou.
    expect(JSON.stringify(scores).replace(/\\"/g, '"')).toBe(original.scores)
    expect(scores.find((s) => s.justification.includes('"healing"'))).toBeDefined()
    // summary e confidence intactos.
    expect((recuperado as Record<string, unknown>).summary).toBe(original.summary)
    expect((recuperado as Record<string, unknown>).confidence).toBe(original.confidence)
  })

  const raw = () => ASPAS().scores as string
  const comScores = (scores: string) => ({ ...ASPAS(), scores })
  const trocaNaPrimeira = (de: string, para: string) => raw().replace(de, para)

  const negativos: Array<[string, () => string]> = [
    ["aspa ÍMPAR numa justificativa", () => trocaNaPrimeira('"European Ambience"', '"European Ambience')],
    ["escape misturado (uma aspa escapada, outra crua)", () => trocaNaPrimeira('"European Ambience"', '\\"European Ambience"')],
    ["fragmento de delimitador `\"}` no texto", () => trocaNaPrimeira('"healing"', '"healing"}')],
    ["texto cita `\"score\"`", () => trocaNaPrimeira('"healing"', '"score"')],
    ["registro aberto dentro do texto", () => trocaNaPrimeira('"healing"', '"healing" {"criterion":"x"')],
    ["critério desconhecido", () => raw().replace('"criterion":"romance"', '"criterion":"romanticismo"')],
    ["critério duplicado", () => raw().replace('"criterion":"humor"', '"criterion":"romance"')],
    ["nota fora do intervalo", () => raw().replace(/"score":[^,]+/, '"score":11')],
    ["nota em notação não-decimal", () => raw().replace(/"score":[^,]+/, '"score":8e0')],
    ["ordem de chaves diferente", () => raw().replace(/\{"criterion":"romance","score":([^,]+),/, '{"score":$1,"criterion":"romance",')],
    ["quebra de linha crua no texto", () => trocaNaPrimeira('"healing"', '"healing"\nx')],
    ["truncado (sem o fechamento `\"}]`)", () => raw().slice(0, -3)],
    ["JSON quebrado por OUTRO motivo, sem aspa crua", () => semAspas().replace('},{', "}{")],
  ]

  /** Os mesmos 11 registros, com as aspas internas trocadas por apóstrofo: JSON válido. */
  function semAspas(): string {
    const recs = (pipeline(ASPAS()).recuperado as { scores: Array<{ justification: string }> }).scores
    return JSON.stringify(recs.map((r) => ({ ...r, justification: r.justification.replace(/"/g, "'") })))
  }

  for (const [nome, gerar] of negativos) {
    it(`recusa: ${nome}`, () => {
      const { recovered, depois } = pipeline(comScores(gerar()))
      expect(recovered).not.toContain("scores_unescaped_quotes")
      expect(depois.success).toBe(false)
    })
  }

  it("scores já em JSON válido é assunto da coerção — esta regra não toca", () => {
    const valido = (pipeline(ASPAS()).recuperado as { scores: unknown }).scores
    const { value, recovered, antes } = pipeline({ ...ASPAS(), scores: JSON.stringify(valido) })
    expect(antes.success).toBe(true)
    expect((value as { scores: unknown }).scores).toEqual(valido)
    expect(recovered).toEqual([])
  })
})

describe("não regressão: payload válido sai IDÊNTICO", () => {
  it("devolve o MESMO objeto e nenhuma recuperação", () => {
    const valido = { ...VAZOU(), summary: "Resumo normal.", confidence: 0.8 }
    const { value, recovered } = recoverEvaluationToolPayload(valido, CRITERION_SLUGS)
    expect(value).toBe(valido)
    expect(recovered).toEqual([])
  })

  it("entradas que não são objeto passam intactas", () => {
    for (const x of [null, "texto", 7, [1, 2]]) {
      expect(recoverEvaluationToolPayload(x, CRITERION_SLUGS)).toEqual({ value: x, recovered: [] })
    }
  })

  it("os dois defeitos juntos: as duas regras se aplicam, cada uma no seu campo", () => {
    const juntos = { summary: VAZOU().summary, scores: ASPAS().scores }
    const { recovered, depois } = pipeline(juntos)
    expect(recovered).toEqual(["confidence_leaked_into_summary", "scores_unescaped_quotes"])
    expect(depois.success).toBe(true)
  })
})
