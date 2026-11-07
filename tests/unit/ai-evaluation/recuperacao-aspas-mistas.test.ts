import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

/**
 * Regra 7 — `scores` como texto com as DUAS convenções de aspa: alguns registros com as aspas internas
 * escapadas (`\"`) e os demais com elas cruas. Forma observada no piloto v32 × v3.1 com W3 (24/10,
 * *Dragondaily*, braço v3.1): 11 registros, 10 `\"` em 3 deles, aspas cruas nos outros.
 *
 * 🔴 O payload real está LACRADO (revisão cega em curso) e não foi aberto: o caso abaixo é SINTÉTICO,
 * com a forma descrita no registro operacional (`EXECUCAO-2026-10-24.md`) e conteúdo inventado.
 */

vi.mock("server-only", () => ({}))
vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {}, exigirVersaoCanonica: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: vi.fn(),
  anotarPayloadRecusado: vi.fn(async () => {}),
  getAnthropicClient: () => ({}),
}))
vi.mock("@/server/queries/ai-cache", () => ({ recordCacheEventAsync: vi.fn(), readAiCache: vi.fn(async () => null), writeAiCache: vi.fn() }))
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
  coerceToolPayload,
  evaluationToolPayloadSchema,
  interpretarRespostaDaTool,
  prepareReviews,
  requestAiEvaluation,
  VARIANTE_V30,
} from "@/lib/ai-evaluation/service"
import { recoverEvaluationToolPayload } from "@/lib/ai-evaluation/tool-payload-recovery"
import { CRITERION_SLUGS } from "@/types/domain"

type Req = Parameters<typeof requestAiEvaluation>[0]

/**
 * Um registro como ele vem no fio. `noFio` é o texto da justificativa EXATAMENTE como está na string
 * (com a barra, quando escapado); `decodificado` é o que ele quer dizer.
 */
type Registro = { criterion: string; score: number; noFio: string; decodificado: string }

const ESCAPADOS = new Map<number, [string, string]>([
  [1, ['Faixa 7-8: tags \\"Dragon\\" e \\"Royalty\\" sustentam a fantasia.', 'Faixa 7-8: tags "Dragon" e "Royalty" sustentam a fantasia.']],
  [4, ['Faixa 7-8: \\"slow burn\\" com momentos \\"Fluff\\"', 'Faixa 7-8: "slow burn" com momentos "Fluff"']],
  [7, ['\\"Cozy\\" é o tom geral.', '"Cozy" é o tom geral.']],
])
const CRUS = new Map<number, string>([
  [0, 'Faixa 4-6: o rótulo "Isekai" aparece, mas é pontual.'],
  [3, 'Faixa 7-8: leitores chamam o casal de "adorável".'],
  [9, 'Faixa 0-3: "sem violência" segundo as tags.'],
])

function dragondaily(): Registro[] {
  return CRITERION_SLUGS.map((criterion, i) => {
    const score = 3 + (i % 6)
    const esc = ESCAPADOS.get(i)
    if (esc) return { criterion, score, noFio: esc[0], decodificado: esc[1] }
    const cru = CRUS.get(i) ?? `Faixa 4-6: texto sem aspas de ${criterion}.`
    return { criterion, score, noFio: cru, decodificado: cru }
  })
}

const noFio = (regs: Registro[]) =>
  `[${regs.map((r) => `{"criterion":"${r.criterion}","score":${r.score},"justification":"${r.noFio}"}`).join(",")}]`
const payload = (scores: unknown) => ({ summary: "Resumo sintético.", confidence: 0.7, scores })
const esperado = (regs: Registro[]) => regs.map((r) => ({ criterion: r.criterion, score: r.score, justification: r.decodificado }))

const recuperar = (input: unknown) => recoverEvaluationToolPayload(coerceToolPayload(input).value, CRITERION_SLUGS)

let n = 0
const pedido = (): Req =>
  ({
    workId: `00000000-0000-0000-0003-${String(++n).padStart(12, "0")}`,
    title: `Obra ${n}`,
    synopsis: `Sinopse ${n}.`,
    genres: [],
    tags: [],
    sourcedReviews: [],
    platformRatings: [],
    externalContext: ["Contexto externo de teste."],
  }) as unknown as Req
