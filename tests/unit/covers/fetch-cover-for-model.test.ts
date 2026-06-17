import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/external/blocked-covers", () => ({
  isBlockedCoverUrl: vi.fn(() => false),
  recordCoverHostResult: vi.fn(),
  recordCoverUrlResult: vi.fn(),
}))

import {
  fetchCoverForModel,
  detectImageMediaType,
  isImageRelatedModelError,
} from "@/lib/server/covers/fetch-cover-for-model"
import { isBlockedCoverUrl, recordCoverHostResult } from "@/lib/external/blocked-covers"

const ALLOWED = "https://cdn.mangaupdates.com/cover.jpg"
const DISALLOWED = "https://evil.example.com/cover.jpg"

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3, 4])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
const AVIF = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])
const HTML = new TextEncoder().encode("<html><body>nope</body></html>")

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

interface FakeResInit {
  status?: number
  headers?: Record<string, string>
  bytes?: Uint8Array | null
  stream?: ReadableStream<Uint8Array> | null
}
function fakeRes({ status = 200, headers = {}, bytes = null, stream = null }: FakeResInit) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
    body: stream ?? (bytes ? streamOf(bytes) : null),
    arrayBuffer: async () => (bytes ? bytes.slice().buffer : new ArrayBuffer(0)),
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.mocked(isBlockedCoverUrl).mockReturnValue(false)
  vi.mocked(recordCoverHostResult).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("detectImageMediaType", () => {
  it("detecta JPEG/PNG/GIF/WebP por assinatura", () => {
    expect(detectImageMediaType(JPEG)).toBe("image/jpeg")
    expect(detectImageMediaType(PNG)).toBe("image/png")
    expect(detectImageMediaType(GIF)).toBe("image/gif")
    expect(detectImageMediaType(WEBP)).toBe("image/webp")
  })
  it("rejeita SVG, AVIF, HTML e buffers curtos", () => {
    expect(detectImageMediaType(SVG)).toBeNull()
    expect(detectImageMediaType(AVIF)).toBeNull()
    expect(detectImageMediaType(HTML)).toBeNull()
    expect(detectImageMediaType(Uint8Array.from([0xff]))).toBeNull()
  })
})

describe("isImageRelatedModelError", () => {
  it("true só para 400 com image/media_type/base64", () => {
    expect(isImageRelatedModelError({ status: 400, message: "invalid base64 data" })).toBe(true)
    expect(isImageRelatedModelError(Object.assign(new Error("bad media_type"), { status: 400 }))).toBe(true)
    expect(isImageRelatedModelError(Object.assign(new Error("could not process image"), { status: 400 }))).toBe(true)
  })
  it("false para outros status ou mensagens", () => {
    expect(isImageRelatedModelError({ status: 429, message: "rate limit on image" })).toBe(false)
    expect(isImageRelatedModelError({ status: 400, message: "invalid tool input" })).toBe(false)
    expect(isImageRelatedModelError(Object.assign(new Error("overloaded"), { status: 529 }))).toBe(false)
    expect(isImageRelatedModelError("image")).toBe(false)
    expect(isImageRelatedModelError(null)).toBe(false)
  })
})

describe("fetchCoverForModel", () => {
  it("URL inválida → null (sem fetch)", async () => {
    expect(await fetchCoverForModel("not a url")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("protocolo não-http → null", async () => {
    expect(await fetchCoverForModel("ftp://cdn.mangaupdates.com/x.jpg")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("host fora da allowlist → null", async () => {
    expect(await fetchCoverForModel(DISALLOWED)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("host bloqueado temporariamente → null", async () => {
    vi.mocked(isBlockedCoverUrl).mockReturnValue(true)
    expect(await fetchCoverForModel("https://static.comix.to/x.jpg")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("JPEG válido → base64 + media_type + registra host saudável", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ bytes: JPEG, headers: { "content-type": "image/jpeg" } }))
    const out = await fetchCoverForModel(ALLOWED)
    expect(out).not.toBeNull()
    expect(out!.mediaType).toBe("image/jpeg")
    expect(out!.data).toBe(Buffer.from(JPEG).toString("base64"))
    expect(out!.originalBytes).toBe(JPEG.length)
    expect(recordCoverHostResult).toHaveBeenCalledWith("cdn.mangaupdates.com", true)
  })

  it("Content-Type errado mas bytes de imagem válidos → aceita pelo magic byte", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ bytes: PNG, headers: { "content-type": "application/octet-stream" } }))
    const out = await fetchCoverForModel(ALLOWED)
    expect(out?.mediaType).toBe("image/png")
  })

  it("header image/* mas conteúdo HTML → null", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ bytes: HTML, headers: { "content-type": "image/png" } }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
    expect(recordCoverHostResult).toHaveBeenCalledWith("cdn.mangaupdates.com", false)
  })

  it("SVG → null", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ bytes: SVG, headers: { "content-type": "image/svg+xml" } }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
  })
  it("AVIF sem conversão → null", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ bytes: AVIF, headers: { "content-type": "image/avif" } }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
  })

  it("Content-Length acima do limite → null (sem ler o corpo)", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ bytes: JPEG, headers: { "content-length": String(10 * 1024 * 1024) } }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
  })

  it("stream acima do limite sem Content-Length → null", async () => {
    const oneMb = new Uint8Array(1024 * 1024)
    oneMb.set(JPEG) // primeira chunk começa com assinatura válida
    const stream = streamOf(oneMb, new Uint8Array(1024 * 1024), new Uint8Array(1024 * 1024), new Uint8Array(1024 * 1024), new Uint8Array(1024 * 1024))
    fetchMock.mockResolvedValueOnce(fakeRes({ stream, headers: { "content-type": "image/jpeg" } }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
  })

  it("HTTP não-ok (404) → null + host marcado ruim", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ status: 404 }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
    expect(recordCoverHostResult).toHaveBeenCalledWith("cdn.mangaupdates.com", false)
  })

  it("redirect para host permitido → segue e retorna a imagem", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeRes({ status: 302, headers: { location: "https://meo.comick.pictures/c.png" } }))
      .mockResolvedValueOnce(fakeRes({ bytes: PNG, headers: { "content-type": "image/png" } }))
    const out = await fetchCoverForModel(ALLOWED)
    expect(out?.mediaType).toBe("image/png")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("redirect para host NÃO permitido → null", async () => {
    fetchMock.mockResolvedValueOnce(fakeRes({ status: 302, headers: { location: DISALLOWED } }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("redirects em excesso → null", async () => {
    fetchMock.mockResolvedValue(fakeRes({ status: 302, headers: { location: "https://cdn.mangaupdates.com/loop.jpg" } }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it("fetch que lança (abort/erro) → null, sem quebrar", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }))
    expect(await fetchCoverForModel(ALLOWED)).toBeNull()
  })

  it("nunca loga base64 nem URL", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(fakeRes({ bytes: JPEG, headers: { "content-type": "image/jpeg" } }))
    const out = await fetchCoverForModel(ALLOWED)
    const b64 = out!.data
    for (const call of logSpy.mock.calls) {
      const serialized = call.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
      expect(serialized).not.toContain(b64)
      expect(serialized).not.toContain("cover.jpg")
    }
    logSpy.mockRestore()
  })
})
