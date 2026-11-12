/**
 * O laço do lote "Reviews do catálogo" (`/curation/settings?g=fontes`), PURO: as dependências
 * (a action, o "parar", o progresso) entram por argumento, e o painel só o liga à tela. Assim o
 * que decide parar, abortar e resumir é testável sem browser e sem banco.
 *
 * Uma obra por chamada: a busca leva ~37 s por obra (o Mangago faz uma requisição por review), e
 * o progresso e o "Parar" só andam entre uma chamada e outra.
 */

/**
 * As duas fontes que dependem do FlareSolverr (Docker) no Mac. Comix e Mangago falhando JUNTOS
 * numa obra é o sinal de bypass fora; uma só (link morto da Comix, por exemplo) é problema da obra.
 * Medido em 11/11: 12 obras com link da Comix devolvendo 404, e 9 delas com o Mangago respondendo.
 */
export const FLARESOLVERR_REVIEW_SOURCES = ["comix", "mangago"] as const

/** Quantas obras seguidas com o bypass fora (ou com erro) fazem o lote abortar sozinho. */
export const BROKEN_STREAK_TO_ABORT = 3

/** Resultado de UMA obra (o que `refreshReviewsForWorks` devolve). */
export interface ReviewBatchWorkResult {
  workId: string
  /** `false` = sem vínculo aceito; nada foi buscado. */
  attempted: boolean
  /** Reviews úteis a mais depois da busca (💬 depois − 💬 antes). */
  gained: number
  /** Fontes que falharam (timeout/erro). */
  failedSources: string[]
  /** `reviews_checked_at` gravado — só quando nenhuma fonte falhou. */
  checked: boolean
  error?: string
}

export interface ReviewBatchDeps {
  /** Busca UMA obra. Lista vazia = o servidor recusou (sem permissão / sessão expirada). */
  refresh: (workId: string) => Promise<ReviewBatchWorkResult[]>
  /** Consultado ANTES de cada obra; `true` encerra o lote com o que já rodou. */
  shouldStop: () => boolean
  onProgress?: (done: number, total: number) => void
}

export interface ReviewBatchOutcome {
  results: ReviewBatchWorkResult[]
  /** Quantas obras o lote tinha para percorrer. */
  total: number
  stoppedByUser: boolean
  /** Por que o lote parou sozinho; `null` = rodou até o fim (ou a pessoa parou). */
  abortedReason: string | null
}

/** A obra mostra o bypass fora: as duas fontes do FlareSolverr falharam juntas. */
export function bypassLooksDown(result: ReviewBatchWorkResult): boolean {
  return FLARESOLVERR_REVIEW_SOURCES.every((s) => result.failedSources.includes(s))
}

export async function runCatalogReviewBatch(
  ids: readonly string[],
  deps: ReviewBatchDeps,
): Promise<ReviewBatchOutcome> {
  const total = ids.length
  const results: ReviewBatchWorkResult[] = []
  let streak = 0
  deps.onProgress?.(0, total)
  for (const id of ids) {
    if (deps.shouldStop()) return { results, total, stoppedByUser: true, abortedReason: null }
    const res = await deps.refresh(id)
    // 🔴 A action devolve `[]` sem lançar quando o gate de admin recusa. Sem o throw, o lote
    // seguiria até o fim e anunciaria "pronto" para uma busca que não aconteceu.
    if (res.length === 0) throw new Error("nenhuma obra foi buscada (sem permissão ou sessão expirada)")
    const r = res[0]
    results.push(r)
    deps.onProgress?.(results.length, total)

    const broken = r.error != null || bypassLooksDown(r)
    streak = broken ? streak + 1 : 0
    if (streak >= BROKEN_STREAK_TO_ABORT) {
      const abortedReason = r.error
        ? `${BROKEN_STREAK_TO_ABORT} obras seguidas com erro (${r.error}). Parei para não seguir sem gravar nada.`
        : `Comix e Mangago falharam juntos em ${BROKEN_STREAK_TO_ABORT} obras seguidas: o FlareSolverr (Docker) ` +
          `parece fora do ar. Parei para não gastar horas sem gravar nada; as que faltam ficam para a próxima.`
      return { results, total, stoppedByUser: false, abortedReason }
    }
  }
  return { results, total, stoppedByUser: false, abortedReason: null }
}

export interface ReviewBatchSummary {
  /** Obras buscadas nesta execução. */
  processed: number
  /** Quantas ganharam ao menos uma review útil. */
  worksWithGain: number
  /** Total de reviews úteis novas. */
  totalGained: number
  /** As que mais ganharam (até 10), da maior para a menor. */
  top: Array<{ title: string; gained: number }>
  /** As que não foram verificadas por inteiro, com o porquê. */
  failed: Array<{ title: string; reason: string }>
  stoppedByUser: boolean
  abortedReason: string | null
  /** Quantas ficaram sem buscar (parou antes do fim). */
  remaining: number
}

export function summarizeReviewBatch(
  outcome: ReviewBatchOutcome,
  titleById: ReadonlyMap<string, string>,
): ReviewBatchSummary {
  const title = (id: string) => titleById.get(id) ?? id
  const withGain = outcome.results.filter((r) => r.gained > 0)
  return {
    processed: outcome.results.length,
    worksWithGain: withGain.length,
    totalGained: withGain.reduce((s, r) => s + r.gained, 0),
    top: [...withGain]
      .sort((a, b) => b.gained - a.gained)
      .slice(0, 10)
      .map((r) => ({ title: title(r.workId), gained: r.gained })),
    failed: outcome.results
      .filter((r) => !r.checked)
      .map((r) => ({
        title: title(r.workId),
        reason: r.error ?? (r.failedSources.length > 0 ? r.failedSources.join(", ") : "não verificada"),
      })),
    stoppedByUser: outcome.stoppedByUser,
    abortedReason: outcome.abortedReason,
    remaining: outcome.total - outcome.results.length,
  }
}
