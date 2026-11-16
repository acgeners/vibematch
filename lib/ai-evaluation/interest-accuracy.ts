import { SYNOPSIS_QUALITIES } from "@/types/domain"

export interface SynopsisPredictionAccuracy {
  /** Obras com Interesse dado À MÃO e previsão desta versão (base da comparação). */
  n: number
  /** Viés médio em níveis (previsto − manual). + = IA superestima o interesse. */
  meanDelta: number | null
  /** Erro absoluto médio em níveis (|previsto − manual|). Menor = mais confiável. */
  mae: number | null
  /** Fração com acerto exato (delta = 0). */
  exactRate: number | null
  /** Fração dentro de ±1 nível. */
  within1Rate: number | null
  /** Obras que ficaram FORA porque o Interesse veio do "Aplicar" (é a própria previsão). */
  appliedExcluded: number
}

/** Uma previsão com o Interesse atual da obra. */
export interface InterestAccuracyRow {
  workId: string
  predictedAt: string
  predicted: string | null
  manual: string | null
  /** `user_work_state.synopsis_quality_source`: human_manual | prediction_applied | legacy_unknown. */
  manualSource: string | null
}

/** Abaixo disto a tela não afirma um nível de confiança (só mostra os números). */
export const MIN_ACCURACY_SAMPLE = 10

function level(q: string | null | undefined): number {
  if (!q) return 0
  const idx = (SYNOPSIS_QUALITIES as readonly string[]).indexOf(q)
  return idx >= 0 ? idx + 1 : 0
}

/**
 * Erro da previsão de Interesse contra o Interesse que a pessoa deu.
 *
 * 🔴 Duas regras, as duas medidas em 2026-11-16 na nuvem (versão v4):
 * 1. **A previsão mais recente da obra nesta versão, mesmo desatualizada.** A versão
 *    anterior só contava as frescas, e 99,7% estavam desatualizadas (777 de 779): a
 *    pílula dizia "Confiança: alta" sobre n = 2. A desatualizada é a que aparece na
 *    fila, então é a que interessa medir.
 * 2. **Só o Interesse dado À MÃO (`human_manual`).** O "Aplicar" copia a previsão para
 *    o Interesse: medido, essas acertam 79% exato contra 55% das manuais, e somá-las
 *    inflava a confiança com a previsão concordando consigo mesma. `legacy_unknown`
 *    (anterior à migration 108) também fica fora: não dá para saber de onde veio.
 */
export function computeInterestAccuracy(rows: InterestAccuracyRow[]): SynopsisPredictionAccuracy {
  const latest = new Map<string, InterestAccuracyRow>()
  for (const r of rows) {
    const cur = latest.get(r.workId)
    if (!cur || r.predictedAt > cur.predictedAt) latest.set(r.workId, r)
  }

  let n = 0
  let sum = 0
  let absSum = 0
  let exact = 0
  let within1 = 0
  let appliedExcluded = 0
  for (const r of latest.values()) {
    const manualLevel = level(r.manual)
    const predLevel = level(r.predicted)
    if (manualLevel === 0 || predLevel === 0) continue
    if (r.manualSource !== "human_manual") {
      if (r.manualSource === "prediction_applied") appliedExcluded += 1
      continue
    }
    const delta = predLevel - manualLevel
    n += 1
    sum += delta
    absSum += Math.abs(delta)
    if (delta === 0) exact += 1
    if (Math.abs(delta) <= 1) within1 += 1
  }

  if (n === 0) return { n: 0, meanDelta: null, mae: null, exactRate: null, within1Rate: null, appliedExcluded }
  return { n, meanDelta: sum / n, mae: absSum / n, exactRate: exact / n, within1Rate: within1 / n, appliedExcluded }
}
