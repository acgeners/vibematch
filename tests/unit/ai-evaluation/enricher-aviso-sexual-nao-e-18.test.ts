import { vi, describe, it, expect } from "vitest"

// O módulo importa o cliente da Anthropic; o teste só lê o TEXTO do prompt e nunca chama nada.
vi.mock("@/lib/ai/anthropic-client", () => ({ createLoggedMessage: vi.fn(), getAnthropicClient: vi.fn() }))

import { buildSystemPrompt } from "@/lib/ai-evaluation/tag-enricher"

/**
 * Decisão de produto fechada em 2026-10-09: tag de abuso, violência sexual, não-consentimento ou
 * pedofilia NÃO liga, sozinha, o gate 18+ (`works.is_adult`). Ela é AVISO de tema sensível.
 *
 * O enricher é quem classifica as tags NOVAS (`adult_level` → `adult_indicator[_strong]`), e o
 * prompt dele se contradizia: o item 3 mandava "none" para violência sexual e o item 4 dizia que
 * "Rape" e "Pedophilia" "podem ser fortes o bastante pra marcar a obra 18+". As tags de estupro
 * criadas de fonte em 2026-07-27 saíram `strong`. Este teste lê o texto que o modelo recebe.
 */
const PROMPT = buildSystemPrompt({
  groupSlug: "content_indicator",
  groupName: "Indicadores de conteúdo",
  newTags: [{ name: "Gang Rape", slug: "gang-rape" }],
  approvedSubgroups: [],
  existingTags: [],
})

/** O trecho de um item numerado do prompt ("3. …" até o próximo "4. …"). */
function item(n: number): string {
  const inicio = PROMPT.indexOf(`\n${n}. `)
  const fim = PROMPT.indexOf(`\n${n + 1}. `, inicio + 1)
  expect(inicio, `item ${n} do prompt`).toBeGreaterThan(-1)
  return PROMPT.slice(inicio, fim === -1 ? undefined : fim)
}

describe("enricher de tags: aviso de violência sexual não é 18+", () => {
  it("o item 18+ (adult_level) classifica abuso/violência sexual/pedofilia como 'none'", () => {
    const adultLevel = item(3)
    const none = adultLevel.slice(adultLevel.indexOf('- "none"'))
    for (const tag of ["Rape", "Pedophilia", "Non-Consensual Relationship", "Drugging/Roofing"]) {
      expect(none, `${tag} no "none" do adult_level`).toContain(`"${tag}"`)
    }
  })

  it("nenhuma frase diz que um aviso de conteúdo pode marcar a obra 18+", () => {
    const frase = "podem ser fortes o bastante pra marcar a obra 18+"
    const piso = item(4)
    const corte = piso.indexOf(frase)
    expect(corte, "a frase sobre o que pode marcar 18+ continua existindo (anatomia/temas)").toBeGreaterThan(-1)
    // O que vem ANTES da frase, dentro do mesmo "Em especial:", é o que ela autoriza a marcar 18+.
    const autorizados = piso.slice(piso.lastIndexOf("Em especial:", corte), corte)
    expect(autorizados).not.toContain('"Rape"')
    expect(autorizados).not.toContain('"Pedophilia"')
    // E o escopo NÃO foi alargado: anatomia/dinâmicas seguem como estavam (não houve decisão sobre elas).
    expect(autorizados).toContain('"Big Breasts"')
    expect(autorizados).toContain('"BDSM"')
  })
})
