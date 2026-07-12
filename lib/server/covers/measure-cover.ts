import "server-only"

import { isAllowedCoverHost, refererFor, userAgentFor } from "./cover-host-policy"

/**
 * Mede uma capa candidata SEM baixar a imagem inteira: um GET com `Range` traz só
 * o cabeçalho (que já carrega largura × altura) e o total de bytes vem do header
 * `Content-Range`/`Content-Length`. Custa ~16KB por capa em vez de ~200KB.
 *
 * Por que largura/altura e bytes, e não "nitidez": nitidez foi medida e REFUTADA
 * como critério — entre artes diferentes ela mede quanta textura o desenho tem, não
 * a qualidade do arquivo (uma capa de 2480×3508 com arte pálida pontua como
 * "borrada"). O que separa capa boa de ruim no catálogo é resolução efetiva; bytes
 * por pixel entram só pra pegar o JPEG estourado, que é grande e feio ao mesmo tempo.
 */

/** Só o cabeçalho interessa. WebP com VP8X precisa de ~30 bytes; JPEG progressivo
 *  pode ter vários segmentos antes do SOF, daí a folga. */
const HEADER_BYTES = 32 * 1024
/** Teto do fallback que baixa o arquivo inteiro (JPEG com EXIF/XMP gigante). */
const MAX_FULL_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 8000

/**
 * CDNs de capa que NÃO precisam do proxy de imagem (carregam direto no browser) e
 * por isso não estão em `PROXIED_COVER_HOSTS` — mas que a gente precisa MEDIR, senão
 * as capas de AniList/MyAnimeList entram no ranking sem nota e caem pro fim sem
 * terem sido avaliadas.
 *
 * A allowlist aqui é guarda de SSRF, não política de proxy: são duas listas com
 * propósitos diferentes, e juntá-las rotearia imagem pelo proxy à toa.
 */
const EXTRA_MEASURABLE_HOSTS = new Set([
  "s4.anilist.co",
  "cdn.myanimelist.net",
  "myanimelist.net",
  // A API OFICIAL do MAL (que substituiu o Jikan) serve `main_picture` por este
  // host. Sem ele, toda capa do MAL entraria no ranking SEM nota e cairia pro fim
  // da fila sem ter sido avaliada. Não deu pra confirmar chamando a API (o
  // MAL_CLIENT_ID não está no ambiente local), então cobrimos os dois hosts.
  "api-cdn.myanimelist.net",
])

function isMeasurableHost(host: string): boolean {
  const h = host.toLowerCase()
  return isAllowedCoverHost(h) || EXTRA_MEASURABLE_HOSTS.has(h)
}

export type CoverFormat = "jpeg" | "png" | "webp" | "gif"

export interface CoverMeasurement {
  width: number
  height: number
  /** Bytes do arquivo inteiro (do Content-Length), não do trecho baixado. */
  bytes: number | null
  /** Necessário pro limiar de compressão: WebP comprime ~2,2× melhor que JPEG. */
  format: CoverFormat
}

// ---------------------------------------------------------------------------
// Parsers de cabeçalho (PNG / JPEG / WebP / GIF)
// ---------------------------------------------------------------------------

function parsePng(b: Buffer): CoverMeasurement | null {
  // \x89PNG\r\n\x1a\n | 4B len | "IHDR" | width(4 BE) | height(4 BE)
  if (b.length < 24) return null
  if (b.readUInt32BE(0) !== 0x89504e47) return null
  if (b.toString("ascii", 12, 16) !== "IHDR") return null
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: null, format: "png" }
}

function parseGif(b: Buffer): CoverMeasurement | null {
  if (b.length < 10) return null
  if (b.toString("ascii", 0, 3) !== "GIF") return null
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), bytes: null, format: "gif" }
}

function parseJpeg(b: Buffer): CoverMeasurement | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++ // ressincroniza em bytes de padding
      continue
    }
    const marker = b[i + 1]
    // standalone markers (sem payload)
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = b.readUInt16BE(i + 2)
    // SOF0..SOF15, exceto DHT(c4), JPGA(c8) e DAC(cc) — que não são start-of-frame
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      // segmento: len(2) | precision(1) | height(2) | width(2)
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), bytes: null, format: "jpeg" }
    }
    if (len < 2) return null // segmento corrompido — não dá pra avançar
    i += 2 + len
  }
  return null
}

function parseWebp(b: Buffer): CoverMeasurement | null {
  // RIFF | size(4) | WEBP | chunk
  if (b.length < 30) return null
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null
  const chunk = b.toString("ascii", 12, 16)

  if (chunk === "VP8X") {
    // canvas: width-1 e height-1 em 24 bits LE
    const w = b.readUIntLE(24, 3) + 1
    const h = b.readUIntLE(27, 3) + 1
    return { width: w, height: h, bytes: null, format: "webp" }
  }
  if (chunk === "VP8 ") {
    // lossy: start code 0x9d 0x01 0x2a, depois 14 bits de cada dimensão
    const sc = b.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20)
    if (sc < 0 || sc + 7 > b.length) return null
    return {
      width: b.readUInt16LE(sc + 3) & 0x3fff,
      height: b.readUInt16LE(sc + 5) & 0x3fff,
      bytes: null,
      format: "webp",
    }
  }
  if (chunk === "VP8L") {
    // lossless: signature 0x2f, depois 14 bits (w-1) e 14 bits (h-1)
    if (b[20] !== 0x2f) return null
    const bits = b.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      bytes: null,
      format: "webp",
    }
  }
  return null
}

