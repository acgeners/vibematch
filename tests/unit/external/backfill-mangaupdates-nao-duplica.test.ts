import { describe, it, expect, vi, afterEach } from "vitest"

// O backfill do MangaUpdates (`scripts/backfill-source-reviews.ts --fonte=mangaupdates`) rebusca
// também as obras que JÁ têm reviews de lá (`--escopo=vinculadas`), porque a coleta parou em 17/06 e
// o que entrou depois só chega rebuscando. Isso só é seguro se o que ele trouxer casar, texto a
// texto, com o que já está gravado — a gravação deduplica por texto EXATO, e um formato um caractere
// diferente viraria uma 2ª cópia de cada review.
//
// Os casos são REAIS: o registro da API e o texto que está na nuvem para o mesmo comentário
// (o fixture do PR #583). Só o `fetch` é mockado; conector, coleta do app e chave são os reais.
import casos from "../../fixtures/mangaupdates/comentarios-api-vs-gravado.json"
import { buscarComoOApp, chaveDaReview, coletarReviewsDaObra, soAsNovas } from "@/scripts/lib/coleta-de-reviews"
import type { SourcedReview } from "@/lib/external/types"

type Caso = { subject: string; content: string; rating: number | null; gravado: string }
const CASOS = casos as Caso[]

const respostaDaApi = (lista: Array<Pick<Caso, "subject" | "content" | "rating">>) =>
  new Response(
    JSON.stringify({
      total_hits: lista.length,
      results: lista.map((c, i) => ({
        record: { id: i + 1, subject: c.subject, content: c.content },
        metadata: { author_series_rating: c.rating },
      })),
    }),
    { status: 200 },
  )

const review = (text: string): SourcedReview => ({ source: "mangaupdates", sourceTitle: "Obra", matchScore: 1, text })

describe("backfill do MangaUpdates — rebuscar não duplica o que já está gravado", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("os comentários já gravados voltam com o MESMO texto: nenhum conta como novo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaDaApi(CASOS)))

    const trazidas = await buscarComoOApp("mangaupdates", "15180124327", "Obra")

    // Todos os casos têm corpo longo: o filtro de tamanho da coleta não pode ter comido nenhum,
    // senão o teste passaria verde por ter comparado lista vazia.
    expect(trazidas).toHaveLength(CASOS.length)
    const gravadas = new Set(CASOS.map((c) => chaveDaReview(c.gravado)))
    expect(soAsNovas(gravadas, trazidas)).toEqual([])
  })

  it("comentário que entrou depois da última coleta é o ÚNICO novo, e uma vez só", async () => {
    const novo = { subject: "Chapter 80", content: "x".repeat(150), rating: 7 }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaDaApi([...CASOS, novo, novo])))

    const trazidas = await buscarComoOApp("mangaupdates", "15180124327", "Obra")
    const novas = soAsNovas(new Set(CASOS.map((c) => chaveDaReview(c.gravado))), trazidas)

    expect(novas.map((r) => r.text)).toEqual([`Título do comentário: Chapter 80\nNota do usuário: 7.0/10\n${"x".repeat(150)}`])
    expect(novas[0].userRating).toBe(7)
  })

  it("API fora do ar é FALHA, não '0 reviews' — a coleta do app engole a rejeição", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>429</html>", { status: 429 })))

    const resultado = await coletarReviewsDaObra(() => buscarComoOApp("mangaupdates", "1", "Obra"))

    expect(resultado.status).toBe("falhou")
  })

  it("a chave é a do texto GRAVADO: espaço nas pontas e meio emoji do corte não fazem review nova", () => {
    const gravadas = new Set([chaveDaReview("texto da review")])
    // O conector corta em 900 unidades UTF-16 e pode partir um emoji; o banco guarda sem a metade.
    expect(soAsNovas(gravadas, [review("  texto da review \n"), review("texto da review\uD83D")])).toEqual([])
    expect(soAsNovas(gravadas, [review("outra review")])).toHaveLength(1)
  })
})
