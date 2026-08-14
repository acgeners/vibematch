/**
 * `Promise.all` com teto de itens EM VOO. Existe por causa de um modo de falha
 * medido (2026-08-12): num fan-out irrestrito, o timeout de cada item começa a
 * correr no instante do disparo, mas quem atende é uma fila estreita — então o
 * "teto por item" vira, na prática, um orçamento de relógio para o LOTE INTEIRO,
 * e tudo que não couber nele falha junto.
 *
 * Foi assim que "Verificar atualizações" reprovou 29 de 38 obras: as 38 saíram
 * de uma vez, o bypass de Cloudflare atende 3 por vez (sidecar) ou 1 por vez
 * (FlareSolverr, sessão nomeada serializada), e dos 74 renders que completaram
 * apenas 27 chegaram dentro dos 25s — os demais encontraram o timeout já
 * disparado. Com teto, cada item só começa a contar quando de fato começa, e o
 * timeout volta a significar o que o nome diz.
 *
 * ⚠️ Preserva a ORDEM da entrada na saída (o chamador costuma casar índice com
 * item) e NÃO engole erro: uma rejeição derruba o todo, igual ao `Promise.all`
 * que ela substitui. Quem quiser fail-soft trata dentro do `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const teto = Math.max(1, Math.floor(limit))
  const out = new Array<R>(items.length)
  let proximo = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = proximo++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: Math.min(teto, items.length) }, worker))
  return out
}
