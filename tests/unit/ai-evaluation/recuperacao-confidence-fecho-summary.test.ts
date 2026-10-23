import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { coerceToolPayload, evaluationToolPayloadSchema } from "@/lib/ai-evaluation/service"
import { recoverEvaluationToolPayload } from "@/lib/ai-evaluation/tool-payload-recovery"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * Regra 6 de `tool-payload-recovery.ts`: o `confidence` vazado no fim do `summary`, fechado com
 * `</summary>` em vez de `</parameter>`.
 *
 * Os dois casos reais são as DUAS tentativas do pedido de produção de 2026-10-03 (v31) que se
 * PERDEU: o mesmo vazamento duas vezes seguidas, cada uma paga. A mesma forma apareceu no piloto
 * de Arte (27/09, 2×) e no piloto v3.1 (22/10) — esses não viram fixture: o do piloto v3.1 é de
 * uma revisão cega em andamento, e os de 27/09 são de experimento.
 *
 * 🔴 A linha é a mesma da regra 1: recuperar SÓ a forma exata observada, e continuar recusando
 * qualquer variação. A retentativa paga é o erro barato; uma nota plausível e errada, o caro.
 */

type Caso = { caso: string; bruto: string }
const ler = (arquivo: string) =>
  JSON.parse(readFileSync(`tests/fixtures/ai-evaluation/${arquivo}`, "utf8")) as { casos: Caso[] }
const fechoSummary = ler("payloads-recusados-fecho-summary.json")
const v31 = ler("payloads-recusados-v31.json")
const bruto = (f: { casos: Caso[] }, nome: string) => {
  const c = f.casos.find((x) => x.caso === nome)
  if (!c) throw new Error(`fixture sem ${nome}`)
  return JSON.parse(c.bruto) as Record<string, unknown>
}
const REAIS = ["fecho_summary_tentativa_0", "fecho_summary_tentativa_1"] as const
const TAG = '</summary>\n<parameter name="confidence">'
const PARAM = '</parameter>\n<parameter name="confidence">'
const NOME = "confidence_leaked_after_summary_tag"

/** O caminho de produção até a decisão: coerção, schema, e só então a recuperação. */
function pipeline(input: unknown) {
  const { value } = coerceToolPayload(input)
  const antes = evaluationToolPayloadSchema.safeParse(value)
  const { value: recuperado, recovered } = recoverEvaluationToolPayload(value, CRITERION_SLUGS)
  const depois = evaluationToolPayloadSchema.safeParse(recuperado)
  return { value, antes, recuperado, recovered, depois }
}

describe("os dois payloads reais (produção, 2026-10-03, o pedido perdido)", () => {
  for (const nome of REAIS) {
    it(`${nome}: tem a forma exata — o fecho uma vez, no fim, e confidence ausente`, () => {
      const p = bruto(fechoSummary, nome)
      const s = p.summary as string
      expect("confidence" in p).toBe(false)
      expect(s.split(TAG)).toHaveLength(2)
      expect(s.split(TAG)[1]).toMatch(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/)
      expect(s).not.toContain(PARAM)
      expect(p.scores).toHaveLength(CRITERION_SLUGS.length)
    })

    it(`${nome}: o schema recusa (marcação no summary e confidence ausente)`, () => {
      const { antes } = pipeline(bruto(fechoSummary, nome))
      expect(antes.success).toBe(false)
      expect(antes.error!.issues.map((i) => i.path.join(".")).sort()).toEqual(["confidence", "summary"])
    })

    it(`${nome}: recupera — summary = texto antes do fecho, confidence = o número vazado, o resto intacto`, () => {
      const original = bruto(fechoSummary, nome)
      const { recuperado, recovered, depois } = pipeline(original)
      expect(recovered).toEqual([NOME])
      expect(depois.success).toBe(true)

      const s = original.summary as string
      const at = s.indexOf(TAG)
      const r = recuperado as Record<string, unknown>
      expect(r.summary).toBe(s.slice(0, at))
      expect(r.confidence).toBe(Number(s.slice(at + TAG.length)))
      // Nada além do summary e do confidence é tocado — nem acrescentado.
      for (const k of Object.keys(original)) if (k !== "summary") expect(r[k]).toEqual(original[k])
      expect(Object.keys(r).sort()).toEqual([...Object.keys(original), "confidence"].sort())
    })
  }
})

