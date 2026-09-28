/**
 * Transição do RÓTULO (`user_score`) — o ponto único onde uma escrita de nota vira evidência
 * prospectiva.
 *
 * Até aqui cada caminho de escrita decidia sozinho se capturava a previsão, se resolvia os
 * snapshots e o que fazer quando a nota sumia. O mapa medido em 2026-09-27:
 *   - criar a obra já com nota, importar lista externa → nunca capturavam;
 *   - `updateWork`/`updateWorkStatus` capturavam DEPOIS de gravar a nota e, quando a nota era
 *     apagada, só carimbavam `label_changed_at` — que nenhuma métrica filtra; `clearUserRating`
 *     e a nota rápida, no mesmo fato, DESCARTAVAM a medição. Dois critérios pro mesmo fato.
 *   - a captura lia `calculated_scores`, que é a previsão do DONO, para qualquer usuário.
 *
 * Aqui a regra é uma só, e a ORDEM é a invariante:
 *   1. lê a nota anterior das obras tocadas;
 *   2. para as que vão de NULL → valor, lê a previsão do usuário — ANTES de gravar;
 *   3. grava a nota;
 *   4. só se a gravação deu certo: registra a 1ª nota no ledger, resolve/relabela snapshots,
 *      ou descarta a medição quando a nota foi apagada.
 * Ler depois de gravar deixaria uma janela em que um recálculo já incluiu o rótulo; registrar
 * antes de gravar deixaria uma linha afirmando uma nota que talvez nunca tenha existido.
 *
 * 🔴 NULL → valor NÃO basta para dizer "1ª nota". Uma obra avaliada e depois apagada volta a
 * NULL — e o modelo já treinou com aquela nota. Se ela reaparecer no /ranking nesse intervalo, os
 * snapshots novos seriam resolvidos como medição prospectiva válida. Por isso o ramo "1ª nota"
 * pergunta ao HISTÓRICO se já houve nota (`readPriorLabelEvidence`): havendo, a obra é
 * REAVALIADA — nenhuma linha nova no ledger, e os snapshots desta nota são resolvidos e
 * descartados na hora (resolver antes é exigência da mig 168: `discarded_at` só em resolvido).
 *
 * Telemetria nunca derruba a escrita: toda falha daqui é LOGADA com prefixo `[ledger]` e a nota
 * segue gravada. Falha ao ler a previsão vira `capture_status = "failed"` com a mensagem — não
 * um NULL indistinguível de "não havia previsão".
 */

export type LabelChange = "first" | "updated" | "removed" | "none"

