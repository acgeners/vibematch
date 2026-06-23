/**
 * Planner PURO (Fase B passo 1) — ver ARQUITETURA-ORQUESTRACAO.md §5.
 *
 * Dado uma ação-alvo e um snapshot de readiness, monta o plano de execução:
 *  - pré-requisitos automáticos ausentes/stale, em ordem TOPOLÓGICA (dependências
 *    primeiro), descobertos via DATA_KEY_PRODUCER;
 *  - bloqueios manuais (entrada `required_manual` faltando, produtor manual, ou
 *    pré-condição de dado não satisfeita — ex.: <10 obras rotuladas p/ perfil);
 *  - fallbacks usados (entradas `optional_with_fallback` ausentes ⇒ resultado parcial).
 *
 * Não executa nada, não toca em IO. A ação-alvo NÃO entra em `steps` (o executor
 * a roda depois dos pré-requisitos).
 */

import {
  ACTION_CONTRACTS,
  DATA_KEY_PRODUCER,
  MANUAL_DATA_INSTRUCTIONS,
  type ActionContract,
  type ActionName,
  type ContractInput,
  type CostTier,
  type DataKey,
} from "./contracts"
import {
  resolveReadiness,
  toPreconditionSnapshot,
  type DataReadiness,
  type WorkReadinessSnapshot,
} from "./readiness"

export type StepReason = "absent" | "stale" | "partial"

export interface PlanStep {
  action: ActionName
  produces: DataKey | null
  reason: StepReason
  costTier: CostTier
}

export interface BlockedManualItem {
  dataKey: DataKey | null
  producer: ActionName | null
  instruction: string
}

export interface ExecutionPlan {
  action: ActionName
  /** Pré-requisitos a executar, dependências primeiro. Não inclui a ação-alvo. */
  steps: PlanStep[]
  /** Vazio = nada bloqueia. */
  blockedManual: BlockedManualItem[]
  /** Entradas opcionais ausentes — o resultado da ação-alvo será parcial. */
  usedFallbacks: DataKey[]
  partial: boolean
}

function needsProduction(dr: DataReadiness): StepReason | null {
  if (dr === "fresh") return null
  return dr // "absent" | "stale" | "partial"
}

function manualInstructionFor(dataKey: DataKey, producer: ActionName | null): string {
  if (producer && ACTION_CONTRACTS[producer].manualInstruction) {
    return ACTION_CONTRACTS[producer].manualInstruction!
  }
  return MANUAL_DATA_INSTRUCTIONS[dataKey] ?? `Pré-requisito manual ausente: ${dataKey}.`
}

export function buildPlan(
  action: ActionName,
  snapshot: WorkReadinessSnapshot,
): ExecutionPlan {
  const readiness = resolveReadiness(snapshot)
  const precondSnap = toPreconditionSnapshot(snapshot)

  const steps: PlanStep[] = []
  const blockedManual: BlockedManualItem[] = []
  const usedFallbacks: DataKey[] = []
  const visited = new Set<ActionName>()
  const blockedKeys = new Set<string>()

  function block(item: BlockedManualItem) {
    const key = `${item.dataKey ?? ""}:${item.producer ?? ""}`
    if (blockedKeys.has(key)) return
    blockedKeys.add(key)
    blockedManual.push(item)
  }

  function planInput(input: ContractInput) {
    const reason = needsProduction(readiness[input.dataKey])

    if (input.requirement === "optional_with_fallback") {
      if (reason) usedFallbacks.push(input.dataKey)
      return
    }

    if (input.requirement === "required_manual") {
      if (reason) {
        const producer = DATA_KEY_PRODUCER[input.dataKey]
        block({ dataKey: input.dataKey, producer, instruction: manualInstructionFor(input.dataKey, producer) })
      }
      return
    }

    // required_automatic_free | required_automatic_paid
    if (!reason) return
    const producer = DATA_KEY_PRODUCER[input.dataKey]
    if (!producer) {
      block({ dataKey: input.dataKey, producer: null, instruction: manualInstructionFor(input.dataKey, null) })
      return
    }
    if (ACTION_CONTRACTS[producer].manual) {
      block({ dataKey: input.dataKey, producer, instruction: manualInstructionFor(input.dataKey, producer) })
      return
    }
    planAction(producer, reason)
  }

  function planAction(a: ActionName, reason: StepReason) {
    if (visited.has(a)) return
    visited.add(a)
    const contract: ActionContract = ACTION_CONTRACTS[a]

    if (contract.precondition) {
      const pre = contract.precondition(precondSnap)
      if (!pre.ok) {
        block({
          dataKey: contract.produces,
          producer: a,
          instruction: pre.reason ?? contract.manualInstruction ?? `Pré-condição não satisfeita: ${a}.`,
        })
        return
      }
    }

    // Se planejar as entradas desta ação revelou um bloqueio manual (próprio ou de
    // uma dependência transitiva), a ação não pode rodar — não a emitimos como
    // passo. O executor já curto-circuita em `blockedManual`; isto só mantém
    // `steps` coerente (sem passos inexecutáveis).
    const blockedBefore = blockedManual.length
    for (const input of contract.inputs) planInput(input)
    if (blockedManual.length > blockedBefore) return
    steps.push({ action: a, produces: contract.produces, reason, costTier: contract.costTier })
  }

  // Ação-alvo: checa pré-condição própria, depois planeja só os pré-requisitos.
  const target = ACTION_CONTRACTS[action]
  if (target.precondition) {
    const pre = target.precondition(precondSnap)
    if (!pre.ok) {
      block({
        dataKey: target.produces,
        producer: action,
        instruction: pre.reason ?? target.manualInstruction ?? `Pré-condição não satisfeita: ${action}.`,
      })
    }
  }
  for (const input of target.inputs) planInput(input)

  return {
    action,
    steps,
    blockedManual,
    usedFallbacks,
    partial: usedFallbacks.length > 0,
  }
}