describe("variações continuam recusadas (mutações do caso real)", () => {
  const base = () => bruto(fechoSummary, REAIS[0])
  const head = () => (base().summary as string).split(TAG)[0]
  const mutar = (summary: string, extra: Record<string, unknown> = {}) => ({ ...base(), summary, ...extra })
  const scoresReais = () => base().scores as Array<Record<string, unknown>>

  const negativos: Array<[string, () => Record<string, unknown>]> = [
    ["confidence não numérico", () => mutar(`${head()}${TAG}alta`)],
    ["confidence acima de 1", () => mutar(`${head()}${TAG}1.5`)],
    ["confidence negativo", () => mutar(`${head()}${TAG}-0.2`)],
    ["confidence em notação científica", () => mutar(`${head()}${TAG}7.5e-1`)],
    ["confidence com espaço", () => mutar(`${head()}${TAG}0.75 `)],
    ["confidence vazio", () => mutar(`${head()}${TAG}`)],
    ["vazamento NÃO está no fim", () => mutar(`${head()}${TAG}0.75</parameter> e mais texto`)],
    ["summary vazio antes do fecho", () => mutar(`${TAG}0.75`)],
    ["vazamento duplicado (dois confidences)", () => mutar(`${head()}${TAG}0.75${TAG}0.4`)],
    ["os dois fechos no mesmo summary", () => mutar(`${head()}${PARAM}0.4${TAG}0.75`)],
    ["outro `</summary>` no texto", () => mutar(`Cita </summary> no texto. ${head()}${TAG}0.75`)],
    ["`<parameter>` solto no texto", () => mutar(`Cita <parameter> no texto. ${head()}${TAG}0.75`)],
    ["`antml:` no texto", () => mutar(`antml:x ${head()}${TAG}0.75`)],
    ["outro campo vazando", () => mutar(`${head()}</summary>\n<parameter name="reviewsRejectedReason">0.75`)],
    ["sem a quebra de linha entre as tags", () => mutar(`${head()}</summary><parameter name="confidence">0.75`)],
    ["fecho de OUTRO campo", () => mutar(`${head()}</scores>\n<parameter name="confidence">0.75`)],
    ["a chave confidence já existe (válida)", () => mutar(`${head()}${TAG}0.75`, { confidence: 0.4 })],
    ["a chave confidence já existe (inválida)", () => mutar(`${head()}${TAG}0.75`, { confidence: "0.75" })],
    ["scores com 10 critérios", () => ({ ...base(), scores: scoresReais().slice(0, 10) })],
    ["critério duplicado", () => ({ ...base(), scores: scoresReais().map((s, i) => (i === 1 ? { ...scoresReais()[0] } : s)) })],
    ["registro de scores com chave a mais", () => ({ ...base(), scores: scoresReais().map((s, i) => (i === 0 ? { ...s, extra: 1 } : s)) })],
    ["scores ausente", () => {
      const { scores: _s, ...resto } = base()
      void _s
      return resto
    }],
  ]

  for (const [nome, gerar] of negativos) {
    it(`recusa: ${nome}`, () => {
      const { recovered, depois } = pipeline(gerar())
      expect(recovered).not.toContain(NOME)
      expect(depois.success).toBe(false)
    })
  }
})

describe("não regressão", () => {
  it("o caso real da regra 1 (`</parameter>`, v31 27/09) sai exatamente como antes", () => {
    const original = bruto(v31, "confidence_vazou_no_summary")
    const { recuperado, recovered, depois } = pipeline(original)
    expect(recovered).toEqual(["confidence_leaked_into_summary"])
    expect(depois.success).toBe(true)
    expect((recuperado as Record<string, unknown>).confidence).toBe(0.75)
    expect((recuperado as Record<string, unknown>).summary).toBe((original.summary as string).split(PARAM)[0])
  })

  it("o caso real com o fecho trocado para `</parameter>` continua sendo da regra 1, não da 6", () => {
    const p = bruto(fechoSummary, REAIS[0])
    const { recovered, depois } = pipeline({ ...p, summary: (p.summary as string).replace(TAG, PARAM) })
    expect(recovered).toEqual(["confidence_leaked_into_summary"])
    expect(depois.success).toBe(true)
  })

  it("payload válido sai IDÊNTICO (mesmo objeto, nenhuma recuperação)", () => {
    const p = bruto(fechoSummary, REAIS[0])
    const valido = { ...p, summary: "Resumo normal.", confidence: 0.8 }
    expect(evaluationToolPayloadSchema.safeParse(valido).success).toBe(true)
    const { value, recovered } = recoverEvaluationToolPayload(valido, CRITERION_SLUGS)
    expect(value).toBe(valido)
    expect(recovered).toEqual([])
  })

  it("`<` legítimo ANTES do vazamento fica no summary — o corte é no fecho, não no 1º `<`", () => {
    const texto = "Romance <3 com nota < 5 em humor e tag <b>Smut</b>."
    const { recuperado, recovered, depois } = pipeline({ ...bruto(fechoSummary, REAIS[0]), summary: `${texto}${TAG}0.6` })
    expect(recovered).toEqual([NOME])
    expect(depois.success).toBe(true)
    expect((recuperado as Record<string, unknown>).summary).toBe(texto)
    expect((recuperado as Record<string, unknown>).confidence).toBe(0.6)
  })

  it("junto com `scores` de aspas cruas: as duas regras se aplicam, cada uma no seu campo", () => {
    const juntos = { summary: bruto(fechoSummary, REAIS[0]).summary, scores: bruto(v31, "scores_com_aspas_cruas").scores }
    const { recovered, depois } = pipeline(juntos)
    expect(recovered).toEqual([NOME, "scores_unescaped_quotes"])
    expect(depois.success).toBe(true)
  })
})
