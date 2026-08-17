import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { sondarCapa, limparCacheDeSondagem } from "@/lib/server/covers/cover-liveness"

/**
 * O caso que existe pra impedir: em 17/08/2026 o `repick-dead-covers` acusou 98 obras com
 * "capa morta", TODAS em `uploads.mangadex.org`. As URLs respondiam 200 minutos depois — o
 * que caiu foi o DNS local, esgotado pelos ~1.000 lookups do próprio script. Como o `catch`
 * devolvia `false` = morta, um `--execute` teria reescrito 98 capas primárias boas.
 *
 * Por isso o teste é sobre a DISTINÇÃO, não sobre "detecta imagem": o que regride aqui é
 * falha de transporte voltar a se disfarçar de veredito sobre a capa.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])
const HTML = new TextEncoder().encode("<!doctype html><html>bloq")

function respostaCom(bytes: Uint8Array, ok = true, status = 200): Response {
  return {
    ok,
    status,
    body: {
      getReader: () => ({
        read: async () => ({ value: bytes, done: false }),
        cancel: async () => {},
      }),
      cancel: async () => {},
    },
  } as unknown as Response
}

describe("sondarCapa: três estados", () => {
  beforeEach(() => limparCacheDeSondagem())
  afterEach(() => vi.unstubAllGlobals())

  it("bytes de imagem ⇒ viva", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaCom(JPEG)))
    await expect(sondarCapa("https://cdn.exemplo/a.jpg")).resolves.toBe("viva")
    vi.stubGlobal("fetch", vi.fn(async () => respostaCom(PNG)))
    await expect(sondarCapa("https://cdn.exemplo/b.png")).resolves.toBe("viva")
  })

  it("HTTP 404 ⇒ morta (o host respondeu sobre a capa)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaCom(HTML, false, 404)))
    await expect(sondarCapa("https://cdn.exemplo/some.jpg")).resolves.toBe("morta")
  })

  it("200 com corpo que não é imagem ⇒ morta (Cloudflare devolvendo HTML)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaCom(HTML)))
    await expect(sondarCapa("https://static.comix.to/x.jpg")).resolves.toBe("morta")
  })

  /**
   * 🔴 O caso central. `ENOTFOUND` é o erro exato que o mangadex produziu naquele dia.
   * Se este teste passar a esperar "morta", o defeito de 98 capas está de volta.
   */
  it("falha de DNS ⇒ indeterminada, NUNCA morta", async () => {
    const erro = Object.assign(new Error("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    })
    const f = vi.fn(async () => {
      throw erro
    })
    vi.stubGlobal("fetch", f)
    const r = await sondarCapa("https://uploads.mangadex.org/covers/x.jpg.512.jpg")
    expect(r).toBe("indeterminada")
    expect(r).not.toBe("morta")
    // Duas tentativas: a 1ª cobre o soluço isolado, e só a 2ª conclui.
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("timeout/abort ⇒ indeterminada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
      }),
    )
    await expect(sondarCapa("https://lento.exemplo/a.jpg")).resolves.toBe("indeterminada")
  })

  it("soluço isolado na 1ª tentativa não condena a capa", async () => {
    let n = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++
        if (n === 1) throw new Error("ECONNRESET")
        return respostaCom(JPEG)
      }),
    )
    await expect(sondarCapa("https://cdn.exemplo/retry.jpg")).resolves.toBe("viva")
  })

  /**
   * Contraprova do comportamento ANTIGO: com dois estados, "rede caiu" e "404" colapsavam
   * no mesmo valor. Aqui eles têm que ser DIFERENTES — é essa desigualdade que o
   * `--execute` consulta antes de sobrescrever a capa principal de uma obra.
   */
  it("rede caída e 404 não colapsam no mesmo estado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND")
      }),
    )
    const rede = await sondarCapa("https://a.exemplo/1.jpg")
    vi.stubGlobal("fetch", vi.fn(async () => respostaCom(HTML, false, 404)))
    const quatroCemQuatro = await sondarCapa("https://a.exemplo/2.jpg")
    expect(rede).not.toBe(quatroCemQuatro)
  })
})
