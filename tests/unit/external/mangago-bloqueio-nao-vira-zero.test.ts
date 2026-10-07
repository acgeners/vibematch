import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Bloqueio do Mangago tem que chegar como FALHA, nunca como "0 resultados" / "0 reviews".
//
// Por que isto merece teste: em 06–07/10/2026 o FlareSolverr da produção saía por um ASN que o
// Mangago bane no Cloudflare. O browser recebia HTTP 200 com uma página de 107 B ("we're sorry,
// the request file are not found"), o parser a lia como lista vazia, e a busca e a coleta de
// reviews anunciavam "não tem" — a mesma resposta de uma obra que de fato não tem nada lá. Quem
// orquestra (busca multi-fonte, coleta, resolvedor de slug) só distingue falha de vazio por
// REJEIÇÃO da promise; um `[]` calado desligava essa distinção inteira.
//
// As páginas são REAIS (tests/fixtures/mangago), capturadas em 07/10/2026 via FlareSolverr num
// IP residencial; a de bloqueio foi registrada com os espaços colapsados. O bypass é mockado; a
// detecção de desafio do Cloudflare é a real.
vi.mock("@/lib/external/flaresolverr", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/external/flaresolverr")>()
  return {
    fetchHtmlWithCfFallback: vi.fn(),
    isCfBypassUnavailable: vi.fn(() => false),
    isCloudflareChallenge: real.isCloudflareChallenge,
  }
})

import {
  classifyMangagoPage,
  fetchMangagoById,
  fetchMangagoChapters,
  fetchMangagoReviews,
  parseMangagoDetailHtml,
  searchMangago,
} from "@/lib/external/mangago"
import { fetchHtmlWithCfFallback, isCfBypassUnavailable } from "@/lib/external/flaresolverr"
import { getMangagoLatestChapter } from "@/lib/external/chapter-sources/mangago"
import type { ChapterCheckInput } from "@/lib/external/chapter-sources/types"
import { collectReviewsFromCandidate } from "@/lib/external/index"
import { mergeFreshWithPersistedReviews } from "@/lib/external/review-merge"
import type { MergedCandidate, SourcedReview } from "@/lib/external/types"

const fixture = (path: string) => readFileSync(join(process.cwd(), "tests/fixtures", path), "utf8")
const BLOQUEIO = fixture("mangago/bloqueio-asn.html") // 107 B, HTTP 200 pelo browser
const CF_1005 = fixture("mangago/cloudflare-1005.txt") // corpo do 403 no HTTP direto
const DESAFIO = fixture("cloudflare/mangago-challenge.html")
const NAO_ACHADO = fixture("mangago/404-real.html") // 404 VERDADEIRO do site, 5,5 KB
const BUSCA_ZERO = fixture("mangago/busca-zero.html")
const BUSCA_OK = fixture("mangago/busca-com-resultado.html")
const DISCUSSAO = fixture("mangago/discussao-com-topicos.html")
const TOPICO = fixture("mangago/topico.html")

const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)
const bypassUnavailable = vi.mocked(isCfBypassUnavailable)
const pagina = (html: string) => ({ html, finalUrl: "https://www.mangago.me/" })

