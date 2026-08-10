/**
 * Backfill orquestrado — Etapa 2A: executor SEGURO para taste profile +
 * Potencial de Interesse (+ recalculate_scores final quando aplicável).
 * Ver PLANO-BACKFILL-ORQUESTRADO.md §29 e ARQUITETURA-ORQUESTRACAO.md.
 *
 * Este módulo é o DOMÍNIO do backfill (a CLI em scripts/backfill-work-data.ts é
 * uma casca fina). NÃO duplica readiness/custo/jobs: reusa `ensureTasteProfile`,
 * `ensurePredictInterest`, `ensureRecalculateScores`, `estimateStep` e os jobs
 * duráveis. Todo IO é INJETÁVEL (gateways + ensure-fns + recalc + jobStore) ⇒ testes
 * sem DB/LLM. NÃO executa nada por import — só `runInterestBackfill` (chamado
 * explicitamente pela CLI) inicia trabalho real.
 *
 * Garantias: dry-run read-only por padrão; assinatura estável do plano;
 * confirmação verificável (re-plano + comparação de assinatura + teto);
 * pré-autorização limitada ao plano aprovado; gate de custo AGREGADO (o lote é
 * metered mesmo com previsões individuais < micro-threshold); resume derivado do
 * estado; cancelamento cooperativo; perfil/recalc no máximo 1×.
 */

import "server-only"
import { createHash } from "node:crypto"
import { PRICING_SNAPSHOT_TAG } from "@/lib/ai/pricing"
import { computeProfileStalenessKey, computeInputHash, loadCurrentTasteProfile, MIN_WORKS_FOR_FULL_PROFILE } from "@/lib/ai-recommendation/taste-profile"
import type { TasteProfileRow } from "@/lib/ai-recommendation/types"
import { MODEL as PREDICT_MODEL } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import { resolveInterestPromptVersion } from "@/lib/ai-evaluation/compiled-preferences"
import { estimateStep } from "../cost"
import { makeUsdScale } from "@/lib/format/money"
import { getJobStore, ABANDONED_JOB_THRESHOLD_MS, type JobStore } from "../jobs"
import { isProductionBuildPhase } from "../integrations/build-phase"
import {
  SYNOPSIS_INTEREST_SCHEMA_VERSION,
  computeInterestInputSignature,
  ensurePredictInterest,
  bestRawSynopsis,
  SupabaseInterestGateway,
  type DefaultPredictFn,
  type InterestGateway,
  type InterestWorkData,
  type StoredPrediction,
  type SynopsisSource,
} from "../integrations/synopsis-interest"
import { formatDigestForPrompt } from "@/lib/synopsis-interest/contextual-package"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import {
  ensureTasteProfile,
  classifyTasteProfileReadiness,
  type EnsureTasteProfileDeps,
  type EnsureTasteProfileOutcome,
} from "../integrations/taste-profile"

// ============================================================================
// Tipos
// ============================================================================

export type ProfilePolicy = "default"
export type BackfillProfileState = "fresh" | "stale" | "blocked_manual"
export type ProfileAction = "none" | "regenerate" | "blocked"
export type WorkPredictState =
  | "fresh_modern"
  | "fresh_legacy"
  | "stale_modern"
  | "stale_legacy"
  | "absent"
  | "blocked"
export type ItemReason = "stale_modern" | "stale_legacy" | "absent" | "profile_regen"

/** Escopo de planejamento (Correção 2A.1 — piloto explícito). `maxCostUsd` é
 *  proteção financeira, NÃO seletor de escopo. */
export type BackfillScope =
  | { kind: "full" }
  | { kind: "ids"; workIds: string[] }
  | { kind: "limit"; limit: number }

/** Token usado como `profileSignature` esperada quando o perfil será regenerado
 *  (a assinatura do perfil novo é desconhecida no dry-run). Constante ⇒ a
 *  assinatura do PLANO segue determinística e sensível a mudanças de obra. */
export const PENDING_PROFILE_REGEN = "PENDING_PROFILE_REGEN"

/** Idade (ms) acima da qual um job queued/running é SINALIZADO como possivelmente
 *  abandonado. O dono do número é `../jobs` — é lá que ele também DECIDE a retomada,
 *  e um limite só para o aviso faria o dry-run e o executor discordarem sobre o que
 *  é abandono. Reexportado porque a CLI e os testes já o importam daqui. */
export { ABANDONED_JOB_THRESHOLD_MS }

export interface InterestBackfillPlanItem {
  workId: string
  currentState: WorkPredictState
  /** Assinatura de entrada esperada (full no modo fresh; profile-independente no
   *  modo regen). NUNCA contém sinopse/perfil/reviews/prompt íntegros. */
  expectedInputSignature: string
  expectedProfileSignature: string
  synopsisSource: SynopsisSource | null
  likelyUsd: number
  upperBoundUsd: number
  reason: ItemReason
}

export interface AbandonedJobInfo {
  action: string
  workId: string | null
  status: "queued" | "running"
  ageMs: number
  dedupKey: string
}

