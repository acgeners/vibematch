/**
 * Classificação ESTÁVEL de erros das chamadas de IA (plano §14).
 *
 * Função pura. Funciona em dois cenários:
 *  - AO VIVO (instrumentação): recebe o erro lançado, com `.status` numérico.
 *  - HISTÓRICO (linhas antigas de ai_api_calls): recebe só `error_message` —
 *    o status é extraído do início da mensagem do SDK Anthropic quando possível.
 *
 * Regra do plano: NÃO classificar qualquer 400 como erro de imagem. Imagem do
 * provider exige status 400 (ou ausente) E menção a image/media_type/base64.
 */

import type { AiCallStage, AiErrorCategory } from "./types"

export interface ClassifyAiErrorInput {
  /** Status HTTP, quando conhecido (ao vivo). Em linhas históricas vem null. */
  status?: number | null
  /** Mensagem de erro (sanitizada o suficiente — nunca passar prompt/base64). */
  message?: string | null
  /** Etapa do fluxo onde o erro ocorreu, quando conhecida. */
  stage?: AiCallStage | null
  /** stop_reason da resposta (ex.: "max_tokens"), quando houver. */
  stopReason?: string | null
}

/**
 * Extrai um status HTTP do começo da mensagem do SDK Anthropic.
 * Ex.: `400 {"type":"error",...}` → 400. Retorna null se não houver.
 * Restrito ao INÍCIO da string pra não capturar números no corpo do JSON.
 */
export function parseLeadingHttpStatus(message: string | null | undefined): number | null {
  if (!message) return null
  const m = /^\s*(\d{3})\b/.exec(message)
  if (!m) return null
  const code = Number(m[1])
  return code >= 100 && code <= 599 ? code : null
}

const IMAGE_RE = /\b(?:image|media_type|base64)\b/i
// Plano §14: "download"/"format" também são evidência de erro de imagem do provider.
// A mensagem real da Anthropic para capa inacessível é "Unable to download the
// file…" (SEM a palavra "image") — daí precisarmos do termo "download".
const IMAGE_DOWNLOAD_RE = /unable to download|failed to (?:download|fetch)|\b(?:download|format)\b/i
const DOWNLOAD_FAIL_RE = /unable to download|failed to (?:download|fetch)/i
const RATE_RE = /\b(?:rate.?limit|429|too many requests)\b/i
const OVERLOADED_RE = /\b(?:overloaded|529)\b/i
const TIMEOUT_RE = /\b(?:timeout|timed out|etimedout|esockettimedout|deadline)\b/i
const NETWORK_RE =
  /\b(?:econnreset|econnrefused|enotfound|epipe|socket hang ?up|network error|fetch failed|connection (?:error|closed))\b/i
const CANCELLED_RE = /\b(?:abort(?:ed)?|cancel(?:l?ed)?)\b/i
const ZOD_RE = /\b(?:zod|schema)\b|não atende ao schema|payload da tool/i
const STRUCT_RE =
  /submit_evaluation|tool_use|cortada por limite de tokens|não usou a tool|resposta cortada/i
const AUDIT_RE = /auditoria de uso de reviews|review_usage|enforceauditablereview/i

/**
 * Mapeia um erro para uma categoria estável. Determinístico: a mesma entrada
 * sempre dá a mesma saída.
 */
export function classifyAiError(input: ClassifyAiErrorInput): AiErrorCategory {
  const message = input.message ?? ""
  const status = input.status ?? parseLeadingHttpStatus(message)
  const stage = input.stage ?? null

  // Etapa explícita tem precedência sobre heurística de texto.
  if (stage === "audit") return "audit_rejected"
  if (stage === "structured_output") {
    return ZOD_RE.test(message) ? "schema_validation_failed" : "structured_output_invalid"
  }

  // Cancelamento (independe de status).
  if (CANCELLED_RE.test(message)) return "cancelled"

  // Erros do provider por status.
  if (status === 429 || RATE_RE.test(message)) return "provider_rate_limit"
  if (status === 529 || OVERLOADED_RE.test(message)) return "provider_overloaded"
  if (status != null && status >= 500 && status <= 599) return "provider_5xx"

  if (status === 400) {
    if (IMAGE_RE.test(message) || IMAGE_DOWNLOAD_RE.test(message)) {
      return "provider_image_invalid_request"
    }
    return "provider_invalid_request"
  }

  // Sem status confiável: só classifica como imagem com evidência FORTE de
  // download (evita confundir "image … timed out", que é timeout, com imagem).
  if (status == null && DOWNLOAD_FAIL_RE.test(message)) {
    return "provider_image_invalid_request"
  }
  if (TIMEOUT_RE.test(message)) return "provider_timeout"
  if (NETWORK_RE.test(message)) return "provider_network"
  if (AUDIT_RE.test(message)) return "audit_rejected"
  if (ZOD_RE.test(message)) return "schema_validation_failed"
  if (input.stopReason === "max_tokens" || STRUCT_RE.test(message)) return "structured_output_invalid"

  if (message.trim() === "") return "unknown"
  return "internal_error"
}

/**
 * Predicado ÚNICO de "erro de imagem do provider" (plano §7/§16). Fonte da
 * verdade compartilhada: o fluxo funcional (fallback sem imagem em
 * `isImageRelatedModelError`) e a telemetria usam ESTA mesma regra, sem divergir.
 *
 * Evidência aceita (§16): image / media_type / base64 / download / file / format,
 * exigindo status 400 (ou ausente, só com prova FORTE de download). NÃO amplia
 * qualquer 400 genérico para erro de imagem.
 */
export function isImageProviderError(input: ClassifyAiErrorInput): boolean {
  return classifyAiError(input) === "provider_image_invalid_request"
}
