/**
 * Backoff exponencial com jitter (plano §13/§14). PURO e determinístico sob
 * `random` injetável (testes). Não usa Date nem Math.random implicitamente quando
 * `random` é fornecido.
 *
 * Só é exercido se um dia ligarmos retry central (hoje o SDK faz o backoff de
 * rede). Mantido testado para não virar número mágico no futuro.
 */

import type { AiRetryPolicy } from "./types"

export interface BackoffOptions {
  /** Gerador [0,1). Injete nos testes; default Math.random. */
  random?: () => number
  /** `Retry-After` do provider em ms (respeitado se a política permitir). */
  retryAfterMs?: number | null
}

/**
 * Delay (ms) ANTES da tentativa de índice `attempt` (0-based: 0 = antes do 1º
 * retry). `Retry-After` tem precedência quando honrado. Jitter centrado:
 * random=0.5 → delay base; 0 → −jitterRatio; 1 → +jitterRatio. Clampado a
 * [0, maxDelayMs].
 */
export function computeBackoffMs(
  attempt: number,
  policy: AiRetryPolicy,
  opts?: BackoffOptions,
): number {
  if (policy.honorRetryAfter && opts?.retryAfterMs != null && opts.retryAfterMs >= 0) {
    return Math.min(opts.retryAfterMs, policy.maxDelayMs)
  }
  const exp = policy.baseDelayMs * 2 ** Math.max(0, attempt)
  const capped = Math.min(exp, policy.maxDelayMs)
  const rand = opts?.random ? opts.random() : Math.random()
  const factor = 1 - policy.jitterRatio + 2 * policy.jitterRatio * rand
  const jittered = capped * factor
  return Math.max(0, Math.min(Math.round(jittered), policy.maxDelayMs))
}
