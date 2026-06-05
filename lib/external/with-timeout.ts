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
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[withTimeout] ${label} excedeu ${ms}ms`)),
      ms,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
