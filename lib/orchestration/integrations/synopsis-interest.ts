/**
 * Integração do "Potencial de Interesse" (técnico: synopsis_quality_predict) com
 * a orquestração durável (Fase B passo 4) — ver ARQUITETURA-ORQUESTRACAO.md.
 *
 * Adiciona readiness por ASSINATURA DE ENTRADA (fecha o gap atual: hoje só o
 * taste_profile_hash invalida; título/tags NÃO), cascata de custo (profile →
 * predict), job durável, dedup cross-processo + single-flight, staleness e
 * retry/resume. SEM mudar modelo/prompt/schema/níveis/persistência funcional/
 * “Aplicar”. NÃO inclui review_digest no prompt nesta etapa (a assinatura é
 * extensível para isso depois).
 *
 * IO injetável (gateway + ensureProfile + predictor + jobStore) ⇒ testes sem
 * DB/LLM; o smoke usa SupabaseJobStore real com predictor no-op e gateway em
 * memória (synopsis_quality_predictions intacto).
 */

import "server-only"
import { createHash } from "node:crypto"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import {
  MODEL as PREDICT_MODEL,
  PROMPT_VERSION as PREDICT_PROMPT_VERSION,
  predictSynopsisQuality,
} from "@/lib/ai-evaluation/synopsis-quality-predictor"
import { formatDigestForPrompt } from "@/lib/synopsis-interest/contextual-package"
import type { SynopsisQuality } from "@/types/domain"
import type { TasteProfilePayload, TasteProfileRow, ReviewDigest } from "@/lib/ai-recommendation/types"
import { gateActionCost, estimateStep } from "../cost"
import { getJobStore, runOrchestratedJob, type JobStore } from "../jobs"
import { ensureTasteProfile, type EnsureTasteProfileDeps, type EnsureTasteProfileOutcome } from "./taste-profile"

/** Versão do schema de saída (níveis ♥..♥♥♥♥). Bump invalida previsões. */
export const SYNOPSIS_INTEREST_SCHEMA_VERSION = "v1"

export type SynopsisSource = "canonical" | "raw_fallback"

// ---- Assinatura de entrada (pura, canônica) --------------------------------

export interface InterestSignatureParts {
  workId: string
  profileSignature: string
  title: string
  synopsis: string
  synopsisSource: SynopsisSource
  /** Nomes de tags relevantes (a função ordena/normaliza — ordem acidental não conta). */
  tags: string[]
  model: string
  promptVersion: string
  schemaVersion: string
  /** Fontes futuras (ex.: digest descritivo) — extensível sem quebrar o legado. */
  extraSources?: Record<string, string>
}

/**
 * Normalização "de materialidade" da chave de staleness (2a): lowercase, colapsa
 * whitespace interno e remove pontuação. Mudanças COSMÉTICAS (espaço/caixa/
 * pontuação/reformatação) deixam de invalidar a previsão → não re-prevê LLM à toa.
 * O texto ENVIADO ao prompt continua o ORIGINAL — isto é só a chave de detecção
 * de mudança. Medido (n=761): cosmético 100%→0%; mudança material (frase nova)
 * segue invalidando 100% (não há over-merge).
 */
