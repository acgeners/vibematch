/**
 * Núcleo PURO da camada de previsões prospectivas (prediction_snapshots / P1).
 *
 * Sem efeitos colaterais e sem `server-only`: hashing de dedup, erros derivados
 * e a decisão de resolução são lógica determinística que precisa ser 100%
 * testável e reusável. Os serviços que tocam o banco (record/resolve) importam
 * daqui e adicionam `import "server-only"`.
 *
 * Ver migration 105 e AUDIT_REPORT P1.
 */

import { z } from "zod"

/** Eventos que justificam registrar um snapshot prospectivo (ver Etapa 4). */
export const PREDICTION_CONTEXTS = [
  "recommendation",
  "ranking_snapshot",
  "work_opened",
  "want_to_read",
  "comparison",
  "manual_snapshot",
] as const

export type PredictionContext = (typeof PREDICTION_CONTEXTS)[number]

/**
 * Schema de ENTRADA pra registrar um snapshot. Validado no boundary do serviço.
 * Scores podem ser null (obra sem aquele componente), mas quando presentes
 * precisam ser finitos. predictedScore/decisionScore/calcScore na escala 0–10;
 * personalFit 0–1; alignment 0–100 (não restringimos a faixa aqui — o CHECK do
 * banco cuida das faixas críticas).
 */
export const predictionSnapshotSchema = z.object({
  workId: z.string().uuid(),
  userId: z.string().uuid(),
  predictedScore: z.number().finite().nullable(),
  calcScore: z.number().finite().nullable(),
  personalFit: z.number().finite().nullable(),
  alignmentScore: z.number().finite().nullable(),
  decisionScore: z.number().finite().nullable(),
  tier: z.number().int().positive().nullable(),
  tierBandWidth: z.number().positive().nullable(),
  predictedIsStub: z.boolean(),
  formulaVersion: z.string().min(1),
  modelVersion: z.string().min(1).nullable(),
  promptVersion: z.string().min(1).nullable(),
  trainingSampleSize: z.number().int().nonnegative().nullable(),
  cvMae: z.number().nonnegative().nullable(),
  moodKey: z.string().min(1).nullable(),
  predictionContext: z.enum(PREDICTION_CONTEXTS),
  rankingSnapshotId: z.string().uuid().nullable(),
})

export type PredictionSnapshotInput = z.infer<typeof predictionSnapshotSchema>

export const PREDICTION_TIME_ZONE = "America/Sao_Paulo"

/**
 * Dia local (YYYY-MM-DD) de uma data num timezone explícito. Pura e testável —
 * NÃO depende do timezone da máquina. Default America/Sao_Paulo (onde o usuário
 * opera) pra o bucket diário de eventos individuais.
 */
export function getPredictionDateBucket(date: Date, timeZone = PREDICTION_TIME_ZONE): string {
  // en-CA formata como YYYY-MM-DD; o timeZone garante o "dia" correto local.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/**
 * Chave de deduplicação determinística, DEPENDENTE do contexto:
 *
 *  - recomendação/ranking (`rankingSnapshotId` presente) →
 *    `ranking::{rankingSnapshotId}::work::{workId}`.
 *    Cada execução do ranking preserva seu conjunto COMPLETO; a MESMA obra pode
 *    ter vários snapshots no mesmo dia se aparecer em rankings diferentes (é o
 *    que permite NDCG/Precision/regret/Spearman por ranking). Dentro do MESMO
 *    ranking a obra não duplica.
 *
 *  - eventos individuais (sem ranking) →
 *    `event::{user}::{work}::{formula}::{context}::{mood}::{dia local}`.
 *    Aí sim 1 snapshot por (usuário, obra, fórmula, contexto, mood, dia em
 *    America/Sao_Paulo). Mudar qualquer componente gera chave nova → snapshot
 *    novo, nunca overwrite.
 *
 * Composição legível (não-hash) — facilita debug e é reproduzível/testável.
 */
export function buildDedupKey(parts: {
  userId: string
  workId: string
  formulaVersion: string
  predictionContext: PredictionContext
  moodKey: string | null
  capturedAt: string
  rankingSnapshotId: string | null
  timeZone?: string
}): string {
  if (parts.rankingSnapshotId) {
    return `ranking::${parts.rankingSnapshotId}::work::${parts.workId}`
  }
  const dayBucket = getPredictionDateBucket(new Date(parts.capturedAt), parts.timeZone)
  return [
    "event",
    parts.userId,
    parts.workId,
    parts.formulaVersion,
    parts.predictionContext,
    parts.moodKey ?? "none",
    dayBucket,
  ].join("::")
}

export interface DerivedErrors {
  signedError: number
  absError: number
  sqError: number
}

/**
 * Erros derivados de uma previsão resolvida. erro = actual - predicted.
 * Calculado SOB DEMANDA nas funções de métrica — não persistido (Opção A),
 * então nunca diverge das notas armazenadas.
 */
export function computeDerivedErrors(predicted: number, actual: number): DerivedErrors {
  const signed = actual - predicted
  return { signedError: signed, absError: Math.abs(signed), sqError: signed * signed }
}

export interface ExistingResolution {
  resolvedAt: string | null
  actualUserScore: number | null
}

export type ResolutionAction =
  /** Snapshot ainda pendente → grava o resultado real (1ª resolução). */
  | { kind: "resolve"; actualUserScore: number }
  /** Já resolvido com a MESMA nota → idempotente, nada a fazer. */
  | { kind: "noop" }
  /**
   * Já resolvido com nota DIFERENTE → a nota foi EDITADA depois. NÃO é
   * invalidação: a 1ª medição prospectiva (predição × 1ª nota) era válida e
   * PERMANECE nas métricas. Só registra `label_changed_at` (auditoria). NÃO
   * marca `superseded` — isso fica reservado pra observação genuinamente
   * inválida (erro de registro / problema técnico), via ação manual.
   */
  | { kind: "relabel" }

/**
 * Decide o que fazer ao receber uma nota real pra um snapshot. PURA — o serviço
 * só aplica o resultado no banco. Não computa/persiste erros (Opção A).
 *
 *  - pendente (resolved_at null) → "resolve" (1ª nota vence; imutável depois);
 *  - resolvido com a mesma nota  → "noop" (idempotente);
 *  - resolvido com nota distinta → "relabel" (nota editada; só marca
 *    label_changed_at — a medição original NÃO sai das métricas).
 */
export function decideResolution(
  existing: ExistingResolution,
  newScore: number,
  epsilon = 1e-9,
): ResolutionAction {
  if (existing.resolvedAt == null) {
    return { kind: "resolve", actualUserScore: newScore }
  }
  if (
    existing.actualUserScore != null &&
    Math.abs(existing.actualUserScore - newScore) <= epsilon
  ) {
    return { kind: "noop" }
  }
  return { kind: "relabel" }
}
