import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * O diagnóstico de payload RECUSADO: o que ele guarda (`descreverPayloadRecusado`), como corta
 * (`truncarPorCodePoint`) e como grava (`anotarPayloadRecusado`, com banco falso).
 *
 * Motivo medido: na v31, 7 das 9 respostas recusadas na 1ª tentativa ficaram sem causa
 * observável — só existia a mensagem do Zod, com 120 caracteres de preview.
 */

vi.mock("server-only", () => ({}))

const banco = vi.hoisted(() => ({
  metadataAtual: {} as Record<string, unknown> | null,
  erroSelect: null as string | null,
  erroUpdate: null as string | null,
  selects: [] as string[],
  updates: [] as Array<{ id: string; metadata: Record<string, unknown> }>,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          single: async () => {
            banco.selects.push(id)
            return banco.erroSelect
              ? { data: null, error: { message: banco.erroSelect } }
              : { data: { metadata: banco.metadataAtual }, error: null }
          },
        }),
      }),
      update: (row: { metadata: Record<string, unknown> }) => ({
        eq: async (_col: string, id: string) => {
          if (banco.erroUpdate) return { error: { message: banco.erroUpdate } }
          banco.updates.push({ id, metadata: row.metadata })
          return { error: null }
        },
      }),
    }),
  }),
}))
vi.mock("@/server/queries/current-user", () => ({ getSessionUserId: async () => null }))

import { anotarPayloadRecusado } from "@/lib/ai/anthropic-client"
import {
  descreverPayloadRecusado,
  PAYLOAD_RECUSADO_MAX_CODE_POINTS,
  truncarPorCodePoint,
} from "@/lib/ai/tool-payload"

const SURROGATE_ORFAO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const EMOJI = "😀" // 1 code point, 2 unidades UTF-16

type Caso = { caso: string; bruto: string }
const fixture = JSON.parse(
  readFileSync("tests/fixtures/ai-evaluation/payloads-recusados-v31.json", "utf8"),
) as { casos: Caso[] }
const real = (nome: string) => JSON.parse(fixture.casos.find((c) => c.caso === nome)!.bruto) as Record<string, unknown>

describe("truncarPorCodePoint — corte que não parte caractere", () => {
  it("emoji EXATAMENTE na fronteira: entra inteiro quando cabe", () => {
    const r = truncarPorCodePoint(`abcd${EMOJI}e`, 5)
    expect(r).toEqual({ texto: `abcd${EMOJI}`, truncado: true, tamanho: 6 })
    expect(r.texto).not.toMatch(SURROGATE_ORFAO)
  })

  it("emoji logo DEPOIS da fronteira: sai inteiro, nunca pela metade", () => {
    const r = truncarPorCodePoint(`abcde${EMOJI}`, 5)
    expect(r).toEqual({ texto: "abcde", truncado: true, tamanho: 6 })
    expect(r.texto).not.toMatch(SURROGATE_ORFAO)
  })

  it("contraprova: `.slice` por unidade UTF-16 no mesmo ponto DEIXA surrogate órfão", () => {
    const s = `abcd${EMOJI}e`
    expect(s.slice(0, 5)).toMatch(SURROGATE_ORFAO)
    expect(truncarPorCodePoint(s, 5).texto).not.toMatch(SURROGATE_ORFAO)
  })

  it("texto de só emojis: conta code points, e todo corte é válido", () => {
    const s = EMOJI.repeat(10)
    for (let max = 0; max <= 10; max++) {
      const r = truncarPorCodePoint(s, max)
      expect(Array.from(r.texto)).toHaveLength(max)
      expect(r.texto).not.toMatch(SURROGATE_ORFAO)
      expect(r.tamanho).toBe(10)
    }
  })

  it("no limite exato e abaixo dele: preservado integralmente", () => {
    expect(truncarPorCodePoint(`abcd${EMOJI}`, 5)).toEqual({ texto: `abcd${EMOJI}`, truncado: false, tamanho: 5 })
    expect(truncarPorCodePoint("", 5)).toEqual({ texto: "", truncado: false, tamanho: 0 })
  })

  it("determinístico", () => {
    const s = `x${EMOJI}y`.repeat(500)
    expect(truncarPorCodePoint(s, 777)).toEqual(truncarPorCodePoint(s, 777))
  })
})

