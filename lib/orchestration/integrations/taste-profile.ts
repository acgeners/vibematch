/**
 * Integração de `ensure_taste_profile` com a orquestração durável (Fase B passo 3)
 * — ver ARQUITETURA-ORQUESTRACAO.md.
 *
 * O perfil de gosto é GLOBAL (work_id = null) e a geração é `metered` (Sonnet
 * sobre N obras). Esta camada adiciona readiness, gate de custo (cascata +
 * micro-threshold), job durável, dedup cross-processo, single-flight, falha
 * persistida e retry/resume — SEM mudar o resultado funcional: mesmos
 * modelo/prompt/schema/critérios, mesmo `input_hash`, mesmos efeitos da criação
 * (nova versão, perfil anterior deixa de ser o atual, previsões de Interesse
 * marcadas stale — tudo dentro de insertNewTasteProfile, injetado via gateway).
 *
 * Pré-autorização de custo é do PONTO DE ENTRADA. NÃO usa a pré-autorização do
 * save de reviews. Geração só com autorização explícita (allowPaid) — uma ação
 * paga iniciada pelo usuário conta como essa autorização.
 *
 * IO injetável (gateway de DB+geração, jobStore) ⇒ testes sem DB/LLM; o smoke usa
 * SupabaseJobStore real com gerador no-op (não persiste taste_profile).
 */

import "server-only"
import { computeCostUsd } from "@/lib/ai/pricing"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import {
  computeInputHash,
  insertNewTasteProfile,
  loadCurrentTasteProfile,
  MIN_WORKS_FOR_FULL_PROFILE,
} from "@/lib/ai-recommendation/taste-profile"
import { generateTasteProfile, MODEL, PROMPT_VERSION } from "@/lib/ai-recommendation/service"
import type { RatedWorkInput, TasteProfileRow } from "@/lib/ai-recommendation/types"
import { DEFAULT_MICRO_THRESHOLD_USD, gateActionCost } from "../cost"
import { getJobStore, runOrchestratedJob, type JobStore } from "../jobs"

// ---- Readiness (puro) ------------------------------------------------------

export type TasteProfileReadiness =
  | { state: "fresh" }
  | { state: "absent" }
  | { state: "stub" }
  | { state: "stale" }

/**
 * Readiness do perfil a partir dos sinais existentes: perfil atual + is_stub +
 * input_hash vs hash da biblioteca elegível. Espelha a lógica de loadOrEnsureProfile.
 */
export function classifyTasteProfileReadiness(args: {
  current: { isStub: boolean; inputHash: string } | null
  libraryHash: string
}): TasteProfileReadiness {
  if (!args.current) return { state: "absent" }
  if (args.current.isStub) return { state: "stub" }
  if (args.current.inputHash !== args.libraryHash) return { state: "stale" }
  return { state: "fresh" }
}

export function tasteProfileDedupKey(inputHash: string): string {
  return `ensure_taste_profile:${inputHash}:${PROMPT_VERSION}`
}

// ---- Gateway (IO injetável) ------------------------------------------------

export interface TasteProfileGateway {
  loadCurrent(): Promise<TasteProfileRow | null>
  loadRatedWorks(): Promise<RatedWorkInput[]>
  /**
   * Gera (LLM) + persiste nova versão COM todos os efeitos (markAllProfilesAsStale +
   * markSynopsisPredictionsStale, dentro de insertNewTasteProfile). Retorna o perfil
   * persistido e o custo real (quando há usage).
   */
  generateAndPersist(
    ratedWorks: RatedWorkInput[],
    inputHash: string,
  ): Promise<{ profile: TasteProfileRow; costUsd: number }>
}

class SupabaseTasteProfileGateway implements TasteProfileGateway {
  async loadCurrent() {
    return loadCurrentTasteProfile()
  }
  async loadRatedWorks() {
    return getRatedWorksForProfile()
  }
  async generateAndPersist(ratedWorks: RatedWorkInput[], inputHash: string) {
    const result = await generateTasteProfile(ratedWorks)
    const profile = await insertNewTasteProfile({
      profile: result.profile,
      nWorks: ratedWorks.length,
      inputHash,
      isStub: false,
      modelName: result.modelName,
      promptVersion: result.promptVersion,
      rawResponse: result.rawResponse,
    })
    const c = computeCostUsd(result.modelName, result.usage)
    return { profile, costUsd: c.costInputUsd + c.costOutputUsd + c.costCacheReadUsd + c.costCacheCreationUsd }
  }
}

// ---- Resultado + opções ----------------------------------------------------

export type EnsureTasteProfileOutcome =
  | { status: "fresh"; profile: TasteProfileRow }
  | { status: "stale"; profile: TasteProfileRow }
  | { status: "succeeded"; profile: TasteProfileRow; ranLlm: boolean; costUsd: number }
  | { status: "processing" }
  | { status: "blocked_manual"; ratedWorksCount: number; required: number; message: string }
  | { status: "blocked_cost_confirmation"; reason: "threshold" | "over_cap" | "pricing_unknown"; estimatedUsd: number; likelyUsd: number; ratedWorksCount: number }
  | { status: "failed"; error: string }

