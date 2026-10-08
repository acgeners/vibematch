// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// O canário de saúde da Comix ("Testar agora") dizia "0 — cadeia de threads falhou (ou canário sem
// comentários)": as duas coisas chegavam iguais, porque a coleta devolvia `[]` nas duas. Desde
// 2026-10-07 a falha REJEITA e o vazio traz o motivo — e o canário tem de mostrar QUAL é cada um,
// sem quebrar quando a Comix rejeita.

// Implementação trocada por teste. NÃO é `vi.fn`: no Vitest 4 o spy acompanha a promise devolvida
// e a derivada rejeitada vira "unhandled rejection" — o teste da falha reprovaria com o canário certo.
type Coleta = (hid: string) => Promise<unknown>
const coleta = vi.hoisted(() => ({ impl: (async () => ({ reviews: [], empty: null })) as Coleta }))
vi.mock("@/lib/external/comix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/comix")>()),
  fetchComixById: async () => ({ title: "Jinx", year: 2019, coverUrl: undefined }),
  collectComixReviews: (hid: string) => coleta.impl(hid),
}))
vi.mock("@/lib/external/flaresolverr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/flaresolverr")>()),
  flareSolverrHealth: async () => ({ ok: false, error: "fora" }),
}))
vi.mock("@/server/actions/comix-hid", () => ({ ensureComixHid: vi.fn() }))
vi.mock("@/lib/external/source-health-store", () => ({ upsertSourceHealth: vi.fn(async () => {}) }))

import { checkComixHealth } from "@/server/comix/resolver"
import { ComixUnavailableError } from "@/lib/external/comix"

const linhaDeReviews = async () => (await checkComixHealth()).checks.find((c) => c.label === "Reviews (threads)")!

beforeEach(() => {
  coleta.impl = async () => ({ reviews: [], empty: null })
})

describe("canário da Comix — cada desfecho com o seu texto", () => {
  it("N comentários → ok", async () => {
    coleta.impl = async () => ({ reviews: ["a", "b", "c"], empty: null })
    expect(await linhaDeReviews()).toMatchObject({ ok: true, detail: "3 comentários do canário" })
  })

  it.each([
    ["no_comments", /a Comix respondeu/],
    ["not_found", /não existe mais na Comix \(404\)/],
    ["lookup_without_thread", /SEM thread: caso ainda não classificado/],
  ])("zero %s → diz QUAL zero é (e não afirma falha)", async (empty, texto) => {
    coleta.impl = async () => ({ reviews: [], empty })
    const linha = await linhaDeReviews()
    expect(linha.detail).toMatch(texto)
    expect(linha.detail).not.toMatch(/falhou/)
  })

  it("falha → não quebra o canário, e mostra o MOTIVO", async () => {
    coleta.impl = async () => {
      throw new ComixUnavailableError("rate_limited", "https://comix.to/api/v1/threads/lookup")
    }
    expect(await linhaDeReviews()).toMatchObject({ ok: false, detail: "falhou — rate_limited" })
  })

  it("a frase ambígua antiga não sobrevive em desfecho nenhum", async () => {
    for (const r of [
      { reviews: [], empty: "no_comments" },
      { reviews: [], empty: "not_found" },
      { reviews: [], empty: "lookup_without_thread" },
    ]) {
      coleta.impl = async () => r
      expect((await linhaDeReviews()).detail).not.toMatch(/ou canário sem comentários/)
    }
  })
})
