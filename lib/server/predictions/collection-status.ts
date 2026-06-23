/**
 * Status da coleta prospectiva (prediction_snapshots). Diferencia os cenários
 * pra o no-op NÃO ser invisível (P1.4): tabela ausente (migration não aplicada),
 * erro de conexão, erro inesperado, e tabela presente (com ou sem dados).
 *
 * Puro + um warner com dedup por processo (não loga stack a cada recomendação).
 */

export type CollectionStatus =
  /** Tabela existe e tem snapshots. */
  | "active"
  /** Tabela existe, mas vazia. */
  | "no_data"
  /** Relação não existe — migration 105 ainda não aplicada (Postgres 42P01). */
  | "migration_missing"
  /** Falha de conexão com o banco (classe SQLSTATE 08). */
  | "connection_error"
  /** Qualquer outro erro não classificado. */
  | "unexpected_error"

interface PgLikeError {
  code?: string | null
  message?: string | null
}

/**
 * Classifica um erro do Supabase/Postgres num CollectionStatus. `null`/ausente →
 * "active" (sem erro). NÃO transforma todo erro em indisponível sem diagnóstico.
 */
export function classifyCollectionError(error: PgLikeError | null | undefined): CollectionStatus {
  if (!error) return "active"
  const code = error.code ?? ""
  const message = error.message ?? ""
  if (code === "42P01" || /relation .* does not exist|does not exist/i.test(message)) {
    return "migration_missing"
  }
  if (code.startsWith("08")) return "connection_error"
  return "unexpected_error"
}

// Dedup de warnings por processo (e por status) — evita poluir o log a cada
// recomendação/save quando a migration não foi aplicada.
const warnedStatuses = new Set<string>()

/**
 * Emite UM warning estruturado por status por processo. Status saudáveis
 * (active/no_data) não logam.
 */
export function warnPredictionCollectionOnce(status: CollectionStatus, detail?: string): void {
  if (status === "active" || status === "no_data") return
  if (warnedStatuses.has(status)) return
  warnedStatuses.add(status)
  console.warn(
    JSON.stringify({ event: "prediction_snapshots_unavailable", status, detail: detail ?? null }),
  )
}

/** Apenas pra testes: zera o dedup de warnings. */
export function __resetCollectionWarnings(): void {
  warnedStatuses.clear()
}
