// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A Comix tem de separar TRÊS desfechos: trouxe comentários, respondeu que não há, e NÃO respondeu.
// Até 2026-10-07 `fetchComixReviews` devolvia `[]` nos três últimos casos — rede, 429, 5xx, JSON
// inválido, desafio sem bypass e página remodelada viravam "0 reviews": a Comix nunca entrava em
// `failedSources` (sem 2ª passada), o backfill contava "sem review" e o canário dizia "cadeia
// falhou (ou canário sem comentários)".
//
// O adaptador e a coleta são os REAIS; a origem (comix.to), o FlareSolverr e o banco são simulados.
// As respostas de sucesso seguem o formato MEDIDO na sonda de 2026-10-07: envelope `{ status, result }`
// e `result.thread = { id, commentCount, … }`.

vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => false,
  renderHtmlViaSidecar: async () => null,
  isSidecarBlockedFor: () => false,
}))
vi.mock("@/lib/external/source-health-store", () => ({ upsertSourceHealth: vi.fn(async () => {}) }))

// A 2ª passada (`acquireAndPersistWorkReviews`): banco e gravação simulados; a coleta e o
// contexto de avaliação são os REAIS (só a Comix tem id, então só ela é tentada). `index` NÃO é
// mockado de propósito: mock de módulo sobrevive ao `resetModules`, e a coleta passaria a gravar
// num gate de outra geração — o teste leria um gate limpo e aprovaria qualquer coisa.
const saveWorkReviews = vi.fn<(w: string, r: unknown[], o?: Record<string, unknown>) => Promise<void>>(async () => {})
vi.mock("@/lib/external/persist-reviews", () => ({
  saveWorkReviews: (w: string, r: unknown[], o?: Record<string, unknown>) => saveWorkReviews(w, r, o),
}))
const encadear = (resultado: unknown): Record<string, unknown> =>
  new Proxy({}, {
    get: (_t, prop) => (prop === "then" ? (res: (v: unknown) => void) => Promise.resolve(resultado).then(res) : () => encadear(resultado)),
  }) as Record<string, unknown>
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) =>
      encadear(
        tabela === "works"
          ? { data: { title: "Jinx", original_title: null, alternative_titles: [] }, error: null }
          : { data: [{ source: "comix", external_id: "003kd", is_rejected: false }], error: null },
      ),
  }),
}))

const HID = "003kd"
const FS = "http://fs.test/v1"
const DETALHE = `<html><script>${JSON.stringify({
  queries: { [JSON.stringify(["manga", "detail", HID])]: { hid: HID, id: 117593, title: "Jinx" } },
})}</script></html>`
const OPINIAO = { contentHtml: "<p>Uma opinião longa sobre a obra, com detalhes do enredo e do ritmo da história.</p>", status: "visible" }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } })
const html = (h: string, status = 200, headers: Record<string, string> = {}) => new Response(h, { status, headers })
const DESAFIO = () => html("<title>Just a moment...</title>", 403, { "cf-mitigated": "challenge" })
const LOOKUP_OK = (extra: Record<string, unknown> = {}) =>
  json({ status: 200, result: { thread: { id: 3155934, commentCount: 2, mainCommentCount: 2, ...extra }, announcement: "" } })
const COMENTARIOS = (items: unknown[], cursor: string | null = null) => json({ status: 200, result: { items, cursor } })

type Resp = () => Response | Promise<Response>
interface Origem {
  detalhe?: Resp
  lookup?: (n: number) => Response | Promise<Response>
  comentarios?: (n: number) => Response | Promise<Response>
  /** Corpo que o FlareSolverr devolve como `solution.response`; `null` = o FlareSolverr falha. */
  flaresolverr?: (url: string) => string | null
}
const chamadas = { lookup: 0, comentarios: 0, flaresolverr: 0 }

