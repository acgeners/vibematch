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
const mu = vi.hoisted(() => ({ status: "Completed" as string | null, originalChapters: null as number | null }))
vi.mock("@/lib/external/mangaupdates", () => ({
  fetchMangaUpdatesStatus: vi.fn(async () => (mu.status == null ? null : { status: mu.status, originalChapters: mu.originalChapters })),
}))
vi.mock("@/lib/external/mangadex", () => ({ fetchMangaDexChapterDates: vi.fn(async () => []) }))

import { checkReadingUpdates } from "@/server/actions/reading"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"
import { describeCheckFailure } from "@/lib/reading/check-failures"

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

// ── O status pela regra única (`decidePublicationStatus`) ──────────────────────────────────

describe("checkReadingUpdates — status de publicação", () => {
  const comMangaUpdates = (publication: string) => ({
    ...banco.obra,
    total_chapters: 23,
    publication_status_id: getPublicationStatusIdByName(publication),
    work_external_ids: [
      { source: "comix", external_id: "abc12", is_rejected: false },
      { source: "mangago", external_id: "obra_teste", is_rejected: false },
      { source: "mangaupdates", external_id: "123", is_rejected: false },
    ],
  })

  beforeEach(() => {
    lookups.comix.mockReset()
    lookups.mangago.mockReset()
    banco.updates = []
    mu.originalChapters = null
    comixResponde(23)
    mangagoResponde(23)
  })

  it("fim do hiato: o MangaUpdates diz que voltou e a obra passa a Ongoing", async () => {
    banco.obra = comMangaUpdates("Hiatus")
    mu.status = "Ongoing"
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.statusApplied).toBe("Ongoing")
    expect(banco.updates).toContainEqual({ publication_status_id: getPublicationStatusIdByName("Ongoing") })
  })

  it("em andamento que terminou no original passa a Completed", async () => {
    banco.obra = comMangaUpdates("Ongoing")
    mu.status = "Completed"
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.statusApplied).toBe("Completed")
    expect(banco.updates).toContainEqual({ publication_status_id: getPublicationStatusIdByName("Completed") })
  })

  it("o MangaUpdates tira uma obra de Completed quando o original está em andamento", async () => {
    banco.obra = comMangaUpdates("Completed")
    mu.status = "Ongoing"
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.statusApplied).toBe("Ongoing")
  })

  it("concluída no original com capítulo por traduzir fica em andamento (status da TRADUÇÃO)", async () => {
    // 23 disponíveis (Comix e Mangago) de 30 do original.
    banco.obra = comMangaUpdates("Ongoing")
    mu.status = "Completed"
    mu.originalChapters = 30
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.statusApplied).toBeNull()
    expect(banco.updates.some((u) => "publication_status_id" in u)).toBe(false)
  })

  it("e uma já gravada como Completed volta para Ongoing", async () => {
    banco.obra = comMangaUpdates("Completed")
    mu.status = "Completed"
    mu.originalChapters = 30
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.statusApplied).toBe("Ongoing")
  })

  it("tradução alcançou o original: concluída", async () => {
    banco.obra = comMangaUpdates("Ongoing")
    mu.status = "Completed"
    mu.originalChapters = 23
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.statusApplied).toBe("Completed")
  })
})

// ── Obra "não verificada" deixa o MOTIVO no log ─────────────────────────────────────────────
//
// 🔴 Em 14/11/2026 uma rodada da /reading deu 53 de 55 obras "não verificadas" e não deixou nenhuma
// linha de log: o `allSettled` de `getLatestChapter` descartava a rejeição de cada fonte e o `catch`
// da checagem era vazio. Estes casos travam o motivo nas duas pontas.

