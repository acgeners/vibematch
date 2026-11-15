// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Lote "Reviews do catálogo", 14/11/2026: o Mangago estourou os 60 s em 91 de 152 obras. Ele abre
// até 40 tópicos, uma página por vez pelo sidecar, e medido são 1,58 s por página (mediana de 2.893):
// ~70 s para 40. O `withTimeout` da orquestração descartava TODAS as reviews da obra, ela não era
// marcada como conferida, e o sidecar seguia renderizando páginas que ninguém esperava mais.
//
// Aqui o relógio é falso e cada página "custa" 1,6 s; o bypass é simulado, a página de tópico é real.

vi.mock("@/lib/external/flaresolverr", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/external/flaresolverr")>()
  return {
    fetchHtmlWithCfFallback: vi.fn(),
    isCfBypassUnavailable: vi.fn(() => false),
    isCloudflareChallenge: real.isCloudflareChallenge,
  }
})
vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => false,
  renderHtmlViaSidecar: async () => null,
  isSidecarBlockedFor: () => false,
}))
vi.mock("@/lib/external/source-health-store", () => ({ upsertSourceHealth: vi.fn(async () => {}) }))

import {
  collectMangagoReviews,
  fetchMangagoReviews,
  MANGAGO_REVIEWS_BUDGET_MS,
  MangagoUnavailableError,
} from "@/lib/external/mangago"
import { fetchHtmlWithCfFallback, isCfBypassUnavailable } from "@/lib/external/flaresolverr"

const TOPICO = readFileSync(join(process.cwd(), "tests/fixtures/mangago/topico.html"), "utf8")
const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)
const pagina = (html: string) => ({ html, finalUrl: "https://www.mangago.me/" })

/** Lista de discussão no formato que o extrator lê: 11 tópicos por página, do mais novo ao mais antigo. */
function listaDe(page: number, total: number): string {
  const ids = Array.from({ length: 11 }, (_, i) => (page - 1) * 11 + i).filter((i) => i < total)
  return `<html>${ids.map((i) => `<a href="/home/mangatopic/${90_000 - i}/">Tópico ${i}</a>`).join("")}</html>`
}

/** Simula a fonte: cada página custa `custoMs` no relógio falso. Devolve os orçamentos pedidos. */
function simular(totalTopicos: number, custoMs: number, relogio: { t: number }) {
  const orcamentos: number[] = []
  fetchHtml.mockImplementation(async (url: string, _h?: unknown, abortMs?: number) => {
    orcamentos.push(abortMs ?? -1)
    relogio.t += custoMs
    if (url.includes("/home/manga/discussion/")) {
      const page = Number(new URL(url).searchParams.get("page") ?? "1")
      return pagina(listaDe(page, totalTopicos))
    }
    if (url.includes("/home/mangatopic/")) return pagina(TOPICO)
    throw new Error(`URL inesperada no teste: ${url}`)
  })
  return orcamentos
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(isCfBypassUnavailable).mockReturnValue(false)
})
afterEach(() => vi.restoreAllMocks())

describe("collectMangagoReviews — orçamento de tempo", () => {
  it("40 tópicos a 1,6 s: para no orçamento e DEVOLVE o que já buscou, marcado como parcial", async () => {
    const relogio = { t: 0 }
    simular(40, 1_600, relogio)
    const out = await collectMangagoReviews("obra_ficticia", { now: () => relogio.t })

    // 4 páginas de lista (6,4 s) + tópicos até 50 s ⇒ ~27 reviews, e não zero.
    expect(out.reviews.length).toBeGreaterThanOrEqual(25)
    expect(out.reviews.length).toBeLessThan(40)
    expect(out.partialFailure).toMatch(/^tempo esgotado: \d+ de 40 tópicos abertos$/)
    expect(relogio.t).toBeLessThanOrEqual(MANGAGO_REVIEWS_BUDGET_MS + 1_600)
  })

  it("nenhuma página pede mais tempo do que sobra no orçamento", async () => {
    const relogio = { t: 0 }
    const pedidos: Array<{ pediu: number; sobrava: number }> = []
    fetchHtml.mockImplementation(async (url: string, _h?: unknown, abortMs?: number) => {
      pedidos.push({ pediu: abortMs ?? -1, sobrava: MANGAGO_REVIEWS_BUDGET_MS - relogio.t })
      relogio.t += 1_600
      if (url.includes("/home/manga/discussion/")) {
        const page = Number(new URL(url).searchParams.get("page") ?? "1")
        return pagina(listaDe(page, 40))
      }
      return pagina(TOPICO)
    })
    await collectMangagoReviews("obra_ficticia", { now: () => relogio.t })

    for (const p of pedidos) expect(p.pediu).toBeLessThanOrEqual(p.sobrava)
  })

  it("obra com poucos tópicos: termina inteira, sem parcial", async () => {
    const relogio = { t: 0 }
    simular(10, 1_600, relogio)
    const out = await collectMangagoReviews("obra_ficticia", { now: () => relogio.t })

    expect(out.reviews).toHaveLength(10)
    expect(out.partialFailure).toBeUndefined()
  })

  it("tempo acabou antes da 1ª review: LANÇA (a fonte não entregou nada; não é 'sem opinião')", async () => {
    const relogio = { t: 0 }
    simular(40, 30_000, relogio) // páginas de lista lentíssimas comem o orçamento
    await expect(collectMangagoReviews("obra_ficticia", { now: () => relogio.t })).rejects.toBeInstanceOf(
      MangagoUnavailableError,
    )
  })

  it("o script de backfill (fetchMangagoReviews, sem orçamento) segue buscando os 40", async () => {
    const relogio = { t: 0 }
    simular(40, 1_600, relogio)
    await expect(fetchMangagoReviews("obra_ficticia")).resolves.toHaveLength(40)
  })
})

describe("na coleta de reviews, o parcial do Mangago NÃO é fonte em falha", () => {
  it("as reviews chegam e o Mangago fica fora de failedSources", async () => {
    // Relógio falso só no `Date` (o `withTimeout` da orquestração segue com timers reais).
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      fetchHtml.mockImplementation(async (url: string) => {
        vi.setSystemTime(Date.now() + 1_600)
        if (url.includes("/home/manga/discussion/")) {
          const page = Number(new URL(url).searchParams.get("page") ?? "1")
          return pagina(listaDe(page, 40))
        }
        return pagina(TOPICO)
      })
      vi.spyOn(console, "log").mockImplementation(() => {})
      const { collectReviewsFromCandidate } = await import("@/lib/external/index")
      const out = await collectReviewsFromCandidate({
        title: "Obra Fictícia",
        sources: ["mangago"],
        mangagoSlug: "obra_ficticia",
        matchScore: 1,
      } as Parameters<typeof collectReviewsFromCandidate>[0])

      expect(out.failedSources).toEqual([])
      expect(out.reviews.length).toBeGreaterThanOrEqual(25)
      const linha = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[collectReviews]"))
      expect(linha).toMatch(/mangago=\d+\(.*parcial: tempo esgotado/)
    } finally {
      vi.useRealTimers()
    }
  })
})
