"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureCapability } from "@/server/queries/current-user"
import { loadOrEnsureProfile } from "@/lib/ai-recommendation/ensure-profile"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getSynopsisPredictionForWork, getSynopsisPredictionsByWorkIds } from "@/server/queries/synopsis-quality"
import { markRecalcPending } from "@/server/actions/recalc-queue"
import { predictSynopsisQuality } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"
import type {
  InterestBatchPlan,
  InterestBatchReport,
} from "@/lib/orchestration/integrations/synopsis-interest"
import { mapInterestOutcome } from "@/lib/orchestration/integrations/interest-ui"
import type { WorkPredictResult, PredictWorkOpts } from "@/lib/orchestration/integrations/interest-ui"

const STUB_PROFILE_ERROR =
  "Perfil de gosto ainda em modo stub — avalie mais obras com nota pessoal pra desbloquear a previsão de Interesse Sinopse."

/** Teto de obras por run do lote — protege gasto e a duração da request. */
const SYNOPSIS_BATCH_MAX = 100

export interface PredictSynopsisQualityResult {
  predictedQuality: SynopsisQuality
  justification: string
  confidence: number | null
}

export type { WorkPredictResult, PredictWorkOpts } from "@/lib/orchestration/integrations/interest-ui"

/**
 * Estima o Interesse Sinopse de UMA obra sob demanda, pela orquestração durável
 * (passo 4). Gate Pago (`smart_shortlist`). NÃO toca em works.synopsis_quality —
 * só grava a sugestão em synopsis_quality_predictions. Cascata de perfil exige
 * `confirmCascade` (uma confirmação). Devolve estado tipado.
 */
