import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { previewCost } from "@/lib/cost-preview/catalog"
import { ACTION_CONTRACTS } from "@/lib/orchestration/contracts"
import { COST_SAFETY_MULTIPLIER, estimateStep } from "@/lib/orchestration/cost"
import { MODEL_PRICING } from "@/lib/ai/pricing"
import type { UsageTokens } from "@/lib/ai/pricing"
import { SONNET_MODEL } from "@/lib/ai/models"
import { CONSOLIDATE_SYNOPSIS_USAGE } from "@/lib/ai-recommendation/synopsis-consolidator-usage"

/**
 * A1b.3 → fix: preview e gate estimavam a MESMA chamada com tokens diferentes.
 *
 * Até 30/07/2026 os dois diziam `1500/400` (era Haiku). A migração para Sonnet + prompt
 * v3 remediu só o `cost-preview/catalog.ts` (`1500/330`) e deixou o
 * `orchestration/contracts.ts` — que alimenta o GATE — no número velho. Um fato, duas
 * casas, uma delas atualizada. Medido nas 228 chamadas reais: p50 de **1612 / 448**, e os
 * DOIS números anteriores estavam abaixo dele (`330` no percentil 11, `400` no 29).
 *
 * Havia uma segunda divergência, ESTRUTURAL: o catálogo modelava `perItem` (escala com
 * `scale`) e o contrato modelava `base` (que `buildUsage` NÃO multiplica). O executor faz
 * UMA chamada POR OBRA, então em `scale=10` o gate devolvia o custo de UMA chamada para
 * dez obras. Latente — e latente é como isso chegaria à produção sem nada acusar.
 *
 * 🔴 **Este arquivo prova os tokens do preview SEM API de produção criada para teste.**
 * O `previewCost` não expõe `usage` (o gate expõe, e isso é anterior a este trabalho).
 * Duas costuras já existentes bastam:
 *
 *   1. **Identidade por MUTAÇÃO** — mexer no dono e ver o preview acompanhar prova que
 *      ele LÊ o dono. Uma cópia `{1612,448}` escrita à mão passaria num `toEqual` e não
 *      passa aqui: é o defeito exato que se quer impedir (duas casas que hoje concordam).
 *   2. **Inversão do custo por `MODEL_PRICING`** — o override de preço existe declarado
 *      como "costura para teste" em `lib/ai/pricing.ts` e já é usado assim em
 *      `pricing.test.ts`. Com a tarifa em (1e6, 0) o custo VIRA o nº de tokens de input;
 *      com (0, 1e6), o de output. Recupera o par exato sem inventar superfície.
 */

const CONTRATO = ACTION_CONTRACTS.consolidate_synopsis
const ACAO = "consolidate_synopsis" as const

/** Roda `fn` com a tarifa do Sonnet substituída, restaurando sempre. */
function comTarifa<T>(inputPerMTok: number, outputPerMTok: number, fn: () => T): T {
  const original = MODEL_PRICING[SONNET_MODEL]
  MODEL_PRICING[SONNET_MODEL] = {
    inputPerMTok,
    outputPerMTok,
    cacheReadPerMTok: 0,
    cacheCreationPerMTok: 0,
  }
  try {
    return fn()
  } finally {
    if (original) MODEL_PRICING[SONNET_MODEL] = original
    else delete MODEL_PRICING[SONNET_MODEL]
  }
}

/** Tokens que o PREVIEW de fato resolve, recuperados invertendo o custo. */
function usageDoPreview(scale: number): { inputTokens: number; outputTokens: number } {
  const inputTokens = comTarifa(1e6, 0, () => Math.round(previewCost(ACAO, scale).likelyUsd))
  const outputTokens = comTarifa(0, 1e6, () => Math.round(previewCost(ACAO, scale).likelyUsd))
  return { inputTokens, outputTokens }
}

/** Muta o dono, roda `fn`, restaura. */
function comDonoAlterado<T>(patch: Partial<UsageTokens>, fn: () => T): T {
  const antes = { ...CONSOLIDATE_SYNOPSIS_USAGE }
  Object.assign(CONSOLIDATE_SYNOPSIS_USAGE, patch)
  try {
    return fn()
  } finally {
    Object.assign(CONSOLIDATE_SYNOPSIS_USAGE, antes)
  }
}

