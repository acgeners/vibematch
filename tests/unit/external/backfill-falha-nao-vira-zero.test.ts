import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// O backfill de reviews (`scripts/backfill-source-reviews.ts`) tem de separar TRÊS desfechos por
// obra: trouxe reviews, a fonte respondeu "não há", e a fonte NÃO respondeu. Até 2026-10-07 ele
// fazia `fetch(...).catch(() => [])` e o terceiro virava o segundo — o bloqueio do Mangago (que o
// adaptador LANÇA desde 656a972) saía como "0" e entrava na conta "obras sem review".
//
// Aqui o adaptador do Mangago é o REAL e as páginas são as fixtures reais de
// `mangago-bloqueio-nao-vira-zero.test.ts`; só o transporte (bypass) é mockado. O script em si
// não é importado — ele roda `main()` e `process.exit` ao carregar —, então a decisão por obra
// mora em `scripts/lib/coleta-de-reviews.ts`, e uma guarda de arquitetura amarra o script a ela.
vi.mock("@/lib/external/flaresolverr", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/external/flaresolverr")>()
  return {
    fetchHtmlWithCfFallback: vi.fn(),
    isCfBypassUnavailable: vi.fn(() => false),
    isCloudflareChallenge: real.isCloudflareChallenge,
  }
})

import { fetchMangagoReviews } from "@/lib/external/mangago"
import { fetchHtmlWithCfFallback, isCfBypassUnavailable } from "@/lib/external/flaresolverr"
import { coletarReviewsDaObra } from "@/scripts/lib/coleta-de-reviews"

const fixture = (path: string) => readFileSync(join(process.cwd(), "tests/fixtures", path), "utf8")
const BLOQUEIO = fixture("mangago/bloqueio-asn.html")
const CF_1005 = fixture("mangago/cloudflare-1005.txt")
const NAO_ACHADO = fixture("mangago/404-real.html")
const DISCUSSAO = fixture("mangago/discussao-com-topicos.html")
const TOPICO = fixture("mangago/topico.html")

const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)
const bypassUnavailable = vi.mocked(isCfBypassUnavailable)
const pagina = (html: string) => ({ html, finalUrl: "https://www.mangago.me/" })

/** Discussão (qualquer página) → `lista`; tópico → `topico(n)` (null = fetch sem resposta). */
function porUrl(lista: string | null, topico: (n: number) => string | null = () => TOPICO) {
  let n = 0
  fetchHtml.mockImplementation(async (url: string) => {
    if (url.includes("/home/manga/discussion/")) return lista === null ? null : pagina(lista)
    if (url.includes("/home/mangatopic/")) {
      const html = topico(n++)
      return html === null ? null : pagina(html)
    }
    throw new Error(`URL inesperada no teste: ${url}`)
  })
}

/** As reviews JÁ salvas de uma obra, e um `salvar` que acumula como o `saveWorkReviews` (união). */
function armazem() {
  const salvas = ["review antiga 1 — persistida numa coleta anterior", "review antiga 2 — persistida"]
  const salvar = vi.fn(async (textos: string[]) => {
    for (const t of textos) if (!salvas.includes(t)) salvas.push(t)
  })
  return { salvas, salvar }
}

const buscarMangago = () => fetchMangagoReviews("slug-de-teste", 5)

beforeEach(() => {
  vi.resetAllMocks()
  bypassUnavailable.mockReturnValue(false)
})

