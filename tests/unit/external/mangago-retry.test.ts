import { describe, it, expect, vi, beforeEach } from "vitest"

// O FlareSolverr é mockado por completo (sem rede, sem container). O que este arquivo
// prova é a POLÍTICA de tentativas do `fetchMangagoById` — quando a 2ª tentativa
// acontece, quando ela é pulada e com que teto de abort ela vai.
//
// Por que isso merece teste: o cenário real que motivou o retry (FlareSolverr VIVO porém
// lento, estourando o CF_ABORT_MS num solve frio de Cloudflare) é caro e instável de
// reproduzir de verdade — foi a única parte do fix que não deu pra medir no app rodando.
// Aqui a política fica presa por asserção, e não por raciocínio.
vi.mock("@/lib/external/flaresolverr", () => ({
  fetchHtmlWithCfFallback: vi.fn(),
  isFlareSolverrCircuitOpen: vi.fn(() => false),
}))

import { fetchMangagoById } from "@/lib/external/mangago"
import { fetchHtmlWithCfFallback, isFlareSolverrCircuitOpen } from "@/lib/external/flaresolverr"

const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)
const circuitOpen = vi.mocked(isFlareSolverrCircuitOpen)

// Teto da 1ª tentativa (CF_ABORT_MS) e o da tentativa extra (RETRY_ABORT_MS), como o
// módulo os define. A 2ª é DELIBERADAMENTE curta: se a sessão do FlareSolverr não ficou
// quente, insistir por mais 25s só entregaria o mesmo `null` bem mais tarde.
const ABORT_1A = 25000
const ABORT_2A = 6000

const html = (titulo: string) => ({
  html: `<html><head><meta property="og:title" content="${titulo}" /></head><body></body></html>`,
  finalUrl: "https://www.mangago.me/read-manga/x/",
})

beforeEach(() => {
  // `reset`, não `clear`: o `clear` zera as CHAMADAS mas preserva a fila de
  // `mockResolvedValueOnce`. Um valor `once` que o teste anterior não consumiu (porque o
  // código fez menos tentativas do que ele esperava) vazaria pro teste seguinte e o faria
  // falhar por tabela — mascarando qual asserção de fato quebrou.
  vi.resetAllMocks()
  circuitOpen.mockReturnValue(false)
})

describe("fetchMangagoById — política de tentativas", () => {
  it("acerta de primeira: não gasta a tentativa extra", async () => {
    fetchHtml.mockResolvedValueOnce(html("Solo Leveling"))

    const detail = await fetchMangagoById("solo_leveling", { retry: true })

    expect(detail?.title).toBe("Solo Leveling")
    expect(fetchHtml).toHaveBeenCalledTimes(1)
  })

  it("com o circuito FECHADO, uma falha transitória ganha a 2ª tentativa — e ela vem com abort curto", async () => {
    fetchHtml
      .mockResolvedValueOnce(null) // 1ª: solve estourou o abort
      .mockResolvedValueOnce(html("Solo Leveling")) // 2ª: sessão já quente

    const detail = await fetchMangagoById("solo_leveling", { retry: true })

    expect(detail?.title).toBe("Solo Leveling")
    expect(fetchHtml).toHaveBeenCalledTimes(2)
    expect(fetchHtml.mock.calls[0][2]).toBe(ABORT_1A)
    expect(fetchHtml.mock.calls[1][2]).toBe(ABORT_2A)
  })

  it("uma exceção na 1ª tentativa também é retentada (não vaza pro caller)", async () => {
    fetchHtml
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(html("Solo Leveling"))

    await expect(fetchMangagoById("solo_leveling", { retry: true })).resolves.toMatchObject({
      title: "Solo Leveling",
    })
    expect(fetchHtml).toHaveBeenCalledTimes(2)
  })

  it("se o circuito ABRE durante a 1ª tentativa (container caiu), a 2ª é PULADA", async () => {
    // O circuito só abre em ECONNREFUSED — container fora. Retentar aí é latência pura:
    // é exatamente o caso em que o card degradado precisa aparecer RÁPIDO.
    fetchHtml.mockResolvedValueOnce(null)
    circuitOpen.mockReturnValueOnce(false).mockReturnValueOnce(true)

    const detail = await fetchMangagoById("solo_leveling", { retry: true })

    expect(detail).toBeNull()
    expect(fetchHtml).toHaveBeenCalledTimes(1)
  })

  it("circuito JÁ aberto: nem a 1ª tentativa é feita", async () => {
    circuitOpen.mockReturnValue(true)

    const detail = await fetchMangagoById("solo_leveling", { retry: true })

    expect(detail).toBeNull()
    expect(fetchHtml).not.toHaveBeenCalled()
  })

  it("sem `retry` (default): uma tentativa só, mesmo com o circuito fechado", async () => {
    // O hydrate em lote roda sob um withTimeout de 30s — um retry embutido ali só
    // queimaria o orçamento dele antes de devolver o mesmo `null`. Por isso é opt-in.
    fetchHtml.mockResolvedValue(null)

    const detail = await fetchMangagoById("solo_leveling")

    expect(detail).toBeNull()
    expect(fetchHtml).toHaveBeenCalledTimes(1)
  })

  it("as duas tentativas falhando devolve null (sem lançar)", async () => {
    fetchHtml.mockResolvedValue(null)

    await expect(fetchMangagoById("solo_leveling", { retry: true })).resolves.toBeNull()
    expect(fetchHtml).toHaveBeenCalledTimes(2)
  })
})