describe("consolidate_synopsis: um dono só para os tokens", () => {
  it("o GATE aponta para o dono — identidade referencial, não valor igual", () => {
    expect(CONTRATO.estimate?.perItem, "o gate deixou de apontar para o dono").toBe(
      CONSOLIDATE_SYNOPSIS_USAGE,
    )
  })

  it("o PREVIEW lê o dono — mexer nele move o preview junto", () => {
    // Prova de REFERÊNCIA sem expor `usage`: um literal copiado à mão não se moveria.
    const base = usageDoPreview(1)
    const movido = comDonoAlterado({ inputTokens: 9999, outputTokens: 7777 }, () =>
      usageDoPreview(1),
    )
    expect(movido, "o preview não acompanhou o dono — voltou a ter cópia própria").toEqual({
      inputTokens: 9999,
      outputTokens: 7777,
    })
    // E o dono foi restaurado.
    expect(usageDoPreview(1)).toEqual(base)
  })

  it("scale=1: preview e gate resolvem o p50 medido — 1612 / 448", () => {
    const esperado = { inputTokens: 1612, outputTokens: 448 }
    expect(
      { inputTokens: CONSOLIDATE_SYNOPSIS_USAGE.inputTokens, outputTokens: CONSOLIDATE_SYNOPSIS_USAGE.outputTokens },
      "a baseline p50 mudou sem remedição",
    ).toEqual(esperado)
    const gate = estimateStep(ACAO, 1).usage
    expect({ inputTokens: gate.inputTokens, outputTokens: gate.outputTokens }).toEqual(esperado)
    expect(usageDoPreview(1)).toEqual(esperado)
  })

  it("scale=1: preview likely == gate likely, ANTES da margem de segurança", () => {
    const gate = estimateStep(ACAO, 1)
    const prev = previewCost(ACAO, 1)
    expect(gate.likelyUsd).toBeCloseTo(prev.likelyUsd, 12)
    expect(gate.pricingKnown).toBe(true)
  })

  it("o conservadorismo mora no multiplicador, não nos tokens", () => {
    const gate = estimateStep(ACAO, 1)
    const prev = previewCost(ACAO, 1)
    expect(gate.upperBoundUsd).toBeCloseTo(gate.likelyUsd * COST_SAFETY_MULTIPLIER, 12)
    expect(prev.upperBoundUsd).toBeCloseTo(prev.likelyUsd * COST_SAFETY_MULTIPLIER, 12)
    expect(gate.upperBoundUsd).toBeCloseTo(prev.upperBoundUsd, 12)
  })

  it("scale=10: as DUAS superfícies escalam — 16120 / 4480", () => {
    // Reprova o desenho antigo do contrato (`base`), que devolvia o custo de UMA
    // chamada em qualquer scale.
    const emLote = { inputTokens: 16120, outputTokens: 4480 }
    const gate = estimateStep(ACAO, 10).usage
    expect({ inputTokens: gate.inputTokens, outputTokens: gate.outputTokens }, "o GATE não escala com o lote").toEqual(emLote)
    expect(usageDoPreview(10), "o PREVIEW não escala com o lote").toEqual(emLote)
  })

  it("scale=10 custa 10× o scale=1 nas duas superfícies", () => {
    const g1 = estimateStep(ACAO, 1).likelyUsd
    const g10 = estimateStep(ACAO, 10).likelyUsd
    const p1 = previewCost(ACAO, 1).likelyUsd
    const p10 = previewCost(ACAO, 10).likelyUsd
    expect(g10).toBeCloseTo(g1 * 10, 12)
    expect(p10).toBeCloseTo(p1 * 10, 12)
    expect(g10).toBeCloseTo(p10, 12)
  })

  it("o dono é dado PURO — nada de servidor pode entrar nele", () => {
    // Os dois consumidores são alcançáveis do cliente; um `server-only` aqui quebraria o
    // bundle do browser, e SÓ o `npm run build` pegaria (o vitest aliasa `server-only`).
    // Não há como observar isto em runtime — daí a leitura do módulo.
    const texto = readFileSync(
      join(process.cwd(), "lib/ai-recommendation/synopsis-consolidator-usage.ts"),
      "utf8",
    )
    const codigo = texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(codigo, "o dono importou algo de servidor").not.toMatch(
      /server-only|@\/lib\/supabase|@\/server\//,
    )
    // E só pode importar TIPO: um import de valor traz o módulo junto para o bundle.
    expect(codigo.match(/^import .*$/gm) ?? [], "o dono ganhou import de VALOR").toEqual([
      'import type { UsageTokens } from "@/lib/ai/pricing"',
    ])
  })
})
