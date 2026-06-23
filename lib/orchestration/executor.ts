/**
 * Executor / orquestrador (Fase B passo 1) — ver ARQUITETURA-ORQUESTRACAO.md §5.
 *
 * `createOrchestrator({ runners, jobStore, config })` devolve `ensureActionReady`.
 * Os RUNNERS (funções que de fato executam cada ação) são INJETADOS — a infra
 * não está acoplada a `consolidateSynopsis`/LLM. A integração com os fluxos reais
 * é deliberadamente das fases seguintes; aqui só existe o motor genérico.
 *
 * Fluxo de `ensureActionReady`:
 *   buildPlan → blocked_manual? → estima custo → decideCost → confirmação?
 *            → executa pré-reqs em ordem (dedup) → roda a ação → estado acionável.
 */

import type { ActionName, DataKey } from "./contracts"
import { buildPlan, type BlockedManualItem, type ExecutionPlan } from "./planner"
import type { WorkReadinessSnapshot } from "./readiness"
import { DEFAULT_MICRO_THRESHOLD_USD, decideCost, estimatePlanUsd, estimateStepUsd } from "./cost"
import { runOrchestratedJob, type JobStore } from "./jobs"

export interface ActionRunnerCtx {
  workId: string | null
  action: ActionName
  scale: number
}

export type ActionRunner = (ctx: ActionRunnerCtx) => Promise<{ costActualUsd?: number } | void>

export interface EnsureActionReadyInput {
  workId: string | null
  action: ActionName
  snapshot: WorkReadinessSnapshot
  /** Pré-autoriza a cascata paga até `maxCostUsd`. Default false. */
  allowPaidDependencies?: boolean
  maxCostUsd?: number
  /** Escala de ações metered (ex.: nº de obras p/ ensure_taste_profile). */
  scaleByAction?: Partial<Record<ActionName, number>>
}

export type EnsureResult =
  | { status: "ready"; via: "complete" | "partial"; usedFallbacks: DataKey[]; ranSteps: ActionName[] }
  | { status: "blocked_manual"; missing: BlockedManualItem[] }
  | {
      status: "blocked_cost_confirmation"
      reason: "threshold" | "over_cap"
      estimatedUsd: number
      plan: ExecutionPlan
    }
  | { status: "processing"; pending: ActionName[] }
  | { status: "failed"; failed: ActionName[]; error: string }

export interface OrchestratorDeps {
  /** Runners por ação. Ausência de runner p/ um passo necessário ⇒ `failed`. */
  runners: Partial<Record<ActionName, ActionRunner>>
  jobStore: JobStore
  config?: { microThresholdUsd?: number }
  /** Override da chave de dedup (a integração real embute as assinaturas de conteúdo). */
  dedupKeyFor?: (action: ActionName, workId: string | null, snapshot: WorkReadinessSnapshot) => string
}

function defaultDedupKey(action: ActionName, workId: string | null): string {
  return `${action}:${workId ?? "global"}`
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const microThresholdUsd = deps.config?.microThresholdUsd ?? DEFAULT_MICRO_THRESHOLD_USD
  const dedupKeyFor = deps.dedupKeyFor ?? ((a, w) => defaultDedupKey(a, w))

  async function ensureActionReady(input: EnsureActionReadyInput): Promise<EnsureResult> {
    const scaleByAction = input.scaleByAction ?? {}
    const plan = buildPlan(input.action, input.snapshot)

    // 1) Bloqueio manual tem precedência — não gasta nem executa nada.
    if (plan.blockedManual.length > 0) {
      return { status: "blocked_manual", missing: plan.blockedManual }
    }

    // 2) Gate de custo sobre a CASCATA inteira (pré-reqs + ação-alvo).
    const estimatedUsd = estimatePlanUsd(plan, scaleByAction)
    const decision = decideCost({
      estimatedUsd,
      microThresholdUsd,
      allowPaid: !!input.allowPaidDependencies,
      maxCostUsd: input.maxCostUsd,
    })
    if (decision === "needs_confirmation") {
      return { status: "blocked_cost_confirmation", reason: "threshold", estimatedUsd, plan }
    }
    if (decision === "blocked_over_cap") {
      return { status: "blocked_cost_confirmation", reason: "over_cap", estimatedUsd, plan }
    }

    // 3) Executa pré-requisitos em ordem topológica, com dedup.
    const ran: ActionName[] = []
    const pending: ActionName[] = []
    for (const step of plan.steps) {
      const outcome = await runStep(step.action, input.workId, input.snapshot, scaleByAction)
      if (outcome.status === "failed") {
        return { status: "failed", failed: [step.action], error: outcome.error }
      }
      if (outcome.status === "processing") pending.push(step.action)
      else ran.push(step.action)
    }
    // Algum pré-requisito ainda rodando (outro processo/aba) ⇒ não roda a ação-alvo.
    if (pending.length > 0) return { status: "processing", pending }

    // 4) Roda a ação-alvo (se houver runner — entry-points como create/update
    //    podem não ter runner registrado aqui; nesse caso só garantimos os pré-reqs).
    const targetRunner = deps.runners[input.action]
    if (targetRunner) {
      const outcome = await runStep(input.action, input.workId, input.snapshot, scaleByAction)
      if (outcome.status === "failed") return { status: "failed", failed: [input.action], error: outcome.error }
      if (outcome.status === "processing") return { status: "processing", pending: [input.action] }
      ran.push(input.action)
    }

    return {
      status: "ready",
      via: plan.partial ? "partial" : "complete",
      usedFallbacks: plan.usedFallbacks,
      ranSteps: ran,
    }
  }

  async function runStep(
    action: ActionName,
    workId: string | null,
    snapshot: WorkReadinessSnapshot,
    scaleByAction: Partial<Record<ActionName, number>>,
  ): Promise<{ status: "ran" | "processing" } | { status: "failed"; error: string }> {
    const runner = deps.runners[action]
    if (!runner) {
      return { status: "failed", error: `Sem runner registrado para a ação "${action}".` }
    }
    const scale = scaleByAction[action] ?? 1
    const result = await runOrchestratedJob(
      deps.jobStore,
      {
        action,
        workId,
        dedupKey: dedupKeyFor(action, workId, snapshot),
        estimateUsd: estimateStepUsd(action, scale),
      },
      () => runner({ workId, action, scale }),
    )
    if (result.status === "failed") {
      return { status: "failed", error: result.error instanceof Error ? result.error.message : String(result.error) }
    }
    if (result.status === "processing") return { status: "processing" }
    return { status: "ran" }
  }

  return { ensureActionReady }
}
