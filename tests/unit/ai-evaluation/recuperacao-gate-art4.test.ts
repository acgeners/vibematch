import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Os 5 payloads RECUSADOS do gate art4 (2026-10-01), byte a byte do NDJSON — dois deles no v30 de
 * produção (braço A). Cada regra nova tem aqui o caso real que ela recupera e as mutações dele que
 * ela TEM de recusar: recuperar errado troca uma retentativa barata por uma nota plausível e falsa.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({ createLoggedMessage: vi.fn(), anotar: vi.fn(async () => {}) }))
vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  anotarPayloadRecusado: spies.anotar,
  getAnthropicClient: () => ({}),
}))
vi.mock("@/server/queries/ai-cache", () => ({
  recordCacheEventAsync: vi.fn(),
  readAiCache: vi.fn(async () => null),
  writeAiCache: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("sem banco no teste")
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
}))

import {
  PRODUCTION_VARIANT,
  coerceToolPayload,
  evaluationToolPayloadSchema,
  interpretarRespostaDaTool,
  prepareReviews,
  VARIANTE_V30,
  requestAiEvaluation,
} from "@/lib/ai-evaluation/service"
import { recoverEvaluationToolPayload } from "@/lib/ai-evaluation/tool-payload-recovery"
import type { PayloadRecusado } from "@/lib/ai/tool-payload"
import { CRITERION_SLUGS } from "@/types/domain"

type Caso = { caso: string; forma: string; braco: "A" | "B"; toolInputBruto: Record<string, unknown> }
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/ai-evaluation/payloads-recusados-gate-art4.json", "utf8")) as {
  casos: Caso[]
}
const caso = (nome: string) => structuredClone(FIXTURE.casos.find((c) => c.caso === nome)!.toolInputBruto)
const E01 = () => caso("B-E01")
const E03 = () => caso("B-E03")
const E04 = () => caso("A-E04")
const E08 = () => caso("A-E08")
const E12 = () => caso("B-E12")

/** O caminho de produção até a decisão: coerção, schema, recuperação, schema de novo. */
function pipeline(input: unknown, allowArt = false) {
  const { value } = coerceToolPayload(input)
  const antes = evaluationToolPayloadSchema.safeParse(value)
  const { value: recuperado, recovered } = recoverEvaluationToolPayload(value, CRITERION_SLUGS, { allowArt })
  const depois = evaluationToolPayloadSchema.safeParse(recuperado)
  return { antes, recuperado: recuperado as Record<string, unknown>, recovered, depois }
}

const recusa = (input: unknown, allowArt = false) => {
  const p = pipeline(input, allowArt)
  expect(p.depois.success).toBe(false)
  return p
}

const OPEN_CONF = '</parameter>\n<parameter name="confidence">'
const OPEN_SCORES = '</parameter>\n<parameter name="scores">'
/** Divide o summary do molde aberto (E01/E04) nas suas três partes. */
function partes(summary: string) {
  const i = summary.indexOf(OPEN_CONF)
  const j = summary.indexOf(OPEN_SCORES)
  return { head: summary.slice(0, i), conf: summary.slice(i + OPEN_CONF.length, j), scores: summary.slice(j + OPEN_SCORES.length) }
}
const montar = (head: string, conf: string, scores: string) => `${head}${OPEN_CONF}${conf}${OPEN_SCORES}${scores}`

describe("os 5 recusados, como chegaram", () => {
  it("todos eram recusados pelo schema", () => {
    for (const c of FIXTURE.casos) expect(evaluationToolPayloadSchema.safeParse(coerceToolPayload(c.toolInputBruto).value).success).toBe(false)
  })
})