function normalizeForSignature(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Assinatura determinística de TODAS as entradas funcionais que entram no prompt.
 * Exclui timestamps, ordem acidental de tags, scores, ranking, avaliação IA,
 * review_digest (nesta etapa) e secrets. Título/sinopse passam por normalização
 * de materialidade (ver normalizeForSignature) — só mudanças significativas contam.
 */
export function computeInterestInputSignature(parts: InterestSignatureParts): string {
  const canonical = JSON.stringify({
    workId: parts.workId,
    profile: parts.profileSignature,
    title: normalizeForSignature(parts.title),
    synopsis: normalizeForSignature(parts.synopsis),
    source: parts.synopsisSource,
    tags: [...parts.tags].map((t) => t.trim().toLowerCase()).filter(Boolean).sort(),
    model: parts.model,
    promptVersion: parts.promptVersion,
    schemaVersion: parts.schemaVersion,
    extra: parts.extraSources
      ? Object.entries(parts.extraSources).sort(([a], [b]) => a.localeCompare(b))
      : null,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

// ---- Readiness (puro, dual-read legado/assinatura) -------------------------

export type InterestReadinessState = "absent" | "fresh" | "stale"

export interface StoredPrediction {
  predictedQuality: SynopsisQuality
  inputSignature: string | null
  tasteProfileHash: string
  stale: boolean
}

/**
 * Readiness da previsão. Dual-read: linhas NOVAS (com input_signature) comparam
 * a assinatura completa; linhas LEGADAS (sem) caem na regra antiga (flag stale +
 * taste_profile_hash). Assim não invalidamos o catálogo pago de uma vez.
 */
export function classifyInterestReadiness(args: {
  currentSignature: string
  currentProfileSignature: string
  stored: StoredPrediction | null
}): InterestReadinessState {
  if (!args.stored) return "absent"
  if (args.stored.inputSignature != null) {
    return args.stored.inputSignature === args.currentSignature ? "fresh" : "stale"
  }
  if (args.stored.stale) return "stale"
  return args.stored.tasteProfileHash === args.currentProfileSignature ? "fresh" : "stale"
}

export function interestDedupKey(workId: string, signature: string): string {
  // signature já embute promptVersion + schemaVersion.
  return `predict_interest_potential:${workId}:${signature}`
}

// ---- Gateway (IO injetável) ------------------------------------------------

export interface InterestWorkData {
  title: string
  tags: string[]
  canonicalSynopsis: string | null
  rawSynopsis: string | null
  /** Digest de reviews JÁ formatado (texto sanitizado) — contrato e1. null sem digest. */
  reviewDigest: string | null
}

export interface InterestGateway {
  loadWork(workId: string): Promise<InterestWorkData | null>
  loadCurrentPrediction(workId: string, promptVersion: string): Promise<StoredPrediction | null>
  /** Status de um job de consolidação ATIVO (queued/running) — null se nenhum. */
  consolidationJobStatus(workId: string): Promise<"queued" | "running" | null>
  persistPrediction(args: {
    workId: string
    predictedQuality: SynopsisQuality
    justification: string | null
    confidence: number | null
    profile: TasteProfileRow
    inputSignature: string
    modelName: string
    promptVersion: string
    aiApiCallId: string | null
  }): Promise<void>
}

// ---- Resultado + opções ----------------------------------------------------

export type PredictInterestOutcome =
  | { status: "fresh"; predictedQuality: SynopsisQuality; partial: boolean; usedFallbacks: string[] }
  | { status: "succeeded"; predictedQuality: SynopsisQuality; ranLlm: boolean; costUsd: number; partial: boolean; usedFallbacks: string[] }
  | { status: "processing"; reason: "consolidating" | "in_flight" }
  | { status: "stale"; reason: "input_changed" }
  | { status: "not_ready"; reason: "no_synopsis" | "no_profile" | "insufficient_works"; message: string }
  | { status: "blocked_manual"; reason: "no_synopsis" | "insufficient_works"; message: string }
  | { status: "blocked_cost_confirmation"; reason: "threshold" | "over_cap" | "pricing_unknown" | "profile_cascade"; estimatedUsd: number; likelyUsd: number }
  | { status: "failed"; error: string }

export type DefaultPredictFn = (
  profile: TasteProfilePayload,
  work: { id: string; title: string; synopsis: string; tags: Array<{ name: string; group: string | null }>; reviewDigest?: string | null },
) => Promise<{
  predictedQuality: SynopsisQuality
  justification: string
  confidence: number | null
  modelName: string
  promptVersion: string
  apiCallId: string | null
  usageUsd: number
}>

export interface EnsurePredictInterestDeps {
  allowPaid?: boolean
  maxCostUsd?: number
  microThresholdUsd?: number
  /** Background nunca gera/atualiza perfil; só prevê com perfil fresh. */
  isBackground?: boolean
  /** Ação explícita aceita usar perfil stale como resultado parcial. */
  acceptStaleProfile?: boolean
  jobStore?: JobStore
  gateway?: InterestGateway
  ensureProfile?: (deps: EnsureTasteProfileDeps) => Promise<EnsureTasteProfileOutcome>
  predict?: DefaultPredictFn
}

function predictUpperBoundUsd(): number {
  return estimateStep("predict_interest_potential", 1).upperBoundUsd
}
function predictLikelyUsd(): number {
  return estimateStep("predict_interest_potential", 1).likelyUsd
}

/**
 * Orquestra a previsão de Potencial de Interesse de UMA obra: resolve o perfil
 * (cascata), a sinopse (canônica → fallback bruta), checa consolidação em voo,
 * readiness por assinatura, gate de custo, e roda via job durável.
 */
export async function ensurePredictInterest(
  workId: string,
  deps: EnsurePredictInterestDeps = {},
): Promise<PredictInterestOutcome> {
  const gateway = deps.gateway
  if (!gateway) throw new Error("ensurePredictInterest: gateway obrigatório (injeção).")
  const ensureProfileFn = deps.ensureProfile ?? ensureTasteProfile
  const predict = deps.predict ?? defaultPredict
  const micro = deps.microThresholdUsd
  const usedFallbacks: string[] = []

  // 1) Dependência: perfil de gosto (cascata).
  let profile: TasteProfileRow
  if (deps.isBackground) {
    // Background: nunca gera/atualiza perfil; só segue com perfil fresh.
    const p = await ensureProfileFn({ allowPaid: false, refreshIfStale: false, jobStore: deps.jobStore })
    if (p.status !== "fresh") {
      return { status: "not_ready", reason: "no_profile", message: "Perfil não-fresh — background não gera nem atualiza o perfil." }
    }
    profile = p.profile
  } else {
    const p = await ensureProfileFn({
      allowPaid: deps.allowPaid,
      maxCostUsd: deps.maxCostUsd,
      microThresholdUsd: micro,
      refreshIfStale: !deps.acceptStaleProfile,
      jobStore: deps.jobStore,
    })
    switch (p.status) {
      case "fresh":
      case "succeeded":
        profile = p.profile
        break
      case "stale":
        if (!deps.acceptStaleProfile) {
          return { status: "blocked_cost_confirmation", reason: "profile_cascade", estimatedUsd: predictUpperBoundUsd(), likelyUsd: predictLikelyUsd() }
        }
        profile = p.profile
        usedFallbacks.push("stale_profile")
        break
      case "blocked_manual":
        return { status: "blocked_manual", reason: "insufficient_works", message: p.message }
      case "blocked_cost_confirmation":
        // Cascata: soma o custo da previsão ao do perfil pra mostrar o TOTAL.
        return { status: "blocked_cost_confirmation", reason: "profile_cascade", estimatedUsd: p.estimatedUsd + predictUpperBoundUsd(), likelyUsd: p.likelyUsd + predictLikelyUsd() }
      case "processing":
        return { status: "processing", reason: "in_flight" }
      case "failed":
        return { status: "failed", error: p.error }
    }
  }

  // 2) Dependência: obra + sinopse.
  const work = await gateway.loadWork(workId)
  if (!work) return { status: "failed", error: "Obra não encontrada." }

  // Consolidação em voo ⇒ a canônica vai mudar; não prevê com input prestes a
  // mudar (evita previsão duplicada/instável).
  const consol = await gateway.consolidationJobStatus(workId)
  if (consol) return { status: "processing", reason: "consolidating" }

  let synopsis: string
  let source: SynopsisSource
  if (work.canonicalSynopsis && work.canonicalSynopsis.trim()) {
    synopsis = work.canonicalSynopsis.trim()
    source = "canonical"
  } else if (work.rawSynopsis && work.rawSynopsis.trim()) {
    synopsis = work.rawSynopsis.trim()
    source = "raw_fallback"
    usedFallbacks.push("raw_synopsis")
  } else {
    return { status: "blocked_manual", reason: "no_synopsis", message: "Obra sem sinopse utilizável — adicione/consolide a sinopse." }
  }

  // 3) Assinatura + readiness.
  const profileSignature = computeProfileSignature(profile.profile)
  const signature = computeInterestInputSignature({
    workId,
    profileSignature,
    title: work.title,
    synopsis,
    synopsisSource: source,
    tags: work.tags,
    model: PREDICT_MODEL,
    promptVersion: PREDICT_PROMPT_VERSION,
    schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
    // Frente 3: o digest entra na assinatura ⇒ mudança de digest invalida a
    // previsão (re-prevê com o consenso novo). Sem digest, extra fica null (b1).
    extraSources: work.reviewDigest ? { reviewDigest: work.reviewDigest } : undefined,
  })
  const stored = await gateway.loadCurrentPrediction(workId, PREDICT_PROMPT_VERSION)
  const readiness = classifyInterestReadiness({ currentSignature: signature, currentProfileSignature: profileSignature, stored })

  const partial = usedFallbacks.length > 0
  if (readiness === "fresh" && stored) {
    return { status: "fresh", predictedQuality: stored.predictedQuality, partial, usedFallbacks }
  }

  // 4) Gate de custo da previsão individual (single-work). Perfil fresh + custo
  // abaixo do micro-threshold ⇒ auto (inclui background).
  const gate = gateActionCost("predict_interest_potential", 1, { allowPaid: deps.allowPaid ?? false, maxCostUsd: deps.maxCostUsd, microThresholdUsd: micro })
  if ("blocked" in gate) return { status: "blocked_cost_confirmation", reason: gate.blocked, estimatedUsd: gate.estimatedUsd, likelyUsd: gate.likelyUsd }

  // 5) Job durável + predict + persist (com re-check anti-cobrança-dupla).
  const jobStore = deps.jobStore ?? (await getJobStore())
  let ranLlm = false
  let costUsd = 0
  let predicted: SynopsisQuality | null = null
  let inputChanged = false
  const run = await runOrchestratedJob(
    jobStore,
    {
      action: "predict_interest_potential",
      workId,
      dedupKey: interestDedupKey(workId, signature),
      estimateUsd: gate.estimatedUsd,
      payload: {
        workId,
        inputSignature: signature,
        profileSignature,
        synopsisSource: source,
        nTags: work.tags.length,
        model: PREDICT_MODEL,
        promptVersion: PREDICT_PROMPT_VERSION,
        schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
      },
    },
    async () => {
      // Re-check 1: as entradas mudaram DURANTE o processamento? Recomputa a
      // assinatura do estado atual (mesmo perfil) — se divergir, o output desta
      // assinatura ANTIGA é descartado (não sobrescreve um input novo). §9/§11.
      const w2 = await gateway.loadWork(workId)
      const syn2 = w2?.canonicalSynopsis?.trim() || w2?.rawSynopsis?.trim() || ""
      const src2: SynopsisSource = w2?.canonicalSynopsis?.trim() ? "canonical" : "raw_fallback"
      const sig2 = w2
        ? computeInterestInputSignature({
            workId,
            profileSignature,
            title: w2.title,
            synopsis: syn2,
            synopsisSource: src2,
            tags: w2.tags,
            model: PREDICT_MODEL,
            promptVersion: PREDICT_PROMPT_VERSION,
            schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
          })
        : null
      if (sig2 !== signature) {
        inputChanged = true
        return { costActualUsd: 0 } // input mudou ⇒ descarta o output da assinatura antiga
      }

      // Re-check 2: outro processo já persistiu a MESMA assinatura?
      const fresh2 = await gateway.loadCurrentPrediction(workId, PREDICT_PROMPT_VERSION)
      if (fresh2 && fresh2.inputSignature === signature) {
        predicted = fresh2.predictedQuality
        return { costActualUsd: 0 }
      }
      const pred = await predict(profile.profile, {
        id: workId,
        title: work.title,
        synopsis,
        tags: work.tags.map((name) => ({ name, group: null })),
        reviewDigest: work.reviewDigest,
      })
      await gateway.persistPrediction({
        workId,
        predictedQuality: pred.predictedQuality,
        justification: pred.justification,
        confidence: pred.confidence,
        profile,
        inputSignature: signature,
        modelName: pred.modelName,
        promptVersion: pred.promptVersion,
        aiApiCallId: pred.apiCallId,
      })
      predicted = pred.predictedQuality
      ranLlm = true
      costUsd = pred.usageUsd
      return { costActualUsd: pred.usageUsd }
    },
  )

  if (run.status === "processing") return { status: "processing", reason: "in_flight" }
  if (run.status === "failed") return { status: "failed", error: run.error instanceof Error ? run.error.message : String(run.error) }
  if (inputChanged) return { status: "stale", reason: "input_changed" }
  if (predicted) return { status: "succeeded", predictedQuality: predicted, ranLlm, costUsd, partial, usedFallbacks }
  // Waiter do single-flight: recarrega o que o runner persistiu.
  const after = await gateway.loadCurrentPrediction(workId, PREDICT_PROMPT_VERSION)
  if (after) return { status: "succeeded", predictedQuality: after.predictedQuality, ranLlm: false, costUsd: 0, partial, usedFallbacks }
  return { status: "failed", error: "Previsão concluiu sem resultado." }
}

// Predictor default: usa o predictor existente e devolve o custo real.
async function defaultPredict(
  profile: TasteProfilePayload,
  work: { id: string; title: string; synopsis: string; tags: Array<{ name: string; group: string | null }>; reviewDigest?: string | null },
): ReturnType<DefaultPredictFn> {
  const { computeCostUsd } = await import("@/lib/ai/pricing")
  const r = await predictSynopsisQuality({ profile, work })
  const c = computeCostUsd(r.modelName, {
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    cacheReadTokens: r.usage.cacheReadTokens,
    cacheCreationTokens: r.usage.cacheCreationTokens,
  })
  return {
    predictedQuality: r.predictedQuality,
    justification: r.justification,
    confidence: r.confidence,
    modelName: r.modelName,
    promptVersion: r.promptVersion,
    apiCallId: r.apiCallId,
    usageUsd: c.costInputUsd + c.costOutputUsd + c.costCacheReadUsd + c.costCacheCreationUsd,
  }
}

// ---- Gateway real (Supabase, dual-read/dual-write tolerante) ---------------

import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimarySynopsis, splitSynopsesFromText } from "@/lib/work-derived"
import { upsertSynopsisPrediction } from "@/server/queries/synopsis-quality"

type AdminClient = ReturnType<typeof createAdminClient>

// Probe único por processo: a coluna input_signature existe? (migration aditiva
// pode não estar aplicada — dual-read/dual-write).
let inputSigColumn: boolean | null = null
async function hasInputSignatureColumn(sb: AdminClient): Promise<boolean> {
  if (inputSigColumn != null) return inputSigColumn
  const { error } = await sb.from("synopsis_quality_predictions").select("input_signature").limit(1)
  inputSigColumn = !error
  if (error) {
    console.warn("[synopsis-interest] coluna input_signature ausente — readiness em modo legado (flag+hash). Aplique a migration.")
  }
  return inputSigColumn
}

/** APENAS para testes/smoke — reseta o probe da coluna. */
export function __resetInputSignatureProbe(): void {
  inputSigColumn = null
}

export function bestRawSynopsis(rows: Array<{ text?: string | null; is_primary?: boolean | null; position?: number | null }> | null | undefined): string | null {
  const primary = pickPrimarySynopsis(rows)
  if (!primary) return null
  const blocks = splitSynopsesFromText(primary)
  if (blocks.length === 0) return primary
  return [...blocks].sort((a, b) => b.length - a.length)[0] ?? primary
}

export class SupabaseInterestGateway implements InterestGateway {
  constructor(private readonly sb: AdminClient = createAdminClient()) {}

  async loadWork(workId: string): Promise<InterestWorkData | null> {
    const { data } = await this.sb
      .from("works")
      .select("title, canonical_synopsis, review_digest, work_tags(tags(name)), work_synopses(text, is_primary, position)")
      .eq("id", workId)
      .maybeSingle()
    if (!data) return null
    const row = data as {
      title: string
      canonical_synopsis: string | null
      review_digest: ReviewDigest | null
      work_tags?: Array<{ tags?: { name?: string | null } | null }> | null
      work_synopses?: Array<{ text?: string | null; is_primary?: boolean | null; position?: number | null }> | null
    }
    const tags = (row.work_tags ?? []).map((wt) => wt.tags?.name).filter((n): n is string => Boolean(n))
    return {
      title: row.title,
      tags,
      canonicalSynopsis: row.canonical_synopsis ?? null,
      rawSynopsis: bestRawSynopsis(row.work_synopses),
      // Contrato e1: digest já sanitizado/formatado pro prompt (null sem digest).
      reviewDigest: formatDigestForPrompt(row.review_digest),
    }
  }

  async loadCurrentPrediction(workId: string, promptVersion: string): Promise<StoredPrediction | null> {
    // select("*") evita erro quando input_signature ainda não existe (dual-read):
    // a coluna simplesmente não vem no row legado.
    const { data } = await this.sb
      .from("synopsis_quality_predictions")
      .select("*")
      .eq("work_id", workId)
      .eq("prompt_version", promptVersion)
      .maybeSingle()
    if (!data) return null
    const r = data as unknown as Record<string, unknown>
    return {
      predictedQuality: r.predicted_quality as SynopsisQuality,
      inputSignature: (r.input_signature as string | null) ?? null,
      tasteProfileHash: (r.taste_profile_hash as string) ?? "",
      stale: Boolean(r.stale),
    }
  }

  async consolidationJobStatus(workId: string): Promise<"queued" | "running" | null> {
    const { data } = await this.sb
      .from("work_processing_jobs")
      .select("status")
      .eq("work_id", workId)
      .eq("action", "consolidate_synopsis")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle()
    return data ? ((data as { status: "queued" | "running" }).status) : null
  }

  async persistPrediction(args: Parameters<InterestGateway["persistPrediction"]>[0]): Promise<void> {
    // Reusa o upsert existente (escreve tudo MENOS input_signature, preservando a
    // persistência funcional atual), depois grava a assinatura se a coluna existir.
    const up = await upsertSynopsisPrediction({
      workId: args.workId,
      predictedQuality: args.predictedQuality,
      justification: args.justification,
      confidence: args.confidence,
      tasteProfileId: args.profile.id,
      tasteProfileVersion: args.profile.version,
      tasteProfileHash: computeProfileSignature(args.profile.profile),
      modelName: args.modelName,
      promptVersion: args.promptVersion,
      aiApiCallId: args.aiApiCallId,
    })
    if (up.error) throw new Error(`Falha persistindo previsão: ${up.error}`)
    if (await hasInputSignatureColumn(this.sb)) {
      await this.sb
        .from("synopsis_quality_predictions")
        .update({ input_signature: args.inputSignature })
        .eq("work_id", args.workId)
        .eq("prompt_version", args.promptVersion)
    }
  }
}

// ---- Dry-run de LOTE (sem executar) ---------------------------------------

export interface InterestBatchPlan {
  total: number
  fresh: number
  stale: number
  absent: number
  /** true se o perfil precisa ser gerado/atualizado para o lote. */
  needsProfile: boolean
  /** Custo upper bound TOTAL da cascata (perfil 1× se preciso + previsões necessárias). */
  upperBoundUsd: number
  /** Custo provável TOTAL (sem a margem) — para exibir a faixa. */
  likelyUsd: number
}

/**
 * Dry-run: conta fresh/stale/ausentes para `workIds` e soma o custo TOTAL (perfil
 * uma vez se preciso + previsão por item NÃO-fresh). NÃO executa nada, NÃO herda
 * a pré-autorização de single-work — o lote sempre confirma.
 */
export async function planInterestBatch(
  workIds: string[],
  args: {
    gateway: InterestGateway
    profileSignature: string | null
    /** Readiness do perfil: 'fresh' não soma custo; senão soma o upper do perfil. */
    profileNeedsGeneration: boolean
    profileScale: number
  },
): Promise<InterestBatchPlan> {
  let fresh = 0
  let stale = 0
  let absent = 0
  for (const id of workIds) {
    const stored = await args.gateway.loadCurrentPrediction(id, PREDICT_PROMPT_VERSION)
    if (!stored) {
      absent += 1
      continue
    }
    // Dry-run aproxima a freshness pelo sinal disponível (assinatura/flag/hash);
    // sem recomputar a assinatura completa por obra (custaria reler tudo).
    const looksFresh =
      stored.inputSignature != null
        ? false /* assinatura existe mas não recomputada aqui ⇒ trata como a confirmar */
        : !stored.stale && args.profileSignature != null && stored.tasteProfileHash === args.profileSignature
    if (looksFresh) fresh += 1
    else stale += 1
  }
  const needs = stale + absent
  const predict = estimateStep("predict_interest_potential", 1)
  const profile = args.profileNeedsGeneration ? estimateStep("ensure_taste_profile", args.profileScale) : { likelyUsd: 0, upperBoundUsd: 0 }
  return {
    total: workIds.length,
    fresh,
    stale,
    absent,
    needsProfile: args.profileNeedsGeneration,
    upperBoundUsd: profile.upperBoundUsd + predict.upperBoundUsd * needs,
    likelyUsd: profile.likelyUsd + predict.likelyUsd * needs,
  }
}

// ---- Execução de LOTE (concorrência limitada, dedup, resume, skip fresh) ----

export interface InterestBatchReport {
  total: number
  succeeded: number
  /** já fresh ⇒ pulado, custo zero. */
  fresh: number
  failed: number
  processing: number
  /** blocked_manual / not_ready / blocked_cost / stale (input mudou). */
  blocked: number
  /** custo REAL acumulado (só dos que chamaram o provider). */
  costUsd: number
  errors: string[]
}

export interface RunInterestBatchDeps {
  gateway: InterestGateway
  ensureProfile?: (deps: EnsureTasteProfileDeps) => Promise<EnsureTasteProfileOutcome>
  predict?: DefaultPredictFn
  jobStore?: JobStore
  /** Concorrência máxima (default 3). */
  concurrency?: number
  /** Teto TOTAL da cascata (USD). Ao acumular ≥ teto, para de gastar. */
  maxCostUsd?: number
}

/**
 * Executa o lote APÓS confirmação: `ensurePredictInterest` por obra com
 * allowPaid=true (uma autorização da cascata). Concorrência limitada; o perfil é
 * gerado UMA vez (dedup por input_hash); itens fresh são pulados sem custo; jobs
 * duráveis dão dedup/resume. Respeita o teto total (para de gastar ao atingi-lo).
 * NÃO herda a pré-autorização single-work — o caller só chama isto após o dry-run
 * confirmado.
 */
export async function runInterestBatch(
  workIds: string[],
  deps: RunInterestBatchDeps,
): Promise<InterestBatchReport> {
  const report: InterestBatchReport = { total: workIds.length, succeeded: 0, fresh: 0, failed: 0, processing: 0, blocked: 0, costUsd: 0, errors: [] }
  const concurrency = Math.max(1, deps.concurrency ?? 3)
  let acc = 0
  let idx = 0

  const worker = async (): Promise<void> => {
    while (idx < workIds.length) {
      const id = workIds[idx++]
      if (deps.maxCostUsd != null && acc >= deps.maxCostUsd) {
        report.blocked += 1
        continue
      }
      const out = await ensurePredictInterest(id, {
        gateway: deps.gateway,
        ensureProfile: deps.ensureProfile,
        predict: deps.predict,
        jobStore: deps.jobStore,
        allowPaid: true,
        maxCostUsd: deps.maxCostUsd != null ? deps.maxCostUsd - acc : undefined,
      })
      switch (out.status) {
        case "fresh":
          report.fresh += 1
          break
        case "succeeded":
          report.succeeded += 1
          if (out.ranLlm) {
            acc += out.costUsd
            report.costUsd += out.costUsd
          }
          break
        case "processing":
          report.processing += 1
          break
        case "failed":
          report.failed += 1
          report.errors.push(out.error)
          break
        default:
          report.blocked += 1
          break
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return report
}
