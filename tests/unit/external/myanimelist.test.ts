import { describe, it, expect, vi, beforeEach } from "vitest"

// Rede mockada: o que se prende aqui é o MAPEAMENTO da API v2 e a POLÍTICA de falha.
// A telemetria de saúde escreve no Supabase — mockada pra não tocar o banco.
vi.mock("@/lib/external/source-health-store", () => ({
  upsertSourceHealth: vi.fn().mockResolvedValue(undefined),
}))

// O circuito é ESTADO DE MÓDULO (`circuitOpenUntil`, `consecutiveFails`). Um import
// estático no topo faria os testes compartilharem esse estado: o circuito aberto por um
// teste continuaria aberto no seguinte, e o resultado passaria a depender da ORDEM.
// Por isso cada teste reimporta o módulo do zero.
async function freshModule() {
  vi.resetModules()
  return import("@/lib/external/myanimelist")
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response

const CLIENT_ID = "0".repeat(32)

// Nó de manga da v2 (só os campos que consumimos).
const soloLeveling = {
  id: 121496,
  title: "Solo Leveling",
  alternative_titles: { synonyms: ["Na Honjaman Level Up"], en: "Solo Leveling", ja: "나 혼자만 레벨업" },
  synopsis: 'Ten   years  ago,\n"the Gate" appeared.',
  main_picture: { medium: "https://cdn/m.jpg", large: "https://cdn/l.jpg" },
  mean: 8.56,
  num_scoring_users: 371737,
  num_chapters: 201,
  status: "finished",
  start_date: "2018-03-04",
  end_date: "2023-12-29",
  genres: [{ id: 1, name: "Action" }, { id: 2, name: "Fantasy" }],
}

beforeEach(() => {
  vi.unstubAllGlobals()
  process.env.MAL_CLIENT_ID = CLIENT_ID
})

describe("MyAnimeList — API oficial v2", () => {
  it("mapeia o detalhe: mean→nota, num_scoring_users→votos, status snake_case→PublicationStatus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(soloLeveling)))
    const { fetchMalMangaById } = await freshModule()

    const d = await fetchMalMangaById(121496)

    expect(d).toMatchObject({
      id: 121496,
      title: "Solo Leveling",
      rating: 8.56,
      votes: 371737,
      chapters: 201,
      // A v2 usa "finished"/"currently_publishing"/"on_hiatus" — strings DIFERENTES das
      // do Jikan ("publishing", "on hiatus"). Trocar a fonte sem trocar o mapa faria toda
      // obra virar "Unknown" silenciosamente.
      publicationStatus: "Completed",
      year: 2018,
      yearEnd: 2023,
      genres: ["Action", "Fantasy"],
      coverUrl: "https://cdn/l.jpg",
    })
    // Sinopse normalizada (a v2 devolve quebras de linha e espaços duplos).
    expect(d?.synopsis).toBe('Ten years ago, "the Gate" appeared.')
    // O título primário não se repete entre os alternativos.
    expect(d?.alternativeTitles).toEqual(["Na Honjaman Level Up", "나 혼자만 레벨업"])
  })

  // O mapa de status é o ponto mais fácil de errar na troca de fonte, e o mais caro: a v2
  // usa snake_case ("currently_publishing") onde o Jikan usava outra grafia ("publishing").
  // Manter o mapa antigo não quebra nada visível — só faz TODA obra cair no `default` e
  // virar "Unknown". E o catálogo é majoritariamente manhwa EM ANDAMENTO, então o caso que
  // mais dói é justamente o que um fixture de obra concluída não cobre.
  it.each([
    ["finished", "Completed"],
    ["currently_publishing", "Ongoing"],
    ["on_hiatus", "Hiatus"],
    ["discontinued", "Cancelled"],
    ["not_yet_published", "Unknown"],
  ])("status da v2 %s → %s", async (malStatus, esperado) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...soloLeveling, status: malStatus })))
    const { fetchMalMangaById } = await freshModule()

    const d = await fetchMalMangaById(121496)

    expect(d?.publicationStatus).toBe(esperado)
  })

  it("manda o Client ID no header e pede os campos explicitamente (a v2 devolve quase nada por padrão)", async () => {
    const f = vi.fn().mockResolvedValue(ok(soloLeveling))
    vi.stubGlobal("fetch", f)
    const { fetchMalMangaById } = await freshModule()

    await fetchMalMangaById(121496)

    const [url, init] = f.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ "X-MAL-CLIENT-ID": CLIENT_ID })
    expect(String(url)).toContain("fields=")
    expect(String(url)).toContain("num_scoring_users")
  })

  it("recomendações: num_recommendations é IRMÃO de node, não filho — é o peso do consenso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ok({
          recommendations: [
            { node: { id: 132214, title: "Omniscient Reader's Viewpoint" }, num_recommendations: 17 },
            { node: { id: 1, title: "Tower of God" }, num_recommendations: 4 },
          ],
        })
      )
    )
    const { fetchMalRecommendations } = await freshModule()

    const recs = await fetchMalRecommendations(121496)

    // Ler o peso de dentro do `node` devolveria undefined, e o merge de similares
    // ranquearia tudo com peso vazio — degradação silenciosa.
    expect(recs).toEqual([
      { id: 132214, title: "Omniscient Reader's Viewpoint", votes: 17 },
      { id: 1, title: "Tower of God", votes: 4 },
    ])
  })

  it("busca desembrulha o envelope { data: [{ node }] } da v2", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ data: [{ node: soloLeveling }] })))
    const { searchMalManga } = await freshModule()

    const rows = await searchMalManga("solo leveling")

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 121496, title: "Solo Leveling", score: 8.56, scoredBy: 371737 })
  })

  it("sem Client ID: não chama a rede e não quebra o caller", async () => {
    delete process.env.MAL_CLIENT_ID
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    const { searchMalManga, isMalConfigured } = await freshModule()

    expect(isMalConfigured()).toBe(false)
    await expect(searchMalManga("solo leveling")).resolves.toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it("3 falhas TRANSIENTES seguidas abrem o circuito — a fonte fora para de comer o orçamento da busca", async () => {
    const f = vi.fn().mockResolvedValue(fail(503))
    vi.stubGlobal("fetch", f)
    const { searchMalManga, isMalCircuitOpen } = await freshModule()

    for (let i = 0; i < 3; i++) await searchMalManga("solo leveling")
    expect(isMalCircuitOpen()).toBe(true)

    // Com o circuito aberto a chamada nem sai: devolve vazio na hora.
    const antes = f.mock.calls.length
    await expect(searchMalManga("solo leveling")).resolves.toEqual([])
    expect(f.mock.calls.length).toBe(antes)
  })

  it("Client ID inválido (400) NÃO abre o circuito: é erro de config, não indisponibilidade", async () => {
    // Abrir o circuito aqui esconderia o problema por 5min e faria um erro de configuração
    // se disfarçar de "fonte fora do ar" — justamente a confusão que esta migração desfaz.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(400)))
    const { searchMalManga, isMalCircuitOpen } = await freshModule()

    for (let i = 0; i < 4; i++) await searchMalManga("solo leveling")

    expect(isMalCircuitOpen()).toBe(false)
  })
})
