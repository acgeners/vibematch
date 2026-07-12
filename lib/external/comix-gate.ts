import { isFlareSolverrCircuitOpen } from "./flaresolverr"

/**
 * ComixGate — fonte ÚNICA da saúde observada do Comix.
 *
 * Antes, o estado de "o Comix está utilizável?" vivia espalhado em 3 lugares
 * descoordenados: o circuit-breaker do FlareSolverr ([flaresolverr.ts] —
 * container fora), o circuit-breaker de auth do Comix ([comix.ts] — API exige
 * token) e as falhas de rede/CF por-call (sem estado). Cada falha morria num
 * `console.error` 1×/processo, sem visibilidade agregada.
 *
 * Este módulo é PASSIVO: não faz nenhuma chamada de rede. Ele só OBSERVA os
 * desfechos reais do tráfego (`recordComixOk`/`recordComixFailure`, fiados no
 * choke point de log do comix.ts) pra derivar o status em `getComixStatus()`.
 * Alimenta a telemetria persistente (fase 2) e a notificação no chrome (fase 3).
 *
 * O circuito do FlareSolverr NÃO entra mais na derivação do estado: a Comix
 * responde em texto puro e não depende dele (medido — com o circuito ABERTO,
 * detalhe e reviews vêm normais). Enquanto entrava, um FlareSolverr fora
 * rebaixava a Comix a `degraded` mesmo com ela 100% de pé, o que travava o
 * `ensureComixReady` (exige `ok`) e, com ele, a cascata do "Gerar tudo".
 *
 * Complementa — não substitui — o `checkComixHealth` ativo (probe por canário
 * sob demanda): aqui é o que o tráfego real já revelou, sem custo.
 */

/** Motivo de uma falha do Comix. Owner deste tipo é o gate (saúde). */
export type ComixFailure =
  | "cloudflare_challenge"
  | "http_error"
  | "json_parse_error"
  | "flaresolverr_unavailable"
  | "network_error"
  | "api_auth_required"

export type ComixHealthState = "ok" | "degraded" | "down" | "unknown"

export interface ComixStatus {
  /**
   * - `ok`: último desfecho recente foi sucesso, sem breakers ativos.
   * - `degraded`: falhas seguidas do PRÓPRIO tráfego da Comix — algumas chamadas
   *   devem estar voltando vazias, mas pode se recuperar sozinho. (Um FlareSolverr
   *   fora NÃO rebaixa mais: ele não é dependência da Comix.)
   * - `down`: muro de token da API (`api_auth_required`) ativo — Comix inutilizável
   *   até o TTL reabrir / a API voltar a ser pública.
   * - `unknown`: nenhum tráfego de Comix neste processo ainda.
   */
  state: ComixHealthState
  lastOkAt: number | null
  lastFailAt: number | null
  failReason: ComixFailure | null
  /** Falhas consecutivas desde o último sucesso. */
  consecutiveFails: number
  /** Circuito do FlareSolverr aberto (container falhou recentemente). */
  flaresolverrCircuitOpen: boolean
  /** Muro de token da API do Comix detectado recentemente (busca gateada). */
  authGated: boolean
}

// Espelha COMIX_AUTH_CIRCUIT_TTL_MS (comix.ts): janela em que um `api_auth_required`
// recente ainda significa "API gateada". Mantenha em sincronia.
const AUTH_GATED_TTL_MS = 30 * 60_000
// A partir de quantas falhas consecutivas consideramos o serviço "degraded"
// (mesmo sem breaker formal aberto — ex.: CF desafiando e o solve falhando).
const DEGRADED_FAIL_THRESHOLD = 3

let lastOkAt: number | null = null
let lastFailAt: number | null = null
let lastFailReason: ComixFailure | null = null
let consecutiveFails = 0

// Heartbeat da persistência: mesmo sem mudança de estado, re-grava de tempos em
// tempos pra manter os timestamps (last_ok_at) frescos no DB.
const PERSIST_HEARTBEAT_MS = 5 * 60_000
let lastPersistedState: ComixHealthState | null = null
let lastPersistAt = 0

/**
 * Persiste o status no DB (migration 098) fire-and-forget, SÓ em mudança de
 * estado ou no heartbeat — não a cada chamada (o enrich bate no Comix N×). O
 * store é carregado por dynamic import (server-only) e engole erros; telemetria
 * nunca quebra o scraping. No-op fora do servidor (sem store).
 */
function maybePersist(): void {
  const status = getComixStatus()
  const now = Date.now()
  if (status.state === lastPersistedState && now - lastPersistAt < PERSIST_HEARTBEAT_MS) return
  lastPersistedState = status.state
  lastPersistAt = now
  void import("./source-health-store")
    .then((m) =>
      m.upsertSourceHealth("comix", {
        status: status.state,
        lastOkAt: status.lastOkAt,
        lastFailAt: status.lastFailAt,
        failReason: status.failReason,
        consecutiveFails: status.consecutiveFails,
      }),
    )
    .catch(() => {})
}

/** Registra um desfecho de SUCESSO de uma chamada ao Comix. */
export function recordComixOk(): void {
  lastOkAt = Date.now()
  consecutiveFails = 0
  // Um sucesso PROVA que o muro de token / a falha anterior caiu. Limpa o sinal
  // de falha pra `authGated` (e o fallback "degraded" por lastFailAt) não manter
  // o estado preso em "down"/"degraded" por todo o TTL apesar do tráfego voltar.
  // É o que torna o canário ("Testar agora") uma recuperação imediata.
  lastFailReason = null
  lastFailAt = null
  maybePersist()
}

/** Registra uma FALHA de uma chamada ao Comix (qualquer superfície). */
export function recordComixFailure(reason: ComixFailure): void {
  lastFailAt = Date.now()
  lastFailReason = reason
  consecutiveFails += 1
  maybePersist()
}

/** Status atual do Comix, derivado do tráfego observado + circuito do FlareSolverr.
 *  PASSIVO: não faz nenhuma chamada de rede. */
export function getComixStatus(): ComixStatus {
  const flaresolverrCircuitOpen = isFlareSolverrCircuitOpen()
  const authGated =
    lastFailReason === "api_auth_required" &&
    lastFailAt != null &&
    Date.now() - lastFailAt < AUTH_GATED_TTL_MS

  const state: ComixHealthState = authGated
    ? "down"
    : consecutiveFails >= DEGRADED_FAIL_THRESHOLD
      ? "degraded"
      : lastOkAt != null
        ? "ok"
        : lastFailAt != null
          ? "degraded"
          : "unknown"

  return {
    state,
    lastOkAt,
    lastFailAt,
    failReason: lastFailReason,
    consecutiveFails,
    flaresolverrCircuitOpen,
    authGated,
  }
}