/** Número ou NULL; o PostgREST devolve `numeric` como string em alguns caminhos. */
export function toScore(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * `next === undefined` = o patch não toca a nota (favoritar, capítulos…) — nada a fazer.
 */
export function classifyLabelChange(prev: unknown, next: unknown): LabelChange {
  if (next === undefined) return "none"
  const p = toScore(prev)
  const n = toScore(next)
  if (p == null && n == null) return "none"
  if (p == null) return "first"
  if (n == null) return "removed"
  return p === n ? "none" : "updated"
}

export type CaptureStatus = "captured" | "no_prediction" | "failed"

/** A previsão do usuário para UMA obra, lida imediatamente antes da 1ª nota. */
export interface PreRatingPrediction {
  status: CaptureStatus
  expected: number | null
  decision: number | null
  calc: number | null
  personalFit: number | null
  personalFitPercentile: number | null
  isStub: boolean
  calculatedAt: string | null
  error: string | null
}

export const NO_PREDICTION: PreRatingPrediction = {
  status: "no_prediction",
  expected: null,
  decision: null,
  calc: null,
  personalFit: null,
  personalFitPercentile: null,
  isStub: true,
  calculatedAt: null,
  error: null,
}

export function failedPrediction(error: string): PreRatingPrediction {
  return { ...NO_PREDICTION, status: "failed", error }
}

/** Linha do ledger: colunas da mig 101 (sempre) + as da mig 200 (quando aplicada). */
export interface LedgerRow {
  user_id: string
  work_id: string
  predicted_expected: number | null
  predicted_decision: number | null
  predicted_is_stub: boolean
  user_score: number
  train_size_at_capture: number | null
  predicted_calc: number | null
  predicted_personal_fit: number | null
  predicted_personal_fit_percentile: number | null
  prediction_calculated_at: string | null
  capture_status: CaptureStatus
  capture_source: string
  capture_error: string | null
  /** Mig 168 (já aplicada). Preenchido só quando a observação nasce fora das métricas. */
  discarded_at: string | null
}

export const LEGACY_LEDGER_COLUMNS = [
  "user_id",
  "work_id",
  "predicted_expected",
  "predicted_decision",
  "predicted_is_stub",
  "user_score",
  "train_size_at_capture",
] as const

export function buildLedgerRow(args: {
  userId: string
  workId: string
  userScore: number
  prediction: PreRatingPrediction
  trainSize: number | null
  source: string
  discardedAt?: string | null
}): LedgerRow {
  const p = args.prediction
  return {
    user_id: args.userId,
    work_id: args.workId,
    predicted_expected: p.expected,
    predicted_decision: p.decision,
    predicted_is_stub: p.isStub,
    user_score: args.userScore,
    train_size_at_capture: args.trainSize,
    predicted_calc: p.calc,
    predicted_personal_fit: p.personalFit,
    predicted_personal_fit_percentile: p.personalFitPercentile,
    prediction_calculated_at: p.calculatedAt,
    capture_status: p.status,
    capture_source: args.source,
    capture_error: p.error,
    discarded_at: args.discardedAt ?? null,
  }
}

export function toLegacyLedgerRow(row: LedgerRow): Record<string, unknown> {
  const legacy: Record<string, unknown> = Object.fromEntries(LEGACY_LEDGER_COLUMNS.map((c) => [c, row[c]]))
  // `discarded_at` é da mig 168 (aplicada): sem a mig 200, é ele que mantém uma observação
  // indeterminada fora das métricas.
  if (row.discarded_at != null) legacy.discarded_at = row.discarded_at
  return legacy
}

/** Prefixo estável de `capture_error` quando o HISTÓRICO da obra não pôde ser lido. */
export const HISTORY_UNREADABLE = "historico_ilegivel"

export interface LabelTransitionDeps {
  /** Nota ANTERIOR de cada obra (ausência de linha = NULL). */
  readPrevScores(workIds: string[]): Promise<{ ok: true; scores: Map<string, number | null> } | { ok: false; error: string }>
  /**
   * Das obras em NULL → valor, quais JÁ tiveram nota antes (linha no ledger, ou snapshot já
   * resolvido). O estado atual `user_score = NULL` não distingue "nunca" de "apagada".
   */
  readPriorLabelEvidence(workIds: string[]): Promise<Set<string>>
  /** Previsão do usuário para as obras que vão ganhar a 1ª nota. Nunca lança: falha vira `failed`. */
  readPreRatingPredictions(workIds: string[]): Promise<{ predictions: Map<string, PreRatingPrediction>; trainSize: number | null }>
  recordFirstRatings(rows: LedgerRow[]): Promise<void>
  resolveLabel(workId: string, score: number): Promise<unknown>
  discardLabel(workId: string): Promise<unknown>
  log(message: string): void
}

export interface LabelTransitionReport {
  first: string[]
  /** NULL → valor numa obra que JÁ teve nota: não é prospectiva. */
  revived: string[]
  /** NULL → valor sem histórico legível: não dá pra afirmar que é a 1ª nota ⇒ fora das métricas. */
  indeterminate: string[]
  updated: string[]
  removed: string[]
  /** true quando a nota anterior não pôde ser lida — nenhuma transição foi aplicada. */
  unclassified: boolean
}

/**
 * Envolve a escrita. `nextScore === undefined` ⇒ passa direto (o patch não toca a nota).
 * A escrita SEMPRE acontece; o que depende das leituras é só a telemetria.
 */
export async function writeWithLabelTransitions<T extends { error: string | null }>(args: {
  userId: string
  workIds: string[]
  nextScore: unknown
  source: string
  write: () => Promise<T>
  deps: LabelTransitionDeps
}): Promise<{ result: T; report: LabelTransitionReport }> {
  const report: LabelTransitionReport = { first: [], revived: [], indeterminate: [], updated: [], removed: [], unclassified: false }
  const ids = Array.from(new Set(args.workIds.filter(Boolean)))
  if (args.nextScore === undefined || ids.length === 0) {
    return { result: await args.write(), report }
  }
  const next = toScore(args.nextScore)

  // 1. Nota anterior. Sem ela não dá pra saber se é a PRIMEIRA — melhor não afirmar nada do que
  // afirmar errado; a escrita segue, e o log diz o que ficou sem medir.
  let prev: Map<string, number | null> | null = null
  try {
    const r = await args.deps.readPrevScores(ids)
    if (r.ok) prev = r.scores
    else args.deps.log(`[ledger] nota anterior ilegível (${args.source}): ${r.error} — ${ids.length} obra(s) sem transição classificada`)
  } catch (err) {
    args.deps.log(`[ledger] nota anterior ilegível (${args.source}): ${err instanceof Error ? err.message : String(err)}`)
  }

  if (prev) {
    for (const id of ids) {
      const change = classifyLabelChange(prev.get(id) ?? null, args.nextScore)
      if (change === "first") report.first.push(id)
      else if (change === "updated") report.updated.push(id)
      else if (change === "removed") report.removed.push(id)
    }
  } else {
    report.unclassified = true
  }

  // 1b. Já houve nota? Só para as candidatas a 1ª nota — edições e patches sem nota não pagam.
  // 🔴 Falha na leitura NÃO é "nunca avaliada": seria uma tentativa falha mascarada de sucesso, e a
  // observação entraria nas métricas como 1ª medição legítima. Sem histórico legível a transição é
  // INDETERMINADA: a nota é gravada, e a observação nasce FALHA e descartada.
  let historyError: string | null = null
  if (report.first.length > 0) {
    let prior: Set<string> | null = null
    try {
      prior = await args.deps.readPriorLabelEvidence(report.first)
    } catch (err) {
      historyError = err instanceof Error ? err.message : String(err)
      args.deps.log(`[ledger] histórico de nota ilegível (${args.source}): ${historyError} — ${report.first.length} obra(s) INDETERMINADA(s), fora das métricas`)
    }
    if (prior == null) {
      report.indeterminate = report.first
      report.first = []
    } else {
      const known = prior
      report.revived = report.first.filter((id) => known.has(id))
      report.first = report.first.filter((id) => !known.has(id))
    }
  }

  // 2. Previsão — ANTES de gravar a nota.
  let predictions = new Map<string, PreRatingPrediction>()
  let trainSize: number | null = null
  if (report.first.length > 0) {
    try {
      const r = await args.deps.readPreRatingPredictions(report.first)
      predictions = r.predictions
      trainSize = r.trainSize
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      for (const id of report.first) predictions.set(id, failedPrediction(msg))
    }
  }

  // 3. A nota.
  const result = await args.write()
  if (result.error) return { result, report: { first: [], revived: [], indeterminate: [], updated: [], removed: [], unclassified: report.unclassified } }

  // 4. Telemetria — só depois de a nota existir de fato.
  if (report.first.length > 0 && next != null) {
    const rows = report.first.map((id) =>
      buildLedgerRow({
        userId: args.userId,
        workId: id,
        userScore: next,
        prediction: predictions.get(id) ?? failedPrediction("previsão não lida"),
        trainSize,
        source: args.source,
      }),
    )
    try {
      await args.deps.recordFirstRatings(rows)
    } catch (err) {
      args.deps.log(`[ledger] 1ª nota NÃO registrada (${args.source}, ${rows.length} obra(s)): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const id of [...report.first, ...report.updated]) {
    if (next == null) continue
    try {
      await args.deps.resolveLabel(id, next)
    } catch (err) {
      args.deps.log(`[ledger] resolução falhou (${id}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // Indeterminadas: linha FALHA e já descartada no ledger (a unique ocupa o lugar — ignoreDuplicates
  // preserva uma linha anterior, se houver), e os snapshots desta transição saem das métricas.
  if (report.indeterminate.length > 0 && next != null) {
    const now = new Date().toISOString()
    const rows = report.indeterminate.map((id) =>
      buildLedgerRow({
        userId: args.userId,
        workId: id,
        userScore: next,
        prediction: failedPrediction(`${HISTORY_UNREADABLE}: ${historyError ?? "erro desconhecido"}`),
        trainSize: null,
        source: args.source,
        discardedAt: now,
      }),
    )
    try {
      await args.deps.recordFirstRatings(rows)
    } catch (err) {
      args.deps.log(`[ledger] observação indeterminada NÃO registrada (${args.source}): ${err instanceof Error ? err.message : String(err)}`)
    }
    for (const id of report.indeterminate) {
      try {
        await args.deps.resolveLabel(id, next)
        await args.deps.discardLabel(id)
      } catch (err) {
        args.deps.log(`[ledger] snapshots da transição indeterminada não descartados (${id}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Reavaliadas: os snapshots tirados enquanto a obra estava sem nota são resolvidos (histórico)
  // e descartados — não viram medição. Nenhuma linha nova no ledger.
  for (const id of report.revived) {
    if (next == null) continue
    try {
      await args.deps.resolveLabel(id, next)
      await args.deps.discardLabel(id)
    } catch (err) {
      args.deps.log(`[ledger] reavaliação não descartada (${id}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const id of report.removed) {
    try {
      await args.deps.discardLabel(id)
    } catch (err) {
      args.deps.log(`[ledger] descarte falhou (${id}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { result, report }
}
