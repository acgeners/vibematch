import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SONNET_MODEL } from "@/lib/ai/models"
import { computeCostUsd, priceForModel } from "@/lib/ai/pricing"
import { previewCost } from "@/lib/cost-preview/catalog"
import { estimateUsdFromTokens } from "@/lib/orchestration/cost"
import { AI_OPERATIONS } from "@/lib/ai-observability/types"

/**
 * A1a — as quatro superfícies de custo precificam a MESMA chamada.
 *
 * O defeito medido em 22/08/2026: `lib/cost-preview/catalog.ts` chumbava
 * `claude-sonnet-4-6` enquanto o app chamava `claude-sonnet-5`. O popup que existe para a
 * pessoa AUTORIZAR um gasto exibia **$0,0465** para uma `ai_evaluation` que custa **~$0,0310**
 * — 50% a mais, porque precificava $3/$15 em vez de $2/$10.
 *
 * 🔴 O mais caro não era o número: era o popup deixar de descrever a chamada. É o mesmo popup
 * que precisa ser levado a sério no botão ao lado.
 *
 * As quatro superfícies:
 *   preview  → `previewCost` (o popup)
 *   logging  → `computeCostUsd` (o que vai para `ai_api_calls.cost_usd`)
 *   saldo    → deriva de `ai_api_calls`, logo do logging
 *   gate     → `estimateUsdFromTokens` (bloqueia/libera pelo custo estimado)
 */

const USO = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 }

describe("as quatro superfícies usam o MESMO modelo e o MESMO preço", () => {
  it("o preview nomeia exatamente o modelo que a chamada usa", () => {
    // Toda ação Sonnet do catálogo tem de apontar para o dono, não para um literal.
    const sonnetActions = ["ai_evaluation", "review_digest", "rerank_single", "deep_dive"] as const
    for (const a of sonnetActions) {
      expect(previewCost(a).model, `preview de "${a}" nomeia outro modelo`).toBe(SONNET_MODEL)
    }
  })

  it("preview e logging chegam ao MESMO custo para o mesmo uso", () => {
    const doLogging = computeCostUsd(SONNET_MODEL, USO)
    const somaLogging = doLogging.costInputUsd + doLogging.costOutputUsd
    const doGate = estimateUsdFromTokens(SONNET_MODEL, USO)
    expect(doGate).toBeCloseTo(somaLogging, 9)
    // E os dois usam a tarifa vigente, não uma cópia.
    const p = priceForModel(SONNET_MODEL)!
    expect(somaLogging).toBeCloseTo(p.inputPerMTok + p.outputPerMTok, 9)
  })

  it("a tarifa do Sonnet ativo é $2/$10 — conferida na página oficial em 22/08/2026", () => {
    expect(priceForModel(SONNET_MODEL)).toEqual({
      inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheCreationPerMTok: 2.5,
    })
  })

  it("nenhuma das quatro devolve `unknown@` para o modelo ativo", () => {
    // `unknown@` é o modo de falha silencioso: custo ZERO gravado em `ai_api_calls`.
    expect(computeCostUsd(SONNET_MODEL, USO).pricingSource).not.toMatch(/^unknown@/)
    expect(Number.isFinite(estimateUsdFromTokens(SONNET_MODEL, USO))).toBe(true)
  })

  it("a observabilidade declara o modelo REAL das operações Sonnet", () => {
    // `defaultModel` alimenta o /curation/ai-usage. Dez operações declaravam sonnet-4-6
    // enquanto rodavam sonnet-5; `synopsis_consolidator` declarava HAIKU e roda SONNET.
    const rodamSonnet = [
      "ai_evaluation", "synopsis_quality_predict", "recommendation_rank",
      "recommendation_taste_profile", "recommendation_chat", "review_digest",
      "deep_dive", "tag_verify", "tag_clustering", "synopsis_consolidator",
    ] as const
    for (const op of rodamSonnet) {
      expect(AI_OPERATIONS[op].defaultModel, `${op} declara modelo diferente do real`).toBe(SONNET_MODEL)
    }
  })

  it("as escolhas de Haiku NÃO foram uniformizadas junto", () => {
    // Haiku é escolha de modelo BARATO, não "o ativo" — trocá-lo apagaria a intenção.
    for (const op of ["review_summarizer", "tag_classifier", "tag_enricher", "tag_inference"] as const) {
      expect(AI_OPERATIONS[op].defaultModel, `${op} deixou de ser Haiku`).toMatch(/^claude-haiku/)
    }
  })

  it("nenhuma superfície de CUSTO reintroduz um literal claude-*", () => {
    // A varredura é da FORMA, não de uma lista de nomes: o próximo arquivo de preview
    // que chumbar um modelo cai aqui sozinho.
    for (const f of [
      "lib/cost-preview/catalog.ts",
      "lib/cost-preview/interest-cost-steps.ts",
      "lib/orchestration/contracts.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8")
      const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      const sonnets = codigo.match(/"claude-sonnet-[a-z0-9.-]+"/g) ?? []
      expect(sonnets, `${f} voltou a chumbar um Sonnet — use SONNET_MODEL`).toEqual([])
    }
  })
})