function origem(o: Origem = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === FS) {
      const body = JSON.parse(String(init?.body)) as { cmd: string; url?: string }
      if (body.cmd !== "request.get") return Response.json({ status: "ok" })
      chamadas.flaresolverr++
      const resposta = o.flaresolverr?.(body.url ?? "") ?? null
      if (resposta === null) return Response.json({ status: "error", message: "Error: boom" }, { status: 500 })
      return Response.json({ status: "ok", solution: { response: resposta, url: body.url } })
    }
    if (url.includes(`/title/${HID}`)) return (o.detalhe ?? (() => html(DETALHE)))()
    if (url.includes("/threads/lookup")) return (o.lookup ?? (() => LOOKUP_OK()))(chamadas.lookup++)
    if (url.includes("/comments")) return (o.comentarios ?? (() => COMENTARIOS([OPINIAO])))(chamadas.comentarios++)
    throw new Error(`URL inesperada no teste: ${url}`)
  }))
}

async function carregar(opts: { flaresolverr?: boolean; semBypass?: boolean } = {}) {
  vi.resetModules()
  vi.stubEnv("FLARESOLVERR_URL", opts.flaresolverr ? FS : "")
  if (opts.semBypass) {
    vi.doMock("@/lib/external/flaresolverr", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/external/flaresolverr")>()),
      isCfBypassUnavailable: () => true,
    }))
  } else {
    vi.doUnmock("@/lib/external/flaresolverr")
  }
  const comix = await import("@/lib/external/comix")
  const gate = await import("@/lib/external/comix-gate")
  const index = await import("@/lib/external/index")
  return { comix, gate, index }
}

/** A promise TEM de rejeitar com `ComixUnavailableError` — devolver qualquer valor é o defeito. */
async function rejeita(p: Promise<unknown>, Erro: new (...a: never[]) => Error): Promise<{ reason: string }> {
  const r = await p.then((v) => ({ resolveu: v }), (e: unknown) => ({ erro: e }))
  expect("erro" in r ? r.erro : r, "deveria REJEITAR, mas resolveu").toBeInstanceOf(Erro)
  return (r as { erro: { reason: string } }).erro
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  chamadas.lookup = 0
  chamadas.comentarios = 0
  chamadas.flaresolverr = 0
  saveWorkReviews.mockClear()
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("satoria.flaresolverr.pageQueue")]
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("sucesso e zero legítimo — a Comix RESPONDEU", () => {
  it("1 · comentários válidos → as reviews", async () => {
    origem()
    const { comix } = await carregar()
    expect(await comix.collectComixReviews(HID)).toEqual({ reviews: [expect.stringContaining("Uma opinião longa")], empty: null })
  })

  it("2 · thread com commentCount: 0 → [] (no_comments), sem nem pedir os comentários", async () => {
    origem({ lookup: () => LOOKUP_OK({ commentCount: 0, mainCommentCount: 0 }) })
    const { comix } = await carregar()
    expect(await comix.collectComixReviews(HID)).toEqual({ reviews: [], empty: "no_comments" })
    expect(chamadas.comentarios).toBe(0)
  })

  it("3 · thread válida + comentários com items: [] → [] (no_comments)", async () => {
    origem({ comentarios: () => COMENTARIOS([]) })
    const { comix } = await carregar()
    expect(await comix.collectComixReviews(HID)).toEqual({ reviews: [], empty: "no_comments" })
  })

  it("4 · detalhe 404 → [] (not_found), e NÃO conta como queda da Comix no gate", async () => {
    origem({ detalhe: () => html("<html>404</html>", 404) })
    const { comix, gate } = await carregar()
    expect(await comix.collectComixReviews(HID)).toEqual({ reviews: [], empty: "not_found" })
    expect(gate.getComixStatus()).toMatchObject({ consecutiveFails: 0, failReason: null })
  })
})

describe("5 · lookup válido SEM thread — ramo PROVISÓRIO (compatível, observável)", () => {
  it.each([
    ["envelope com result.thread: null", () => json({ status: 200, result: { thread: null } })],
    ["envelope sem a chave thread", () => json({ status: 200, result: {} })],
    ["lookup 404", () => json({ message: "Not Found" }, 404)],
  ])("%s → [] por compatibilidade, com a marca lookup_without_thread no log — nem zero, nem falha", async (_n, lookup) => {
    origem({ lookup })
    const { comix } = await carregar()
    expect(await comix.collectComixReviews(HID)).toEqual({ reviews: [], empty: "lookup_without_thread" })
    expect(await comix.fetchComixReviews(HID)).toEqual([]) // não rejeita: preserva o comportamento atual
    expect(warn.mock.calls.flat().join(" ")).toMatch(/\[comix\] lookup_without_thread hid=003kd/)
  })
})