export interface EnsureTasteProfileDeps {
  /** Pré-autoriza o custo metered. Sem isso, stale/absent/stub elegível ⇒ confirmação. */
  allowPaid?: boolean
  maxCostUsd?: number
  microThresholdUsd?: number
  /** Default true. false ⇒ perfil stale é devolvido como está (sem regenerar). */
  refreshIfStale?: boolean
  jobStore?: JobStore
  gateway?: TasteProfileGateway
  /** Telemetria de dedup in-process (preserva recordCacheEventAsync). */
  onWaiter?: () => void
  /** Obras já lidas (evita re-query no caminho do regenerate). */
  ratedWorks?: RatedWorkInput[]
}

function insufficientMsg(count: number): string {
  return `Perfil de gosto precisa de ao menos ${MIN_WORKS_FOR_FULL_PROFILE} obras avaliadas com nota pessoal (você tem ${count}). Avalie mais obras para destilar um perfil não-stub.`
}

export async function ensureTasteProfile(
  deps: EnsureTasteProfileDeps = {},
): Promise<EnsureTasteProfileOutcome> {
  const gateway = deps.gateway ?? new SupabaseTasteProfileGateway()
  const micro = deps.microThresholdUsd ?? DEFAULT_MICRO_THRESHOLD_USD
  const allowPaid = deps.allowPaid ?? false
  const refreshIfStale = deps.refreshIfStale ?? true

  const ratedWorks = deps.ratedWorks ?? (await gateway.loadRatedWorks())
  const count = ratedWorks.length
  const libraryHash = computeInputHash(ratedWorks)
  const current = await gateway.loadCurrent()

  const readiness = classifyTasteProfileReadiness({
    current: current ? { isStub: current.is_stub, inputHash: current.input_hash } : null,
    libraryHash,
  })

  // Perfil atual e fresh ⇒ devolve já; sem job, sem LLM, custo zero.
  if (readiness.state === "fresh" && current) return { status: "fresh", profile: current }

  // Não-fresh exige geração. Sem obras suficientes ⇒ bloqueio manual (não cria
  // perfil artificial pra destravar).
  if (count < MIN_WORKS_FOR_FULL_PROFILE) {
    return { status: "blocked_manual", ratedWorksCount: count, required: MIN_WORKS_FOR_FULL_PROFILE, message: insufficientMsg(count) }
  }

  // Stale + caller não pediu refresh ⇒ continua usando o perfil anterior (não
  // regenera silenciosamente; não transforma leitura em atualização paga).
  if (readiness.state === "stale" && !refreshIfStale && current) {
    return { status: "stale", profile: current }
  }

  // absent | stub | (stale + refreshIfStale): gerar, com gate de custo (metered,
  // escalado pela quantidade real de obras; upper bound conservador).
  const gate = gateActionCost("ensure_taste_profile", count, { allowPaid, maxCostUsd: deps.maxCostUsd, microThresholdUsd: micro })
  if ("blocked" in gate) {
    return { status: "blocked_cost_confirmation", reason: gate.blocked, estimatedUsd: gate.estimatedUsd, likelyUsd: gate.likelyUsd, ratedWorksCount: count }
  }
  const estimatedUsd = gate.estimatedUsd

  const jobStore = deps.jobStore ?? (await getJobStore())
  let produced: TasteProfileRow | null = null
  let ranLlm = false
  let costUsd = 0
  const run = await runOrchestratedJob(
    jobStore,
    {
      action: "ensure_taste_profile",
      workId: null, // global
      dedupKey: tasteProfileDedupKey(libraryHash),
      estimateUsd: estimatedUsd,
      payload: { inputHash: libraryHash, n: count, model: MODEL, promptVersion: PROMPT_VERSION },
      onWaiter: deps.onWaiter,
    },
    async () => {
      // Re-check anti-cobrança-dupla: outro processo pode já ter gerado fresh.
      const fresh = await gateway.loadCurrent()
      if (fresh && !fresh.is_stub && fresh.input_hash === libraryHash) {
        produced = fresh
        return { costActualUsd: 0 }
      }
      const gen = await gateway.generateAndPersist(ratedWorks, libraryHash)
      produced = gen.profile
      ranLlm = true
      costUsd = gen.costUsd
      return { costActualUsd: gen.costUsd }
    },
  )

  if (run.status === "processing") return { status: "processing" }
  if (run.status === "failed") return { status: "failed", error: run.error instanceof Error ? run.error.message : String(run.error) }
  if (produced) return { status: "succeeded", profile: produced, ranLlm, costUsd }
  // Waiter do single-flight (outra chamada in-process executou a geração): o
  // `fn` desta chamada não rodou, então `produced` ficou null. Recarrega o perfil
  // que o runner persistiu — sem custo, sem LLM próprio.
  const after = await gateway.loadCurrent()
  if (after) return { status: "succeeded", profile: after, ranLlm: false, costUsd: 0 }
  return { status: "failed", error: "Geração concluiu sem perfil." }
}
