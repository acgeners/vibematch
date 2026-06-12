"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureCapability } from "@/server/queries/current-user"
import { loadOrEnsureProfile } from "@/lib/ai-recommendation/ensure-profile"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import {
  getCandidateById,
  getCandidatesByIds,
} from "@/server/queries/recommendations"
import { getSynopsisPredictionForWork } from "@/server/queries/synopsis-quality"
import { markRecalcPending } from "@/server/actions/recalc-queue"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { predictAndPersistSynopsisQuality } from "@/lib/ai-evaluation/synopsis-quality-runner"
import { predictSynopsisQuality } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import type { SynopsisQuality } from "@/types/domain"

const STUB_PROFILE_ERROR =
  "Perfil de gosto ainda em modo stub — avalie mais obras com nota pessoal pra desbloquear a previsão de Interesse Sinopse."

/** Teto de obras por run do lote — protege gasto e a duração da request. */
const SYNOPSIS_BATCH_MAX = 100

export interface PredictSynopsisQualityResult {
  predictedQuality: SynopsisQuality
  justification: string
  confidence: number | null
}

/**
 * Estima o Interesse Sinopse de UMA obra sob demanda. Gate Pago
 * (`smart_shortlist`), exige perfil não-stub. NÃO toca em works.synopsis_quality
 * (campo manual) — só grava a sugestão em synopsis_quality_predictions.
 */
export async function predictSynopsisQualityForWorkAction(
  workId: string,
): Promise<{ data?: PredictSynopsisQualityResult; error?: string }> {
  try {
    const gate = await ensureCapability("smart_shortlist")
    if (!gate.ok) return { error: gate.error }

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile
    if (profile.is_stub) return { error: STUB_PROFILE_ERROR }

    const candidate = await getCandidateById(workId)
    if (!candidate) return { error: "Obra não encontrada (ou arquivada)." }
    if (!candidate.synopsis) {
      return { error: "Obra sem sinopse canônica — gere a sinopse consolidada antes de prever." }
    }

    const result = await predictAndPersistSynopsisQuality(profile, candidate)

    revalidatePath("/titles")
    revalidatePath(`/titles/${workId}`)

    return { data: result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
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
      .update({ synopsis_quality: prediction.predictedQuality })
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

export interface PredictSynopsisQualityBatchResult {
  /** Quantas previsões foram geradas e persistidas com sucesso. */
  predicted: number
  /** Quantas falharam (erro do modelo/persistência) — puladas. */
  failed: number
}

/**
 * Estima o Interesse Sinopse em LOTE para uma lista EXPLÍCITA de obras — os IDs
 * que o painel está exibindo na fila (na ordem que o usuário vê). Isso garante
 * que "Estimar N" age exatamente sobre os cards visíveis, e não sobre um
 * subconjunto à parte. Carrega o perfil uma vez e reusa um client comum (bloco
 * de perfil cacheado ⇒ chamadas 2..N mais baratas). Sequencial de propósito.
 * Corta em `SYNOPSIS_BATCH_MAX` por run (trava de custo + duração da request).
 */
export async function predictSynopsisQualityBatchAction(
  workIds: string[],
): Promise<{ data?: PredictSynopsisQualityBatchResult; error?: string }> {
  try {
    const gate = await ensureCapability("smart_shortlist")
    if (!gate.ok) return { error: gate.error }

    // Lê o perfil ATUAL (consulta barata de 1 linha) em vez de loadOrEnsureProfile
    // — o lote é chamado em blocos pequenos pelo cliente (pra mostrar progresso),
    // então recarregar o histórico de obras a cada bloco seria desperdício.
    const profile = await loadCurrentTasteProfile()
    if (!profile) return { error: "Gere o perfil de gosto antes de prever (em /recommendations)." }
    if (profile.is_stub) return { error: STUB_PROFILE_ERROR }

    const ids = (workIds ?? []).slice(0, SYNOPSIS_BATCH_MAX)
    if (ids.length === 0) {
      return { error: "Nenhuma obra para estimar." }
    }
    const todo = await getCandidatesByIds(ids)
    if (todo.length === 0) {
      return { error: "Nenhuma obra elegível (sem sinopse canônica ou arquivada)." }
    }

    const client = getAnthropicClient({ maxRetries: 6 })
    let predicted = 0
    let failed = 0
    for (const work of todo) {
      try {
        await predictAndPersistSynopsisQuality(profile, work, client)
        predicted += 1
      } catch (err) {
        failed += 1
        console.error(`[synopsis-quality] lote: falha em ${work.id}:`, err)
      }
    }

    revalidatePath("/ai-evaluation")
    revalidatePath("/titles")

    return {
      data: { predicted, failed },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}