describe("falha real REJEITA com ComixUnavailableError — nunca vira []", () => {
  it("6 · erro de rede no lookup → fetch_failed", async () => {
    origem({ lookup: () => { throw new TypeError("fetch failed") } })
    const { comix } = await carregar()
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("fetch_failed")
  })

  it("7 · HTTP 429 no lookup → rate_limited", async () => {
    origem({ lookup: () => json({ message: "Too Many Attempts." }, 429) })
    const { comix } = await carregar()
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("rate_limited")
  })

  it("8 · HTTP 500 na 1ª página de comentários → server_error", async () => {
    origem({ comentarios: () => json({ message: "Server Error" }, 500) })
    const { comix } = await carregar()
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("server_error")
  })

  it("9 · JSON inválido no lookup → invalid_response", async () => {
    origem({ lookup: () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "application/json" } }) })
    const { comix } = await carregar()
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("invalid_response")
  })

  it("10 · desafio do Cloudflare no detalhe, sem bypass que o atravesse → blocked", async () => {
    origem({ detalhe: DESAFIO })
    const { comix } = await carregar()
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("blocked")
  })

  it("10 · desafio com o bypass FORA (circuito aberto, sem sidecar) → bypass_unavailable", async () => {
    origem({ detalhe: DESAFIO })
    const { comix } = await carregar({ semBypass: true })
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("bypass_unavailable")
  })

  it("11 · FlareSolverr que falha ao atravessar o desafio → blocked (não [])", async () => {
    origem({ detalhe: DESAFIO, flaresolverr: () => null })
    const { comix } = await carregar({ flaresolverr: true })
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("blocked")
    expect(chamadas.flaresolverr).toBeGreaterThan(0)
  })

  it("11 · 403 que o FlareSolverr devolve como CORPO do erro → blocked, e o gate NÃO vira 'ok'", async () => {
    origem({ lookup: () => json({ message: "Forbidden" }, 403), flaresolverr: () => `<pre>${JSON.stringify({ message: "Forbidden" })}</pre>` })
    const { comix, gate } = await carregar({ flaresolverr: true })
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("blocked")
    expect(chamadas.flaresolverr).toBe(1)
    expect(gate.getComixStatus().failReason).toBe("http_error")
  })

  it("7 · 429 NÃO insiste: nem o fetch direto de novo, nem o FlareSolverr", async () => {
    origem({ lookup: () => json({ message: "Too Many Attempts." }, 429), flaresolverr: () => "nunca deveria ser chamado" })
    const { comix } = await carregar({ flaresolverr: true })
    await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)
    expect(chamadas.lookup).toBe(1)
    expect(chamadas.flaresolverr).toBe(0)
  })

  it("11 · FlareSolverr devolve algo que não é o envelope → invalid_response", async () => {
    origem({ lookup: DESAFIO, flaresolverr: () => "<html>página qualquer</html>" })
    const { comix } = await carregar({ flaresolverr: true })
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("invalid_response")
  })

  it("12 · página 200 sem o objeto da obra (remodelada) → invalid_response, registrada no gate", async () => {
    origem({ detalhe: () => html("<html><body>novo layout</body></html>") })
    const { comix, gate } = await carregar()
    expect((await rejeita(comix.fetchComixReviews(HID), comix.ComixUnavailableError)).reason).toBe("invalid_response")
    expect(gate.getComixStatus().failReason).toBe("invalid_response")
    // A página que o bypass devolveu é a MESMA página ruim: não pode ter contado como sucesso. Até
    // 2026-10-07 contava (o gate ficava "ok" enquanto a coleta não tinha nada).
    expect(gate.getComixStatus()).toMatchObject({ lastOkAt: null, state: "degraded" })
  })
})

describe("13 · parcial — a política não mudou", () => {
  it("1ª página veio, a 2ª falha → devolve o que a 1ª trouxe, sem rejeitar", async () => {
    origem({ comentarios: (n) => (n === 0 ? COMENTARIOS([OPINIAO], "pagina-2") : json({ message: "Server Error" }, 500)) })
    const { comix } = await carregar()
    expect(await comix.fetchComixReviews(HID)).toHaveLength(1)
    expect(chamadas.comentarios).toBe(2)
  })
})

