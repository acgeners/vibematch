"use server"

// ⚠️ Legacy prediction capture. Do not use for new prospective ranking metrics.
// Mecanismo legado (migration 101): grava 1 linha por obra no instante da
// PRIMEIRA nota (resolve no mesmo evento, unique(user_id, work_id)). Para a
// validação prospectiva nova (múltiplos snapshots imutáveis por obra/fórmula/
// contexto/ranking + métricas de ordenação) use `prediction_snapshots`
// (migration 105) via lib/server/predictions/*. Ver lib/server/predictions/README.md.
// Esta tabela NÃO é apagada nem migrada nesta etapa.

import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { ensureSignedIn } from "@/server/queries/current-user"
import { computeDecisionScore } from "@/lib/calculations/decision"

/**
 * Captura a previsão DE-REGISTRO de uma obra no instante em que ela ganha a
 * PRIMEIRA user_score (validação prospectiva — ver migration 101).
 *
 * Lê a Nota Prevista/Prioridade JÁ persistidas em calculated_scores — que ainda
 * são pré-rótulo, porque o recalc é deferido (markRecalcPending) — e grava o par
 * (previsto, real) no prediction_ledger. `ignoreDuplicates` garante que só a
 * primeira nota conte (re-avaliar não cria ponto leak-free novo).
 *
 * Best-effort: NUNCA bloqueia o save da obra. Se a migration 101 não foi aplicada
 * (tabela ausente), o erro é engolido e vira no-op.
 *
 * O caller só deve chamar na transição null → nota (não em re-avaliações).
 */
export async function capturePredictionForFirstRating(
  workId: string,
  userScore: number,
): Promise<void> {
  if (!workId || userScore == null || Number.isNaN(Number(userScore))) return
  try {
    const supabase = createAdminClient()
    const auth = await ensureSignedIn()
    if (!auth.ok) return // sem sessão não há ledger de quem — no-op (isto é telemetria)
    const userId = auth.userId

    const [csRes, histRes] = await Promise.all([
      supabase
        .from("calculated_scores")
        .select("expected_score, expected_is_stub, alignment_score, alignment_payload")
        .eq("work_id", workId)
        .maybeSingle(),
      supabase
        .from("calibration_history")
        .select("train_size")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const cs = csRes.data as {
      expected_score: number | null
      expected_is_stub: boolean | null
      alignment_score: number | null
      alignment_payload: { confidence?: number } | null
    } | null

    const expected = cs?.expected_score ?? null
    const decision = computeDecisionScore({
      expected,
      alignment: cs?.alignment_score ?? null,
      confidence: cs?.alignment_payload?.confidence ?? null,
    })

    // O ledger é SEU (as leituras acima são de catálogo e seguem na service role).
    const userDb = await createUserClient()
    await userDb.from("prediction_ledger").upsert(
      {
        user_id: userId,
        work_id: workId,
        predicted_expected: expected,
        predicted_decision: decision,
        predicted_is_stub: cs?.expected_is_stub ?? true,
        user_score: Number(userScore),
        train_size_at_capture: (histRes.data?.train_size as number | null | undefined) ?? null,
      },
      { onConflict: "user_id,work_id", ignoreDuplicates: true },
    )
  } catch (err) {
    console.warn(
      "[capturePredictionForFirstRating] falhou (não bloqueia o save):",
      err instanceof Error ? err.message : err,
    )
  }
}
