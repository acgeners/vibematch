// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A coleta de reviews do ComicK tem duas partes, em série: a API JSON (reviews curadas) e a
// página web (comentários, uma SPA pesada). Medido na Fly em 06/10/2026: 4,4 s + 15,9 s —
// acima do teto de 18 s que a orquestração aplicava à fonte inteira. Quando os comentários
// estouravam, ela descartava TUDO, inclusive as 18 reviews da API que já tinham chegado.
//
// Este arquivo prova as três saídas que a coleta tem agora, e que elas não se confundem:
// parcial (uma parte entregou), zero legítimo (as duas responderam, sem itens) e falha (as
// duas falharam — lança, em vez de virar "0 reviews").

vi.mock("@/lib/external/flaresolverr", () => ({
  fetchHtmlWithCfFallback: vi.fn(),
  isFlareSolverrEnabled: vi.fn(() => true),
}))

import {
  collectComicKReviews,
  fetchComicKReviews,
  COMICK_API_CF_ABORT_MS,
  COMICK_COMMENTS_CF_ABORT_MS,
  COMICK_REVIEWS_BUDGET_MS,
} from "@/lib/external/comick"
import { fetchHtmlWithCfFallback } from "@/lib/external/flaresolverr"

const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)
const HID = "71gMd0vF"
const LONG = (n: number) => `Review ${n}: ${"uma opinião longa o bastante sobre a obra ".repeat(2)}`

/** JSON da API como o FlareSolverr devolve (dentro de <pre>). */
const apiPage = (reviews: string[]) => ({
  html: `<pre>${JSON.stringify({ comic: { title: "Na Honjaman Level-Up", reviews: reviews.map((content) => ({ content })) } })}</pre>`,
  finalUrl: `https://api.comick.dev/comic/${HID}`,
})
const webPage = (comments: string[]) => ({
  html: comments.map((c) => `<div class="comment-content prose">${c}</div>`).join(""),
  finalUrl: `https://comick.dev/comic/${HID}`,
})
// Página web = as bases de COMICK_WEB_BASES. ⚠️ `https://comick.dev` também é a 3ª base da API,
// então quando a API falha nas duas primeiras ela chega lá e recebe a página web — que não é
// JSON e conta como falha da API, exatamente como em produção.
const isWeb = (url: string) => url.startsWith("https://comick.io/") || url.startsWith("https://comick.dev/")

beforeEach(() => {
  vi.resetAllMocks()
  // Fetch direto: o Cloudflare desafia tudo, então cada parte cai no bypass (mockado).
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Just a moment...", { status: 403 })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("collectComicKReviews — parcial, zero legítimo e falha", () => {
  it("API entrega e os comentários falham: as reviews da API ficam, marcadas como parcial", async () => {
    fetchHtml.mockImplementation(async (url: string) => (isWeb(url) ? null : apiPage([LONG(1), LONG(2)])))

    const out = await collectComicKReviews(HID)

    expect(out.reviews).toHaveLength(2)
    expect(out.partialFailure).toMatch(/comentários/)
  })

  it("API entrega e os comentários não cabem no orçamento: devolve a API no prazo, sem esperar a página", async () => {
    vi.useFakeTimers()
    fetchHtml.mockImplementation((url: string) =>
      isWeb(url) ? new Promise(() => {}) : Promise.resolve(apiPage([LONG(1)])),
    )

    const pending = collectComicKReviews(HID)
    await vi.advanceTimersByTimeAsync(COMICK_REVIEWS_BUDGET_MS)
    const out = await pending

    expect(out.reviews).toHaveLength(1)
    expect(out.partialFailure).toMatch(/comentários/)
  })

  it("a API falha e os comentários entregam: o parcial diz que faltou a API", async () => {
    fetchHtml.mockImplementation(async (url: string) => (isWeb(url) ? webPage([LONG(9)]) : null))

    const out = await collectComicKReviews(HID)

    expect(out.reviews).toHaveLength(1)
    expect(out.partialFailure).toMatch(/API/)
  })

  it("zero legítimo: as duas partes respondem sem itens — vazio, SEM parcial e sem lançar", async () => {
    fetchHtml.mockImplementation(async (url: string) => (isWeb(url) ? webPage([]) : apiPage([])))

    const out = await collectComicKReviews(HID)

    expect(out).toEqual({ reviews: [] })
  })

  it("as duas partes falham: LANÇA (falha de verdade, não '0 reviews')", async () => {
    fetchHtml.mockResolvedValue(null)

    await expect(collectComicKReviews(HID)).rejects.toThrow(/API e comentários falharam/)
  })

  it("as duas inteiras: sem parcial", async () => {
    fetchHtml.mockImplementation(async (url: string) => (isWeb(url) ? webPage([LONG(7)]) : apiPage([LONG(1)])))

    const out = await collectComicKReviews(HID)

    expect(out.reviews).toHaveLength(2)
    expect(out.partialFailure).toBeUndefined()
  })
})

describe("orçamentos que a coleta passa ao bypass", () => {
  it("a API usa COMICK_API_CF_ABORT_MS e os comentários nunca mais do que o que sobrou do orçamento", async () => {
    fetchHtml.mockImplementation(async (url: string) => (isWeb(url) ? webPage([]) : apiPage([])))

    await collectComicKReviews(HID)

    const apiCall = fetchHtml.mock.calls.find(([url]) => !isWeb(url))
    const webCall = fetchHtml.mock.calls.find(([url]) => isWeb(url))
    expect(apiCall?.[2]).toBe(COMICK_API_CF_ABORT_MS)
    expect(webCall?.[2]).toBeLessThanOrEqual(COMICK_COMMENTS_CF_ABORT_MS)
    expect(webCall?.[2]).toBeGreaterThan(0)
  })

  it("os orçamentos cobrem o que a Fly mediu com a CPU livre, com folga", () => {
    // 06/10/2026, FlareSolverr da Fly sem throttle: API 4,4 s · comentários 15,9 s.
    expect(COMICK_API_CF_ABORT_MS).toBeGreaterThanOrEqual(4_400 * 1.5)
    expect(COMICK_COMMENTS_CF_ABORT_MS).toBeGreaterThanOrEqual(15_900 * 1.5)
    expect(COMICK_REVIEWS_BUDGET_MS).toBe(COMICK_API_CF_ABORT_MS + COMICK_COMMENTS_CF_ABORT_MS)
  })
})

describe("fetchComicKReviews (canário e script) mantém a semântica antiga", () => {
  it("tudo falhando ainda devolve [] — quem distingue falha é a coleta da orquestração", async () => {
    fetchHtml.mockResolvedValue(null)

    await expect(fetchComicKReviews(HID)).resolves.toEqual([])
  })
})

// Sanidade dos classificadores do próprio teste: se eles errarem, os casos acima testam a
// parte errada e passam por acaso.
describe("helpers do teste", () => {
  it("separam a API da página web", () => {
    expect(isWeb(`https://comick.io/comic/${HID}`)).toBe(true)
    expect(isWeb(`https://api.comick.dev/comic/${HID}`)).toBe(false)
  })
})
