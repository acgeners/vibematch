/**
 * Plano 3 B2.2M — Resultado DISCRIMINADO + helpers PUROS das Server Actions de reviews
 * externas manuais. Separado do arquivo "use server" (que só pode exportar funções async)
 * para ser testável (conflito de índice único, validação de posse do registro).
 */

export type ExternalManualReviewActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "blocked"; message: string }
  | { ok: false; error: "invalid_id"; message: string }
  | { ok: false; error: "validation"; message: string }
  | { ok: false; error: "work_not_found"; message: string }
  | { ok: false; error: "review_not_found"; message: string }
  | { ok: false; error: "wrong_work"; message: string }
  | { ok: false; error: "duplicate_text"; message: string }
  | { ok: false; error: "db"; message: string }

/** Mapeia o erro do Postgres (23505) para o único índice único restante: uniq_hash (texto). */
export function mapUniqueConflict(
  err: { code?: string; message?: string } | null,
): ExternalManualReviewActionResult | null {
  if (!err || err.code !== "23505") return null
  const m = err.message ?? ""
  if (m.includes("uniq_hash")) {
    return { ok: false, error: "duplicate_text", message: "Já existe uma review com esse mesmo texto nesta obra+fonte." }
  }
  return { ok: false, error: "db", message: m || "conflito único" }
}

/**
 * Valida posse: o registro precisa existir E pertencer a `workId` (não alterar/excluir
 * registro de outra obra). Retorna o erro discriminado, ou `null` quando a posse é válida.
 */
export function ownershipError(
  existing: { work_id: string } | null | undefined,
  workId: string,
): ExternalManualReviewActionResult | null {
  if (!existing) return { ok: false, error: "review_not_found", message: "Review não encontrada." }
  if (existing.work_id !== workId) return { ok: false, error: "wrong_work", message: "A review pertence a outra obra." }
  return null
}