describe("regra 3a — payload inteiro dentro do summary, molde aberto (E04 do v30 e E01)", () => {
  for (const [nome, get] of [["A-E04", E04], ["B-E01", E01]] as const) {
    it(`${nome}: recupera, e cada campo é EXATAMENTE o trecho que veio`, () => {
      const original = get()
      const p = pipeline(original)
      expect(p.recovered).toEqual(["payload_leaked_into_summary"])
      expect(p.depois.success).toBe(true)
      const { head, conf, scores } = partes(original.summary as string)
      expect(p.recuperado.summary).toBe(head)
      expect(p.recuperado.confidence).toBe(Number(conf))
      expect(p.recuperado.scores).toEqual(JSON.parse(scores))
      expect((p.recuperado.scores as unknown[]).length).toBe(CRITERION_SLUGS.length)
    })
  }

  it("B-E01: o `art` REAL (chave própria) passa intacto — a regra não o toca", () => {
    const original = E01()
    expect(pipeline(original).recuperado.art).toEqual(original.art)
  })

  const base = () => partes(E04().summary as string)
  const comSummary = (summary: string, extra: Record<string, unknown> = {}) => ({ ...E04(), summary, ...extra })
  const scoresSem = (filtro: (x: { criterion: string }) => boolean) =>
    JSON.stringify((JSON.parse(base().scores) as Array<{ criterion: string }>).filter(filtro))

  const negativos: Array<[string, () => unknown]> = [
    ["campo faltando — sem scores (é só o vazamento de confidence)", () => comSummary(`${base().head}${OPEN_CONF}${base().conf}`)],
    ["campo faltando — sem confidence", () => comSummary(`${base().head}${OPEN_SCORES}${base().scores}`)],
    ["campo duplicado — dois confidence", () => comSummary(montar(`${base().head}${OPEN_CONF}0.5`, base().conf, base().scores))],
    ["ordem inesperada — scores antes de confidence", () =>
      comSummary(`${base().head}${OPEN_SCORES}${base().scores}${OPEN_CONF}${base().conf}`)],
    ["parâmetro desconhecido no lugar de confidence", () =>
      comSummary(montar(base().head, base().conf, base().scores).replace('name="confidence"', 'name="certeza"'))],
    ["parâmetro desconhecido a mais", () => comSummary(`${montar(base().head, base().conf, base().scores)}</parameter>\n<parameter name="extra">x`)],
    ["confidence > 1", () => comSummary(montar(base().head, "1.5", base().scores))],
    ["confidence não numérico", () => comSummary(montar(base().head, "alta", base().scores))],
    ["confidence com espaço", () => comSummary(montar(base().head, "0.78 ", base().scores))],
    ["scores incompletos (10 critérios)", () => comSummary(montar(base().head, base().conf, scoresSem((x) => x.criterion !== "angst")))],
    ["critério duplicado", () =>
      comSummary(montar(base().head, base().conf, base().scores.replace('"criterion":"angst"', '"criterion":"drama"')))],
    ["critério desconhecido", () =>
      comSummary(montar(base().head, base().conf, base().scores.replace('"criterion":"angst"', '"criterion":"beauty"')))],
    ["lixo depois da estrutura", () => comSummary(`${montar(base().head, base().conf, base().scores)}\nobrigado!`)],
    ["markup parcial (fechamento truncado)", () =>
      comSummary(montar(base().head, base().conf, base().scores).replace("</parameter>", "</paramete"))],
    ["delimitador ambíguo — `</parameter>` dentro de uma justificativa", () =>
      comSummary(montar(base().head, base().conf, base().scores.replace("Faixa 7-8", "Faixa 7-8 </parameter>")))],
    ["texto do summary vazio", () => comSummary(montar("   ", base().conf, base().scores))],
    ["chave confidence real presente (duas fontes)", () => comSummary(montar(base().head, base().conf, base().scores), { confidence: 0.5 })],
    ["chave scores real presente (duas fontes)", () => comSummary(montar(base().head, base().conf, base().scores), { scores: [] })],
    ["marcação da tool no texto do summary", () => comSummary(montar(`${base().head} <invoke`, base().conf, base().scores))],
  ]
  for (const [nome, payload] of negativos) {
    it(`recusa: ${nome}`, () => {
      // a mutação tem de MUDAR o payload real — senão o caso negativo é inofensivo
      expect(JSON.stringify(payload())).not.toBe(JSON.stringify(E04()))
      expect(pipeline(payload()).recovered).not.toContain("payload_leaked_into_summary")
      recusa(payload())
    })
  }

  it("summary LEGÍTIMO com texto parecido, e os campos reais presentes: nada é recuperado e a guarda segura", () => {
    const legit = { ...E08(), summary: 'O autor usa a tag <parameter name="x"> na sinopse.</parameter>' }
    const p = pipeline(legit)
    expect(p.recovered).toEqual(["scores_comment_line"]) // só a regra de scores, nada no summary
    expect(p.depois.success).toBe(false) // a guarda do summary continua recusando
  })
})

