import { describe, it, expect } from "vitest"
import {
  evaluationToolPayloadSchema,
  buildResponseFromToolPayload,
} from "@/lib/ai-evaluation/service"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * O CONTRATO das 9 notas: o conjunto de `criterion` tem que ser exatamente
 * `CRITERION_SLUGS`, cada slug uma vez, nenhum ausente, nenhum desconhecido.
 *
 * 🔴 Este arquivo existe porque `.length(9)` NÃO é o contrato, e o contraexemplo
 * é o caso 3 abaixo: 9 entradas com um slug repetido e outro ausente. A contagem
 * bate e mesmo assim o mapa fica com 8 chaves — o repetido é sobrescrito em
 * silêncio (last-wins) e o ausente era fabricado como 5,0 + "Não avaliado.".
 *
 * Custo medido do defeito, na nuvem, antes desta correção: 1 obra em 2.265
 * avaliações auditáveis ficou com `adult_content` = 5,0 aceito e VIGENTE em
 * `category_scores`, para um critério que o modelo nunca avaliou — com
 * `confidence` global 0,75, porque os outros oito tinham evidência.
 *
 * ⚠️ Os casos DERIVAM de `CRITERION_SLUGS`. Lista fixa aqui não acompanharia um
 * critério novo no banco, que é justamente quando o contrato precisa valer.
 */

const nota = (criterion: string, score = 7) => ({
  criterion,
  score,
  justification: `Faixa 7-8: ${criterion}.`,
})
const canonicas = () => CRITERION_SLUGS.map((slug) => nota(slug))
const payload = (scores: unknown[]) => ({ summary: "Resumo.", confidence: 0.8, scores })

describe("contrato estrutural do payload das notas", () => {
  it("1. os 9 slugs canônicos, cada um uma vez → PASSA", () => {
    const r = evaluationToolPayloadSchema.safeParse(payload(canonicas()))
    expect(r.success).toBe(true)
  })

  it("6. os 9 canônicos FORA DE ORDEM → PASSA (a ordem não é o contrato)", () => {
    const r = evaluationToolPayloadSchema.safeParse(payload([...canonicas()].reverse()))
    expect(r.success).toBe(true)
  })

  it("2. falta um critério (8 entradas) → FALHA, nomeando o ausente", () => {
    const faltando = CRITERION_SLUGS[CRITERION_SLUGS.length - 1]
    const r = evaluationToolPayloadSchema.safeParse(payload(canonicas().slice(0, -1)))
    expect(r.success).toBe(false)
    if (r.success) return
    expect(JSON.stringify(r.error.issues)).toContain(faltando)
  })

  it("3. 9 entradas com DUPLICATA + AUSENTE → FALHA (o caso que `.length(9)` deixa passar)", () => {
    const duplicado = CRITERION_SLUGS[0]
    const ausente = CRITERION_SLUGS[CRITERION_SLUGS.length - 1]
    const scores = [...canonicas().slice(0, -1), nota(duplicado, 2)]
    expect(scores).toHaveLength(CRITERION_SLUGS.length) // a cardinalidade BATE
    const r = evaluationToolPayloadSchema.safeParse(payload(scores))
    expect(r.success).toBe(false)
    if (r.success) return
    const texto = JSON.stringify(r.error.issues)
    expect(texto).toContain(ausente)
    expect(texto).toContain(duplicado)
  })

  it("4. entrada a mais (10) → FALHA", () => {
    const r = evaluationToolPayloadSchema.safeParse(
      payload([...canonicas(), nota(CRITERION_SLUGS[0], 3)])
    )
    expect(r.success).toBe(false)
  })

  it("5. slug DESCONHECIDO → FALHA", () => {
    const r = evaluationToolPayloadSchema.safeParse(
      payload([...canonicas(), nota("plot_twist", 9)])
    )
    expect(r.success).toBe(false)
  })

  it("7. payload estruturalmente inválido NUNCA vira nota — nem 5, nem 'Não avaliado.'", () => {
    const quebrados = [
      canonicas().slice(0, -1),
      [...canonicas().slice(0, -1), nota(CRITERION_SLUGS[0], 2)],
      [...canonicas(), nota(CRITERION_SLUGS[0], 3)],
      [...canonicas(), nota("plot_twist", 9)],
    ]
    for (const scores of quebrados) {
      const r = evaluationToolPayloadSchema.safeParse(payload(scores))
      expect(r.success).toBe(false)
      // e o parse falho não entrega `data`, então nada chega ao construtor
      expect(r.success ? r.data : null).toBeNull()
    }
  })

  it("8. a invariante do construtor LANÇA em vez de fabricar, nomeando o slug", () => {
    const ausente = CRITERION_SLUGS[CRITERION_SLUGS.length - 1]
    // payload que NÃO passou pelo schema — é o único jeito de alcançar a invariante
    const bypass = { summary: "x", confidence: 0.5, scores: canonicas().slice(0, -1) }
    expect(() =>
      buildResponseFromToolPayload(bypass as never, "Obra", "modelo", "hash")
    ).toThrowError(new RegExp(ausente))
    // e a mensagem precisa dizer que NADA foi fabricado
    expect(() =>
      buildResponseFromToolPayload(bypass as never, "Obra", "modelo", "hash")
    ).toThrowError(/[Nn]enhuma nota foi fabricada/)
  })

  it("o caminho feliz continua entregando exatamente as 9 notas, na ordem canônica", () => {
    const r = evaluationToolPayloadSchema.safeParse(payload(canonicas()))
    expect(r.success).toBe(true)
    if (!r.success) return
    const out = buildResponseFromToolPayload(r.data, "Obra", "modelo", "hash")
    expect(out.scores.map((s) => s.criterionSlug)).toEqual([...CRITERION_SLUGS])
    expect(out.scores.every((s) => s.suggestedScore === 7)).toBe(true)
    expect(out.scores.some((s) => s.justification === "Não avaliado.")).toBe(false)
  })
})
