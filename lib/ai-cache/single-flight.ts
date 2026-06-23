/**
 * Single-flight: deduplicação de chamadas IDÊNTICAS concorrentes EM PROCESSO
 * (plano §10).
 *
 *   Solicitação A (miss) → executa o provider.
 *   Solicitação B (mesma chave, enquanto A está em voo) → AGUARDA A.
 *   Resultado: uma chamada paga; ambas recebem o mesmo resultado.
 *
 * Escopo (plano §10.2): funciona dentro do MESMO processo Node. NÃO protege
 * múltiplas instâncias — execução distribuída precisaria de lock externo ou
 * constraint no banco (fora de escopo aqui).
 *
 * A promise em voo é removida em `finally` (sucesso OU erro), então:
 *  - erro não fica preso; nova tentativa após erro é permitida;
 *  - o resultado NÃO é guardado indefinidamente (isto não é cache — o cache
 *    persistente continua sendo a fonte de reaproveitamento entre processos).
 */

const inFlight = new Map<string, Promise<unknown>>()

export interface SingleFlightOptions {
  /** Chamado (síncrono) quando ESTA chamada aguardou uma já em voo (waiter). */
  onWaiter?: () => void
}

/**
 * Executa `operation` sob a chave `key`. Se já houver uma execução em voo para a
 * MESMA chave, aguarda-a em vez de iniciar outra. Chaves diferentes não colidem.
 */
export async function runSingleFlight<T>(
  key: string,
  operation: () => Promise<T>,
  opts?: SingleFlightOptions,
): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) {
    opts?.onWaiter?.()
    return existing
  }

  // IIFE async: invoca `operation()` imediatamente (corpo roda síncrono até o
  // primeiro await) e captura throw síncrono como rejeição — nada escapa.
  const p = (async () => operation())()
  inFlight.set(key, p)
  try {
    return await p
  } finally {
    // Só remove se ainda for ESTA promise (defensivo contra corrida).
    if (inFlight.get(key) === p) inFlight.delete(key)
  }
}

/** Nº de execuções em voo (telemetria/testes). */
export function inFlightCount(): number {
  return inFlight.size
}

/** Limpa o estado em voo. APENAS para testes. */
export function __resetSingleFlight(): void {
  inFlight.clear()
}
