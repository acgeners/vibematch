import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

// O banco simulado registra cada UPDATE com os filtros — o que se confere é QUAL linha cada
// status pode tocar, que é a regra inteira da migration 222.
type Update = { patch: Record<string, unknown>; filtros: Array<[string, unknown]> }
const updates: Update[] = []
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const u: Update = { patch, filtros: [] }
        updates.push(u)
        const chain = {
          eq: (col: string, val: unknown) => {
            u.filtros.push([col, val])
            return chain
          },
          then: (res: (v: unknown) => void) => Promise.resolve({ error: null }).then(res),
        }
        return chain
      },
    }),
  }),
}))

const fetchComixByIdOutcome = vi.fn()
vi.mock("@/lib/external/comix", () => ({
  fetchComixByIdOutcome: (hid: string) => fetchComixByIdOutcome(hid),
  fetchComixById: vi.fn(async () => null),
  searchComix: vi.fn(async () => []),
  comixWorkUrl: (hid: string) => `https://comix.to/title/${hid}`,
}))
vi.mock("@/lib/external/anilist", () => ({ fetchAniListById: vi.fn(async () => null) }))
vi.mock("@/lib/external/index", () => ({ bestTitleMatch: () => 0 }))

import { recordSourceLinkStatus } from "@/lib/external/link-status"
import { getComixLatestChapter } from "@/lib/external/chapter-sources/comix"

beforeEach(() => {
  updates.length = 0
  fetchComixByIdOutcome.mockReset()
})

/**
 * Até a migration 222 o 404 de um código da Comix só existia no log, e o painel dizia "100%" com
 * 12 códigos mortos. A marca é `not_found_external_id`: o vínculo está morto enquanto ela é IGUAL
 * ao código vinculado. Estes testes prendem as duas regras de escrita que mantêm isso verdade.
 */
describe("recordSourceLinkStatus", () => {
  it("🔴 404 marca SÓ se o vínculo ainda é aquele código (checagem lenta não marca o código novo)", async () => {
    await recordSourceLinkStatus("w1", "comix", "morto", "not_found")
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toMatchObject({ not_found_external_id: "morto" })
    expect(updates[0].patch).toHaveProperty("not_found_at")
    expect(updates[0].filtros).toEqual([
      ["work_id", "w1"],
      ["source", "comix"],
      ["external_id", "morto"],
    ])
  })

  it("página que existe limpa SÓ a marca daquele código, nunca a de outro", async () => {
    await recordSourceLinkStatus("w1", "comix", "vivo", "ok")
    expect(updates[0].patch).toEqual({ not_found_external_id: null, not_found_at: null })
    expect(updates[0].filtros).toEqual([
      ["work_id", "w1"],
      ["source", "comix"],
      ["not_found_external_id", "vivo"],
    ])
  })

  it("sem obra ou sem código, não grava nada", async () => {
    await recordSourceLinkStatus("", "comix", "x", "not_found")
    await recordSourceLinkStatus("w1", "comix", "", "ok")
    expect(updates).toHaveLength(0)
  })
})

describe("a checagem de capítulos avisa o status do código SALVO", () => {
  const input = (onSavedLinkStatus: (s: string, id: string, st: string) => void) => ({
    title: "Obra",
    comixHid: "salvo",
    onSavedLinkStatus,
  })

  it("404 → avisa not_found (e segue para a busca, que aqui não acha nada)", async () => {
    fetchComixByIdOutcome.mockResolvedValue({ detail: null, linkStatus: "not_found" })
    const avisos: string[] = []
    const r = await getComixLatestChapter(input((s, id, st) => avisos.push(`${s}:${id}:${st}`)))
    expect(avisos).toEqual(["comix:salvo:not_found"])
    expect(r).toBeNull()
  })

  it("página ok → avisa ok e devolve o capítulo", async () => {
    fetchComixByIdOutcome.mockResolvedValue({ detail: { chapters: 40, hid: "salvo" }, linkStatus: "ok" })
    const avisos: string[] = []
    const r = await getComixLatestChapter(input((s, id, st) => avisos.push(`${s}:${id}:${st}`)))
    expect(avisos).toEqual(["comix:salvo:ok"])
    expect(r?.chapter).toBe(40)
  })

  it("Comix fora do ar → não avisa nada (não prova nada sobre o código)", async () => {
    fetchComixByIdOutcome.mockResolvedValue({ detail: null, linkStatus: null })
    const avisos: string[] = []
    await getComixLatestChapter(input((s, id, st) => avisos.push(`${s}:${id}:${st}`)))
    expect(avisos).toEqual([])
  })
})
