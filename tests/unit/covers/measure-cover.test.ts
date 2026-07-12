// @vitest-environment node
import { describe, it, expect } from "vitest"
import { parseImageHeader, scoreCover } from "@/lib/server/covers/measure-cover"

// ---------------------------------------------------------------------------
// Fixtures: cabeçalhos mínimos válidos, montados byte a byte.
// ---------------------------------------------------------------------------

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write("IHDR", 12, "ascii")
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

/** JPEG com N segmentos APP1 de enchimento antes do SOF — imita os arquivos do
 *  Kitsu, que trazem EXIF/XMP gigante e empurram as dimensões pra bem depois do
 *  começo do arquivo. */
function jpeg(w: number, h: number, appPadding = 0): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])] // SOI
  for (let i = 0; i < appPadding; i++) {
    const len = 1000
    const seg = Buffer.alloc(2 + len)
    seg[0] = 0xff
    seg[1] = 0xe1 // APP1
    seg.writeUInt16BE(len, 2)
    parts.push(seg)
  }
  const sof = Buffer.alloc(11)
  sof[0] = 0xff
  sof[1] = 0xc0 // SOF0
  sof.writeUInt16BE(8, 2) // len
  sof[4] = 8 // precision
  sof.writeUInt16BE(h, 5)
  sof.writeUInt16BE(w, 7)
  parts.push(sof)
  return Buffer.concat(parts)
}

function webpVp8x(w: number, h: number): Buffer {
  const b = Buffer.alloc(30)
  b.write("RIFF", 0, "ascii")
  b.writeUInt32LE(22, 4)
  b.write("WEBP", 8, "ascii")
  b.write("VP8X", 12, "ascii")
  b.writeUInt32LE(10, 16)
  b.writeUIntLE(w - 1, 24, 3)
  b.writeUIntLE(h - 1, 27, 3)
  return b
}

/** WebP lossy — é o chunk mais comum nas capas reais (18 de 25 amostradas; o
 *  AnimePlanet serve assim). Estrutura: RIFF|size|WEBP|"VP8 "|size|frame tag(3)|
 *  start code 9d 01 2a|width(14 bits LE)|height(14 bits LE). */
function webpVp8(w: number, h: number): Buffer {
  const b = Buffer.alloc(30)
  b.write("RIFF", 0, "ascii")
  b.writeUInt32LE(22, 4)
  b.write("WEBP", 8, "ascii")
  b.write("VP8 ", 12, "ascii")
  b.writeUInt32LE(10, 16)
  Buffer.from([0x9d, 0x01, 0x2a]).copy(b, 23) // start code, após o frame tag
  b.writeUInt16LE(w, 26)
  b.writeUInt16LE(h, 28)
  return b
}

/** WebP lossless: signature 0x2f, depois (w-1) e (h-1) em 14 bits cada. */
function webpVp8l(w: number, h: number): Buffer {
  const b = Buffer.alloc(30)
  b.write("RIFF", 0, "ascii")
  b.writeUInt32LE(22, 4)
  b.write("WEBP", 8, "ascii")
  b.write("VP8L", 12, "ascii")
  b.writeUInt32LE(10, 16)
  b[20] = 0x2f
  b.writeUInt32LE((w - 1) | ((h - 1) << 14), 21)
  return b
}

function gif(w: number, h: number): Buffer {
  const b = Buffer.alloc(10)
  b.write("GIF89a", 0, "ascii")
  b.writeUInt16LE(w, 6)
  b.writeUInt16LE(h, 8)
  return b
}

