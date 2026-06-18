/**
 * Mapeia o resultado interno do prefetch de capa
 * (lib/server/covers/fetch-cover-for-model.ts → `cover_fetch_result`) para o
 * status estável de imagem usado na telemetria. Função pura.
 *
 * Os nomes de `cover_fetch_result` hoje só vão pro console; a instrumentação
 * (Commit 2) passa a anexá-los ao metadata e este mapper os normaliza.
 */

import type { AiImageStatus } from "./types"

const COVER_RESULT_TO_STATUS: Record<string, AiImageStatus> = {
  ok: "fetch_success",
  blocked_redirect: "blocked_redirect",
  http_error: "http_error",
  too_large_header: "too_large",
  too_large_stream: "too_large",
  unsupported_type: "unsupported_format",
  timeout: "fetch_timeout",
  fetch_error: "fetch_error",
}

export function imageStatusFromCoverResult(result: string | null | undefined): AiImageStatus {
  if (!result) return "unknown"
  return COVER_RESULT_TO_STATUS[result] ?? "unknown"
}