const interpretar = (p: unknown) => {
  const req = pedido()
  return interpretarRespostaDaTool(p, req, prepareReviews(req), "claude-sonnet-5", "hash-x", VARIANTE_V30)
}

describe("2. a forma de Dragondaily recupera, preservando o conteúdo", () => {
  it("o caso sintético tem a forma descrita: 11 registros, 10 \\\" em 3, aspas cruas nos outros, JSON quebrado", () => {
    const regs = dragondaily()
    const raw = noFio(regs)
    expect(regs).toHaveLength(11)
    expect(raw.split('\\"').length - 1).toBe(10)
    expect(regs.filter((r) => r.noFio.includes("\\")).length).toBe(3)
    expect(() => JSON.parse(raw)).toThrow()
    // A regra 2 sozinha recusa: há barra invertida.
    expect(evaluationToolPayloadSchema.safeParse(coerceToolPayload(payload(raw)).value).success).toBe(false)
  })

  it("recupera com a forma registrada, e o texto decodificado é só \\\" → \"", () => {
    const { value, recovered } = recuperar(payload(noFio(dragondaily())))
    expect(recovered).toEqual(["scores_mixed_quote_escaping"])
    expect((value as { scores: unknown }).scores).toEqual(esperado(dragondaily()))
  })

  it("a decodificação é exatamente a do JSON.parse sobre o mesmo texto", () => {
    const { value } = recuperar(payload(noFio(dragondaily())))
    const scores = (value as { scores: Array<{ justification: string }> }).scores
    for (const [i, [fio]] of ESCAPADOS) expect(scores[i].justification).toBe(JSON.parse(`"${fio}"`))
  })

  it("na interpretação: aceita, uma vez, com as notas e textos do modelo, e o original intacto", () => {
    const original = payload(noFio(dragondaily()))
    const copia = structuredClone(original)
    const r = interpretar(original)
    if (r.tipo !== "aceita") throw new Error(`esperava aceita: ${String(r.erro)}`)
    expect(r.recuperacao?.formas).toEqual(["scores_mixed_quote_escaping"])
    expect(r.recuperacao?.motivo).toMatch(/Payload da tool não atende ao schema: scores/)
    expect(r.resposta.scores.map((s) => ({ criterion: s.criterionSlug, score: s.suggestedScore, justification: s.justification }))).toEqual(
      esperado(dragondaily()),
    )
    expect(original).toEqual(copia)
  })
})

