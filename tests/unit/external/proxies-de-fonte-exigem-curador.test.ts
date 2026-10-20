// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// As rotas-proxy de fonte externa (`/api/animeplanet`, `/api/comick/*`) atendiam QUALQUER
// requisição: o middleware não cobre `/api/*` e nenhuma das três checava sessão. Cada chamada
// anônima podia abrir o FlareSolverr de produção (fila de UMA página por processo, a mesma das
// server actions) por até ~40s. Hoje o curador é exigido ANTES de qualquer fetch.

vi.mock("@/server/queries/current-user", () => ({
  getSessionUserId: vi.fn(),
  isCurrentUserAdmin: vi.fn(),
}))
vi.mock("@/lib/external/flaresolverr", () => ({
  fetchHtmlWithCfFallback: vi.fn(),
  isFlareSolverrEnabled: vi.fn(),
  isCfBypassUnavailable: vi.fn(() => false),
}))

import { NextRequest } from "next/server"
import { getSessionUserId, isCurrentUserAdmin } from "@/server/queries/current-user"
import { fetchHtmlWithCfFallback, isFlareSolverrEnabled } from "@/lib/external/flaresolverr"
import { parseAnimePlanetDetailHtml } from "@/lib/external/animeplanet"
import { ComicKUnavailableError, fetchComicKClient } from "@/lib/external/client-fetches"
import { GET as animePlanetGET } from "@/app/api/animeplanet/route"
import { GET as comickSearchGET } from "@/app/api/comick/search/route"
import { GET as comickDetailGET } from "@/app/api/comick/[hid]/route"

const sessao = vi.mocked(getSessionUserId)
const curador = vi.mocked(isCurrentUserAdmin)
const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)
const flareLigado = vi.mocked(isFlareSolverrEnabled)
const fetchExterno = vi.fn<typeof fetch>()

const DETALHE_AP = readFileSync(
  join(__dirname, "../../fixtures/animeplanet/detalhe-solo-leveling-2026-10.html"),
  "utf8",
)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const ROTAS = [
  {
    nome: "/api/animeplanet",
    chamar: () =>
      animePlanetGET(new NextRequest("http://local.test/api/animeplanet?title=Solo%20Leveling&slug=solo-leveling")),
  },
  {
    nome: "/api/comick/search",
    chamar: () => comickSearchGET(new NextRequest("http://local.test/api/comick/search?q=Solo%20Leveling")),
  },
  {
    nome: "/api/comick/[hid]",
    chamar: () =>
      comickDetailGET(new NextRequest("http://local.test/api/comick/abc123"), {
        params: Promise.resolve({ hid: "abc123" }),
      }),
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", fetchExterno)
  // A fonte "responderia" pelos dois caminhos: o fetch direto falha (Cloudflare) e o bypass
  // está ligado e devolve página. Assim, sem o gate, as rotas chamariam os DOIS.
  fetchExterno.mockResolvedValue(new Response("cf", { status: 403 }))
  flareLigado.mockReturnValue(true)
  fetchHtml.mockResolvedValue({ html: DETALHE_AP, finalUrl: "https://x.test/" })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(ROTAS)("$nome — bloqueio antes de qualquer chamada externa", ({ chamar }) => {
  it("anônimo recebe 401 e nada sai para a fonte nem para o FlareSolverr", async () => {
    sessao.mockResolvedValue(null)

    const res = await chamar()

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthenticated" })
    expect(fetchExterno).not.toHaveBeenCalled()
    expect(fetchHtml).not.toHaveBeenCalled()
  })

  it("logado SEM papel de curador recebe 403 e nada sai para a fonte nem para o FlareSolverr", async () => {
    sessao.mockResolvedValue("leitor-1")
    curador.mockResolvedValue(false)

    const res = await chamar()

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
    expect(fetchExterno).not.toHaveBeenCalled()
    expect(fetchHtml).not.toHaveBeenCalled()
  })
})

describe("curador autorizado — contratos de resposta preservados", () => {
  beforeEach(() => {
    sessao.mockResolvedValue("curador-1")
    curador.mockResolvedValue(true)
  })

  it("/api/comick/search: match volta 200 com os dados da fonte", async () => {
    fetchExterno.mockResolvedValue(json([{ hid: "abc123", title: "Solo Leveling" }]))

    const res = await comickSearchGET(new NextRequest("http://local.test/api/comick/search?q=Solo%20Leveling"))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ hid: "abc123", title: "Solo Leveling" }])
    expect(String(fetchExterno.mock.calls[0][0])).toContain("/v1.0/search/?q=Solo+Leveling")
  })

  it("/api/comick/search: ausência de resultado (200 + []) ≠ fonte fora do ar (502)", async () => {
    fetchExterno.mockResolvedValue(json([]))
    const vazio = await comickSearchGET(new NextRequest("http://local.test/api/comick/search?q=nada"))
    expect(vazio.status).toBe(200)
    expect(await vazio.json()).toEqual([])

    fetchExterno.mockRejectedValue(new Error("rede"))
    fetchHtml.mockResolvedValue(null)
    const fora = await comickSearchGET(new NextRequest("http://local.test/api/comick/search?q=nada"))
    expect(fora.status).toBe(502)
    expect(await fora.json()).toEqual({ error: "comick_upstream_unavailable" })
    // O bypass continua sendo tentado para o curador — uma vez por base.
    expect(fetchHtml).toHaveBeenCalledTimes(4)
  })

  it("/api/comick/[hid]: dados voltam 200; todas as bases falhando voltam 502", async () => {
    fetchExterno.mockResolvedValue(json({ comic: { hid: "abc123", rating: "8.5" } }))
    const ok = await comickDetailGET(new NextRequest("http://local.test/api/comick/abc123"), {
      params: Promise.resolve({ hid: "abc123" }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ comic: { hid: "abc123", rating: "8.5" } })
    expect(String(fetchExterno.mock.calls[0][0])).toContain("/comic/abc123")

    fetchExterno.mockRejectedValue(new Error("rede"))
    fetchHtml.mockResolvedValue(null)
    const fora = await comickDetailGET(new NextRequest("http://local.test/api/comick/abc123"), {
      params: Promise.resolve({ hid: "abc123" }),
    })
    expect(fora.status).toBe(502)
    expect(await fora.json()).toEqual({ error: "comick_upstream_unavailable" })
  })

  it("/api/animeplanet: slug conhecido abre o detalhe pelo bypass e devolve o parse", async () => {
    const res = await animePlanetGET(new NextRequest("http://local.test/api/animeplanet?slug=solo-leveling"))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(parseAnimePlanetDetailHtml(DETALHE_AP))
    expect(fetchHtml.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/manga/solo-leveling"])
  })

  it("/api/animeplanet: contrato anterior mantido — fonte sem página volta 200 + null", async () => {
    // Esta rota NUNCA distinguiu falha de ausência (as duas são 200 + null), e o cliente
    // (`fetchAnimePlanetClient`) também não. Fica como estava: mudar não é escopo do gate.
    fetchHtml.mockResolvedValue(null)

    const res = await animePlanetGET(new NextRequest("http://local.test/api/animeplanet?slug=solo-leveling"))

    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })
})

describe("cliente (`fetchComicKClient`) — bloqueio não vira 'fonte indisponível'", () => {
  it("502 lança ComicKUnavailableError (retry); 403 e [] voltam null sem lançar", async () => {
    fetchExterno.mockResolvedValueOnce(json({ error: "comick_upstream_unavailable" }, 502))
    await expect(fetchComicKClient("Solo Leveling")).rejects.toBeInstanceOf(ComicKUnavailableError)

    fetchExterno.mockResolvedValueOnce(json({ error: "forbidden" }, 403))
    await expect(fetchComicKClient("Solo Leveling")).resolves.toBeNull()

    fetchExterno.mockResolvedValueOnce(json([]))
    await expect(fetchComicKClient("Solo Leveling")).resolves.toBeNull()
  })
})

// ── Rede de arquitetura ──────────────────────────────────────────────────────
// Rota que ALCANÇA o bypass de Cloudflare (direto ou por um módulo intermediário) tem que
// chamar o gate. Deriva as rotas do filesystem e segue os imports de VALOR (não `import type`):
// lista fixa não acharia a rota de amanhã, e casar só o import direto deixaria passar uma rota
// que chame `searchAnimePlanet()`, que chega ao FlareSolverr sem importá-lo.

const RAIZ = resolve(__dirname, "../../..")
const BYPASS = new Set(["lib/external/flaresolverr.ts", "lib/external/comix-render-client.ts"])

function rotasDoApp(dir = join(RAIZ, "app")): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return rotasDoApp(caminho)
    return /^route\.(ts|tsx)$/.test(nome) ? [caminho] : []
  })
}

