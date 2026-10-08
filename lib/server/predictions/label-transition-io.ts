import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { computeDecisionScore } from "@/lib/calculations/decision"
import { getOwnerUserId } from "@/server/queries/current-user"
import { getVerdictScale } from "@/server/queries/verdict-scale"
import { discardPredictionsForWork, resolvePredictionsForWork } from "./resolve-prediction"
import {
  NO_PREDICTION,
  failedPrediction,
  toLegacyLedgerRow,
  toScore,
  type LabelTransitionDeps,
  type LedgerRow,
  type PreRatingPrediction,
} from "./label-transition"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const CHUNK = 150

let legacyLedgerWarned = false

/** Coluna ausente no PostgREST (migration 200 ainda não aplicada). */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === "PGRST204" || error.code === "42703" || /column/i.test(error.message ?? "")
}

/**
 * `stateClient` lê a nota anterior com o MESMO cliente da escrita (sessão ⇒ RLS; service role ⇒
 * `user_id` explícito). `ledgerClient` grava o ledger pelo mesmo motivo. A previsão sai sempre de
 * `user_calculated_scores` DESTE usuário — não de `calculated_scores`, que é a do dono.
 */
export function createLabelTransitionDeps(args: {
  userId: string
  stateClient: AnyClient
  ledgerClient: AnyClient
}): LabelTransitionDeps {
  const { userId, stateClient, ledgerClient } = args
  return {
    async readPrevScores(workIds) {
      const scores = new Map<string, number | null>()
      for (let i = 0; i < workIds.length; i += CHUNK) {
        const chunk = workIds.slice(i, i + CHUNK)
        const { data, error } = await stateClient
          .from("user_work_state")
          .select("work_id, user_score")
          .eq("user_id", userId)
          .in("work_id", chunk)
        if (error) return { ok: false, error: error.message }
        for (const r of (data ?? []) as Array<{ work_id: string; user_score: unknown }>) {
          scores.set(r.work_id, toScore(r.user_score))
        }
      }
      return { ok: true, scores }
    },

    async readPriorLabelEvidence(workIds) {
      const prior = new Set<string>()
      // Ledger: no máximo 1 linha por (user, obra) — em blocos cabe no corte de 1000.
      for (let i = 0; i < workIds.length; i += CHUNK) {
        const chunk = workIds.slice(i, i + CHUNK)
        const { data, error } = await ledgerClient
          .from("prediction_ledger")
          .select("work_id")
          .eq("user_id", userId)
          .in("work_id", chunk)
        if (error) throw new Error(`ledger: ${error.message}`)
        for (const r of (data ?? []) as Array<{ work_id: string }>) prior.add(r.work_id)
      }
      // Snapshot já RESOLVIDO também prova nota anterior — é o que sobra de quem teve a nota
      // apagada pelo caminho antigo (só carimbava) ou avaliada antes do ledger existir. Uma obra
      // pode ter dezenas de snapshots, então é CONTAGEM por obra (head), nunca um select de linhas
      // que o PostgREST cortaria em 1000 em silêncio.
      const admin = createAdminClient()
      for (const id of workIds) {
        if (prior.has(id)) continue
        const { count, error } = await admin
          .from("prediction_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("work_id", id)
          .not("resolved_at", "is", null)
        if (error) throw new Error(`snapshots: ${error.message}`)
        if ((count ?? 0) > 0) prior.add(id)
      }
      return prior
    },

    async readPreRatingPredictions(workIds) {
      const predictions = new Map<string, PreRatingPrediction>()
      const admin = createAdminClient()
      type Row = {
        work_id: string
        expected_score: unknown
        expected_is_stub: boolean | null
        personal_fit: unknown
        personal_fit_percentile: unknown
        alignment_score: unknown
        alignment_payload: { confidence?: number } | null
        alignment_stale: boolean | null
        calculated_at: string | null
      }
      let verdictScale: Awaited<ReturnType<typeof getVerdictScale>> | null = null
      try {
        verdictScale = await getVerdictScale()
      } catch {
        verdictScale = null // sem régua a Prioridade é a Prevista (degradação documentada em decision.ts)
      }
      for (let i = 0; i < workIds.length; i += CHUNK) {
        const chunk = workIds.slice(i, i + CHUNK)
        const { data, error } = await admin
          .from("user_calculated_scores")
          .select(
            "work_id, expected_score, expected_is_stub, personal_fit, personal_fit_percentile, alignment_score, alignment_payload, alignment_stale, calculated_at",
          )
          .eq("user_id", userId)
          .in("work_id", chunk)
        if (error) {
          for (const id of chunk) predictions.set(id, failedPrediction(error.message))
          continue
        }
        const byId = new Map(((data ?? []) as Row[]).map((r) => [r.work_id, r]))
        for (const id of chunk) {
          const r = byId.get(id)
          if (!r) {
            predictions.set(id, NO_PREDICTION) // obra nova / nunca recalculada para este usuário
            continue
          }
          const expected = toScore(r.expected_score)
          const base = {
            personalFit: toScore(r.personal_fit),
            personalFitPercentile: toScore(r.personal_fit_percentile),
            calculatedAt: r.calculated_at ?? null,
            error: null,
          }
          if (expected == null) {
            predictions.set(id, { ...NO_PREDICTION, ...base })
            continue
          }
          predictions.set(id, {
            status: "captured",
            expected,
            decision: computeDecisionScore({
              expected,
              alignment: toScore(r.alignment_score),
              confidence: r.alignment_payload?.confidence ?? null,
              stale: Boolean(r.alignment_stale),
              verdictScale,
            }),
            isStub: r.expected_is_stub ?? true,
            ...base,
          })
        }
      }

      // Tamanho do treino: só faz sentido para o modelo do DONO (calibration_history é dele).
      let trainSize: number | null = null
      try {
        if (userId === (await getOwnerUserId(admin))) {
          const { data } = await admin
            .from("calibration_history")
            .select("train_size")
            .order("recorded_at", { ascending: false })
            .limit(1)
            .maybeSingle()
          trainSize = (data?.train_size as number | null | undefined) ?? null
        }
      } catch {
        trainSize = null
      }
      return { predictions, trainSize }
    },

    async recordFirstRatings(rows: LedgerRow[]) {
      if (rows.length === 0) return
      // `ignoreDuplicates` + unique(user_id, work_id): retry e corrida gravam UMA vez; a 1ª vence.
      const { error } = await ledgerClient
        .from("prediction_ledger")
        .upsert(rows, { onConflict: "user_id,work_id", ignoreDuplicates: true })
      if (!error) return
      if (!isMissingColumn(error)) throw new Error(error.message)
      if (!legacyLedgerWarned) {
        legacyLedgerWarned = true
        console.warn("[ledger] migration 200 ausente — gravando só as colunas da mig 101 (personal_fit/proveniência perdidos até aplicar)")
      }
      const { error: legacyError } = await ledgerClient
        .from("prediction_ledger")
        .upsert(rows.map(toLegacyLedgerRow), { onConflict: "user_id,work_id", ignoreDuplicates: true })
      if (legacyError) throw new Error(legacyError.message)
    },

    resolveLabel: (workId, score) => resolvePredictionsForWork(workId, score, userId),
    discardLabel: (workId) => discardPredictionsForWork(workId, userId),
    log: (message) => console.error(message),
  }
}
