/**
 * Classificação do tipo de WORKLOAD de uma chamada de IA (plano §9).
 *
 * Função pura e CONSERVADORA: só afirma o que há evidência. Sem sinal confiável
 * → "unknown" (o plano proíbe reclassificar histórico com heurística frágil e
 * proíbe inventar "recurring" sem prova).
 *
 * Prioridade:
 *  1. `metadata.workload_type` explícito (gravado pela instrumentação) — confiável;
 *  2. `metadata.backfill === true` → backfill;
 *  3. `metadata.is_override`/`isOverride === true` (avaliação com modelo trocado:
 *     botão "Reavaliar com…" ou script compare-models) → experiment;
 *  4. operação inerentemente administrativa (calibration_*, tag_*) → admin;
 *  5. caso contrário → unknown.
 */

import { ADMIN_OPERATIONS, AI_WORKLOAD_TYPES, type AiWorkloadType } from "./types"

export interface ClassifyWorkloadInput {
  operation: string
  metadata?: Record<string, unknown> | null
}

function asBool(v: unknown): boolean {
  return v === true
}

function asWorkloadType(v: unknown): AiWorkloadType | null {
  return typeof v === "string" && (AI_WORKLOAD_TYPES as readonly string[]).includes(v)
    ? (v as AiWorkloadType)
    : null
}

export function classifyWorkload(input: ClassifyWorkloadInput): AiWorkloadType {
  const meta = input.metadata ?? {}

  const explicit = asWorkloadType(meta.workload_type)
  if (explicit) return explicit

  if (asBool(meta.backfill)) return "backfill"

  if (asBool(meta.is_override) || asBool(meta.isOverride)) return "experiment"

  if (ADMIN_OPERATIONS.has(input.operation)) return "admin"

  return "unknown"
}