function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

function resolverImport(de: string, especificador: string): string | null {
  let base: string
  if (especificador.startsWith("@/")) base = join(RAIZ, especificador.slice(2))
  else if (especificador.startsWith(".")) base = resolve(dirname(de), especificador)
  else return null // pacote: fora do repo
  for (const sufixo of ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"]) {
    const c = base + sufixo
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function importsDeValor(arquivo: string): string[] {
  const src = semComentarios(readFileSync(arquivo, "utf8"))
  const especificadores = [
    ...src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^"';]*?\bfrom\s+["']([^"']+)["']/g),
    ...src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g),
    ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1])
  return especificadores.map((e) => resolverImport(arquivo, e)).filter((c): c is string => c != null)
}

function alcancaBypass(rota: string): string[] | null {
  const visto = new Map<string, string | null>([[rota, null]])
  const fila = [rota]
  while (fila.length) {
    const atual = fila.shift()!
    if (BYPASS.has(relative(RAIZ, atual))) {
      const caminho: string[] = []
      for (let n: string | null = atual; n; n = visto.get(n) ?? null) caminho.unshift(relative(RAIZ, n))
      return caminho
    }
    for (const prox of importsDeValor(atual)) {
      if (!visto.has(prox)) {
        visto.set(prox, atual)
        fila.push(prox)
      }
    }
  }
  return null
}

describe("toda rota que alcança o bypass de Cloudflare exige curador", () => {
  const rotas = rotasDoApp()
  const comBypass = rotas
    .map((r) => ({ rota: relative(RAIZ, r), caminho: alcancaBypass(r) }))
    .filter((r): r is { rota: string; caminho: string[] } => r.caminho != null)

  it("a varredura acha as três rotas-proxy conhecidas (senão ela não está olhando)", () => {
    expect(comBypass.map((r) => r.rota).sort()).toEqual(
      expect.arrayContaining([
        "app/api/animeplanet/route.ts",
        "app/api/comick/[hid]/route.ts",
        "app/api/comick/search/route.ts",
      ]),
    )
  })

  it("cada uma chama `gateCuradorDaRota()`", () => {
    const semGate = comBypass
      .filter(({ rota }) => !/\bgateCuradorDaRota\(\)/.test(semComentarios(readFileSync(join(RAIZ, rota), "utf8"))))
      .map(({ rota, caminho }) => `${rota}  (via ${caminho.join(" → ")})`)
    expect(semGate).toEqual([])
  })
})
