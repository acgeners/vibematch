import { describe, it, expect } from "vitest"
import { CRITERION_GROUP } from "@/lib/ai-evaluation/service"
import { CRITERION_SLUGS } from "@/types/domain"

// v23 dividiu os 9 critérios em dois grupos de interpretação (FATO/SENTIMENTO), e o
// prompt marca cada critério com o seu. `buildCriteriaPromptSection` cai em "FATO" se
// o mapa não cobrir um slug — um critério novo entraria no grupo errado EM SILÊNCIO.
// Esta trava obriga a decisão explícita de grupo ao adicionar critério.
describe("CRITERION_GROUP", () => {
  it("cobre todos os 9 critérios IA — sem default silencioso", () => {
    for (const slug of CRITERION_SLUGS) {
      expect(CRITERION_GROUP[slug], `critério "${slug}" sem grupo definido`).toBeDefined()
    }
  })

  it("não tem grupo sobrando que não seja um critério real", () => {
    const slugs = new Set<string>(CRITERION_SLUGS)
    for (const key of Object.keys(CRITERION_GROUP)) {
      expect(slugs.has(key), `"${key}" não é um CRITERION_SLUG`).toBe(true)
    }
  })

  it("couple_dynamics é o único SENTIMENTO de valência; os 5 FATOS são intensidade", () => {
    expect(CRITERION_GROUP.couple_dynamics).toBe("SENTIMENTO")
    expect(CRITERION_GROUP.romance).toBe("FATO")
    expect(CRITERION_GROUP.adult_content).toBe("FATO")
    const fatos = Object.values(CRITERION_GROUP).filter((g) => g === "FATO").length
    expect(fatos).toBe(5)
  })
})
