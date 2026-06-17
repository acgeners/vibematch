import "server-only"

import { isBlockedCoverUrl, recordCoverHostResult } from "@/lib/external/blocked-covers"
import { isAllowedCoverHost, refererFor, userAgentFor } from "./cover-host-policy"

// Pré-busca da capa NO NOSSO servidor para enviar à Anthropic em base64, em vez
// de mandar a URL (que a Anthropic baixa e falha em hosts com Cloudflare/hotlink
// → 400 "Unable to download"). Server-only: nunca deve entrar no bundle client.

export type SupportedImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp"

export interface ModelCoverImage {
  /** Base64 (sem prefixo data:) pronto pro bloco image/base64 da Anthropic. */
  data: string
  mediaType: SupportedImageMediaType
  originalBytes: number
  /** Igual a originalBytes enquanto não houver recompressão (sharp ausente). */
  finalBytes: number
}

// Limite ~4,5 MB (abaixo do teto de 5 MB da Anthropic para imagem base64).
const MAX_IMAGE_BYTES = Math.floor(4.5 * 1024 * 1024)
const FETCH_TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3
const ACCEPT_HEADER = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"

/**
 * Detecta o formato REAL pela assinatura de bytes (magic numbers), sem confiar no
 * Content-Type. Retorna null para SVG/AVIF/HTML/octet-stream-não-imagem/etc.
 */
export function detectImageMediaType(bytes: Uint8Array): SupportedImageMediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png"
  }
  // "GIF87a" / "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return "image/gif"
  }
  // "RIFF"...."WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

/** Lê o body respeitando o limite, abortando o stream ao ultrapassar (sem bufferizar tudo). */
async function readCappedBytes(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader?.()
  if (!reader) {
    // Sem stream (ambientes/mocks): cai no arrayBuffer mas ainda respeita o teto.
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.length > maxBytes ? null : buf
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

interface PolicyFetchResult {
  res: Response | null
  host: string
  reason?: "host_not_allowed" | "too_many_redirects" | "bad_redirect"
}

/** Segue redirects manualmente, validando o host de CADA hop contra a allowlist. */
async function fetchWithHostPolicy(initialUrl: URL, signal: AbortSignal): Promise<PolicyFetchResult> {
  let url = initialUrl
  for (let redirects = 0; ; redirects += 1) {
    const host = url.hostname.toLowerCase()
    if (!isAllowedCoverHost(host)) return { res: null, host, reason: "host_not_allowed" }

    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        Accept: ACCEPT_HEADER,
        Referer: refererFor(host, url.origin),
        "User-Agent": userAgentFor(host),
      },
    })

    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.get("location") != null
    if (!isRedirect) return { res, host }

    if (redirects >= MAX_REDIRECTS) return { res: null, host, reason: "too_many_redirects" }
    const location = res.headers.get("location") as string
    let next: URL
    try {
      next = new URL(location, url)
    } catch {
      return { res: null, host, reason: "bad_redirect" }
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      return { res: null, host, reason: "bad_redirect" }
    }
    url = next
  }
}

function logCoverResult(fields: Record<string, string | number | boolean>): void {
  // Nunca logar base64 nem a URL (pode ter token/assinatura) — só host/métricas.
  console.log("[cover-fetch]", JSON.stringify(fields))
}

/**
 * Busca e valida a capa no servidor; retorna base64 + media_type, ou null quando
 * deve-se avaliar SEM imagem (URL inválida, host fora da allowlist, host bloqueado,
 * timeout, tamanho/formato inválido). Nunca lança — falha vira null.
 */
export async function fetchCoverForModel(rawUrl: string): Promise<ModelCoverImage | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const host = url.hostname.toLowerCase()
  if (!isAllowedCoverHost(host)) return null
  // Host com bloqueio temporário recente (TTL) → nem tenta.
  if (isBlockedCoverUrl(rawUrl)) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const { res, host: finalHost, reason } = await fetchWithHostPolicy(url, controller.signal)
    if (!res) {
      if (reason === "host_not_allowed" || reason === "bad_redirect") {
        logCoverResult({ cover_fetch_result: "blocked_redirect", cover_host: finalHost })
      }
      return null
    }
    if (!res.ok) {
      recordCoverHostResult(finalHost, false)
      logCoverResult({ cover_fetch_result: "http_error", cover_host: finalHost, status: res.status })
      return null
    }

    // Nível 1 de proteção de tamanho: Content-Length quando disponível.
    const contentLength = Number(res.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      recordCoverHostResult(finalHost, false)
      logCoverResult({ cover_fetch_result: "too_large_header", cover_host: finalHost, cover_original_bytes: contentLength })
      return null
    }

    // Nível 2: streaming com corte ao ultrapassar o limite.
    const bytes = await readCappedBytes(res, MAX_IMAGE_BYTES)
    if (!bytes) {
      recordCoverHostResult(finalHost, false)
      logCoverResult({ cover_fetch_result: "too_large_stream", cover_host: finalHost })
      return null
    }

    const mediaType = detectImageMediaType(bytes)
    if (!mediaType) {
      // Tipo não suportado (svg/avif/html/octet-stream sem assinatura de imagem).
      recordCoverHostResult(finalHost, false)
      logCoverResult({ cover_fetch_result: "unsupported_type", cover_host: finalHost, cover_original_bytes: bytes.length })
      return null
    }

    recordCoverHostResult(finalHost, true)
    logCoverResult({
      cover_fetch_result: "ok",
      cover_host: finalHost,
      cover_fetch_duration_ms: Date.now() - startedAt,
      cover_original_bytes: bytes.length,
      cover_final_bytes: bytes.length,
      cover_media_type: mediaType,
    })
    return {
      data: Buffer.from(bytes).toString("base64"),
      mediaType,
      originalBytes: bytes.length,
      finalBytes: bytes.length,
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError"
    logCoverResult({ cover_fetch_result: aborted ? "timeout" : "fetch_error", cover_host: host })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Erro do MODELO relacionado à imagem (status 400 + menção a image/media_type/base64).
 * Focado de propósito: NÃO dispara para rate limit, auth, timeout geral, validação
 * de resposta estruturada ou indisponibilidade — só para problemas da própria imagem.
 */
export function isImageRelatedModelError(err: unknown): boolean {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: unknown }).status
      : undefined
  if (status !== 400) return false
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : ""
  return /\b(?:image|media_type|base64)\b/i.test(message)
}