export interface InterestBackfillPlan {
  planSignature: string
  createdForProfilePolicy: ProfilePolicy
  profileState: BackfillProfileState
  profileSignature: string | null
  profileFunctionalVersion: number | null
  libraryInputHash: string
  profileAction: ProfileAction
  /** Escopo aplicado. `scopeWorkIds` = obras efetivamente selecionadas (ordenadas). */
  scopeKind: "full" | "ids" | "limit"
  scopeWorkIds: string[]
  scopeLimit: number | null
  /** IDs pedidos em `--work-id` que NÃO existem entre as obras ativas (erro/bloqueio). */
  requestedButMissing: string[]
  totalWorks: number
  eligible: number
  fresh: number
  stale: number
  absent: number
  blocked: number
  processing: number
  failed: number
  /** Obras com job de previsão `failed` (transiente; NÃO entra na assinatura).
   *  O executor só as reprocessa com `retryFailed=true`. */
  failedWorkIds: string[]
  itemsToPredict: InterestBackfillPlanItem[]
  estimatedLikelyUsd: number
  estimatedUpperBoundUsd: number
  /** Teto MÍNIMO necessário p/ confirmar (= upper bound da cascata). */
  minMaxCostUsd: number
  recommendedConcurrency: { predict_interest_potential: number; ensure_taste_profile: number; recalculate_scores: number }
  recalcPlanned: boolean
  actionVersions: { model: string; promptVersion: string; schemaVersion: string; costVersion: string }
  abandonedJobs: AbandonedJobInfo[]
  warnings: string[]
  /** Metadado — NÃO entra na assinatura. */
  createdAt: string
}

export interface InterestBackfillReport {
  planSignature: string
  planned: number
  started: number
  freshSkipped: number
  succeeded: number
  failed: number
  processing: number
  blocked: number
  changedDuringRun: number
  stoppedByCost: boolean
  stoppedByPlanChange: boolean
  stoppedByCancel: boolean
  estimatedLikelyUsd: number
  estimatedUpperBoundUsd: number
  actualUsd: number
  durationMs: number
  lastSanitizedError: string | null
  profileUpdated: boolean
  recalcExecuted: boolean
  /** Recalc obrigatório (pós regeneração do perfil) que NÃO concluiu ⇒ pós-processamento falho, resume gratuito. */
  recalcFailed: boolean
  errors: string[]
}

// ============================================================================
// Gateway de PLANEJAMENTO (bulk, read-only) — distinto do InterestGateway
// (per-obra, usado na EXECUÇÃO). Ambos injetáveis.
// ============================================================================

export interface BackfillWork extends InterestWorkData {
  workId: string
}

export interface BackfillJobInfo {
  action: string
  workId: string | null
  status: "queued" | "running" | "succeeded" | "failed" | "skipped"
  dedupKey: string
  createdAt: string | null
  startedAt: string | null
}

export interface InterestBackfillGateway {
  /** Obras ATIVAS (is_archived=false) com sinopse resolvida (canonical/raw). */
  listWorks(): Promise<BackfillWork[]>
  /** Previsões da prompt_version ATUAL, por obra (linhas obsoletas são histórico). */
  listPredictions(promptVersion: string): Promise<Map<string, StoredPrediction>>
  /** Perfil corrente + hash da biblioteca elegível + contagem de obras rotuladas. */
  loadProfileSnapshot(): Promise<{ current: TasteProfileRow | null; libraryInputHash: string; ratedWorksCount: number }>
  /** Jobs recentes das ações do backfill (p/ processing/failed/abandono). */
  listBackfillJobs(): Promise<BackfillJobInfo[]>
}

const BACKFILL_ACTIONS = ["predict_interest_potential", "ensure_taste_profile", "recalculate_scores"]

// ============================================================================
// Classificação por obra (expansão rotulada de classifyInterestReadiness)
// ============================================================================

/**
 * Estado efetivo da previsão de UMA obra (dual-read). Espelha
 * `classifyInterestReadiness` adicionando o rótulo moderno/legado:
 *  - input_signature != null ⇒ moderno (compara assinatura completa);
 *  - input_signature == null ⇒ legado (flag stale + taste_profile_hash).
 * Uma linha antiga stale NÃO invalida a linha corrente fresh (a seleção da linha
 * efetiva é por prompt_version atual — feita no gateway, UNIQUE(work_id,prompt_version)).
 */
export function classifyWorkPredictState(args: {
  stored: StoredPrediction | null
  expectedSignature: string
  currentProfileSignature: string | null
}): WorkPredictState {
  if (!args.stored) return "absent"
  if (args.stored.inputSignature != null) {
    return args.stored.inputSignature === args.expectedSignature ? "fresh_modern" : "stale_modern"
  }
  if (args.stored.stale) return "stale_legacy"
  return args.currentProfileSignature != null && args.stored.tasteProfileHash === args.currentProfileSignature
    ? "fresh_legacy"
    : "stale_legacy"
}