describe("regra 3b — payload e art dentro do summary, molde fechado (E03)", () => {
  it("B-E03 na variante com Arte: recupera os três campos, e o scores passa ainda pela regra 2", () => {
    const original = E03()
    const p = pipeline(original, true)
    expect(p.recovered).toEqual(["payload_and_art_leaked_into_summary", "scores_unescaped_quotes"])
    expect(p.depois.success).toBe(true)
    const s = original.summary as string
    expect(p.recuperado.summary).toBe(s.slice(0, s.indexOf("</summary>")))
    expect(p.recuperado.confidence).toBe(0.82)
    expect((p.recuperado.scores as unknown[]).length).toBe(CRITERION_SLUGS.length)
    const artTexto = s.slice(s.indexOf('<parameter name="art">') + 22, s.lastIndexOf("</parameter>"))
    expect(p.recuperado.art).toEqual(JSON.parse(artTexto))
  })

  it("B-E03 na PRODUÇÃO (sem Arte na tool): não recupera — `art` é parâmetro desconhecido lá", () => {
    expect(pipeline(E03(), false).recovered).toEqual([])
    recusa(E03(), false)
  })

  const s = () => E03().summary as string
  const comSummary = (summary: string, extra: Record<string, unknown> = {}) => ({ ...E03(), summary, ...extra })
  const negativos: Array<[string, () => unknown]> = [
    ["art malformada (JSON quebrado)", () => comSummary(s().replace('{"judging_reviews"', '{judging_reviews"'))],
    ["art que não é objeto", () => comSummary(s().replace(/<parameter name="art">[\s\S]*<\/parameter>\n<\/invoke>/, '<parameter name="art">[1,2]</parameter>\n</invoke>'))],
    ["lixo depois do </invoke>", () => comSummary(`${s()}obrigado`)],
    ["sem a quebra final", () => comSummary(s().slice(0, -1))],
    ["chave art real presente (duas fontes)", () => comSummary(s(), { art: { quality_signal: "AVERAGE" } })],
    ["scores com aspa ímpar (a regra 2 recusa)", () => {
      const sum = s()
      expect(sum).toContain('"rollercoaster emocional"') // a mutação tem de MUDAR o payload
      return comSummary(sum.replace('"rollercoaster emocional"', '"rollercoaster emocional'))
    }],
    ["abre com </parameter> mas tem o resto do molde fechado", () => comSummary(s().replace("</summary>", "</parameter>"))],
  ]
  for (const [nome, payload] of negativos) {
    it(`recusa: ${nome}`, () => {
      // a mutação tem de MUDAR o payload real — senão o caso negativo é inofensivo
      expect(JSON.stringify(payload())).not.toBe(JSON.stringify(E03()))
      expect(pipeline(payload(), true).recovered).not.toContain("payload_and_art_leaked_into_summary")
      recusa(payload(), true)
    })
  }
})

