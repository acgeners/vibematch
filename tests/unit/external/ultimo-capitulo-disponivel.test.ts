// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// O número de capítulos é o ÚLTIMO DISPONÍVEL PARA LER (decidido em 2026-11-09): Comix primeiro,
// o Mangago só sem ele. Aqui ficam as duas pontas que gravam esse número pela `/reading` — o
// agregador (`getLatestChapter`) e a checagem (`checkReadingUpdates`). A régua em si é testada em
// `total-de-capitulos.test.ts`.

const lookups = vi.hoisted(() => ({
  comix: vi.fn(),
  mangago: vi.fn(),
}))
vi.mock("@/lib/external/chapter-sources/comix", () => ({ getComixLatestChapter: lookups.comix }))
vi.mock("@/lib/external/chapter-sources/mangago", () => ({ getMangagoLatestChapter: lookups.mangago }))

import { getLatestChapter } from "@/lib/external/chapter-sources"

const entrada = { title: "Obra Teste", comixHid: "abc12", mangagoSlug: "obra_teste" }
const datasMangago = {
  releasedAt: "2026-11-01T00:00:00.000Z",
  cadenceDates: ["2026-10-18T00:00:00.000Z", "2026-10-25T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
}

function comixResponde(chapter: number) {
  lookups.comix.mockResolvedValue({
    chapter,
    source: "comix",
    sourceUrl: "https://comix.to/title/abc12",
    releasedLabel: "5d ago",
    status: "Unknown",
  })
}
function mangagoResponde(chapter: number) {
  lookups.mangago.mockResolvedValue({
    chapter,
    source: "mangago",
    sourceUrl: "https://www.mangago.me/read-manga/obra_teste/",
    ...datasMangago,
    chapterNumbers: Array.from({ length: Math.floor(chapter) }, (_, i) => i + 1),
  })
}

describe("getLatestChapter — quem vence", () => {
  beforeEach(() => {
    lookups.comix.mockReset()
    lookups.mangago.mockReset()
  })

  it("o Comix vence o Mangago à frente — um capítulo-aviso do Mangago não vira capítulo novo", async () => {
    // Obra real (medido em 2026-11-09): Comix 32, Mangago 33.
    comixResponde(32)
    mangagoResponde(33)
    const r = await getLatestChapter(entrada)

    expect(r.latest).toBe(32)
    expect(r.latestUrl).toBe("https://comix.to/title/abc12")
    // A lista e as datas do Mangago falam do capítulo 33 — não servem para o 32.
    expect(r.chapterNumbers).toBeNull()
    expect(r.releasedAt).toBeNull()
  })

  it("empate: o capítulo é o do Comix, e as datas e a lista exata são do Mangago", async () => {
    comixResponde(22)
    mangagoResponde(22)
    const r = await getLatestChapter(entrada)

    expect(r.latest).toBe(22)
    expect(r.releasedAt).toBe(datasMangago.releasedAt)
    expect(r.cadenceDates).toEqual(datasMangago.cadenceDates)
    expect(r.chapterNumbers).toHaveLength(22)
  })

  it("sem Comix: o Mangago, com as datas dele", async () => {
    lookups.comix.mockResolvedValue(null)
    mangagoResponde(16)
    const r = await getLatestChapter(entrada)

    expect(r.latest).toBe(16)
    expect(r.releasedAt).toBe(datasMangago.releasedAt)
  })

  it("Comix corrompido com o total gravado de referência: descartado, e sem número inventado", async () => {
    // Obra real: Comix 815 numa obra de 81.
    comixResponde(815)
    lookups.mangago.mockResolvedValue(null)
    const r = await getLatestChapter(entrada, { currentTotal: 81 })

    expect(r.latest).toBeNull()
    expect(r.bySource.comix).toBe(815) // o diagnóstico continua mostrando o que a fonte disse
  })
})

// ── A checagem da /reading: obra CONCLUÍDA também é checada ────────────────────────────────

const banco = vi.hoisted(() => ({
  obra: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: () => ({
        in: async () => ({ data: tabela === "works_owner" && banco.obra ? [banco.obra] : [], error: null }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          banco.updates.push(patch)
          return { error: null }
        },
      }),
    }),
  }),
}))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }) }))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: vi.fn(async () => {}) }))
vi.mock("@/server/actions/comix-hid", () => ({ persistComixHid: vi.fn(async () => {}) }))
vi.mock("@/lib/external/mangaupdates", () => ({ fetchMangaUpdatesStatus: vi.fn(async () => "Completed") }))
vi.mock("@/lib/external/mangadex", () => ({ fetchMangaDexChapterDates: vi.fn(async () => []) }))

import { checkReadingUpdates } from "@/server/actions/reading"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"

describe("checkReadingUpdates — obra concluída no original com a tradução atrasada", () => {
  beforeEach(() => {
    lookups.comix.mockReset()
    lookups.mangago.mockReset()
    banco.updates = []
    // Obra real (medido em 2026-11-09): concluída, 29 no banco, 22 no Comix e no Mangago.
    banco.obra = {
      id: "w1",
      title: "Obra Teste",
      original_title: null,
      alternative_titles: [],
      total_chapters: 29,
      chapters_read: 22,
      publication_status_id: getPublicationStatusIdByName("Completed"),
      work_external_ids: [
        { source: "comix", external_id: "abc12", is_rejected: false },
        { source: "mangago", external_id: "obra_teste", is_rejected: false },
      ],
    }
  })

  it("é checada (não pulada) e o total cai para o disponível", async () => {
    comixResponde(22)
    mangagoResponde(22)
    const [r] = await checkReadingUpdates(["w1"])

    expect(lookups.comix).toHaveBeenCalledTimes(1)
    expect(r.failed).toBe(false)
    expect(r.latestExternal).toBe(22)
    expect(r.hasNew).toBe(false)
    expect(banco.updates).toContainEqual({ total_chapters: 22 })
  })

  it("e o capítulo traduzido seguinte aparece como novo", async () => {
    banco.obra = { ...banco.obra, total_chapters: 22 }
    comixResponde(23)
    mangagoResponde(22)
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.hasNew).toBe(true)
    expect(r.latestExternal).toBe(23)
    expect(banco.updates).toContainEqual({ total_chapters: 23 })
  })
})
