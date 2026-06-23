import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId } from "@/server/queries/current-user"
import { decideResolution } from "./prediction-context"
import { classifyCollectionError, warnPredictionCollectionOnce } from "./collection-status"

/**
 * RESOLUÇÃO de snapshots prospectivos (prediction_snapshots / P1).
 *
 * Quando uma obra ganha (ou tem alterada) a user_score, casa o resultado real
 * com os snapshots PENDENTES daquela obra. Regras (ver prediction-context):
 *  - pendente            → grava actual/resolved_at/erros (1ª nota vence);
 *  - resolvido, =nota     → idempotente (no-op);
 *  - resolvido, ≠nota     → marca superseded (rótulo editado; original intacto).
 *
 * NUNCA reescreve os campos previstos do snapshot. Best-effort: não bloqueia o
 * save. Os UPDATEs são CONDICIONAIS (`.is("resolved_at", null)` / `.eq(...
 * superseded false)`) → idempotentes e seguros sob concorrência entre duas
 * resoluções (a 2ª não casa a condição e vira no-op).
 */

interface SnapshotResolutionRow {
  id: string
  resolved_at: string | null
  actual_user_score: number | null
  superseded: boolean
}

export async function resolvePredictionsForWork(
  workId: string,
  userScore: number,
): Promise<number> {
  if (!workId || userScore == null || Number.isNaN(Number(userScore))) return 0
  const score = Number(userScore)
  try {
    const supabase = createAdminClient()
    const userId = await getCurrentUserId(supabase)

    const { data, error } = await supabase
      .from("prediction_snapshots")
      .select("id, resolved_at, actual_user_score, superseded")
      .eq("user_id", userId)
      .eq("work_id", workId)
    if (error) {
      warnPredictionCollectionOnce(classifyCollectionError(error), error.message)
      return 0
    }
    const rows = (data ?? []) as unknown as SnapshotResolutionRow[]
    if (rows.length === 0) return 0

    const now = new Date().toISOString()
    let resolved = 0

    await Promise.all(
      rows.map(async (row) => {
        const action = decideResolution(
          {
            resolvedAt: row.resolved_at,
            actualUserScore: row.actual_user_score == null ? null : Number(row.actual_user_score),
          },
          score,
        )
        if (action.kind === "noop") return
        if (action.kind === "resolve") {
          // Opção A: grava só a nota + timestamp; os erros são derivados nas
          // funções puras de métrica (nunca persistidos → nunca inconsistentes).
          const { error: upErr, count } = await supabase
            .from("prediction_snapshots")
            .update(
              { actual_user_score: action.actualUserScore, resolved_at: now },
              { count: "exact" },
            )
            .eq("id", row.id)
            .is("resolved_at", null) // só resolve se ainda pendente (idempotente/concorrência)
          if (upErr) {
            console.warn("[resolvePredictionsForWork] update(resolve) falhou:", upErr.message)
            return
          }
          if ((count ?? 0) > 0) resolved += 1
          return
        }
        // relabel: a nota foi editada após a resolução. NÃO invalida — a 1ª
        // medição (predição × 1ª nota) permanece nas métricas. Só carimba
        // label_changed_at UMA vez (auditoria), sem tocar superseded nem o
        // actual_user_score original. Idempotente: só preenche se ainda null.
        const { error: relErr } = await supabase
          .from("prediction_snapshots")
          .update({ label_changed_at: now })
          .eq("id", row.id)
          .is("label_changed_at", null)
        if (relErr) {
          console.warn("[resolvePredictionsForWork] update(relabel) falhou:", relErr.message)
        }
      }),
    )

    return resolved
  } catch (err) {
    console.warn(
      "[resolvePredictionsForWork] falhou (best-effort, não bloqueia o save):",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}

/**
 * Nota REMOVIDA (score → null): a obra deixou de ter rótulo atual, MAS a 1ª
 * medição prospectiva já feita continua válida (a previsão foi avaliada contra
 * a 1ª nota conhecida). Por isso NÃO marcamos superseded nem mexemos no
 * actual_user_score/resolved_at — só carimbamos label_changed_at (auditoria),
 * uma vez. As métricas preservam a observação original. Pendentes seguem
 * pendentes. (superseded fica reservado pra invalidação manual.)
 */
export async function markPredictionLabelChanged(workId: string): Promise<number> {
  if (!workId) return 0
  try {
    const supabase = createAdminClient()
    const userId = await getCurrentUserId(supabase)
    const { error, count } = await supabase
      .from("prediction_snapshots")
      .update({ label_changed_at: new Date().toISOString() }, { count: "exact" })
      .eq("user_id", userId)
      .eq("work_id", workId)
      .not("resolved_at", "is", null)
      .is("label_changed_at", null)
    if (error) {
      console.warn("[markPredictionLabelChanged] update falhou:", error.message)
      return 0
    }
    return count ?? 0
  } catch (err) {
    console.warn(
      "[markPredictionLabelChanged] falhou (best-effort):",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