describe("regra 4 — linha de comentário entre registros (E08 do v30)", () => {
  it("A-E08: recupera, e o resultado é o JSON original sem a linha", () => {
    const original = E08()
    const p = pipeline(original)
    expect(p.recovered).toEqual(["scores_comment_line"])
    expect(p.depois.success).toBe(true)
    expect(p.recuperado.scores).toEqual(JSON.parse((original.scores as string).replace("\n<!--drama-->\n", "\n")))
    expect(p.recuperado.summary).toBe(original.summary)
    expect(p.recuperado.confidence).toBe(original.confidence)
  })

  const comScores = (scores: string) => ({ ...E08(), scores })
  const sc = () => E08().scores as string
  const negativos: Array<[string, () => unknown]> = [
    ["rótulo diferente do critério seguinte", () => comScores(sc().replace("<!--drama-->", "<!--humor-->"))],
    ["comentário fora da forma (com espaços)", () => comScores(sc().replace("<!--drama-->", "<!-- drama -->"))],
    ["comentário sem linha própria", () => comScores(sc().replace("\n<!--drama-->\n", "<!--drama-->"))],
    ["comentário DENTRO de uma justificativa", () => comScores(sc().replace("Faixa 7-8", "Faixa <!--drama--> 7-8"))],
    ["um segundo comentário malformado", () => comScores(sc().replace('{"criterion":"tragedy"', '<!--tragedy\n{"criterion":"tragedy"'))],
    ["sem um critério depois de tirar o comentário", () => {
      const a = sc()
      const i = a.indexOf('{"criterion":"angst"')
      return comScores(`${a.slice(0, i - 2)}\n]`)
    }],
  ]
  for (const [nome, payload] of negativos) {
    it(`recusa: ${nome}`, () => {
      // a mutação tem de MUDAR o payload real — senão o caso negativo é inofensivo
      expect(JSON.stringify(payload())).not.toBe(JSON.stringify(E08()))
      expect(pipeline(payload()).recovered).not.toContain("scores_comment_line")
      recusa(payload())
    })
  }
})