describe("coletarReviewsDaObra — os três desfechos, pelo adaptador REAL do Mangago", () => {
  it("1 · a fonte responde COM reviews → com_reviews, e só aí grava", async () => {
    porUrl(DISCUSSAO)
    const { salvar } = armazem()
    const r = await coletarReviewsDaObra(buscarMangago, salvar)
    expect(r.status).toBe("com_reviews")
    if (r.status !== "com_reviews") return
    expect(r.textos.length).toBeGreaterThan(0)
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledWith(r.textos)
  })

  it("2 · a fonte responde que NÃO HÁ (404 verdadeiro da discussão) → zero legítimo, sem gravar", async () => {
    porUrl(NAO_ACHADO)
    const { salvar } = armazem()
    expect(await coletarReviewsDaObra(buscarMangago, salvar)).toEqual({ status: "zero" })
    expect(salvar).not.toHaveBeenCalled()
  })

  it.each([
    ["página de bloqueio do Mangago (107 B, HTTP 200)", BLOQUEIO],
    ["Cloudflare 1005 (ASN banido)", CF_1005],
  ])("3 · %s → falhou:blocked — NUNCA zero", async (_nome, html) => {
    porUrl(html)
    const { salvar } = armazem()
    expect(await coletarReviewsDaObra(buscarMangago, salvar)).toEqual({ status: "falhou", motivo: "blocked" })
    expect(salvar).not.toHaveBeenCalled()
  })

  it("3 · bypass fora → falhou:bypass_unavailable, sem nem tentar o fetch", async () => {
    bypassUnavailable.mockReturnValue(true)
    expect(await coletarReviewsDaObra(buscarMangago)).toEqual({ status: "falhou", motivo: "bypass_unavailable" })
    expect(fetchHtml).not.toHaveBeenCalled()
  })

  it("4 · rede/timeout (o bypass não devolveu resposta) → falhou:fetch_failed", async () => {
    porUrl(null)
    expect(await coletarReviewsDaObra(buscarMangago)).toEqual({ status: "falhou", motivo: "fetch_failed" })
  })

  it("4 · erro que não é do contrato do Mangago (ex.: timeout lançado) também é falha, com a mensagem", async () => {
    const r = await coletarReviewsDaObra(() => Promise.reject(new Error("ETIMEDOUT")))
    expect(r).toEqual({ status: "falhou", motivo: "ETIMEDOUT" })
  })

  it("contraprova: tópicos listados mas TODOS os corpos bloqueados → falha (não '0 reviews')", async () => {
    porUrl(DISCUSSAO, () => BLOQUEIO)
    expect(await coletarReviewsDaObra(buscarMangago)).toEqual({ status: "falhou", motivo: "blocked" })
  })
})

describe("falha não escreve — as reviews já salvas sobrevivem", () => {
  it("5 · numa falha, o que estava salvo fica intacto (nem apagado, nem substituído)", async () => {
    porUrl(BLOQUEIO)
    const { salvas, salvar } = armazem()
    const antes = [...salvas]
    const r = await coletarReviewsDaObra(buscarMangago, salvar)
    expect(r.status).toBe("falhou")
    expect(salvar).not.toHaveBeenCalled()
    expect(salvas).toEqual(antes)
  })

  it("5 · contraprova: com reviews, o armazém CRESCE e as antigas continuam lá", async () => {
    porUrl(DISCUSSAO)
    const { salvas, salvar } = armazem()
    const antes = [...salvas]
    await coletarReviewsDaObra(buscarMangago, salvar)
    expect(salvas.length).toBeGreaterThan(antes.length)
    for (const a of antes) expect(salvas).toContain(a)
  })

  it("6 · nenhuma escrita em falha nem em zero; e o dry-run (sem `salvar`) nunca escreve", async () => {
    const salvar = vi.fn(async () => {})
    await coletarReviewsDaObra(() => Promise.reject(new Error("HTTP 429")), salvar)
    await coletarReviewsDaObra(async () => [], salvar)
    expect(salvar).not.toHaveBeenCalled()
    expect(await coletarReviewsDaObra(async () => ["uma review"])).toEqual({ status: "com_reviews", textos: ["uma review"] })
  })
})

describe("arquitetura: o backfill não volta a engolir a falha", () => {
  const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const script = semComentarios(readFileSync(join(process.cwd(), "scripts/backfill-source-reviews.ts"), "utf8"))

  it("nenhum `.catch` devolvendo lista vazia", () => {
    expect(script).not.toMatch(/\.catch\(\s*(\(\s*[^)]*\)|\w+)\s*=>\s*\[\s*\]/)
  })

  it("a coleta passa pelo helper de três estados, e é ele quem chama o `saveWorkReviews`", () => {
    expect(script).toMatch(/coletarReviewsDaObra\(/)
    const salvamentos = script.match(/saveWorkReviews\(/g) ?? []
    expect(salvamentos).toHaveLength(1)
    // O único `saveWorkReviews(` mora no callback `salvar` passado ao helper — que só o chama com
    // reviews —, ou seja, entre a chamada do helper e a primeira leitura do resultado dela.
    const helper = script.indexOf("coletarReviewsDaObra(")
    const salva = script.indexOf("saveWorkReviews(")
    const leitura = script.indexOf("resultado.status", helper)
    expect(helper).toBeGreaterThan(-1)
    expect(salva).toBeGreaterThan(helper)
    expect(salva).toBeLessThan(leitura)
  })
})