describe("parseImageHeader", () => {
  it("lê PNG", () => {
    expect(parseImageHeader(png(700, 1000))).toMatchObject({ width: 700, height: 1000 })
  })

  it("lê JPEG simples", () => {
    expect(parseImageHeader(jpeg(600, 900))).toMatchObject({ width: 600, height: 900 })
  })

  it("lê JPEG com EXIF gordo antes do SOF (caso Kitsu)", () => {
    // 40 segmentos de enchimento ⇒ SOF só aparece ~40KB adentro
    expect(parseImageHeader(jpeg(1200, 1800, 40))).toMatchObject({ width: 1200, height: 1800 })
  })

  it("lê WebP (VP8X)", () => {
    expect(parseImageHeader(webpVp8x(800, 1200))).toMatchObject({
      width: 800, height: 1200, format: "webp",
    })
  })

  // 18 das 25 capas WebP reais do catálogo usam ESTE chunk — é o caminho quente,
  // e era o único ramo do parser sem fixture.
  it("lê WebP lossy (VP8), o chunk mais comum nas capas reais", () => {
    expect(parseImageHeader(webpVp8(771, 1080))).toMatchObject({
      width: 771, height: 1080, format: "webp",
    })
  })

  it("lê WebP lossless (VP8L)", () => {
    expect(parseImageHeader(webpVp8l(640, 960))).toMatchObject({
      width: 640, height: 960, format: "webp",
    })
  })

  it("lê GIF", () => {
    expect(parseImageHeader(gif(300, 400))).toMatchObject({ width: 300, height: 400 })
  })

  it("devolve null pro que não reconhece, em vez de chutar", () => {
    expect(parseImageHeader(Buffer.from("não sou uma imagem"))).toBeNull()
    expect(parseImageHeader(Buffer.alloc(0))).toBeNull()
  })
})

describe("scoreCover", () => {
  const bytesFor = (w: number, h: number, bpp: number) => Math.round(w * h * bpp)
  const jpg = (w: number, h: number, bpp: number) =>
    ({ width: w, height: h, bytes: bytesFor(w, h, bpp), format: "jpeg" }) as const
  const webp = (w: number, h: number, bpp: number) =>
    ({ width: w, height: h, bytes: bytesFor(w, h, bpp), format: "webp" }) as const

  it("prefere a capa maior entre duas sadias", () => {
    expect(scoreCover(jpg(900, 1350, 0.3))).toBeGreaterThan(scoreCover(jpg(400, 600, 0.3)))
  })

  // REGRESSÃO: o limiar de "estourada" era único (0,15) e marcava 45% de TODOS os
  // WebP do catálogo como defeituosos — o WebP comprime ~2,2× melhor que JPEG pelo
  // mesmo resultado visual. Isso rebaixava uma capa de 771×1080 do AnimePlanet
  // (impecável no recorte 1:1) abaixo de uma miniatura de 230px.
  it("não trata WebP eficiente como estourado", () => {
    const apGrande = webp(771, 1080, 0.113) // capa real, verificada visualmente: perfeita
    const miniatura = jpg(230, 334, 0.46)
    expect(scoreCover(apGrande)).toBeGreaterThan(scoreCover(miniatura))
  })

  it("ainda pega WebP genuinamente estourado", () => {
    expect(scoreCover(webp(771, 1080, 0.042))).toBeLessThan(scoreCover(webp(771, 1080, 0.113)))
  })

  it("não pune PNG por bpp (lossless não tem limiar)", () => {
    const png = { width: 800, height: 1200, bytes: bytesFor(800, 1200, 0.05), format: "png" } as const
    expect(scoreCover(png)).toBe(scoreCover({ ...png, bytes: bytesFor(800, 1200, 2.0) }))
  })

  // REGRESSÃO: a primeira versão dava BÔNUS por bits/pixel alto, e uma capa de
  // 512px bem comprimida ganhava de uma de 600px. Compressão só pode PENALIZAR.
  it("não deixa a compressão inverter a ordem entre duas capas sadias", () => {
    expect(scoreCover(jpg(600, 984, 0.27))).toBeGreaterThan(scoreCover(jpg(512, 690, 0.9)))
  })

  it("penaliza JPEG estourado", () => {
    expect(scoreCover(jpg(800, 1200, 0.05))).toBeLessThan(scoreCover(jpg(800, 1200, 0.3)))
  })

  it("penaliza proporção que não é de capa (banner/quadrado)", () => {
    expect(scoreCover(jpg(700, 700, 0.3))).toBeLessThan(scoreCover(jpg(700, 1050, 0.3)))
  })

  it("não pune quando o tamanho do arquivo é desconhecido", () => {
    const semBytes = { width: 700, height: 1050, bytes: null, format: "jpeg" } as const
    expect(scoreCover(semBytes)).toBe(scoreCover(jpg(700, 1050, 0.3)))
  })
})