/** Dimensões a partir do cabeçalho. `null` quando o formato não é reconhecido. */
export function parseImageHeader(buf: Buffer): CoverMeasurement | null {
  return parsePng(buf) ?? parseJpeg(buf) ?? parseWebp(buf) ?? parseGif(buf)
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** Total de bytes do arquivo: `Content-Range: bytes 0-32767/198432` quando o host
 *  honra o Range; `Content-Length` quando ele ignora e manda tudo. */
function totalBytesFrom(headers: Headers, fallbackLength: number): number | null {
  const range = headers.get("content-range")
  const fromRange = range?.split("/")[1]
  if (fromRange && /^\d+$/.test(fromRange)) return Number(fromRange)
  const len = headers.get("content-length")
  if (len && /^\d+$/.test(len) && !range) return Number(len)
  return fallbackLength > 0 ? fallbackLength : null
}

/** Mede uma capa. Fail-soft: qualquer erro (host fora da allowlist, 404, formato
 *  desconhecido, timeout) devolve `null` e o chamador cai no critério antigo. */
export async function measureCover(rawUrl: string): Promise<CoverMeasurement | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (!isMeasurableHost(url.hostname)) return null

  const headers = {
    Referer: refererFor(url.hostname, url.origin),
    "User-Agent": userAgentFor(url.hostname),
    Accept: "image/*",
  }

  try {
    const res = await fetch(url, {
      headers: { ...headers, Range: `bytes=0-${HEADER_BYTES - 1}` },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // 206 = Range honrado (corpo truncado); 200 = host ignorou o Range e mandou tudo.
    if (!res.ok && res.status !== 206) return null

    const buf = Buffer.from(await res.arrayBuffer())
    const dims = parseImageHeader(buf)
    if (dims && dims.width > 0 && dims.height > 0) {
      return { ...dims, bytes: totalBytesFrom(res.headers, buf.length) }
    }

    // Cabeçalho não bastou. Se o corpo veio TRUNCADO, o SOF pode estar além da
    // janela: existem JPEGs (Kitsu) com vários blocos EXIF/XMP de 64KB antes das
    // dimensões. Nesses, só o arquivo inteiro resolve. Se o corpo veio COMPLETO,
    // é formato que não sei ler — não adianta rebaixar.
    const truncado = res.status === 206
    if (!truncado) return null

    const full = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!full.ok) return null
    const len = Number(full.headers.get("content-length") ?? 0)
    if (len > MAX_FULL_BYTES) return null // capa absurda: não vale a banda

    const fullBuf = Buffer.from(await full.arrayBuffer())
    if (fullBuf.length > MAX_FULL_BYTES) return null
    const fullDims = parseImageHeader(fullBuf)
    if (!fullDims || fullDims.width <= 0 || fullDims.height <= 0) return null

    return { ...fullDims, bytes: totalBytesFrom(full.headers, fullBuf.length) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** Largura em que a capa já é nítida na página da obra; acima disso não melhora. */
const TARGET_WIDTH = 700
/**
 * Bits por pixel abaixo do qual a imagem está estourada (bloco/chuvisco visível).
 *
 * **O limiar é POR FORMATO, e isso não é preciosismo.** Medido nas 2.307 capas do
 * catálogo: JPEG tem bpp mediano 0,355 e WebP 0,158 — o WebP comprime ~2,2× melhor
 * pelo mesmo resultado visual. Um limiar único de 0,15 marcava como "estourada"
 * **45% de TODOS os WebP** (203 capas, 158 delas com 600px+), incluindo uma de
 * 771×1080 do AnimePlanet cujo recorte 1:1 está impecável. Como o AnimePlanet serve
 * tudo em WebP, o limiar único punia a fonte inteira.
 *
 * Os valores abaixo são calibrados pra MESMA taxa de suspeita (~3% das capas) nos
 * dois formatos. PNG é lossless (bpp mediano 1,8) e nunca dispara — não tem limiar.
 *
 * NÃO existe limiar de "bem comprimida" acima disso: qualquer bônus por bpp alto
 * inverte a ordem entre capas sadias (fazia uma de 512px ganhar de uma de 600px).
 */
const BLOWN_BPP: Partial<Record<CoverFormat, number>> = {
  jpeg: 0.15,
  webp: 0.07,
  gif: 0.15,
  // png: lossless — sem limiar de propósito
}

/**
 * 0 a 1. **Resolução ordena; compressão e proporção só PENALIZAM.**
 *
 * Resolução manda porque foi o único sinal que sobreviveu à medição do catálogo: a
 * melhor fonte (ComicK, mediana 720px) entrega miniatura em 12% dos casos, contra
 * 100% da MangaUpdates (275px) — justamente quem a ordem hardcoded escolhia primeiro.
 *
 * Compressão como BÔNUS foi tentada e descartada: fazia uma capa de 512px bem
 * comprimida ganhar de uma de 600px, ou seja, a conta preferia a imagem menor. Como
 * penalidade ela faz o que precisa — derruba o JPEG estourado (grande e feio ao mesmo
 * tempo) sem nunca inverter a ordem entre duas capas sadias.
 */
export function scoreCover(m: CoverMeasurement): number {
  const res = Math.min(1, m.width / TARGET_WIDTH)

  // Imagem estourada: bloco e chuvisco visíveis. Sem Content-Length (ou em formato
  // sem limiar, como PNG) assume sadia — não punir por falta de informação. É
  // penalidade binária de propósito: qualquer gradação aqui inverte a ordem entre
  // capas sadias.
  const px = m.width * m.height
  const limiar = BLOWN_BPP[m.format]
  const bpp = m.bytes != null && px > 0 ? m.bytes / px : null
  const quality = limiar != null && bpp != null && bpp < limiar ? 0.3 : 1

  // Fora da proporção de capa (~2:3) vai cortar feio no card.
  const ratio = m.height / m.width
  const shape = ratio >= 1.3 && ratio <= 1.7 ? 1 : 0.6

  return res * quality * shape
}