describe("6. o que é ambíguo continua recusado (sem adivinhar)", () => {
  /** Troca o texto no fio do registro `i` e confere que NADA é recuperado e o schema segue recusando. */
  const mutado = (i: number, fio: string) => {
    const regs = dragondaily()
    regs[i] = { ...regs[i], noFio: fio }
    return payload(noFio(regs))
  }
  const nadaRecuperado = (p: unknown) => {
    const { value, recovered } = recuperar(p)
    expect(recovered).toEqual([])
    expect(evaluationToolPayloadSchema.safeParse(value).success).toBe(false)
    const r = interpretar(p)
    expect(r.tipo).toBe("recusada")
    if (r.tipo === "recusada") expect(r.classe).toBe("schema")
  }

  it.each([
    ["barra dupla (\\\\)", 1, 'tags \\"Dragon\\" em C:\\\\pasta e \\"Royalty\\"'],
    ["outro escape (\\n)", 1, 'tags \\"Dragon\\"\\ne \\"Royalty\\"'],
    ["barra no fim do texto (escaparia a aspa de fechamento)", 2, "texto que termina com barra\\"],
    ["barra solta", 2, "uma barra \\ solta"],
    ["as duas convenções no mesmo registro", 1, 'tags \\"Dragon\\" e "Royalty"'],
    ["aspa escapada ímpar", 7, '\\"Cozy é o tom geral.'],
    ["aspa crua ímpar num registro cru", 0, 'o rótulo "Isekai aparece'],
    ["fragmento do molde escapado (\\\"criterion\\\")", 7, 'cita \\"criterion\\" no texto'],
    ["fecho do molde escapado (\\\"})", 7, 'cita \\"} no texto \\"x\\"'],
  ])("%s", (_nome, i, fio) => nadaRecuperado(mutado(i as number, fio as string)))

  it("caractere de controle cru", () => nadaRecuperado(mutado(3, 'leitores chamam\to casal de "adorável".')))

  it("quebra de linha estrutural (a regra 5 é só da convenção crua)", () => {
    const raw = noFio(dragondaily()).replace("[", "[\n").replace(/"\},\{"criterion"/g, '"},\n{"criterion"').replace(/\]$/, "\n]")
    nadaRecuperado(payload(raw))
  })

  it("sem nenhum registro cru: o que quebrou o JSON foi outra coisa (aqui, uma nota 07)", () => {
    const regs = dragondaily().map((r) => (r.noFio.includes('"') && !r.noFio.includes("\\") ? { ...r, noFio: "texto sem aspas.", decodificado: "texto sem aspas." } : r))
    const raw = noFio(regs).replace(`"score":${regs[5].score},`, '"score":07,')
    expect(() => JSON.parse(raw)).toThrow()
    nadaRecuperado(payload(raw))
  })

  it("10 de 11 registros: a regra nova não entrega payload incompleto", () => nadaRecuperado(payload(noFio(dragondaily().slice(0, 10)))))

  it("critério repetido", () => {
    const regs = dragondaily()
    regs[10] = { ...regs[10], criterion: regs[0].criterion }
    nadaRecuperado(payload(noFio(regs)))
  })

  it("JSON válido (todas as aspas escapadas): não é caso de recuperação, passa direto", () => {
    const regs = dragondaily().map((r) => ({ ...r, noFio: r.decodificado.split('"').join('\\"') }))
    const r = interpretar(payload(noFio(regs)))
    if (r.tipo !== "aceita") throw new Error(`esperava aceita: ${String(r.erro)}`)
    expect(r.recuperacao).toBeNull()
    expect(r.coerced).toEqual(["scores"])
  })
})

describe("7. não regressão: os payloads reais já recuperados não mudam de forma", () => {
  type CasoV31 = { caso: string; bruto: string }
  type CasoArt4 = { caso: string; variante: string; toolInputBruto: Record<string, unknown> }
  const ler = <T>(arquivo: string) => (JSON.parse(readFileSync(`tests/fixtures/ai-evaluation/${arquivo}`, "utf8")) as { casos: T[] }).casos

  const reais: Array<[string, unknown, boolean]> = [
    ...ler<CasoV31>("payloads-recusados-v31.json").map((c) => [`v31/${c.caso}`, JSON.parse(c.bruto), false] as [string, unknown, boolean]),
    ...ler<CasoV31>("payloads-recusados-fecho-summary.json").map((c) => [`fecho/${c.caso}`, JSON.parse(c.bruto), false] as [string, unknown, boolean]),
    ...ler<CasoArt4>("payloads-recusados-gate-art4.json").map((c) => [`art4/${c.caso}`, c.toolInputBruto, c.caso.startsWith("B")] as [string, unknown, boolean]),
  ]

  it.each(reais)("%s: a regra 7 não se aplica", (_nome, bruto, allowArt) => {
    const { recovered } = recoverEvaluationToolPayload(coerceToolPayload(bruto).value, CRITERION_SLUGS, { allowArt })
    expect(recovered).not.toContain("scores_mixed_quote_escaping")
  })

  it("o caso real da regra 2 continua sendo da regra 2", () => {
    const bruto = JSON.parse(ler<CasoV31>("payloads-recusados-v31.json").find((c) => c.caso === "scores_com_aspas_cruas")!.bruto)
    expect(recoverEvaluationToolPayload(bruto, CRITERION_SLUGS).recovered).toEqual(["scores_unescaped_quotes"])
  })

  it("o caso real da regra 6 continua sendo da regra 6", () => {
    for (const c of ler<CasoV31>("payloads-recusados-fecho-summary.json")) {
      const { recovered } = recoverEvaluationToolPayload(coerceToolPayload(JSON.parse(c.bruto)).value, CRITERION_SLUGS)
      expect(recovered).toEqual(["confidence_leaked_after_summary_tag"])
    }
  })
})
