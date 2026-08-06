"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin, getOwnerUserId } from "@/server/queries/current-user"
import {
  mirrorOwnerState,
  writeReadingState,
  ensureReadingStateWriter,
} from "@/server/queries/user-work-state"
import { recalculateForUser } from "@/server/recalc/user-recalc"
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
      revalidatePath("/fila-recomendacao")
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

    const applied = {
      synopsis_quality: prediction.predictedQuality,
      // Proveniência (Plano 3): cópia da previsão IA. NÃO muda o valor copiado.
      synopsis_quality_source: "prediction_applied" as const,
      synopsis_quality_prediction_id: prediction.id,
    }
    // O ♥ é estado pessoal (Fatia 2a) e mora SÓ no espelho do dono (Fase E). O `update` em
    // `works` que vinha antes desta linha gravava exatamente o mesmo objeto `applied`.
    const mirror = await mirrorOwnerState(await getOwnerUserId(), [workId], applied)
    if (mirror.error) return { error: `Falha aplicando previsão: ${mirror.error}` }

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
    appliedRows.push({ id, quality: prediction.predictedQuality, predictionId: prediction.id })
  }

  // FASE E: a ÚNICA escrita é o espelho — e por isso ela é quem manda nos contadores.
  //
  // ⚠️ Antes eram DUAS escritas (works + espelho) e DOIS lugares mexendo em `applied`/`failed`:
  // o loop de cima incrementava `applied` no sucesso do `works`, e este aqui fazia
  // `applied--; failed++` se o espelho falhasse depois. Com o `works` fora, contar no lugar
  // errado faria a UI dizer "12 aplicadas" com o espelho vazio. Uma escrita, um contador.
  //
  // Uma linha por previsão (cada obra tem a SUA) — não dá pra fazer um upsert só, porque o
  // valor difere por obra.
  const ownerId = await getOwnerUserId()
  for (const row of appliedRows) {
    const mirror = await mirrorOwnerState(ownerId, [row.id], {
      synopsis_quality: row.quality,
      synopsis_quality_source: "prediction_applied",
      synopsis_quality_prediction_id: row.predictionId,
    })
    if (mirror.error) failed++
    else applied++
  }

  if (applied > 0) await markRecalcPending("applySynopsisPredictionBatch")
  revalidatePath("/ai-evaluation")
  revalidatePath("/fila-recomendacao")
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
    // FASE E: só o espelho. O `update` em `works` que vinha antes gravava o mesmo booleano, e
    // era ELE que gateava o espelho (`if (!error)`) — agora o espelho é a escrita, não a cópia.
    const mirror = await mirrorOwnerState(await getOwnerUserId(), [workId], {
      synopsis_interest_skipped: skipped,
    })
    if (mirror.error) {
      // A dica da migration continua valendo, mas agora aponta pra coluna do ESPELHO (mig 138+),
      // que é onde o "Pular" de fato grava.
      if (/synopsis_interest_skipped|column|schema cache/i.test(mirror.error)) {
        return { error: "Aplique a migration 121 (synopsis_interest_skipped) pra usar o 'Pular'." }
      }
      return { error: `Falha ao pular: ${mirror.error}` }
    }
    revalidatePath("/ai-evaluation")
    revalidatePath("/fila-recomendacao")
    revalidateTag("ai-eval-tab-counts", "max")
    return { data: { skipped } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * Atribui (ou limpa) o Interesse Sinopse MANUAL (`synopsis_quality`) diretamente — sem
 * passar pela previsão IA. É o caminho GRÁTIS de triagem manual (fila
 * /fila-recomendacao?tab=sinopse e os corações da faixa na página da obra).
 * `quality = null` limpa o campo ("Não avaliada").
 *
 * ⚠️ NÃO é `ensureAdmin()`, e a distinção importa: PREVER o interesse por IA é que é
 * restrito (`applySynopsisPredictionAction`/`predictSynopsisQualityForWorkAction` gastam
 * tokens e mexem no perfil do dono). Dizer "esta sinopse me interessa" é dado PESSOAL, e
 * desde a Fatia 2a ele tem casa própria em `user_work_state` — o mesmo lugar onde o form
 * completo (`updateWorkStatus`) já grava o ♥ de qualquer usuário logado. Manter o admin aqui
 * fazia o atalho recusar o que o form ao lado aceitava.
 */
export async function setSynopsisQualityAction(
  workId: string,
  quality: SynopsisQuality | null,
): Promise<{ data?: { synopsisQuality: SynopsisQuality | null }; error?: string }> {
  try {
    const gate = await ensureReadingStateWriter()
    if (!gate.ok) return { error: gate.error }
    if (quality !== null && !(SYNOPSIS_QUALITIES as readonly string[]).includes(quality)) {
      return { error: "Valor de Interesse inválido." }
    }
    const triaged = {
      synopsis_quality: quality,
      // Proveniência (Plano 3): triagem manual direta. Limpar o ♥ zera a origem junto —
      // sem valor não há de onde ter vindo, e um CHECK no banco (migration 179) recusa
      // a linha se os dois não andarem juntos.
      synopsis_quality_source: (quality === null ? null : "human_manual") as "human_manual" | null,
      synopsis_quality_prediction_id: null,
    }
    // Cliente de SESSÃO: a RLS da mig 142 barra escrever na linha de outra pessoa. Vale pro
    // dono também — o `mirrorOwnerState` que estava aqui só existia porque o gate era admin.
    const write = await writeReadingState(gate.userId, [workId], triaged)
    if (write.error) return { error: `Falha gravando Interesse: ${write.error}` }

    if (gate.isOwner) {
      // synopsis_quality é feature do Ridge GLOBAL (treinado nos rótulos do dono) → marca
      // recálculo pendente em vez de recalcular na hora.
      await markRecalcPending("setSynopsisQuality")
    } else {
      // O modelo DELA (Fatia 2b): Ridge em TS puro, zero IA — mas ~880 obras, então não segura
      // a resposta do clique. Best-effort, igual ao ramo não-dono de `updateWorkStatus`.
      after(async () => {
        try {
          await recalculateForUser(gate.userId)
        } catch (err) {
          console.error("[setSynopsisQuality] recalc do usuário falhou:", err)
        }
      })
    }

    revalidatePath("/titles")
    // Por ROTA, não por caminho: o `/titles/${workId}` que estava aqui usava o UUID, e a
    // página é servida pelo SLUG — ou seja, revalidava um caminho que ninguém visita.
    revalidatePath("/titles/[id]", "page")
    revalidatePath("/ranking")
    revalidatePath("/ai-evaluation")
    revalidatePath("/fila-recomendacao")
    revalidateTag("ai-eval-tab-counts", "max")

    return { data: { synopsisQuality: quality } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/** Plano (dry-run) do lote — devolvido à UI antes de executar. */
export type BatchPlanResult =
  | {
      status: "ok"
      plan: InterestBatchPlan
      profileReadiness: "fresh" | "stale" | "absent" | "stub"
      /** true ⇒ a cascata vai REGENERAR o perfil (custo somado); false ⇒ prevê
       * contra o perfil atual (stale aceito). Governa `acceptStaleProfile` no run. */
      regenProfile: boolean
      /** Drift heurístico do perfil (0..1) — pra mostrar "~X% defasado" no popup. */
      driftPct: number
    }
  | { status: "blocked_manual"; message: string }
  | { status: "failed"; error: string }

/**
 * Decisão central de PERFIL para os fluxos de LOTE gated por custo (o "Prever
 * Interesse" do painel e o "Reprocessar Interesse" do /ai-evaluation). Lê o perfil
 * atual + a biblioteca UMA vez e resolve:
 *  - `readinessState`: fresh | stale | absent | stub (materialidade, não hash cru);
 *  - `driftPct`: quanto o gosto se moveu (0 quando fresh/legado/sem perfil);
 *  - `regenProfile`: se a cascata deve REGENERAR o perfil (⇒ soma ~$0,60 no custo)
 *    ou prever contra o atual. `absent`/`stub` SEMPRE regeneram (não há perfil
 *    usável); `stale` só regenera quando o drift é SEVERO (isProfileDriftSevere).
 * Assim o teto do plano e o comportamento da execução ficam consistentes, e um
 * perfil só levemente defasado não dispara a regeneração cara.
 */
async function resolveBatchProfilePlan(): Promise<{
  current: Awaited<ReturnType<typeof loadCurrentTasteProfile>>
  ratedWorksCount: number
  readinessState: "fresh" | "stale" | "absent" | "stub"
  driftPct: number
  needsGen: boolean
  regenProfile: boolean
}> {
  const { classifyTasteProfileReadiness } = await import("@/lib/orchestration/integrations/taste-profile")
  const { classifyProfileStaleness, computeHeuristicFingerprint, isProfileDriftSevere } = await import(
    "@/lib/ai-recommendation/profile-drift"
  )
  const { computeInputHash } = await import("@/lib/ai-recommendation/taste-profile")
  const { getRatedWorksForProfile } = await import("@/server/queries/recommendations")

  const ratedWorks = await getRatedWorksForProfile()
  const current = await loadCurrentTasteProfile()
  const libraryHash = computeInputHash(ratedWorks)
  const libraryFingerprint = computeHeuristicFingerprint(ratedWorks)
  const nowMs = Date.now()
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
    libraryFingerprint,
    libraryNWorks: ratedWorks.length,
    nowMs,
  })
  // driftPct só é medível com perfil não-stub existente; senão 0 (fresh/absent/stub/legado).
  let driftPct = 0
  if (readiness.state === "stale" && current && !current.is_stub) {
    driftPct = classifyProfileStaleness({
      savedFingerprint: current.heuristic_fingerprint ?? null,
      currentFingerprint: libraryFingerprint,
      savedInputHash: current.input_hash,
      currentInputHash: libraryHash,
      savedNWorks: current.n_works_used ?? 0,
      currentNWorks: ratedWorks.length,
      savedCreatedAt: current.created_at ?? null,
      nowMs,
    }).driftPct
  }
  const needsGen = readiness.state !== "fresh"
  // absent/stub: não há perfil usável ⇒ tem que gerar. stale: só se muito defasado.
  const regenProfile =
    readiness.state === "absent" ||
    readiness.state === "stub" ||
    (readiness.state === "stale" && isProfileDriftSevere(driftPct))
  return {
    current,
    ratedWorksCount: ratedWorks.length,
    readinessState: readiness.state,
    driftPct,
    needsGen,
    regenProfile,
  }
}

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
    const { computeProfileSignature, computeProfileStalenessKey, MIN_WORKS_FOR_FULL_PROFILE } = await import("@/lib/ai-recommendation/taste-profile")

    const decision = await resolveBatchProfilePlan()
    // Só a REGENERAÇÃO exige o mínimo de obras — prever contra um perfil já existente
    // (stale aceito) não gera nada, então não precisa do piso.
    if (decision.regenProfile && decision.ratedWorksCount < MIN_WORKS_FOR_FULL_PROFILE) {
      return { status: "blocked_manual", message: `Avalie ao menos ${MIN_WORKS_FOR_FULL_PROFILE} obras (você tem ${decision.ratedWorksCount}) para gerar o perfil do lote.` }
    }
    const current = decision.current
    const profileSignature = current && !current.is_stub ? computeProfileStalenessKey(current) : null
    const profileSignatureLegacy = current && !current.is_stub ? computeProfileSignature(current.profile) : null
    const plan = await planInterestBatch(ids, {
      gateway: new SupabaseInterestGateway(),
      profileSignature,
      profileSignatureLegacy,
      // Custo do perfil entra no plano SÓ quando vamos de fato regenerar (ausente/
      // stub/drift severo). stale-mas-não-severo ⇒ prevê contra o atual, custo zero.
      profileNeedsGeneration: decision.regenProfile,
      profileScale: decision.ratedWorksCount,
    })
    return { status: "ok", plan, profileReadiness: decision.readinessState, regenProfile: decision.regenProfile, driftPct: decision.driftPct }
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
      // Consistente com o plano acima: se ele NÃO incluiu o custo do perfil (stale
      // não-severo), a execução também não regenera — prevê contra o perfil atual.
      acceptStaleProfile: !planned.regenProfile,
    })

    revalidatePath("/ai-evaluation")
    revalidatePath("/fila-recomendacao")
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
  /** true ⇒ o run vai regenerar o perfil (muito defasado/ausente) antes de prever. */
  regenProfile: boolean
  /** Drift heurístico do perfil (0..1) — pra mostrar "~X% defasado" no popup. */
  driftPct: number
  /** Porção do custo que é a regeneração do perfil (0 quando regenProfile=false). */
  profileLikelyUsd: number
  profileUpperBoundUsd: number
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
    if (ids.length === 0) return { status: "ok", targetIds: [], total: 0, fresh: 0, needCalls: 0, likelyUsd: 0, upperBoundUsd: 0, regenProfile: false, driftPct: 0, profileLikelyUsd: 0, profileUpperBoundUsd: 0 }
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
    // Custo do PERFIL: o run regenera 1× quando o perfil está ausente/stub OU muito
    // defasado (drift severo). Só então soma no teto — senão o botão prometia um teto
    // sem o perfil e o 1º lote (que INCLUI a regeneração) estourava. stale-não-severo
    // ⇒ prevê contra o perfil atual, sem custo de perfil. Nada a prever ⇒ sem perfil
    // (e evita 2 leituras de DB à toa).
    const decision = targetIds.length > 0 ? await resolveBatchProfilePlan() : null
    const regenProfile = decision?.regenProfile ?? false
    const profileCost = regenProfile
      ? estimateStep("ensure_taste_profile", decision!.ratedWorksCount)
      : { likelyUsd: 0, upperBoundUsd: 0 }
    return {
      status: "ok",
      targetIds,
      total: ids.length,
      fresh: ids.length - targetIds.length,
      needCalls: targetIds.length,
      likelyUsd: profileCost.likelyUsd + per.likelyUsd * targetIds.length,
      upperBoundUsd: profileCost.upperBoundUsd + per.upperBoundUsd * targetIds.length,
      regenProfile,
      driftPct: decision?.driftPct ?? 0,
      profileLikelyUsd: profileCost.likelyUsd,
      profileUpperBoundUsd: profileCost.upperBoundUsd,
    }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}