describe("pipeline — a falha chega a quem decide", () => {
  const candidato = { title: "Jinx", comixHid: HID, matchScore: 1 } as never

  it("14 · uma falha real entra em failedSources (antes: zero calado)", async () => {
    origem({ lookup: () => json({ message: "Server Error" }, 500) })
    const { index: { collectReviewsFromCandidate } } = await carregar()
    const r = await collectReviewsFromCandidate(candidato)
    expect(r.failedSources).toEqual(["comix"])
    expect(r.reviews).toEqual([])
  })

  it("14 · zero legítimo NÃO entra em failedSources", async () => {
    origem({ comentarios: () => COMENTARIOS([]) })
    const { index: { collectReviewsFromCandidate } } = await carregar()
    expect((await collectReviewsFromCandidate(candidato)).failedSources).toEqual([])
  })

  it("16 · a falha tipada mantém a causa real no gate — NÃO vira delivery_timeout", async () => {
    origem({ lookup: () => json({ message: "Too Many Attempts." }, 429) })
    const { gate, index: { collectReviewsFromCandidate } } = await carregar()
    await collectReviewsFromCandidate(candidato)
    expect(gate.getComixStatus().failReason).toBe("http_error")
  })

  it("16 · contraprova: o timeout REAL do wrapper continua sendo delivery_timeout", async () => {
    vi.useFakeTimers()
    origem({ detalhe: () => new Promise<Response>(() => {}) }) // a Comix nunca responde
    const { gate, index: { collectReviewsFromCandidate } } = await carregar()
    const coleta = collectReviewsFromCandidate(candidato)
    await vi.advanceTimersByTimeAsync(25_001)
    expect((await coleta).failedSources).toEqual(["comix"])
    expect(gate.getComixStatus().failReason).toBe("delivery_timeout")
  })

  it("15 · a 2ª passada roda UMA vez e recupera quando a Comix volta (e só então força o enriquecimento)", async () => {
    origem({ lookup: (n) => (n === 0 ? json({ message: "Server Error" }, 500) : LOOKUP_OK()) })
    await carregar()
    const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
    expect(await acquireAndPersistWorkReviews("w1")).toBe(1)
    expect(chamadas.lookup).toBe(2) // 1ª passada + 2ª passada — nenhuma terceira
    const [, pool, opts] = saveWorkReviews.mock.calls.at(-1)!
    expect(pool).toEqual([expect.objectContaining({ source: "comix" })])
    expect(opts).toMatchObject({ accumulate: true, forcePaidEnrichment: true })
  })

  it("15 · sem loop: se a 2ª passada também falha, para ali — e não força enriquecimento pago", async () => {
    origem({ lookup: () => json({ message: "Server Error" }, 500) })
    await carregar()
    const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
    expect(await acquireAndPersistWorkReviews("w1")).toBe(0)
    expect(chamadas.lookup).toBe(2)
    expect(saveWorkReviews.mock.calls.at(-1)?.[2]).toMatchObject({ accumulate: true, forcePaidEnrichment: false })
  })

  it("17 · reviews persistidas sobrevivem: a falha nunca grava nada da Comix, e a gravação é sempre acumulativa", async () => {
    origem({ lookup: () => json({ message: "Server Error" }, 500) })
    await carregar()
    const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
    await acquireAndPersistWorkReviews("w1")
    for (const [, pool, opts] of saveWorkReviews.mock.calls) {
      expect(pool).toEqual([]) // conjunto vazio = no-op do saveWorkReviews: nada é apagado nem substituído
      expect(opts).toMatchObject({ accumulate: true })
    }
    // E na avaliação, a Comix fora não tira as persistidas do prompt.
    const { mergeFreshWithPersistedReviews } = await import("@/lib/external/review-merge")
    const persistida = { source: "comix" as const, sourceTitle: "Jinx", matchScore: 1, text: "review persistida da comix", textLength: 26 }
    expect(mergeFreshWithPersistedReviews([], [persistida])).toEqual({ merged: [persistida], recovered: 1 })
  })
})
