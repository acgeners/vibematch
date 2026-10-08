/**
 * Limita o tempo de ESPERA por uma promise sem cancelar o trabalho subjacente.
 *
 * Usado para envolver cada fonte externa dentro dos `Promise.allSettled` da
 * busca de contexto da avaliação IA: como `allSettled` espera a fonte mais
 * lenta, um único scraper travado (AnimePlanet/MangaUpdates fazem scraping de
 * HTML) somava dezenas de segundos mortos. Com o timeout, a fonte lenta vira
 * uma rejeição e cai fail-soft (igual ao tratamento de `rejected` já existente),
 * enquanto as demais fontes seguem normalmente.
 *
 * Observação: `Promise.race` apenas para de ESPERAR — o fetch pendente continua
 * em background e resolve/rejeita depois, inofensivamente, pois o resultado
 * tardio é descartado. Para cancelar de fato a request seria preciso threadar
 * um `AbortSignal` em cada fetcher (mais invasivo).
 */
/**
 * O timeout DESTE wrapper — e só ele. Classe própria para quem precisa separar "a fonte
 * demorou demais" de "a fonte falhou" (ex.: o `delivery_timeout` da Comix), sem casar mensagem.
 */
export class WithTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly ms: number,
  ) {
    super(`[withTimeout] ${label} excedeu ${ms}ms`)
    this.name = "WithTimeoutError"
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new WithTimeoutError(label, ms)),
      ms,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