describe("getLatestChapter — por que cada fonte não deu capítulo", () => {
  beforeEach(() => {
    lookups.comix.mockReset()
    lookups.mangago.mockReset()
  })

  it("falha da fonte vira a mensagem dela; fonte vinculada sem capítulo vira 'respondeu sem capítulo'", async () => {
    lookups.comix.mockRejectedValue(new Error("comix indisponível (rate_limited)"))
    lookups.mangago.mockResolvedValue(null)
    const r = await getLatestChapter(entrada)

    expect(r.latest).toBeNull()
    expect(r.failures).toEqual({ comix: "comix indisponível (rate_limited)", mangago: "respondeu sem capítulo" })
  })

  it("tempo esgotado também é motivo, com o nome da fonte", async () => {
    vi.useFakeTimers()
    try {
      lookups.comix.mockReturnValue(new Promise(() => {}))
      mangagoResponde(16)
      const pendente = getLatestChapter(entrada)
      await vi.advanceTimersByTimeAsync(25_000)
      const r = await pendente

      expect(r.latest).toBe(16)
      expect(r.failures.comix).toMatch(/chapter:comix.*25000/)
      expect(r.failures.mangago).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("sem vínculo não é falha da fonte, e o texto diz isso", async () => {
    lookups.comix.mockResolvedValue(null)
    lookups.mangago.mockResolvedValue(null)
    const r = await getLatestChapter({ title: "Obra Teste" })

    expect(r.failures).toEqual({ comix: "sem código, e a busca não achou", mangago: "sem vínculo" })
  })

  it("número descartado pela régua também deixa motivo", async () => {
    comixResponde(815)
    lookups.mangago.mockResolvedValue(null)
    const r = await getLatestChapter(entrada, { currentTotal: 81 })

    expect(r.latest).toBeNull()
    expect(r.failures.comix).toBe("número descartado pela régua (815)")
  })

  it("com capítulo, nenhuma falha é inventada", async () => {
    comixResponde(22)
    mangagoResponde(22)
    await expect(getLatestChapter(entrada)).resolves.toMatchObject({ latest: 22, failures: {} })
  })
})

describe("checkReadingUpdates — a obra não verificada deixa uma linha no log", () => {
  const avisos = () =>
    (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[reading-check]"))

  beforeEach(() => {
    lookups.comix.mockReset()
    lookups.mangago.mockReset()
    banco.updates = []
    mu.status = null
    banco.obra = {
      id: "w1",
      title: "Obra Teste",
      original_title: null,
      alternative_titles: [],
      total_chapters: 10,
      chapters_read: 5,
      publication_status_id: getPublicationStatusIdByName("Ongoing"),
      work_external_ids: [
        { source: "comix", external_id: "abc12", is_rejected: false },
        { source: "mangago", external_id: "obra_teste", is_rejected: false },
      ],
    }
    vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear()
  })

  it("nenhuma fonte deu capítulo: registra obra, id e o motivo de cada fonte", async () => {
    lookups.comix.mockRejectedValue(new Error("comix indisponível (rate_limited)"))
    lookups.mangago.mockRejectedValue(new Error("mangago fetch_failed: https://www.mangago.me/read-manga/obra_teste/"))
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.failed).toBe(true)
    expect(avisos()).toEqual([
      '[reading-check] não verificada · "Obra Teste" (w1) · comix: comix indisponível (rate_limited) · ' +
        "mangago: mangago fetch_failed: https://www.mangago.me/read-manga/obra_teste/",
    ])
    // O MESMO motivo volta no resultado — é ele que a tela mostra.
    expect(r.failure).toEqual({
      kind: "sources",
      sources: {
        comix: "comix indisponível (rate_limited)",
        mangago: "mangago fetch_failed: https://www.mangago.me/read-manga/obra_teste/",
      },
    })
    expect(avisos()[0]).toBe(`[reading-check] não verificada · "Obra Teste" (w1) · ${describeCheckFailure(r.failure!)}`)
  })

  it("exceção no meio da checagem não some mais: vira linha de log com a mensagem", async () => {
    const { persistComixHid } = await import("@/server/actions/comix-hid")
    vi.mocked(persistComixHid).mockRejectedValueOnce(new Error("falha ao gravar o código"))
    banco.obra = { ...banco.obra, work_external_ids: [] }
    lookups.comix.mockResolvedValue({ chapter: 12, source: "comix", sourceUrl: "https://comix.to/title/novo1", resolvedHid: "novo1" })
    lookups.mangago.mockResolvedValue(null)
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.failed).toBe(true)
    expect(avisos()).toEqual(['[reading-check] não verificada · "Obra Teste" (w1) · erro: falha ao gravar o código'])
    expect(r.failure).toEqual({ kind: "whole", reason: "erro: falha ao gravar o código" })
  })

  it("Comix marcada como ausente (e sem código): a obra é pulada, e o log diz por quê", async () => {
    banco.obra = { ...banco.obra, work_external_ids: [{ source: "comix", external_id: null, is_rejected: true }] }
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.failed).toBe(true)
    expect(lookups.comix).not.toHaveBeenCalled()
    expect(avisos()[0]).toMatch(/Comix marcada como ausente/)
    expect(r.failure).toMatchObject({ kind: "whole", reason: expect.stringMatching(/Comix marcada como ausente/) })
  })

  it("código da Comix morto (404): a linha diz isso, e não 'respondeu sem capítulo'", async () => {
    lookups.comix.mockImplementation(async (input: { onSavedLinkStatus?: (s: string, id: string, st: string) => void }) => {
      input.onSavedLinkStatus?.("comix", "abc12", "not_found")
      return null
    })
    lookups.mangago.mockResolvedValue(null)
    await checkReadingUpdates(["w1"])

    expect(avisos()).toEqual([
      '[reading-check] não verificada · "Obra Teste" (w1) · comix: código abc12 não existe (404) · mangago: respondeu sem capítulo',
    ])
  })

  it("obra verificada não gera linha nenhuma", async () => {
    comixResponde(11)
    mangagoResponde(11)
    const [r] = await checkReadingUpdates(["w1"])

    expect(r.failed).toBe(false)
    expect(avisos()).toEqual([])
    expect(r.failure ?? null).toBeNull()
  })
})