export async function predictSynopsisQualityForWorkAction(
  workId: string,
  opts: PredictWorkOpts = {},
): Promise<WorkPredictResult> {
  try {
    const gate = await ensureCapability("smart_shortlist")
    if (!gate.ok) return { status: "blocked_manual", message: gate.error }

    const { ensurePredictInterest, SupabaseInterestGateway } = await import(
      "@/lib/orchestration/integrations/synopsis-interest"
    )
    const outcome = await ensurePredictInterest(workId, {
      gateway: new SupabaseInterestGateway(),
      allowPaid: opts.confirmCascade ?? false,
      maxCostUsd: opts.maxCostUsd,
      acceptStaleProfile: opts.acceptStaleProfile ?? false,
    })

    if (outcome.status === "succeeded") {
      revalidatePath("/titles")
      revalidatePath(`/titles/${workId}`)
      revalidatePath("/ai-evaluation")
    }
    const result = mapInterestOutcome(outcome)
    // Quando o custo é a CASCATA do perfil (~$0,40), anexa o DRIFT method-free pra
    // o usuário decidir se vale o regen. Informativo — nunca bloqueia.
    if (result.status === "blocked_cost_confirmation" && result.reason === "profile_cascade") {
      try {
        const { getProfileDrift } = await import("@/lib/ai-recommendation/profile-drift")
        const drift = await getProfileDrift()
        if (drift.available) {
          const pct = Math.round(drift.driftPct * 100)
          result.message += ` Perfil ~${pct}% defasado${drift.changedTags > 0 ? ` (${drift.changedTags} tag${drift.changedTags === 1 ? "" : "s"} mudaram)` : ""}.`
        }
      } catch {
        /* drift é informativo; falha não afeta a previsão */
      }
    }
    return result
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface DraftSynopsisQualityInput {
  title: string
  /** A SINOPSE CANÔNICA (consolidada) — mesmo sinal que o caminho da obra salva. */
  synopsis: string
  /** Nomes de tags do form (sem grupo). */
  tags: string[]
}

/**
 * Estima o Interesse Sinopse de um RASCUNHO (form de /titles/new), antes da obra
 * existir no banco. Roda a previsão em memória contra a sinopse canônica + tags
 * do form — NÃO persiste nada (nem em synopsis_quality_predictions, nem em works).
 * A sugestão só entra no pipeline se o usuário clicar "Aplicar" (seta o campo do
 * form) e depois salvar a obra. Mesmo gate Pago e perfil não-stub do caminho da
 * obra salva.
 */
export async function predictSynopsisQualityForDraftAction(
  input: DraftSynopsisQualityInput,
): Promise<{ data?: PredictSynopsisQualityResult; error?: string }> {
  try {
    const gate = await ensureCapability("smart_shortlist")
    if (!gate.ok) return { error: gate.error }

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile
    if (profile.is_stub) return { error: STUB_PROFILE_ERROR }

    const synopsis = input.synopsis?.trim()
    if (!synopsis) {
      return { error: "Gere a sinopse canônica antes de estimar o Interesse Sinopse." }
    }

    const result = await predictSynopsisQuality({
      profile: profile.profile,
      work: {
        id: "draft",
        title: input.title?.trim() || "(sem título)",
        synopsis,
        tags: (input.tags ?? []).map((name) => ({ name, group: null })),
      },
    })

    return {
      data: {
        predictedQuality: result.predictedQuality,
        justification: result.justification,
        confidence: result.confidence,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * Aplica a previsão IA ao campo MANUAL (works.synopsis_quality). É a única via
 * pela qual a sugestão entra no pipeline de notas — e só por ação explícita do
 * usuário. Recalcula a obra (o multiplicador da Nota.Calc / feature da Nota.Pr
 * dependem de synopsis_quality).
 */
export async function applySynopsisPredictionAction(
  workId: string,
): Promise<{ data?: { applied: SynopsisQuality }; error?: string }> {
  try {
    const prediction = await getSynopsisPredictionForWork(workId)
    if (!prediction) return { error: "Não há previsão para esta obra." }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("works")
      .update({
        synopsis_quality: prediction.predictedQuality,
        // Proveniência (Plano 3): cópia da previsão IA. NÃO muda o valor copiado.
        synopsis_quality_source: "prediction_applied",
        synopsis_quality_prediction_id: prediction.id,
      })
      .eq("id", workId)
    if (error) return { error: `Falha aplicando previsão: ${error.message}` }

    // synopsis_quality é feature do Ridge global → marca recálculo pendente em
    // vez de recalcular na hora. A resposta volta assim que synopsis_quality está
    // gravado (estado "Aplicado"); a Nota Prevista atualiza no "Recalcular agora"
    // ou no auto-recalc (≥1h sem novas edições). Antes era um recalc-all inteiro.
    await markRecalcPending("applySynopsisPrediction")

    revalidatePath("/titles")
    revalidatePath(`/titles/${workId}`)
    revalidatePath("/ranking")

    return { data: { applied: prediction.predictedQuality } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface ApplySynopsisBatchResult {
  processed: number
  applied: number
  skipped: number
  failed: number
  capped: boolean
}

/** Teto por execução do "Aplicar em fila" (operação grátis/DB-only). */
const APPLY_BATCH_CAP = 150

/**
 * Aplica a previsão IA ao Interesse manual (works.synopsis_quality) em LOTE — o
 * "Aplicar previsão em fila" da aba "Interesse na Obra". Espelha
 * applySynopsisPredictionAction, mas:
 *  - PROTEGE rótulos humanos: pula obras com source='human_manual' (não
 *    sobrescreve ground-truth);
 *  - pula obras sem previsão ativa;
 *  - marca recalc_pending UMA vez no fim (synopsis_quality é feature do Ridge global).
 * Grátis (sem LLM) — só copia a previsão pro campo manual.
 */
export async function applySynopsisPredictionForWorks(
  workIds: string[],
): Promise<ApplySynopsisBatchResult> {
  const ids = [...new Set((workIds ?? []).filter(Boolean))].slice(0, APPLY_BATCH_CAP)
  if (ids.length === 0) return { processed: 0, applied: 0, skipped: 0, failed: 0, capped: false }

  const supabase = createAdminClient()
  const [predictions, sourceRows] = await Promise.all([
    getSynopsisPredictionsByWorkIds(ids),
    supabase.from("works").select("id, synopsis_quality_source").in("id", ids),
  ])
  const sourceById = new Map(
    ((sourceRows.data ?? []) as Array<{ id: string; synopsis_quality_source: string | null }>).map(
      (r) => [r.id, r.synopsis_quality_source],
    ),
  )

  let applied = 0
  let skipped = 0
  let failed = 0
  for (const id of ids) {
    const prediction = predictions.get(id)
    if (!prediction) {
      skipped++ // sem previsão ativa
      continue
    }
    if (sourceById.get(id) === "human_manual") {
      skipped++ // protege rótulo humano (ground-truth)
      continue
    }
    const { error } = await supabase
      .from("works")
      .update({
        synopsis_quality: prediction.predictedQuality,
        synopsis_quality_source: "prediction_applied",
        synopsis_quality_prediction_id: prediction.id,
      })
      .eq("id", id)
    if (error) {
      failed++
      continue
    }
    applied++
  }

  if (applied > 0) await markRecalcPending("applySynopsisPredictionBatch")
  revalidatePath("/ai-evaluation")
  revalidatePath("/titles")
  revalidatePath("/ranking")

  return {
    processed: ids.length,
    applied,
    skipped,
    failed,
    capped: (workIds ?? []).length > APPLY_BATCH_CAP,
  }
}

/**
 * "Pular" (ou desfazer) uma obra na fila de Interesse na Obra — sai da fila e do
 * "Aplicar previsão em fila" (migration 121: works.synopsis_interest_skipped).
 * Espelha skipAiEvaluation da fila de atributos. NÃO toca em synopsis_quality/fonte.
 */
export async function skipSynopsisInterestAction(
  workId: string,
  skipped = true,
): Promise<{ data?: { skipped: boolean }; error?: string }> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from("works")
      .update({ synopsis_interest_skipped: skipped })
      .eq("id", workId)
    if (error) {
      if (/synopsis_interest_skipped|column|schema cache/i.test(error.message)) {
        return { error: "Aplique a migration 121 (synopsis_interest_skipped) pra usar o 'Pular'." }
      }
      return { error: `Falha ao pular: ${error.message}` }
    }
    revalidatePath("/ai-evaluation")
    return { data: { skipped } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * Atribui (ou limpa) o Interesse Sinopse MANUAL (works.synopsis_quality)
 * diretamente — sem passar pela previsão IA. É o caminho GRÁTIS de triagem
 * manual da fila /ai-evaluation?tab=sinopse. `quality = null` limpa o campo
 * ("Não avaliada"). Igual ao apply: marca recálculo pendente (synopsis_quality
 * é feature do Ridge global) em vez de recalcular na hora.
 */
export async function setSynopsisQualityAction(
  workId: string,
  quality: SynopsisQuality | null,
): Promise<{ data?: { synopsisQuality: SynopsisQuality | null }; error?: string }> {
  try {
    if (quality !== null && !(SYNOPSIS_QUALITIES as readonly string[]).includes(quality)) {
      return { error: "Valor de Interesse inválido." }
    }
    const supabase = createAdminClient()
    const { error } = await supabase
      .from("works")
      .update({
        synopsis_quality: quality,
        // Proveniência (Plano 3): triagem manual direta. Limpar (null) zera a origem.
        synopsis_quality_source: quality === null ? "legacy_unknown" : "human_manual",
        synopsis_quality_prediction_id: null,
      })
      .eq("id", workId)
    if (error) return { error: `Falha gravando Interesse: ${error.message}` }

    await markRecalcPending("setSynopsisQuality")

    revalidatePath("/titles")
    revalidatePath(`/titles/${workId}`)
    revalidatePath("/ranking")
    revalidatePath("/ai-evaluation")

    return { data: { synopsisQuality: quality } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/** Plano (dry-run) do lote — devolvido à UI antes de executar. */
export type BatchPlanResult =
  | { status: "ok"; plan: InterestBatchPlan; profileReadiness: "fresh" | "stale" | "absent" | "stub" }
  | { status: "blocked_manual"; message: string }
  | { status: "failed"; error: string }

/** Relatório do lote executado. */
export type BatchRunResult =
  | { status: "ok"; report: InterestBatchReport }
  | { status: "blocked_cost_confirmation"; upperBoundUsd: number; maxCostUsd: number; message: string }
  | { status: "blocked_manual"; message: string }
  | { status: "failed"; error: string }

/**
 * DRY-RUN do lote (passo 4 etapa 2): conta fresh/stale/ausentes e soma o custo
 * TOTAL da cascata (perfil 1× se preciso + previsões necessárias). NÃO executa
 * nada, NÃO chama provider. Itens fresh não entram no custo. NÃO herda a
 * pré-autorização single-work.
 */
export async function planSynopsisInterestBatchAction(workIds: string[]): Promise<BatchPlanResult> {
  try {
    const gate = await ensureCapability("smart_shortlist")
    if (!gate.ok) return { status: "blocked_manual", message: gate.error }
    const ids = (workIds ?? []).slice(0, SYNOPSIS_BATCH_MAX)
    if (ids.length === 0) return { status: "failed", error: "Nenhuma obra para o lote." }

    const { SupabaseInterestGateway, planInterestBatch } = await import("@/lib/orchestration/integrations/synopsis-interest")
    const { classifyTasteProfileReadiness } = await import("@/lib/orchestration/integrations/taste-profile")
    const { computeInputHash, computeProfileSignature, MIN_WORKS_FOR_FULL_PROFILE } = await import("@/lib/ai-recommendation/taste-profile")
    const { getRatedWorksForProfile } = await import("@/server/queries/recommendations")

    const ratedWorks = await getRatedWorksForProfile()
    const libraryHash = computeInputHash(ratedWorks)
    const current = await loadCurrentTasteProfile()
    const readiness = classifyTasteProfileReadiness({
      current: current ? { isStub: current.is_stub, inputHash: current.input_hash } : null,
      libraryHash,
    })
    const needsGen = readiness.state !== "fresh"
    if (needsGen && ratedWorks.length < MIN_WORKS_FOR_FULL_PROFILE) {
      return { status: "blocked_manual", message: `Avalie ao menos ${MIN_WORKS_FOR_FULL_PROFILE} obras (você tem ${ratedWorks.length}) para gerar o perfil do lote.` }
    }
    const profileSignature = current && !current.is_stub ? computeProfileSignature(current.profile) : null
    const plan = await planInterestBatch(ids, {
      gateway: new SupabaseInterestGateway(),
      profileSignature,
      profileNeedsGeneration: needsGen,
      profileScale: ratedWorks.length,
    })
    return { status: "ok", plan, profileReadiness: readiness.state }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * EXECUTA o lote APÓS confirmação. Re-roda o dry-run; bloqueia se o upper bound
 * passar de `maxCostUsd`. Concorrência limitada, jobs duráveis (dedup/resume),
 * pula fresh, perfil gerado 1×. Uma autorização para a cascata inteira.
 */
export async function runSynopsisInterestBatchAction(
  workIds: string[],
  opts: { maxCostUsd: number },
): Promise<BatchRunResult> {
  try {
    const gate = await ensureCapability("smart_shortlist")
    if (!gate.ok) return { status: "blocked_manual", message: gate.error }
    const ids = (workIds ?? []).slice(0, SYNOPSIS_BATCH_MAX)
    if (ids.length === 0) return { status: "failed", error: "Nenhuma obra para o lote." }

    const planned = await planSynopsisInterestBatchAction(ids)
    if (planned.status !== "ok") return planned
    if (planned.plan.upperBoundUsd > opts.maxCostUsd) {
      return {
        status: "blocked_cost_confirmation",
        upperBoundUsd: planned.plan.upperBoundUsd,
        maxCostUsd: opts.maxCostUsd,
        message: `Upper bound do lote ($${planned.plan.upperBoundUsd.toFixed(3)}) acima do teto ($${opts.maxCostUsd.toFixed(3)}).`,
      }
    }

    const { SupabaseInterestGateway, runInterestBatch } = await import("@/lib/orchestration/integrations/synopsis-interest")
    const report = await runInterestBatch(ids, {
      gateway: new SupabaseInterestGateway(),
      maxCostUsd: opts.maxCostUsd,
      concurrency: 3,
    })

    revalidatePath("/ai-evaluation")
    revalidatePath("/titles")
    return { status: "ok", report }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}
