import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { INSTRUCAO_ARTE } from "@/lib/ai-evaluation/art-signal"
import { INSTRUCAO_FRONTEIRA_TEXTUAL } from "@/lib/ai-evaluation/evidence-format"
import { buildUserPrompt, evaluationToolFor, PRODUCTION_VARIANT, VARIANTE_V30 } from "@/lib/ai-evaluation/service"
import { PEDIDOS_SINTETICOS } from "../../fixtures/ai-evaluation/user-prompt-requests"

/**
 * O producer canônico virou a v32 (Arte na mesma chamada). Este arquivo prova duas coisas:
 *
 * 1. a v30 continua REPRODUZÍVEL byte a byte pela `VARIANTE_V30` — o golden foi gerado com
 *    `origin/main` @ a5bd5ed, ANTES de qualquer mudança de Arte, sobre pedidos que passam por todos
 *    os ramos (sinopse manual, contexto, adicionais, similares, notas de plataforma, piso adulto,
 *    marcador R19, reviews manuais/externas/legadas, sem reviews);
 * 2. a v32 é a v30 + a moldura textual da evidência + a instrução de Arte — e nada mais.
 */
const golden = JSON.parse(readFileSync("tests/fixtures/ai-evaluation/user-prompt-v30-golden.json", "utf8")) as {
  prompts: Record<string, string>
}

function montar(req: Record<string, unknown>, variante?: typeof PRODUCTION_VARIANT) {
  const r = req as Record<string, unknown> & { sourcedReviews?: unknown[]; reviews?: string[] }
  const revs = r.sourcedReviews ?? null
  const legacy = revs ? null : (r.reviews ?? null)
  const ids = ((revs ?? legacy ?? []) as unknown[]).map((_, i) => `R${i + 1}`)
  const args: unknown[] = [r, { sourcedReviews: revs, legacyReviews: legacy, ids }]
  if (variante) args.push(variante)
  return (buildUserPrompt as (...a: unknown[]) => string)(...args)
}

describe("v30 continua reproduzível byte a byte (VARIANTE_V30)", () => {
  for (const { nome, req } of PEDIDOS_SINTETICOS) {
    it(`${nome}`, () => {
      expect(montar(req, VARIANTE_V30)).toBe(golden.prompts[nome])
    })
  }

  it("o golden cobre todos os pedidos (nenhum ramo esquecido)", () => {
    expect(Object.keys(golden.prompts).sort()).toEqual(PEDIDOS_SINTETICOS.map((p) => p.nome).sort())
  })

  it("a tool da v30 não tem `art`", () => {
    const tool = evaluationToolFor(VARIANTE_V30) as { input_schema: { properties: Record<string, unknown>; required: string[] } }
    expect(tool.input_schema.properties).not.toHaveProperty("art")
    expect(tool.input_schema.required).not.toContain("art")
  })
})

describe("v32 é o producer canônico: v30 + fronteira textual + Arte", () => {
  for (const { nome, req } of PEDIDOS_SINTETICOS) {
    it(`${nome}: sem variante = PRODUCTION_VARIANT, e termina na instrução de Arte`, () => {
      const p = montar(req)
      expect(p).toBe(montar(req, PRODUCTION_VARIANT))
      expect(p.endsWith(`\n\n${INSTRUCAO_ARTE}`)).toBe(true)
    })
  }

  it("sem evidência externa, a v32 é EXATAMENTE a v30 + a instrução de Arte", () => {
    const semEvidencia = PEDIDOS_SINTETICOS.filter(({ req }) => !montar(req, PRODUCTION_VARIANT).includes(INSTRUCAO_FRONTEIRA_TEXTUAL))
    expect(semEvidencia.length).toBeGreaterThan(0) // senão o caso não exercita nada
    for (const { nome, req } of semEvidencia) expect(montar(req)).toBe(`${golden.prompts[nome]}\n\n${INSTRUCAO_ARTE}`)
  })

  it("com evidência externa, a v32 traz a fronteira textual uma vez e os blocos no formato textual", () => {
    const comEvidencia = PEDIDOS_SINTETICOS.filter(({ req }) => montar(req).includes(INSTRUCAO_FRONTEIRA_TEXTUAL))
    expect(comEvidencia.length).toBeGreaterThan(0)
    for (const { req } of comEvidencia) {
      const p = montar(req)
      expect(p.split(INSTRUCAO_FRONTEIRA_TEXTUAL)).toHaveLength(2)
      expect(p).toMatch(/===== INÍCIO (REVIEW|DADO EXTERNO) /)
    }
  })

  it("a tool da produção exige `art` e mantém os campos dos 11 iguais aos da v30", () => {
    const v30 = evaluationToolFor(VARIANTE_V30) as { input_schema: { properties: Record<string, unknown>; required: string[] } }
    const v32 = evaluationToolFor(PRODUCTION_VARIANT) as { input_schema: { properties: Record<string, unknown>; required: string[] } }
    expect(v32.input_schema.required).toEqual([...v30.input_schema.required, "art"])
    for (const k of Object.keys(v30.input_schema.properties)) expect(v32.input_schema.properties[k]).toEqual(v30.input_schema.properties[k])
  })
})