describe("descreverPayloadRecusado — replay dos 2 payloads reais da v31", () => {
  it("caso 1: o vazamento `<parameter>` fica reconhecível, e o bruto reproduz o input", () => {
    const input = real("confidence_vazou_no_summary")
    const d = descreverPayloadRecusado(input, "Payload da tool não atende ao schema: confidence: …", "schema")
    expect(d).toMatchObject({ versao: 1, classe: "schema", truncado: false })
    expect(d.campos).toEqual({ summary: "string", scores: "array" }) // sem `confidence`
    expect(d.bruto).toContain('</parameter>\\n<parameter name=\\"confidence\\">0.75')
    expect(JSON.parse(d.bruto)).toEqual(input) // dá para rodar o parser localmente sobre ele
    expect(d.json_invalido).toBeUndefined()
  })

  it("caso 2: `scores` string com JSON interno quebrado, com a posição do erro", () => {
    const input = real("scores_com_aspas_cruas")
    const d = descreverPayloadRecusado(input, "Payload da tool não atende ao schema: scores: …", "schema")
    expect(d.campos).toEqual({ summary: "string", confidence: "number", scores: "string" })
    expect(d.json_invalido?.scores).toMatch(/position 1154/)
    expect(Object.keys(d.json_invalido!)).toEqual(["scores"]) // o summary é prosa, não "JSON inválido"
    expect(JSON.parse(d.bruto)).toEqual(input)
  })

  it("payload pequeno: preservado integralmente (os dois reais cabem com folga)", () => {
    for (const c of fixture.casos) {
      const d = descreverPayloadRecusado(JSON.parse(c.bruto), "x", "schema")
      expect(d.truncado).toBe(false)
      expect(d.bruto).toBe(JSON.stringify(JSON.parse(c.bruto)))
      expect(d.tamanho).toBeLessThan(PAYLOAD_RECUSADO_MAX_CODE_POINTS / 3)
    }
  })

  it("payload gigante: cortado no teto, sinalizado, e ainda Unicode válido", () => {
    const summary = `${"a".repeat(PAYLOAD_RECUSADO_MAX_CODE_POINTS - 13)}${EMOJI.repeat(50)}`
    const d = descreverPayloadRecusado({ summary }, "x", "schema")
    expect(d.truncado).toBe(true)
    expect(Array.from(d.bruto)).toHaveLength(PAYLOAD_RECUSADO_MAX_CODE_POINTS)
    expect(d.bruto).not.toMatch(SURROGATE_ORFAO)
    expect(d.tamanho).toBeGreaterThan(PAYLOAD_RECUSADO_MAX_CODE_POINTS)
  })

  it("input inteiro como string (JSON quebrado) e input não-objeto", () => {
    expect(descreverPayloadRecusado('{"summary": "a', "x", "schema")).toMatchObject({
      campos: { "(input)": "string" },
      json_invalido: { "(input)": expect.any(String) },
    })
    expect(descreverPayloadRecusado(null, "x", "schema").campos).toEqual({ "(input)": "null" })
  })

  it("prosa em campo estruturado NÃO vira `json_invalido` (é outro defeito)", () => {
    expect(descreverPayloadRecusado({ scores: "não consegui avaliar" }, "x", "schema").json_invalido).toBeUndefined()
  })

  it("o motivo também é cortado com segurança", () => {
    const d = descreverPayloadRecusado({}, EMOJI.repeat(5000), "schema")
    expect(Array.from(d.motivo)).toHaveLength(2000)
    expect(d.motivo).not.toMatch(SURROGATE_ORFAO)
  })
})

describe("anotarPayloadRecusado — grava sem apagar o que a linha já tinha", () => {
  beforeEach(() => {
    banco.metadataAtual = {
      attempt: 0,
      logical_request_id: "lr-1",
      work_id: "w-1",
      code: { sha: "abc", dirty: false },
      hasImage: true,
    }
    banco.erroSelect = null
    banco.erroUpdate = null
    banco.selects = []
    banco.updates = []
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("preserva a metadata existente (a correlação vive nela) e acrescenta só `payload_recusado`", async () => {
    const detalhe = descreverPayloadRecusado(real("confidence_vazou_no_summary"), "motivo", "schema")
    await anotarPayloadRecusado("call-1", detalhe)
    expect(banco.updates).toHaveLength(1)
    const { id, metadata } = banco.updates[0]
    expect(id).toBe("call-1")
    expect(metadata).toEqual({ ...banco.metadataAtual, payload_recusado: detalhe })
  })

  it("higieniza para o Postgres: nenhum surrogate órfão nem NUL CRU chega à escrita", async () => {
    // O motivo e as CHAVES não passam por JSON.stringify: é ali que o caractere cru sobrevive.
    const input = { ["ca\u0000mpo"]: "a\uD83D b\u0000c" }
    await anotarPayloadRecusado("call-1", descreverPayloadRecusado(input, "motivo\u0000 \uDE00 quebrado", "schema"))
    const strings: string[] = []
    const colher = (v: unknown): void => {
      if (typeof v === "string") strings.push(v)
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          strings.push(k)
          colher(x)
        }
      }
    }
    colher(banco.updates[0].metadata)
    for (const s of strings) {
      expect(s).not.toMatch(SURROGATE_ORFAO)
      expect(s).not.toContain("\u0000")
    }
  })

  it("…e o `bruto` guarda o caractere quebrado como ESCAPE, então o input ainda é reproduzível", async () => {
    const input = { summary: "a\uD83D b\u0000c" }
    await anotarPayloadRecusado("call-1", descreverPayloadRecusado(input, "m", "schema"))
    const bruto = (banco.updates[0].metadata.payload_recusado as { bruto: string }).bruto
    expect(bruto).toContain("\\ud83d")
    expect(JSON.parse(bruto)).toEqual(input)
  })

  it("sem id da linha: não toca o banco", async () => {
    await anotarPayloadRecusado(null, { classe: "schema" })
    expect(banco.selects).toEqual([])
    expect(banco.updates).toEqual([])
  })

  it("fail-soft: erro de leitura ou de escrita não lança", async () => {
    banco.erroSelect = "boom"
    await expect(anotarPayloadRecusado("call-1", {})).resolves.toBeUndefined()
    banco.erroSelect = null
    banco.erroUpdate = "boom"
    await expect(anotarPayloadRecusado("call-1", {})).resolves.toBeUndefined()
    expect(banco.updates).toEqual([])
  })
})
