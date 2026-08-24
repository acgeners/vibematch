import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

/**
 * A1b.2 → A1b.1-fix: `consolidate_synopsis` era precificado por DOIS registros que
 * discordavam, e o lado errado era o GATE.
 *
 * Retrato de 2026-08-24, com a suíte inteira VERDE:
 *   executor  `CONSOLIDATOR_MODEL` = `SONNET_MODEL`   (Sonnet, desde o prompt v3)
 *   preview   `cost-preview/catalog.ts`               → Sonnet  ✅
 *   GATE      `ACTION_CONTRACTS…estimate.model`       → **Haiku** 🔴
 *   painel    StatCard "Modelo"                       → **"claude-haiku-4-5"** 🔴
 *
 * O gate precificava **$0,0035** uma chamada que custa **$0,0070** — subestimava em
 * 2,00×, e é ele que `server/actions/generate-all.ts` soma para decidir se a cascata
 * passa. O banco confirma a migração: 496 chamadas Haiku até 30/07/2026 e 230
 * `claude-sonnet-5` de 30/07 a 20/08 (`ai_api_calls`, clone local).
 *
 * 🔴 **O guarda que já existia não podia pegar isto.** `quatro-superficies-mesmo-modelo`
 * varre os arquivos de custo procurando `"claude-sonnet-*"`; um literal **Haiku** passa
 * pela peneira por construção. E não havia nada comparando as superfícies ENTRE SI para
 * uma mesma ação. Por isso aqui a comparação é SEMÂNTICA — o modelo que cada superfície
 * resolve, não a grafia dele —, e o lado "verdade" é o símbolo do próprio executor.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/curation/settings",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))
vi.mock("@/server/actions/settings", () => ({ consolidatePendingSynopses: vi.fn() }))

import { CONSOLIDATOR_MODEL } from "@/lib/ai-recommendation/synopsis-consolidator"
import { previewCost } from "@/lib/cost-preview/catalog"
import { ACTION_CONTRACTS } from "@/lib/orchestration/contracts"
import { estimateStep } from "@/lib/orchestration/cost"
import { AI_OPERATIONS } from "@/lib/ai-observability/types"
import { computeCostUsd } from "@/lib/ai/pricing"
import { SynopsisConsolidationPanel } from "@/components/settings/synopsis-consolidation-panel"

const CONTRATO = ACTION_CONTRACTS.consolidate_synopsis

afterEach(cleanup)

describe("consolidate_synopsis: todas as superfícies resolvem o modelo do EXECUTOR", () => {
  it("preview == contrato/gate == executor == metadata de observabilidade", () => {
    // O executor é o lado VERDADE: é o ID que de fato vai para o provider e para
    // `ai_api_calls.model_name`. As outras três descrevem essa mesma chamada.
    expect(CONTRATO.estimate?.model, "o GATE precifica outro modelo que o executor").toBe(
      CONSOLIDATOR_MODEL,
    )
    expect(previewCost("consolidate_synopsis").model, "o PREVIEW nomeia outro modelo").toBe(
      CONSOLIDATOR_MODEL,
    )
    expect(
      AI_OPERATIONS.synopsis_consolidator.defaultModel,
      "a observabilidade declara outro modelo",
    ).toBe(CONSOLIDATOR_MODEL)
  })

  it("a DESCRIÇÃO da operação não nomeia uma família que não é a do executor", () => {
    // As duas metades da mesma entrada já discordaram: `defaultModel` vinha do dono e a
    // frase dizia "(Haiku)" — e é a frase que aparece no `/curation/ai-usage`.
    // A lista de proibidas é DERIVADA do executor, não escrita à mão.
    const familias = ["sonnet", "haiku", "opus"] as const
    const daVez = familias.find((f) => CONSOLIDATOR_MODEL.includes(f))
    expect(daVez, "modelo do executor fora das famílias conhecidas").toBeDefined()
    const desc = AI_OPERATIONS.synopsis_consolidator.description.toLowerCase()
    for (const outra of familias.filter((f) => f !== daVez)) {
      expect(desc, `a descrição nomeia "${outra}", mas o executor é ${CONSOLIDATOR_MODEL}`)
        .not.toContain(outra)
    }
  })

  it("o gate cobra o preço do modelo do executor para os tokens que ele mesmo declara", () => {
    // Não crava um número: deriva. Assim a asserção sobrevive a uma troca de tarifa
    // ou de estimativa de token, e só cai quando o MODELO voltar a divergir.
    const est = CONTRATO.estimate!
    const c = computeCostUsd(CONSOLIDATOR_MODEL, {
      inputTokens: est.base.inputTokens,
      outputTokens: est.base.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: est.base.cacheCreationTokens,
    })
    const esperado = c.costInputUsd + c.costOutputUsd + c.costCacheReadUsd + c.costCacheCreationUsd
    const gate = estimateStep("consolidate_synopsis", 1)
    expect(gate.pricingKnown, "modelo sem preço ⇒ o gate viraria Infinity").toBe(true)
    expect(gate.likelyUsd).toBeCloseTo(esperado, 9)
  })

  it("o gate NÃO cobra mais o preço de Haiku — a subestimação de 2× está fechada", () => {
    // Contraprova do defeito, na grandeza em que ele doía: com os MESMOS tokens, o
    // Haiku dá metade. Se alguém devolver o literal, este número volta a bater.
    const est = CONTRATO.estimate!
    const uso = {
      inputTokens: est.base.inputTokens,
      outputTokens: est.base.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: est.base.cacheCreationTokens,
    }
    const haiku = computeCostUsd("claude-haiku-4-5-20251001", uso)
    const comoHaiku = haiku.costInputUsd + haiku.costOutputUsd
    const gate = estimateStep("consolidate_synopsis", 1).likelyUsd
    expect(gate).not.toBeCloseTo(comoHaiku, 9)
    expect(gate).toBeGreaterThan(comoHaiku)
  })
})

describe("o painel de settings MOSTRA o modelo do executor", () => {
  // RENDER de propósito: o que regride é a árvore desenhada. Um teste que lesse
  // `previewCost` passaria verde com o literal de volta dentro do StatCard — foi
  // exatamente esse o estado anterior.
  it("o card 'Modelo' imprime o modelo do executor, e nenhum outro", () => {
    render(<SynopsisConsolidationPanel accent="violet" pendingCount={3} totalCount={10} />)
    const card = screen.getByText("Modelo").closest("div")!
    expect(card.textContent).toContain(CONSOLIDATOR_MODEL)
    expect(card.textContent, "o painel voltou a nomear Haiku").not.toMatch(/haiku/i)
  })

  it("o custo por obra impresso é o do catálogo, não um número escrito à mão", () => {
    render(<SynopsisConsolidationPanel accent="violet" pendingCount={3} totalCount={10} />)
    const card = screen.getByText("Modelo").closest("div")!
    // "~0,2¢/obra" era o custo do HAIKU; o Sonnet custa mais que o dobro disso.
    expect(card.textContent).not.toContain("0,2¢")
    expect(card.textContent).toMatch(/\/obra/)
  })
})
