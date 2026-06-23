/**
 * API pública da camada de orquestração de dependências (Fase B passo 1).
 * Ver ARQUITETURA-ORQUESTRACAO.md. Esta fase entrega só a infra central;
 * a integração com os fluxos reais (review summary/digest, taste_profile,
 * Potencial de Interesse, recálculo) vem nas fases seguintes.
 */

export {
  ACTION_CONTRACTS,
  DATA_KEY_PRODUCER,
  MANUAL_DATA_INSTRUCTIONS,
  MIN_RATED_WORKS_FOR_PROFILE,
  getContract,
} from "./contracts"
export type {
  ActionName,
  CostTier,
  RequirementKind,
  DataKey,
  ContractInput,
  ActionContract,
  TokenEstimate,
  ContractPreconditionSnapshot,
} from "./contracts"

export {
  resolveReadiness,
  emptyReadinessSnapshot,
  toPreconditionSnapshot,
} from "./readiness"
export type { DataReadiness, PresentStale, WorkReadinessSnapshot } from "./readiness"

export { buildPlan } from "./planner"
export type { ExecutionPlan, PlanStep, StepReason, BlockedManualItem } from "./planner"

export {
  DEFAULT_MICRO_THRESHOLD_USD,
  estimateStepUsd,
  estimatePlanUsd,
  decideCost,
} from "./cost"
export type { CostDecision, DecideCostArgs } from "./cost"

export {
  InMemoryJobStore,
  SupabaseJobStore,
  getJobStore,
  runOrchestratedJob,
  sanitizeErrorMessage,
  __resetJobStoreCache,
} from "./jobs"
export type {
  JobStore,
  JobRecord,
  JobStatus,
  ClaimInput,
  ClaimResult,
  RunJobParams,
  RunJobResult,
} from "./jobs"

export { createOrchestrator } from "./executor"
export type {
  ActionRunner,
  ActionRunnerCtx,
  EnsureActionReadyInput,
  EnsureResult,
  OrchestratorDeps,
} from "./executor"