/** Responde por URL: discussão (qualquer página) → `lista`; tópico → `topico(n)`. */
function porUrl(lista: string, topico: (n: number) => string | null) {
  let n = 0
  fetchHtml.mockImplementation(async (url: string) => {
    if (url.includes("/home/manga/discussion/")) return pagina(lista)
    if (url.includes("/home/mangatopic/")) {
      const html = topico(n++)
      return html === null ? null : pagina(html)
    }
    throw new Error(`URL inesperada no teste: ${url}`)
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  bypassUnavailable.mockReturnValue(false)
})

describe("classifyMangagoPage — o que a página recebida É", () => {
  it.each([
    ["página de bloqueio do Mangago (107 B, HTTP 200)", BLOQUEIO, "blocked"],
    ["Cloudflare 1005 (ASN banido)", CF_1005, "blocked"],
    ["desafio do Cloudflare que o bypass não resolveu", DESAFIO, "blocked"],
    ["404 verdadeiro do site", NAO_ACHADO, "not_found"],
    ["busca válida SEM resultado", BUSCA_ZERO, "ok"],
    ["busca válida com resultados", BUSCA_OK, "ok"],
    ["discussão com tópicos", DISCUSSAO, "ok"],
    ["página de tópico", TOPICO, "ok"],
  ] as const)("%s → %s", (_nome, html, esperado) => {
    expect(classifyMangagoPage(html)).toBe(esperado)
  })

  it("a frase do bloqueio CITADA num tópico (página grande) não é bloqueio", () => {
    // Leitores reclamam dessa mensagem nos tópicos; só a página minúscula é a recusa.
    const citada = TOPICO.replace("</body>", "<p>I keep getting we're sorry, the request file are not found</p></body>")
    expect(classifyMangagoPage(citada)).toBe("ok")
  })
})

describe("searchMangago — falha da fonte rejeita; zero legítimo resolve []", () => {
  it.each([
    ["página de bloqueio (HTTP 200)", BLOQUEIO],
    ["Cloudflare 1005", CF_1005],
    ["desafio não resolvido", DESAFIO],
  ])("%s → rejeita com reason=blocked", async (_nome, html) => {
    fetchHtml.mockResolvedValue(pagina(html))
    await expect(searchMangago("solo leveling")).rejects.toMatchObject({
      name: "MangagoUnavailableError",
      reason: "blocked",
    })
  })

  it("bypass fora → rejeita sem nem tentar o fetch", async () => {
    bypassUnavailable.mockReturnValue(true)
    await expect(searchMangago("solo leveling")).rejects.toMatchObject({ reason: "bypass_unavailable" })
    expect(fetchHtml).not.toHaveBeenCalled()
  })

  it("fetch sem resposta (bypass devolveu null) → rejeita com fetch_failed", async () => {
    fetchHtml.mockResolvedValue(null)
    await expect(searchMangago("solo leveling")).rejects.toMatchObject({ reason: "fetch_failed" })
  })

  it("busca válida sem resultado → [] (o Mangago respondeu e não há)", async () => {
    fetchHtml.mockResolvedValue(pagina(BUSCA_ZERO))
    await expect(searchMangago("zzqxjwvkpfnaoexiste")).resolves.toEqual([])
  })

  it("busca válida com resultados → lista não vazia", async () => {
    fetchHtml.mockResolvedValue(pagina(BUSCA_OK))
    const resultados = await searchMangago("solo leveling")
    expect(resultados.length).toBeGreaterThan(0)
    expect(resultados.every((r) => r.source === "mangago")).toBe(true)
  })
})

describe("fetchMangagoReviews — bloqueio rejeita; discussão vazia é vazia", () => {
  it("1ª página da discussão bloqueada → rejeita (nunca '0 reviews')", async () => {
    porUrl(BLOQUEIO, () => TOPICO)
    await expect(fetchMangagoReviews("solo_leveling")).rejects.toMatchObject({ reason: "blocked" })
  })

  it("discussão inexistente (404 verdadeiro) → [] legítimo", async () => {
    porUrl(NAO_ACHADO, () => TOPICO)
    await expect(fetchMangagoReviews("slug_que_nao_existe")).resolves.toEqual([])
  })

  it("discussão com tópicos e corpos OK → reviews", async () => {
    porUrl(DISCUSSAO, () => TOPICO)
    const reviews = await fetchMangagoReviews("solo_leveling", 3)
    expect(reviews).toHaveLength(3)
  })

  it("tópicos listados mas TODOS os corpos bloqueados → rejeita", async () => {
    porUrl(DISCUSSAO, () => BLOQUEIO)
    await expect(fetchMangagoReviews("solo_leveling", 3)).rejects.toMatchObject({ reason: "blocked" })
  })

  it("bloqueio no meio dos corpos → devolve o parcial já obtido (não é falha da fonte)", async () => {
    porUrl(DISCUSSAO, (n) => (n < 2 ? TOPICO : BLOQUEIO))
    const reviews = await fetchMangagoReviews("solo_leveling", 5)
    expect(reviews).toHaveLength(2)
  })
})

describe("fetchMangagoById — nem o 404 nem o bloqueio viram obra", () => {
  it("contraprova: o parser sozinho lê o 404 verdadeiro como uma obra", () => {
    // É isto que o classificador impede: slug morto chegando como "achado".
    expect(parseMangagoDetailHtml(NAO_ACHADO)?.title).toBe("I don't know's home")
  })

  it("404 verdadeiro → null, sem gastar a tentativa extra", async () => {
    fetchHtml.mockResolvedValue(pagina(NAO_ACHADO))
    await expect(fetchMangagoById("slug_que_nao_existe", { retry: true })).resolves.toBeNull()
    expect(fetchHtml).toHaveBeenCalledTimes(1)
  })

  it("bloqueio → null (contrato do detalhe), contando como tentativa perdida", async () => {
    fetchHtml.mockResolvedValue(pagina(BLOQUEIO))
    await expect(fetchMangagoById("solo_leveling", { retry: true })).resolves.toBeNull()
    expect(fetchHtml).toHaveBeenCalledTimes(2)
  })
})

describe("capítulos — bloqueio HTTP 200 nunca vira 'zero capítulos'", () => {
  // `fetchMangagoChapters` não passa pelo classificador: o parser exige `id="chapter_table"` e
  // devolve `null` sem ela — o contrato NÃO tem valor para "zero capítulos". E o agregador
  // (`getLatestChapter`) só lê `chapter` de quem devolveu valor; `null` fica fora da conta, nunca
  // vira 0. Estes casos travam isso: se alguém der ao parser um retorno "vazio" em vez de `null`,
  // uma recusa do Mangago passa a afirmar que a obra tem 0 capítulos.
  const entrada = { mangagoSlug: "solo_leveling" } as ChapterCheckInput

  it.each([
    ["página de bloqueio (HTTP 200)", BLOQUEIO],
    ["404 verdadeiro", NAO_ACHADO],
  ])("%s → null em toda a cadeia, nunca um capítulo 0", async (_nome, html) => {
    fetchHtml.mockResolvedValue(pagina(html))
    await expect(fetchMangagoChapters("solo_leveling")).resolves.toBeNull()
    await expect(getMangagoLatestChapter(entrada)).resolves.toBeNull()
  })

  it("contraprova: página com a tabela de capítulos → o capítulo chega", async () => {
    // HTML mínimo no formato que o parser lê (sem fixture real de detalhe: ela tem 242 KB).
    const comTabela = `<table id="chapter_table"><tr><td><b>Ch.12 : Fim</b></td><td>Oct 05, 2026</td></tr><tr><td><b>Ch.11</b></td><td>Sep 28, 2026</td></tr></table>`
    fetchHtml.mockResolvedValue(pagina(comTabela))
    await expect(getMangagoLatestChapter(entrada)).resolves.toMatchObject({
      chapter: 12,
      source: "mangago",
      chapterNumbers: [12, 11],
    })
  })
})

describe("reviews já salvas sobrevivem a uma coleta fresca que falha", () => {
  const candidato = { title: "Solo Leveling", mangagoSlug: "solo_leveling", sources: ["mangago"] } as unknown as MergedCandidate

  it("na coleta, o Mangago bloqueado entra em failedSources e NÃO chega ao callback de gravação", async () => {
    porUrl(BLOQUEIO, () => TOPICO)
    const gravadas: SourcedReview[][] = []

    const { reviews, failedSources } = await collectReviewsFromCandidate(candidato, (r) => {
      gravadas.push(r)
    })

    expect(failedSources).toEqual(["mangago"])
    expect(reviews).toEqual([])
    // Nada chega a `saveWorkReviews`: e ele só apaga fontes PRESENTES no lote, então as
    // reviews do Mangago já gravadas ficam intactas.
    expect(gravadas).toEqual([])
  })

  it("no pool da avaliação, as reviews salvas do Mangago entram mesmo com a fresca falhando", () => {
    const salvas: SourcedReview[] = [
      { source: "mangago", sourceTitle: "Solo Leveling", matchScore: 1, text: "great art, slow middle", textLength: 22 },
    ]
    const { merged, recovered } = mergeFreshWithPersistedReviews([], salvas)
    expect(recovered).toBe(1)
    expect(merged.map((r) => r.source)).toEqual(["mangago"])
  })
})