describe("regra 5 — aspas cruas com quebras de linha estruturais (E12)", () => {
  it("B-E12: recupera, e as aspas ficam no texto exatamente como vieram", () => {
    const original = E12()
    const p = pipeline(original)
    expect(p.recovered).toEqual(["scores_unescaped_quotes_multiline"])
    expect(p.depois.success).toBe(true)
    const scores = p.recuperado.scores as Array<{ criterion: string; justification: string }>
    expect(scores.map((x) => x.criterion).sort()).toEqual([...CRITERION_SLUGS].sort())
    // Prova de que nada foi adivinhado: re-serializado com uma linha por registro e sem o escape das
    // aspas, volta-se byte a byte à string que o modelo mandou.
    const reconstruido = `[\n${scores.map((x) => JSON.stringify(x)).join(",\n")}\n]`.replace(/\\"/g, '"')
    expect(reconstruido).toBe(original.scores)
  })

  it("a regra 2 compacta (v31) continua exatamente como era — o E12 compactado recupera como antes", () => {
    const compacto = (E12().scores as string).replace("[\n", "[").split('"},\n{').join('"},{').replace('"}\n]', '"}]')
    expect(pipeline({ ...E12(), scores: compacto }).recovered).toEqual(["scores_unescaped_quotes"])
  })

  const comScores = (scores: string) => ({ ...E12(), scores })
  const sc = () => E12().scores as string
  const negativos: Array<[string, () => unknown]> = [
    ["separadores misturados (um sem quebra)", () => comScores(sc().replace('"},\n{', '"},{'))],
    ["quebra de linha dentro de uma justificativa", () => comScores(sc().replace("Faixa 4-6:", "Faixa\n4-6:"))],
    ["CRLF nos separadores", () => comScores(sc().split("\n").join("\r\n"))],
    ["aspa ímpar", () => comScores(sc().replace('"spirit beasts"', '"spirit beasts'))],
    ["barra invertida misturada", () => comScores(sc().replace('"spirit beasts"', '\\"spirit beasts\\"'))],
    ["incompleto (10 critérios)", () => {
      const a = sc()
      const i = a.lastIndexOf('{"criterion":')
      return comScores(`${a.slice(0, i - 2)}\n]`)
    }],
    ["JSON com uma 2ª reconstrução — fronteira falsa dentro do texto", () =>
      comScores(sc().replace("Faixa 4-6:", 'Faixa"},\n{"criterion":"drama","score":5,"justification":"4-6:'))],
  ]
  for (const [nome, payload] of negativos) {
    it(`recusa: ${nome}`, () => {
      // a mutação tem de MUDAR o payload real — senão o caso negativo é inofensivo
      expect(JSON.stringify(payload())).not.toBe(JSON.stringify(E12()))
      expect(pipeline(payload()).recovered).not.toContain("scores_unescaped_quotes_multiline")
      recusa(payload())
    })
  }
})

describe("interpretação: a mesma função do laço e do harness", () => {
  const pedido = () =>
    ({
      workId: "00000000-0000-0000-0002-000000000001",
      title: "Obra",
      synopsis: "Sinopse.",
      genres: [],
      tags: [],
      sourcedReviews: [{ source: "mangaupdates", sourceTitle: "Obra", matchScore: 0.95, text: "The art is gorgeous and detailed." }],
      platformRatings: [],
      externalContext: ["Contexto."],
    }) as unknown as Parameters<typeof requestAiEvaluation>[0]
  const interpretar = (payload: unknown, variant = PRODUCTION_VARIANT) => {
    const req = pedido()
    return interpretarRespostaDaTool(payload, req, prepareReviews(req), "claude-sonnet-5", "h", variant)
  }

  it("E03 na candidata: aceita, e a Arte que vai ao validador é a que estava DENTRO do summary", () => {
    const r = interpretar(E03())
    expect(r.tipo).toBe("aceita")
    if (r.tipo !== "aceita") return
    const s = E03().summary as string
    const artTexto = s.slice(s.indexOf('<parameter name="art">') + 22, s.lastIndexOf("</parameter>"))
    expect((r.resposta.rawResponse as Record<string, unknown>).art_bruto).toEqual(JSON.parse(artTexto))
    expect(r.resposta.art?.status).not.toBe("invalid")
  })

  it("E03 na produção: recusada", () => {
    expect(interpretar(E03(), VARIANTE_V30).tipo).toBe("recusada")
  })

  for (const nome of ["A-E04", "A-E08", "B-E01", "B-E12"]) {
    it(`${nome}: aceita, com as 11 notas do payload`, () => {
      const r = interpretar(caso(nome), nome.startsWith("A") ? VARIANTE_V30 : PRODUCTION_VARIANT)
      expect(r.tipo).toBe("aceita")
      if (r.tipo === "aceita") expect(r.resposta.scores.every((s) => s.justification !== "Não avaliado.")).toBe(true)
    })
  }
})

describe("no laço de produção: os dois formatos do v30 deixam de pagar retentativa", () => {
  const resposta = (input: unknown) => ({
    apiCallId: "call-gate",
    message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input }] },
  })
  let n = 0
  const pedido = () =>
    ({
      workId: `00000000-0000-0000-0003-${String(++n).padStart(12, "0")}`,
      title: `Obra ${n}`,
      synopsis: "Sinopse.",
      genres: [],
      tags: [],
      sourcedReviews: [],
      platformRatings: [],
      externalContext: ["Contexto."],
    }) as unknown as Parameters<typeof requestAiEvaluation>[0]

  beforeEach(() => {
    spies.createLoggedMessage.mockReset()
    spies.anotar.mockReset()
    spies.anotar.mockImplementation(async () => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  for (const [nome, forma] of [["A-E04", "payload_leaked_into_summary"], ["A-E08", "scores_comment_line"]] as const) {
    it(`${nome}: uma chamada, e o diagnóstico da resposta ORIGINAL é gravado uma vez, com a forma recuperada`, async () => {
      spies.createLoggedMessage.mockResolvedValueOnce(resposta(caso(nome)))
      const r = await requestAiEvaluation(pedido())
      expect(spies.createLoggedMessage).toHaveBeenCalledTimes(1)
      expect(r.scores).toHaveLength(CRITERION_SLUGS.length)
      expect(spies.anotar).toHaveBeenCalledTimes(1)
      const [, diag] = spies.anotar.mock.calls[0] as unknown as [string, PayloadRecusado]
      expect(diag.classe).toBe("schema")
      expect(diag.recuperado).toEqual([forma])
    })
  }
})
