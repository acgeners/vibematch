import { vi, describe, it, expect } from "vitest"

// Server actions / módulos server-only não rodam no jsdom — mockados. O alvo aqui é
// só a função pura `buildSynopsisPool`, mas ela mora no arquivo do diálogo.
vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }))
vi.mock("@/server/actions/works", () => ({ updateWorkExternalData: vi.fn(), refreshWorkExternalData: vi.fn() }))
vi.mock("@/lib/external/client-fetches", () => ({ fetchComicKClient: vi.fn(), fetchAnimePlanetClient: vi.fn() }))
vi.mock("@/components/titles/external-search", () => ({ ExternalSearch: () => null }))
vi.mock("@/server/actions/external", () => ({
  revalidateWorkSources: vi.fn(),
  saveWorkSourceSelections: vi.fn(),
  isComixAutoResolveAvailable: vi.fn(async () => true),
  setComixHidManually: vi.fn(),
}))

import { buildSynopsisPool } from "@/components/titles/update-data-dialog"

/**
 * O caso do print (obra "Reeling in the Male Lead"): três cartões "JÁ SALVA" pro que
 * era, no fundo, uma sinopse só — o MangaUpdates com a cauda "Original Novel: …" e o
 * Comix com o mesmo texto em markdown cru. A chave exata que o pool usava não via
 * relação nenhuma entre eles.
 */
const PROSA =
  "What's a girl to do when a problematic fave ends up as the catch of the day? After a long " +
  "hospitalization in her past life, Yuri is thrilled to wake up on a mysterious island feeling fit and healthy."

describe("buildSynopsisPool", () => {
  it("colapsa salva + externa que só diferem no bloco de fonte", () => {
    const pool = buildSynopsisPool(
      [{ source: "mangaupdates", text: `${PROSA} Original Novel: KakaoPage, Naver Series`, isPrimary: true }],
      [{ source: "comix", text: `${PROSA}\n\n**Original Novel:**\n[KakaoPage](https://page.kakao.com/content/63968767)` }]
    )
    expect(pool).toHaveLength(1)
    expect(pool[0].source).toBe("mangaupdates")
    expect(pool[0].saved).toBe(true)
    expect(pool[0].isPrimary).toBe(true)
  })

  it("mostra o texto LIMPO — a tela precisa exibir o que vai ser gravado", () => {
    const pool = buildSynopsisPool(
      [{ source: "comix", text: `${PROSA}\n\n**Original Novel:**\n[Ridibooks](https://ridibooks.com/books/1)`, isPrimary: true }],
      []
    )
    expect(pool[0].text).toBe(PROSA)
    expect(pool[0].text).not.toMatch(/Original Novel|https?:|\*\*/)
  })

  it("mantém sinopses genuinamente diferentes como itens separados", () => {
    const outra =
      "I have been living alone on a deserted island for two years. However, one day, a man was caught on my fishing rod."
    const pool = buildSynopsisPool(
      [{ source: "mangaupdates", text: PROSA, isPrimary: true }],
      [{ source: "mangago", text: outra }]
    )
    expect(pool).toHaveLength(2)
    // A salva continua marcada e principal; a nova entra desmarcada pro usuário decidir.
    expect(pool[0]).toMatchObject({ source: "mangaupdates", included: true, isPrimary: true })
    expect(pool[1]).toMatchObject({ source: "mangago", included: false, isPrimary: false })
  })

  it("obra sem nada salvo continua com as externas já marcadas", () => {
    const pool = buildSynopsisPool([], [{ source: "anilist", text: PROSA }])
    expect(pool[0]).toMatchObject({ included: true, isPrimary: true })
    expect(pool[0].saved).toBeUndefined()
  })

  it("descarta a externa que a limpeza esvazia (era só lista de links)", () => {
    const pool = buildSynopsisPool(
      [{ source: "manual", text: PROSA, isPrimary: true }],
      [{ source: "comix", text: "**Official Translations:**\n[English](https://webtoons.com/x)" }]
    )
    expect(pool).toHaveLength(1)
    expect(pool[0].source).toBe("manual")
  })
})
