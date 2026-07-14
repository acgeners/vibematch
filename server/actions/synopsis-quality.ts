"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin, getOwnerUserId } from "@/server/queries/current-user"
import { mirrorOwnerState } from "@/server/queries/user-work-state"
import { ensureAiConsumption } from "@/server/queries/ai-quota"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getSynopsisPredictionForWork, getSynopsisPredictionsByWorkIds } from "@/server/queries/synopsis-quality"
import { markRecalcPending } from "@/server/recalc/queue"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { estimateStep } from "@/lib/orchestration/cost"
import {
  resolveInterestPromptVersion,
  isInterestShadowEnabled,
  COMPILED_PREFERENCES_V4_SHADOW,
} from "@/lib/ai-evaluation/compiled-preferences"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"
import type {
  InterestBatchPlan,
  InterestBatchReport,
} from "@/lib/orchestration/integrations/synopsis-interest"
import { mapInterestOutcome } from "@/lib/orchestration/integrations/interest-ui"
import type { WorkPredictResult, PredictWorkOpts } from "@/lib/orchestration/integrations/interest-ui"

/** Teto de obras por run do lote — protege gasto e a duração da request. */
const SYNOPSIS_BATCH_MAX = 100

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
    const gate = await ensureAiConsumption()
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
      revalidateTag("ai-eval-tab-counts", "max")
    }

    // MEDIDA TEMPORÁRIA — shadow A/B. Após o response, roda o arm B (bloco v4 + Item A)
    // em background, sem afetar a latência do arm A. Dispara quando o arm A rodou
    // (`succeeded`) OU já estava fresco (`fresh`) — assim "Reprever" SEMEIA o arm B pra
    // qualquer obra, mesmo sem mudança. O arm B dedupa sozinho (não re-roda se já fresco).
    // Fica como linha `prompt_version="v5s"`, não exibida como headline.
    if (
      (outcome.status === "succeeded" || outcome.status === "fresh") &&
      isInterestShadowEnabled()
    ) {
      after(async () => {
        try {
          const declaredTags = await getDeclaredTagPreferences()
          await ensurePredictInterest(workId, {
            gateway: new SupabaseInterestGateway(),
            isBackground: true,
            arm: { compiled: COMPILED_PREFERENCES_V4_SHADOW, declaredTags },
          })
        } catch (err) {
          console.warn("[shadow] arm B falhou:", err instanceof Error ? err.message : err)
        }
      })
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
    const gate = await ensureAdmin()
    if (!gate.ok) return { error: gate.error }
    const prediction = await getSynopsisPredictionForWork(workId)
    if (!prediction) return { error: "Não há previsão para esta obra." }

    const supabase = createAdminClient()
    const applied = {
      synopsis_quality: prediction.predictedQuality,
      // Proveniência (Plano 3): cópia da previsão IA. NÃO muda o valor copiado.
      synopsis_quality_source: "prediction_applied" as const,
      synopsis_quality_prediction_id: prediction.id,
    }
    const { error } = await supabase.from("works").update(applied).eq("id", workId)
    if (error) return { error: `Falha aplicando previsão: ${error.message}` }

    // O ♥ é estado pessoal (Fatia 2a) — espelha, senão o espelho do dono envelhece a cada
    // previsão aplicada e a Fase 2 não pode confiar nele.
    const mirror = await mirrorOwnerState(await getOwnerUserId(), [workId], applied)
    if (mirror.error) return { error: mirror.error }

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
  // Stopgap: só o admin (dono) muta o catálogo compartilhado. Sem canal de erro
  // nesta shape → no-op silencioso (a UI que dispara isto some pra não-admin na parte C).
  const gate = await ensureAdmin()
  if (!gate.ok) return { processed: 0, applied: 0, skipped: 0, failed: 0, capped: false }
  const ids = [...new Set((workIds ?? []).filter(Boolean))].slice(0, APPLY_BATCH_CAP)
  if (ids.length === 0) return { processed: 0, applied: 0, skipped: 0, failed: 0, capped: false }

  const supabase = createAdminClient()
  const [predictions, sourceRows] = await Promise.all([
    getSynopsisPredictionsByWorkIds(ids),
    // Guarda do `human_manual`: lê o dado PESSOAL do DONO (synopsis_quality_source) → vem do
    // espelho via a view `works_owner`, não da linha compartilhada de `works` (que vai perder
    // essas colunas).
    supabase.from("works_owner").select("id, synopsis_quality_source").in("id", ids),
  ])
  const sourceById = new Map(
    ((sourceRows.data ?? []) as Array<{ id: string; synopsis_quality_source: string | null }>).map(
      (r) => [r.id, r.synopsis_quality_source],
    ),
  )

  let applied = 0
  let skipped = 0
  let failed = 0
  // Espelha só o que REALMENTE foi aplicado (não o que foi pulado ou falhou) — um espelho que
  // registra o que não aconteceu é pior que um espelho velho.
  const appliedRows: Array<{ id: string; quality: SynopsisQuality; predictionId: string }> = []
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
    appliedRows.push({ id, quality: prediction.predictedQuality, predictionId: prediction.id })
  }

  // Uma linha por previsão (cada obra tem a SUA), em blocos — não dá pra fazer um upsert só,
  // porque o valor difere por obra.
  const ownerId = await getOwnerUserId()
  for (const row of appliedRows) {
    const mirror = await mirrorOwnerState(ownerId, [row.id], {
      synopsis_quality: row.quality,
      synopsis_quality_source: "prediction_applied",
      synopsis_quality_prediction_id: row.predictionId,
    })
    if (mirror.error) {
      failed++
      applied--
    }
  }

  if (applied > 0) await markRecalcPending("applySynopsisPredictionBatch")
  revalidatePath("/ai-evaluation")
  revalidateTag("ai-eval-tab-counts", "max")
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
    const gate = await ensureAdmin()
    if (!gate.ok) return { error: gate.error }
    const supabase = createAdminClient()
    const { error } = await supabase
      .from("works")
      .update({ synopsis_interest_skipped: skipped })
      .eq("id", workId)
    if (!error) {
      const mirror = await mirrorOwnerState(await getOwnerUserId(), [workId], {
        synopsis_interest_skipped: skipped,
      })
      if (mirror.error) return { error: mirror.error }
    }
    if (error) {
      if (/synopsis_interest_skipped|column|schema cache/i.test(error.message)) {
        return { error: "Aplique a migration 121 (synopsis_interest_skipped) pra usar o 'Pular'." }
      }
      return { error: `Falha ao pular: ${error.message}` }
    }
    revalidatePath("/ai-evaluation")
    revalidateTag("ai-eval-tab-counts", "max")
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
    const gate = await ensureAdmin()
    if (!gate.ok) return { error: gate.error }
    if (quality !== null && !(SYNOPSIS_QUALITIES as readonly string[]).includes(quality)) {
      return { error: "Valor de Interesse inválido." }
    }
    const supabase = createAdminClient()
    const triaged = {
      synopsis_quality: quality,
      // Proveniência (Plano 3): triagem manual direta. Limpar (null) zera a origem.
      synopsis_quality_source: (quality === null ? "legacy_unknown" : "human_manual") as
        | "legacy_unknown"
        | "human_manual",
      synopsis_quality_prediction_id: null,
    }
    const { error } = await supabase.from("works").update(triaged).eq("id", workId)
    if (error) return { error: `Falha gravando Interesse: ${error.message}` }

    const mirror = await mirrorOwnerState(await getOwnerUserId(), [workId], triaged)
    if (mirror.error) return { error: mirror.error }

    await markRecalcPending("setSynopsisQuality")

    revalidatePath("/titles")
    revalidatePath(`/titles/${workId}`)
    revalidatePath("/ranking")
    revalidatePath("/ai-evaluation")
    revalidateTag("ai-eval-tab-counts", "max")

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
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { status: "blocked_manual", message: gate.error }
    const ids = (workIds ?? []).slice(0, SYNOPSIS_BATCH_MAX)
    if (ids.length === 0) return { status: "failed", error: "Nenhuma obra para o lote." }

    const { SupabaseInterestGateway, planInterestBatch } = await import("@/lib/orchestration/integrations/synopsis-interest")
    const { classifyTasteProfileReadiness } = await import("@/lib/orchestration/integrations/taste-profile")
    const { computeInputHash, computeProfileSignature, computeProfileStalenessKey, MIN_WORKS_FOR_FULL_PROFILE } = await import("@/lib/ai-recommendation/taste-profile")
    const { computeHeuristicFingerprint } = await import("@/lib/ai-recommendation/profile-drift")
    const { getRatedWorksForProfile } = await import("@/server/queries/recommendations")

    const ratedWorks = await getRatedWorksForProfile()
    const libraryHash = computeInputHash(ratedWorks)
    const current = await loadCurrentTasteProfile()
    const readiness = classifyTasteProfileReadiness({
      current: current
        ? {
            isStub: current.is_stub,
            inputHash: current.input_hash,
            fingerprint: current.heuristic_fingerprint ?? null,
            nWorks: current.n_works_used,
            createdAt: current.created_at,
          }
        : null,
      libraryHash,
      libraryFingerprint: computeHeuristicFingerprint(ratedWorks),
      libraryNWorks: ratedWorks.length,
      nowMs: Date.now(),
    })
    const needsGen = readiness.state !== "fresh"
    if (needsGen && ratedWorks.length < MIN_WORKS_FOR_FULL_PROFILE) {
      return { status: "blocked_manual", message: `Avalie ao menos ${MIN_WORKS_FOR_FULL_PROFILE} obras (você tem ${ratedWorks.length}) para gerar o perfil do lote.` }
    }
    const profileSignature = current && !current.is_stub ? computeProfileStalenessKey(current) : null
    const profileSignatureLegacy = current && !current.is_stub ? computeProfileSignature(current.profile) : null
    const plan = await planInterestBatch(ids, {
      gateway: new SupabaseInterestGateway(),
      profileSignature,
      profileSignatureLegacy,
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
    const gate = await ensureAiConsumption()
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
    revalidateTag("ai-eval-tab-counts", "max")
    revalidatePath("/titles")
    return { status: "ok", report }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface InterestBackfillPlan {
  status: "ok"
  /** Obras não-frescas a processar (o run pula as já frescas — reuse). */
  targetIds: string[]
  /** Total de ids recebidos (o conjunto FILTRADO na UI). */
  total: number
  /** Já frescas na versão ATIVA (puladas sem custo). */
  fresh: number
  /** Quantas precisam de chamada LLM. */
  needCalls: number
  likelyUsd: number
  upperBoundUsd: number
}

/**
 * Dry-run do BACKFILL de Interesse sobre um conjunto de obras JÁ FILTRADO na UI
 * (respeita os filtros aplicados na aba — status, estado, mín. tags/reviews). Recebe
 * os work_ids EXIBIDOS, remove os já frescos na versão de prompt ATIVA (v4 com a
 * flag; v3 sem) e estima o custo do restante. NÃO executa nada.
 */
export async function planInterestBackfillForIds(
  workIds: string[],
): Promise<InterestBackfillPlan | { status: "blocked_manual"; message: string } | { status: "failed"; error: string }> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { status: "blocked_manual", message: gate.error }
    const ids = [...new Set((workIds ?? []).filter(Boolean))]
    if (ids.length === 0) return { status: "ok", targetIds: [], total: 0, fresh: 0, needCalls: 0, likelyUsd: 0, upperBoundUsd: 0 }
    const supabase = createAdminClient()

    // Já frescas na versão ativa ⇒ puladas (reuse). Estima só o restante.
    const activeVersion = resolveInterestPromptVersion()
    const fresh = await fetchAllRows<{ work_id: string }>(
      (from, to) =>
        supabase
          .from("synopsis_quality_predictions")
          .select("work_id")
          .eq("prompt_version", activeVersion)
          .eq("stale", false)
          .range(from, to),
      "Falha listando previsões frescas",
    )
    const freshSet = new Set(fresh.map((r) => r.work_id))
    const targetIds = ids.filter((id) => !freshSet.has(id))
    // Custo = por-obra (estimateStep com scale=1) × nº de obras, IGUAL ao
    // planInterestBatch. `estimateStep(action, N)` NÃO escala linear aqui (o custo é
    // ~fixo por CHAMADA, base domina), então multiplicamos nós — senão o teto do
    // plano vem ~1 chamada e o 1º lote de 100 estoura.
    const per = estimateStep("predict_interest_potential", 1)
    return {
      status: "ok",
      targetIds,
      total: ids.length,
      fresh: ids.length - targetIds.length,
      needCalls: targetIds.length,
      likelyUsd: per.likelyUsd * targetIds.length,
      upperBoundUsd: per.upperBoundUsd * targetIds.length,
    }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}