function resolveSynopsis(w: InterestWorkData): { synopsis: string; source: SynopsisSource } | null {
  if (w.canonicalSynopsis && w.canonicalSynopsis.trim()) return { synopsis: w.canonicalSynopsis.trim(), source: "canonical" }
  if (w.rawSynopsis && w.rawSynopsis.trim()) return { synopsis: w.rawSynopsis.trim(), source: "raw_fallback" }
  return null
}

// ============================================================================
// Assinatura do plano (determinística; sem timestamp, sem ordem do banco)
// ============================================================================

const round6 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n)

export interface PlanSignatureInput {
  scope: { kind: "full" | "ids" | "limit"; limit: number | null; selected: string[]; missing: string[] }
  profilePolicy: ProfilePolicy
  profileState: BackfillProfileState
  libraryInputHash: string
  profileSignatureOrRegen: string
  profileFunctionalVersion: number | null
  model: string
  promptVersion: string
  schemaVersion: string
  costVersion: string
  items: Array<{ workId: string; expectedInputSignature: string; reason: ItemReason }>
  plannedActions: { profile: boolean; predictCount: number; recalc: boolean }
  likelyUsd: number
  upperBoundUsd: number
}

/** Assinatura canônica (sha256). Listas ordenadas; sem timestamp/ordem de query. */
export function computeInterestPlanSignature(input: PlanSignatureInput): string {
  const canonical = JSON.stringify({
    scope: {
      kind: input.scope.kind,
      limit: input.scope.limit,
      selected: [...input.scope.selected].sort(),
      missing: [...input.scope.missing].sort(),
    },
    profilePolicy: input.profilePolicy,
    profileState: input.profileState,
    libraryInputHash: input.libraryInputHash,
    profileSignature: input.profileSignatureOrRegen,
    profileFunctionalVersion: input.profileFunctionalVersion,
    model: input.model,
    promptVersion: input.promptVersion,
    schemaVersion: input.schemaVersion,
    costVersion: input.costVersion,
    items: [...input.items]
      .map((i) => ({ w: i.workId, s: i.expectedInputSignature, r: i.reason }))
      .sort((a, b) => a.w.localeCompare(b.w)),
    plannedActions: input.plannedActions,
    likelyUsd: round6(input.likelyUsd),
    upperBoundUsd: round6(input.upperBoundUsd),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

// ============================================================================
// PLANNER (dry-run; read-only)
// ============================================================================

export interface PlanInterestBackfillDeps {
  gateway?: InterestBackfillGateway
  profilePolicy?: ProfilePolicy
  /** Escopo do planejamento (default: catálogo completo). */
  scope?: BackfillScope
  now?: () => number
}

const PREDICT_STEP = () => estimateStep("predict_interest_potential", 1)

/**
 * Aplica o escopo às obras ativas. Determinístico:
 *  - full  → todas;
 *  - ids   → só as pedidas (ordem da seleção é por id ASC); IDs ausentes/arquivados
 *            NÃO entram silenciosamente — vão p/ `missing`;
 *  - limit → as N primeiras por `work_id` ASC (ordenação estável e documentada).
 */
function applyScope(works: BackfillWork[], scope: BackfillScope): { selected: BackfillWork[]; missing: string[] } {
  if (scope.kind === "ids") {
    const requested = [...new Set(scope.workIds)]
    const byId = new Map(works.map((w) => [w.workId, w]))
    const selected: BackfillWork[] = []
    const missing: string[] = []
    for (const id of requested) {
      const w = byId.get(id)
      if (w) selected.push(w)
      else missing.push(id)
    }
    selected.sort((a, b) => a.workId.localeCompare(b.workId))
    return { selected, missing }
  }
  if (scope.kind === "limit") {
    const sorted = [...works].sort((a, b) => a.workId.localeCompare(b.workId))
    return { selected: sorted.slice(0, Math.max(0, scope.limit)), missing: [] }
  }
  return { selected: works, missing: [] }
}

export async function planInterestBackfill(deps: PlanInterestBackfillDeps = {}): Promise<InterestBackfillPlan> {
  const gateway = deps.gateway ?? new SupabaseInterestBackfillGateway()
  const profilePolicy = deps.profilePolicy ?? "default"
  const scope: BackfillScope = deps.scope ?? { kind: "full" }
  const now = deps.now ?? Date.now
  // Peça 2: versão de prompt ATIVA (v3 base / v4 com preferências). Planejamento,
  // leitura de previsões e assinaturas seguem o que ensurePredictInterest vai gravar.
  const promptVersion = resolveInterestPromptVersion()

  const [works, predictions, profileSnap, jobs] = await Promise.all([
    gateway.listWorks(),
    gateway.listPredictions(promptVersion),
    gateway.loadProfileSnapshot(),
    gateway.listBackfillJobs(),
  ])

  // ---- Escopo (piloto explícito; maxCostUsd NÃO é seletor) ----
  const { selected: scopedWorks, missing: requestedButMissing } = applyScope(works, scope)

  // ---- Estado do perfil (objetivo: hash da biblioteca vs hash do perfil) ----
  const readiness = classifyTasteProfileReadiness({
    current: profileSnap.current ? { isStub: profileSnap.current.is_stub, inputHash: profileSnap.current.input_hash } : null,
    libraryHash: profileSnap.libraryInputHash,
  })
  // Chave determinística (fingerprint), coerente com o que o store grava. Um
  // backfill EXPLÍCITO re-prevê linhas de chave-antiga (migração intencional).
  const currentProfileSignature =
    profileSnap.current && !profileSnap.current.is_stub ? computeProfileStalenessKey(profileSnap.current) : null

  let profileState: BackfillProfileState
  let profileAction: ProfileAction
  const warnings: string[] = []
  if (readiness.state === "fresh") {
    profileState = "fresh"
    profileAction = "none"
  } else if (profileSnap.ratedWorksCount < MIN_WORKS_FOR_FULL_PROFILE) {
    profileState = "blocked_manual"
    profileAction = "blocked"
    warnings.push(`Perfil não-fresh e só ${profileSnap.ratedWorksCount} obras rotuladas (< ${MIN_WORKS_FOR_FULL_PROFILE}) — nenhuma previsão planejada.`)
  } else {
    profileState = "stale"
    profileAction = "regenerate"
    if (scope.kind === "full") {
      warnings.push("Perfil stale: o plano regenera o perfil 1× e prevê TODAS as obras elegíveis (não prevê parcialmente contra perfil stale).")
    } else {
      warnings.push(
        "A regeneração do perfil tornará stale as previsões restantes do catálogo. Este plano atualizará somente as obras selecionadas. As demais permanecerão para um lote posterior.",
      )
    }
  }
  if (requestedButMissing.length > 0) {
    warnings.push(`${requestedButMissing.length} ID(s) pedido(s) NÃO existe(m) entre as obras ativas (inexistente/arquivada) — execução bloqueada até corrigir: ${requestedButMissing.slice(0, 5).join(", ")}${requestedButMissing.length > 5 ? "…" : ""}.`)
  }

  // ---- Jobs: processing / failed / abandono ----
  const activePredictWorkIds = new Set<string>()
  const failedPredictWorkIds = new Set<string>()
  const abandonedJobs: AbandonedJobInfo[] = []
  for (const j of jobs) {
    if (!BACKFILL_ACTIONS.includes(j.action)) continue
    if ((j.status === "queued" || j.status === "running")) {
      const ref = j.startedAt ?? j.createdAt
      const ageMs = ref ? now() - new Date(ref).getTime() : 0
      if (j.action === "predict_interest_potential" && j.workId) activePredictWorkIds.add(j.workId)
      if (ageMs >= ABANDONED_JOB_THRESHOLD_MS) {
        abandonedJobs.push({ action: j.action, workId: j.workId, status: j.status, ageMs, dedupKey: j.dedupKey })
      }
    } else if (j.status === "failed" && j.action === "predict_interest_potential" && j.workId) {
      failedPredictWorkIds.add(j.workId)
    }
  }
  if (abandonedJobs.length > 0) {
    // ⚠️ `running` velho passou a ser RETOMADO pelo `claim()` (mesmo limite). `queued` velho
    // não: ninguém o pegou para executar, e requeue não conserta isso. Por isso o aviso
    // continua — mudou o que ele significa, não o fato de haver algo torto.
    const presos = abandonedJobs.filter((j) => j.status === "queued").length
    warnings.push(
      `${abandonedJobs.length} job(s) queued/running há ≥${Math.round(ABANDONED_JOB_THRESHOLD_MS / 60000)}min — possivelmente abandonados. ` +
        `Os em 'running' são retomados na próxima tentativa; ${presos} em 'queued' NÃO (ver procedimento no PLANO).`,
    )
  }

  // ---- Classificação por obra + itens a prever (somente no escopo) ----
  let fresh = 0, stale = 0, absent = 0, blocked = 0
  const items: InterestBackfillPlanItem[] = []
  const eligibleWorkIds: string[] = []
  const scopeWorkIds = scopedWorks.map((w) => w.workId).sort()
  const predictStep = PREDICT_STEP()

  for (const w of scopedWorks) {
    const resolved = resolveSynopsis(w)
    if (!resolved) {
      blocked++
      continue
    }
    eligibleWorkIds.push(w.workId)
    // Assinatura de CLASSIFICAÇÃO (detecta fresh_modern): contra o perfil CORRENTE.
    const classifySig = computeInterestInputSignature({
      workId: w.workId,
      profileSignature: currentProfileSignature ?? PENDING_PROFILE_REGEN,
      title: w.title,
      synopsis: resolved.synopsis,
      synopsisSource: resolved.source,
      tags: w.tags,
      model: PREDICT_MODEL,
      promptVersion,
      schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
      // Frente 3: o digest entra na assinatura real da previsão; a classificação
      // precisa incluí-lo, senão obras com digest nunca casam (fresh→stale falso).
      extraSources: w.reviewDigest ? { reviewDigest: w.reviewDigest } : undefined,
    })
    const stored = predictions.get(w.workId) ?? null
    const state = classifyWorkPredictState({ stored, expectedSignature: classifySig, currentProfileSignature })
    if (state === "fresh_modern" || state === "fresh_legacy") fresh++
    else if (state === "absent") absent++
    else stale++

    // Itens a prever:
    //  - perfil fresh  ⇒ só stale/absent;
    //  - perfil stale  ⇒ TODAS as elegíveis no escopo (reason=profile_regen);
    //  - perfil blocked ⇒ nenhuma.
    if (profileState === "blocked_manual") continue
    const needsPredict =
      profileState === "stale" || state === "stale_modern" || state === "stale_legacy" || state === "absent"
    if (!needsPredict) continue
    const reason: ItemReason =
      profileState === "stale" ? "profile_regen" : state === "absent" ? "absent" : (state as "stale_modern" | "stale_legacy")
    // Assinatura do ITEM no plano confirmado:
    //  - fresh ⇒ assinatura funcional completa (contra o perfil corrente);
    //  - regen ⇒ assinatura de ESCOPO (dados próprios da obra + libraryInputHash +
    //    política de regeneração) — NÃO finge conhecer a profileSignature futura.
    const planItemSig =
      profileState === "stale"
        ? computeInterestInputSignature({
            workId: w.workId,
            profileSignature: `regen:${profileSnap.libraryInputHash}`,
            title: w.title,
            synopsis: resolved.synopsis,
            synopsisSource: resolved.source,
            tags: w.tags,
            model: PREDICT_MODEL,
            promptVersion,
            schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
            extraSources: w.reviewDigest ? { reviewDigest: w.reviewDigest } : undefined,
          })
        : classifySig
    items.push({
      workId: w.workId,
      currentState: state,
      expectedInputSignature: planItemSig,
      expectedProfileSignature: profileState === "stale" ? PENDING_PROFILE_REGEN : currentProfileSignature ?? PENDING_PROFILE_REGEN,
      synopsisSource: resolved.source,
      likelyUsd: round6(predictStep.likelyUsd),
      upperBoundUsd: round6(predictStep.upperBoundUsd),
      reason,
    })
  }

  // ---- Custo agregado da cascata (reusa estimateStep). Perfil escala com a
  //      biblioteca COMPLETA (global), não com o escopo do piloto. ----
  const profileStep = profileState === "stale" ? estimateStep("ensure_taste_profile", profileSnap.ratedWorksCount) : null
  const predictCount = items.length
  const likelyUsd = round6((profileStep?.likelyUsd ?? 0) + predictStep.likelyUsd * predictCount)
  const upperBoundUsd = round6((profileStep?.upperBoundUsd ?? 0) + predictStep.upperBoundUsd * predictCount)
  const recalcPlanned = profileState === "stale"

  const planSignature = computeInterestPlanSignature({
    scope: { kind: scope.kind, limit: scope.kind === "limit" ? scope.limit : null, selected: scopeWorkIds, missing: requestedButMissing },
    profilePolicy,
    profileState,
    libraryInputHash: profileSnap.libraryInputHash,
    profileSignatureOrRegen: profileState === "stale" ? PENDING_PROFILE_REGEN : currentProfileSignature ?? "none",
    profileFunctionalVersion: profileSnap.current?.version ?? null,
    model: PREDICT_MODEL,
    promptVersion,
    schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
    costVersion: PRICING_SNAPSHOT_TAG,
    items: items.map((i) => ({ workId: i.workId, expectedInputSignature: i.expectedInputSignature, reason: i.reason })),
    plannedActions: { profile: profileState === "stale", predictCount, recalc: recalcPlanned },
    likelyUsd,
    upperBoundUsd,
  })

  return {
    planSignature,
    createdForProfilePolicy: profilePolicy,
    profileState,
    profileSignature: currentProfileSignature,
    profileFunctionalVersion: profileSnap.current?.version ?? null,
    libraryInputHash: profileSnap.libraryInputHash,
    profileAction,
    scopeKind: scope.kind,
    scopeWorkIds,
    scopeLimit: scope.kind === "limit" ? scope.limit : null,
    requestedButMissing,
    totalWorks: scopedWorks.length,
    eligible: eligibleWorkIds.length,
    fresh,
    stale,
    absent,
    blocked,
    processing: activePredictWorkIds.size,
    failed: failedPredictWorkIds.size,
    failedWorkIds: [...failedPredictWorkIds].sort(),
    itemsToPredict: items,
    estimatedLikelyUsd: likelyUsd,
    estimatedUpperBoundUsd: upperBoundUsd,
    minMaxCostUsd: upperBoundUsd,
    recommendedConcurrency: { predict_interest_potential: 3, ensure_taste_profile: 1, recalculate_scores: 1 },
    recalcPlanned,
    actionVersions: { model: PREDICT_MODEL, promptVersion, schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION, costVersion: PRICING_SNAPSHOT_TAG },
    abandonedJobs,
    warnings,
    createdAt: new Date().toISOString(),
  }
}

// ============================================================================
// EXECUTOR (exige execute + planSignature + maxCostUsd)
// ============================================================================

export type RecalcRunner = (force: boolean) => Promise<{ status: string }>

export interface RunInterestBackfillDeps {
  planSignature: string
  maxCostUsd: number
  /** MESMO escopo do dry-run confirmado (a assinatura embute o escopo). */
  scope?: BackfillScope
  concurrency?: number
  retryFailed?: boolean
  // Injeção (testes/no-op):
  planGateway?: InterestBackfillGateway
  interestGateway?: InterestGateway
  ensureProfile?: (deps: EnsureTasteProfileDeps) => Promise<EnsureTasteProfileOutcome>
  predict?: DefaultPredictFn
  recalc?: RecalcRunner
  jobStore?: JobStore
  /** Cancelamento cooperativo: true ⇒ não inicia novos itens. */
  shouldStop?: () => boolean
  /** Validação extra (opcional) da assinatura do perfil entre itens — detecta
   *  mudança de perfil DURANTE a execução. Quando ausente, a proteção primária é
   *  o re-check por item dentro de ensurePredictInterest (descarta output stale). */
  loadCurrentProfileSignature?: () => Promise<string | null>
  now?: () => number
}

export type RunInterestBackfillResult =
  | { status: "completed" | "partial" | "completed_with_failures"; report: InterestBackfillReport }
  | { status: "plan_changed"; message: string; expected: string; actual: string }
  | { status: "blocked_cost_confirmation"; upperBoundUsd: number; maxCostUsd: number; message: string }
  | { status: "blocked_manual"; message: string }
  | { status: "profile_failed"; message: string }

const PLAN_CHANGED_MSG =
  "O catálogo ou o perfil mudou desde o dry-run. Gere um novo plano e confirme novamente."

export async function runInterestBackfill(deps: RunInterestBackfillDeps): Promise<RunInterestBackfillResult> {
  // Guarda de build: nunca executa durante `next build`/prerender.
  if (isProductionBuildPhase()) {
    return { status: "blocked_manual", message: "Execução bloqueada durante o build." }
  }
  const started = (deps.now ?? Date.now)()
  const concurrency = Math.max(1, Math.min(deps.concurrency ?? 3, 5))
  const retryFailed = deps.retryFailed ?? false
  const planGateway = deps.planGateway ?? new SupabaseInterestBackfillGateway()
  const interestGateway = deps.interestGateway ?? new SupabaseInterestGateway()
  const jobStore = deps.jobStore ?? (await getJobStore())
  const shouldStop = deps.shouldStop ?? (() => false)

  // 1) Re-plano íntegro (MESMO escopo) + comparação de assinatura. Mudança
  //    EXTERNA (perfil/biblioteca/obra) antes da execução ⇒ assinatura diverge ⇒
  //    plan_changed, sem nenhuma chamada paga.
  const plan = await planInterestBackfill({ gateway: planGateway, scope: deps.scope, now: deps.now })
  if (plan.planSignature !== deps.planSignature) {
    return { status: "plan_changed", message: PLAN_CHANGED_MSG, expected: deps.planSignature, actual: plan.planSignature }
  }
  // 1b) IDs pedidos inexistentes/arquivados ⇒ bloqueia antes de qualquer execução.
  if (plan.requestedButMissing.length > 0) {
    return { status: "blocked_manual", message: `IDs inexistentes/arquivados no escopo: ${plan.requestedButMissing.join(", ")}. Corrija e gere novo plano.` }
  }
  // 2) Teto (hard cap insuficiente) — sempre sobre o UPPER BOUND.
  if (plan.estimatedUpperBoundUsd > deps.maxCostUsd) {
    // Régua única: a frase compara os dois ("X acima do teto Y"), então formatar
    // cada um por si sairia "12,2¢ acima do teto $0,10".
    const usd = makeUsdScale(plan.estimatedUpperBoundUsd, deps.maxCostUsd)
    return {
      status: "blocked_cost_confirmation",
      upperBoundUsd: plan.estimatedUpperBoundUsd,
      maxCostUsd: deps.maxCostUsd,
      message: `Upper bound da cascata (${usd.format(plan.estimatedUpperBoundUsd)}) acima do teto (${usd.format(deps.maxCostUsd)}). Aumente --max-cost-usd ou reduza o escopo.`,
    }
  }
  if (plan.profileState === "blocked_manual") {
    return { status: "blocked_manual", message: plan.warnings[0] ?? "Perfil bloqueado (obras rotuladas insuficientes)." }
  }

  const report: InterestBackfillReport = {
    planSignature: plan.planSignature,
    planned: plan.itemsToPredict.length,
    started: 0,
    freshSkipped: 0,
    succeeded: 0,
    failed: 0,
    processing: 0,
    blocked: 0,
    changedDuringRun: 0,
    stoppedByCost: false,
    stoppedByPlanChange: false,
    stoppedByCancel: false,
    estimatedLikelyUsd: plan.estimatedLikelyUsd,
    estimatedUpperBoundUsd: plan.estimatedUpperBoundUsd,
    actualUsd: 0,
    durationMs: 0,
    lastSanitizedError: null,
    profileUpdated: false,
    recalcExecuted: false,
    recalcFailed: false,
    errors: [],
  }

  // 3) Perfil (1×) quando stale. Pré-autorizado pelo plano (allowPaid + teto).
  let resolvedProfile: TasteProfileRow | null = null
  let runningProfileSignature: string | null = plan.profileSignature
  if (plan.profileAction === "regenerate") {
    const ensureProfileFn = deps.ensureProfile ?? ensureTasteProfile
    const out = await ensureProfileFn({ allowPaid: true, maxCostUsd: deps.maxCostUsd, refreshIfStale: true, jobStore })
    switch (out.status) {
      case "succeeded":
        resolvedProfile = out.profile
        report.profileUpdated = out.ranLlm
        report.actualUsd += out.ranLlm ? out.costUsd : 0
        break
      case "fresh":
        resolvedProfile = out.profile // corrida: outro processo gerou
        break
      case "blocked_cost_confirmation":
        return { status: "blocked_cost_confirmation", upperBoundUsd: out.estimatedUsd, maxCostUsd: deps.maxCostUsd, message: "Perfil acima do teto na execução." }
      case "blocked_manual":
        return { status: "blocked_manual", message: out.message }
      case "processing":
        report.processing++
        report.durationMs = (deps.now ?? Date.now)() - started
        return { status: "partial", report }
      case "failed":
        return { status: "profile_failed", message: out.error }
      case "stale":
        return { status: "profile_failed", message: "Perfil permaneceu stale (refresh não solicitado)." }
    }
    runningProfileSignature = resolvedProfile ? computeProfileStalenessKey(resolvedProfile) : runningProfileSignature
  }

  // Injeta o perfil JÁ RESOLVIDO em ensurePredictInterest (não regenera/regate).
  const ensureProfileForPredict: (d: EnsureTasteProfileDeps) => Promise<EnsureTasteProfileOutcome> = resolvedProfile
    ? async () => ({ status: "fresh", profile: resolvedProfile! })
    : (deps.ensureProfile ?? ensureTasteProfile)

  // 4) Previsões — pool de concorrência limitado, gate de custo agregado, skip
  //    fresh, dedup durável, validação de assinatura do perfil entre itens.
  const items = plan.itemsToPredict
  const failedSet = new Set(plan.failedWorkIds)
  const predictUpper = estimateStep("predict_interest_potential", 1).upperBoundUsd
  let idx = 0
  let stop = false

  const worker = async (): Promise<void> => {
    while (!stop && idx < items.length) {
      if (shouldStop()) { report.stoppedByCancel = true; stop = true; break }
      // Soft-cap: não INICIA item que possa ultrapassar o teto (custo desconhecido
      // nunca é tratado como zero — predictUpper é finito e conservador).
      if (report.actualUsd + predictUpper > deps.maxCostUsd) { report.stoppedByCost = true; stop = true; break }
      // Perfil mudou durante a execução? Para de iniciar novos itens (validação
      // opcional; a proteção dura é o re-check por item em ensurePredictInterest).
      if (deps.loadCurrentProfileSignature) {
        const curSig = await deps.loadCurrentProfileSignature()
        if (curSig !== runningProfileSignature) { report.stoppedByPlanChange = true; stop = true; break }
      }
      const i = idx++
      const item = items[i]
      // Resume: pula obras com job de previsão `failed` quando !retryFailed (o
      // claim durável as retomaria por padrão; aqui respeitamos a opção).
      if (!retryFailed && failedSet.has(item.workId)) {
        report.blocked++
        continue
      }
      report.started++
      const out = await ensurePredictInterest(item.workId, {
        gateway: interestGateway,
        ensureProfile: ensureProfileForPredict,
        predict: deps.predict,
        jobStore,
        allowPaid: true,
        maxCostUsd: deps.maxCostUsd - report.actualUsd,
      })
      switch (out.status) {
        case "fresh":
          report.freshSkipped++
          break
        case "succeeded":
          report.succeeded++
          if (out.ranLlm) report.actualUsd += out.costUsd
          break
        case "processing":
          report.processing++
          break
        case "stale":
          report.changedDuringRun++ // obra mudou durante a previsão (output antigo descartado)
          break
        case "failed":
          report.failed++
          report.lastSanitizedError = out.error
          report.errors.push(out.error)
          break
        default:
          report.blocked++
          break
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  // 5) Recalc global FINAL (free, coalescido, work_id=null) — 1× quando o perfil
  //    foi REGENERADO. insertNewTasteProfile marca recalc_pending; este recalc
  //    (force=false) roda por causa dessa pendência e a zera no sucesso. NÃO usa
  //    `force` (que mascararia a ausência de pendência para os demais consumidores).
  if (report.profileUpdated) {
    // Default HEADLESS-SAFE: a CLI roda fora do request scope do Next, então o
    // recalc usa o caminho uncached (recalculateScoresHeadless). Mesmo contrato
    // global/free/coalescido; zera recalc_pending no sucesso.
    const recalcFn: RecalcRunner =
      deps.recalc ??
      (async () => {
        const { recalculateScoresHeadless } = await import("@/server/recalc/queue")
        return recalculateScoresHeadless()
      })
    const r = await recalcFn(false)
    report.recalcExecuted = r.status === "succeeded"
    // Recalc OBRIGATÓRIO (após regeneração do perfil) que NÃO concluiu ⇒ falha de
    // pós-processamento. "fresh" (pendência já zerada por outro caminho) não é falha.
    report.recalcFailed = r.status !== "succeeded" && r.status !== "fresh"
  }

  report.durationMs = (deps.now ?? Date.now)() - started
  const predicted = report.succeeded + report.freshSkipped === report.planned
  const noInterruptions = !report.stoppedByCost && !report.stoppedByPlanChange && !report.stoppedByCancel && report.failed === 0 && report.processing === 0
  // Etapas pagas (perfil + previsões) OK mas o recalc obrigatório falhou ⇒
  // sucesso PARCIAL com pós-processamento falho (resume gratuito disponível).
  if (predicted && noInterruptions && report.recalcFailed) {
    return { status: "completed_with_failures", report }
  }
  return { status: predicted && noInterruptions ? "completed" : "partial", report }
}

// ============================================================================
// Gateway real (Supabase, bulk, read-only)
// ============================================================================

import { createAdminClient } from "@/lib/supabase/admin"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import type { SynopsisQuality } from "@/types/domain"

type AdminClient = ReturnType<typeof createAdminClient>

export class SupabaseInterestBackfillGateway implements InterestBackfillGateway {
  constructor(private readonly sb: AdminClient = createAdminClient()) {}

  async listWorks(): Promise<BackfillWork[]> {
    const pageSize = 500
    let from = 0
    const out: BackfillWork[] = []
    for (;;) {
      const { data, error } = await this.sb
        .from("works")
        .select("id, title, canonical_synopsis, review_digest, work_tags(tags(name)), work_synopses(text, is_primary, position)")
        .eq("is_archived", false)
        .range(from, from + pageSize - 1)
      if (error) throw new Error(`listWorks: ${error.message}`)
      for (const row of data ?? []) {
        const r = row as {
          id: string
          title: string
          canonical_synopsis: string | null
          review_digest: ReviewDigest | null
          work_tags?: Array<{ tags?: { name?: string | null } | null }> | null
          work_synopses?: Array<{ text?: string | null; is_primary?: boolean | null; position?: number | null }> | null
        }
        out.push({
          workId: r.id,
          title: r.title,
          tags: (r.work_tags ?? []).map((wt) => wt.tags?.name).filter((n): n is string => Boolean(n)),
          canonicalSynopsis: r.canonical_synopsis ?? null,
          rawSynopsis: bestRawSynopsis(r.work_synopses),
          reviewDigest: formatDigestForPrompt(r.review_digest),
        })
      }
      if (!data || data.length < pageSize) break
      from += pageSize
    }
    return out
  }

  async listPredictions(promptVersion: string): Promise<Map<string, StoredPrediction>> {
    const map = new Map<string, StoredPrediction>()
    const pageSize = 1000
    let from = 0
    for (;;) {
      const { data, error } = await this.sb
        .from("synopsis_quality_predictions")
        .select("work_id, predicted_quality, input_signature, taste_profile_hash, stale")
        .eq("prompt_version", promptVersion)
        .range(from, from + pageSize - 1)
      if (error) throw new Error(`listPredictions: ${error.message}`)
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>
        map.set(r.work_id as string, {
          predictedQuality: r.predicted_quality as SynopsisQuality,
          inputSignature: (r.input_signature as string | null) ?? null,
          tasteProfileHash: (r.taste_profile_hash as string) ?? "",
          stale: Boolean(r.stale),
        })
      }
      if (!data || data.length < pageSize) break
      from += pageSize
    }
    return map
  }

  async loadProfileSnapshot() {
    const ratedWorks = await getRatedWorksForProfile()
    const current = await loadCurrentTasteProfile()
    return { current, libraryInputHash: computeInputHash(ratedWorks), ratedWorksCount: ratedWorks.length }
  }

  async listBackfillJobs(): Promise<BackfillJobInfo[]> {
    const { data, error } = await this.sb
      .from("work_processing_jobs")
      .select("action, work_id, status, dedup_key, created_at, started_at")
      .in("action", BACKFILL_ACTIONS)
      .in("status", ["queued", "running", "failed"])
    if (error) {
      // Tabela ausente (pré-migration 110) ⇒ sem jobs rastreados.
      return []
    }
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>
      return {
        action: r.action as string,
        workId: (r.work_id as string | null) ?? null,
        status: r.status as BackfillJobInfo["status"],
        dedupKey: (r.dedup_key as string) ?? "",
        createdAt: (r.created_at as string | null) ?? null,
        startedAt: (r.started_at as string | null) ?? null,
      }
    })
  }
}
