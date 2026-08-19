import { describe, it, expect } from "vitest"
import {
  classifyEvalPrep,
  reviewContextAt,
  MAIN_REVIEW_SOURCES,
  type EvalPrepInput,
} from "@/lib/ai-evaluation/eval-readiness"
import { SELECTABLE_EXTERNAL_SOURCES } from "@/lib/external/source-order"

/**
 * A régua de "o que falta antes de avaliar os 9 atributos".
 *
 * Ela decide três coisas que a tela promete: se o botão diz "Preparar e avaliar", se a
 * obra é BLOQUEADA por falta de fonte principal, e se o lote vai pagar `infer_tags`.
 * Errar pro lado permissivo é avaliar com tags anteriores às reviews (o defeito que a
 * feature existe pra fechar); errar pro lado restritivo é gastar 0,99¢ à toa por obra.
 */

const BASE: EvalPrepInput = {
  sourceStates: { comix: "linked", mangago: "linked" },
  tagsInferredAt: "2026-08-18T00:00:00.000Z",
  reviewDigestAt: "2026-08-10T00:00:00.000Z",
  reviewSummaryAt: "2026-08-09T00:00:00.000Z",
}

const com = (over: Partial<EvalPrepInput>): EvalPrepInput => ({ ...BASE, ...over })

describe("fontes principais", () => {
  it("são duas, e as duas existem no catálogo de fontes selecionáveis", () => {
    // Deriva do catálogo real: uma fonte renomeada no Supabase (via sync-constants)
    // deixaria a régua apontando pra um id que não existe, e o gate passaria a
    // bloquear TODA obra por uma lacuna que ninguém consegue resolver.
    expect(MAIN_REVIEW_SOURCES.length).toBe(2)
    for (const source of MAIN_REVIEW_SOURCES) {
      expect(SELECTABLE_EXTERNAL_SOURCES).toContain(source)
    }
  })

  it("lacuna (`gap`) bloqueia — é o único estado que é trabalho", () => {
    const prep = classifyEvalPrep(com({ sourceStates: { comix: "linked" } }))
    expect(prep.missingSources).toEqual(["mangago"])
    expect(prep.blocked).toBe(true)
    expect(prep.ready).toBe(false)
  })

  it("🔴 `absent` (declarada inexistente) NÃO bloqueia", () => {
    // O contrário travaria pra sempre toda obra que de fato não está na fonte — e a
    // única saída seria mentir, vinculando um id errado. Declarar ausência É resolver.
    const prep = classifyEvalPrep(
      com({ sourceStates: { comix: "linked", mangago: "absent" } }),
    )
    expect(prep.missingSources).toEqual([])
    expect(prep.blocked).toBe(false)
  })

  it("as duas em lacuna aparecem as duas, na ordem da constante", () => {
    const prep = classifyEvalPrep(com({ sourceStates: {} }))
    expect(prep.missingSources).toEqual([...MAIN_REVIEW_SOURCES])
  })

  it("fonte SECUNDÁRIA em lacuna não bloqueia (só o mapa das principais chega aqui)", () => {
    // anilist tem 0,1 review por vínculo — travar a curadoria por ela seria o alarme
    // que sempre toca, e ela nem entra no input.
    const prep = classifyEvalPrep(com({ sourceStates: { comix: "linked", mangago: "linked" } }))
    expect(prep.blocked).toBe(false)
  })
})

describe("tags contra o contexto de reviews", () => {
  it("nunca inferidas ⇒ precisa, mesmo sem digest nenhum", () => {
    const prep = classifyEvalPrep(
      com({ tagsInferredAt: null, reviewDigestAt: null, reviewSummaryAt: null }),
    )
    expect(prep.needsTagRefresh).toBe(true)
  })

  it("inferidas DEPOIS do digest ⇒ não precisa", () => {
    expect(classifyEvalPrep(BASE).needsTagRefresh).toBe(false)
    expect(classifyEvalPrep(BASE).ready).toBe(true)
  })

  it("inferidas ANTES do digest ⇒ precisa", () => {
    const prep = classifyEvalPrep(com({ tagsInferredAt: "2026-08-01T00:00:00.000Z" }))
    expect(prep.needsTagRefresh).toBe(true)
    expect(prep.ready).toBe(false)
  })

  it("🔴 o RESUMO conta, não só o digest — é o mais novo dos dois que vale", () => {
    // `buildReviewContext` lê os dois. Olhar só `review_digest_at` deixaria de fora a
    // obra cujo resumo foi regerado (o gate do digest é mais rígido que o do resumo),
    // e ela seria avaliada com tags anteriores ao texto que a inferência leria.
    const carimbos = {
      reviewDigestAt: "2026-08-10T00:00:00.000Z",
      reviewSummaryAt: "2026-08-20T00:00:00.000Z",
    }
    expect(reviewContextAt(carimbos)).toBe("2026-08-20T00:00:00.000Z")
    const prep = classifyEvalPrep(
      com({ tagsInferredAt: "2026-08-15T00:00:00.000Z", ...carimbos }),
    )
    expect(prep.needsTagRefresh).toBe(true)

    // Sonda: olhando SÓ o digest (o erro provável), esta obra passaria por "em dia".
    const soDigest = classifyEvalPrep(
      com({ tagsInferredAt: "2026-08-15T00:00:00.000Z", ...carimbos, reviewSummaryAt: null }),
    )
    expect(soDigest.needsTagRefresh).toBe(false)
  })

  it("🔴 obra SEM digest e SEM resumo que já inferiu NÃO precisa reinferir", () => {
    // São 6 no catálogo. Marcar aqui gastaria 0,99¢ pra reler só a sinopse, que não
    // mudou — o contexto novo é justamente o que não existe.
    const prep = classifyEvalPrep(
      com({ reviewDigestAt: null, reviewSummaryAt: null }),
    )
    expect(prep.needsTagRefresh).toBe(false)
  })

  it("carimbos IGUAIS não disparam — a comparação é estrita", () => {
    const t = "2026-08-10T00:00:00.000Z"
    const prep = classifyEvalPrep(
      com({ tagsInferredAt: t, reviewDigestAt: t, reviewSummaryAt: null }),
    )
    expect(prep.needsTagRefresh).toBe(false)
  })
})

/**
 * ⚠️ **Não há caso de "evidência escassa" aqui, e é DECISÃO medida.** Houve um campo
 * `lowEvidence` (reviews úteis abaixo do piso do digest) e ele foi REMOVIDO em
 * 2026-08-19, antes de chegar à tela. Medido na fila de 552: 26 obras escassas, das
 * quais **16 (61,5%) já estão travadas por falta de fonte** — sobram 10 (1,8% da fila),
 * e 8 dessas já imprimem confiança < 0,80 no próprio card. Some-se a isso que o piso de
 * 4 foi medido para o DIGEST (`salient_traits < 3`), não para a avaliação de atributo:
 * era régua de outro artefato. Ver o CLAUDE.md antes de reintroduzir.
 */
