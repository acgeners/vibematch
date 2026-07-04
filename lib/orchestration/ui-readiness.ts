/**
 * Face de UI do planner de orquestração (camada de apresentação — NÃO toca no
 * motor). Traduz um `ExecutionPlan` (buildPlan) + o snapshot num modelo de 3
 * níveis que os componentes consomem pra avisar o usuário ANTES de gerar:
 *
 *   - block    → falta input HARD (buildPlan.blockedManual) → desabilita + tooltip
 *   - importa  → opcional de ALTO impacto ausente → alerta âmbar (deixa clicar)
 *   - ajuda    → opcional leve ausente → só alimenta o selo de confiança
 *
 * A graduação importa/ajuda e os inputs extras (que o predictor usa mas o
 * contrato de execução não lista, ex.: review_digest no Interesse) vivem AQUI —
 * o `contracts.ts` continua descrevendo só a EXECUÇÃO. Função pura, serializável.
 */

import type { ActionName, CostTier, DataKey } from "./contracts"
import type { ExecutionPlan } from "./planner"
import type { WorkReadinessSnapshot } from "./readiness"

export type InputImpact = "importa" | "ajuda"
export type InputConfidence = "alta" | "média" | "baixa"

export interface UiReadinessItem {
  dataKey: DataKey
  label: string
  /** Instrução do que fazer (só nos itens de bloqueio). */
  instruction?: string
  /** Impacto na qualidade quando ausente (itens que enfraquecem). */
  impact?: InputImpact
  /** Frase curta do efeito de faltar (tooltip/selo). */
  hint?: string
}

export interface UiAutoStep {
  action: ActionName
  costTier: CostTier
  label: string
}

export interface UiReadiness {
  action: ActionName
  label: string
  /** Nenhum bloqueio → o botão pode disparar. */
  ready: boolean
  /** HARD ausente → desabilita + tooltip. */
  blocking: UiReadinessItem[]
  /** "importa" ausente → alerta âmbar (roda, mas fraco). */
  weakening: UiReadinessItem[]
  /** "ajuda" ausente → só o selo (sem alerta individual). */
  softMissing: UiReadinessItem[]
  /** Pré-reqs que auto-rodariam antes (com custo) — ex.: gerar o perfil. */
  autoSteps: UiAutoStep[]
  confidence: InputConfidence
}

// Rótulos humanos por DataKey (o usuário reconhece, não o nome de coluna).
const DATA_KEY_LABEL: Record<DataKey, string> = {
  work_row: "obra",
  raw_synopsis: "sinopse",
  canonical_synopsis: "sinopse consolidada",
  tags: "tags",
  tags_enriched: "tags agrupadas",
  external_ids_accepted: "fontes externas",
  platform_ratings: "notas do público",
  reviews: "reviews",
  review_summary: "resumo de reviews",
  review_digest: "resumo de reviews",
  taste_profile: "perfil de gosto",
  category_scores_ai: "avaliação IA (9 atributos)",
  calculated_scores: "nota prevista",
  interest_prediction: "previsão de interesse",
}

function labelFor(dk: DataKey | null): string {
  return dk ? DATA_KEY_LABEL[dk] ?? dk : "pré-requisito"
}

/** Input opcional que o predictor USA mas o contrato de execução não lista. */
interface ExtraSoftInput {
  dataKey: DataKey
  impact: InputImpact
  hint: string
  /** Presente no snapshot? Ausência conta como enfraquecimento. */
  present: (s: WorkReadinessSnapshot) => boolean
}

/** Bloqueio HARD expresso na UI (fora do contrato de execução) — ex.: o Veredito
 *  exige perfil não-stub, mas `run_alignment` tem inputs:[] no contrato. */
interface ExtraBlockingInput {
  dataKey: DataKey
  present: (s: WorkReadinessSnapshot) => boolean
  instruction: string
  label?: string
}

interface GeneratorUi {
  label: string
  /** Impacto de cada input opcional-com-fallback do contrato (default "ajuda"). */
  inputImpact?: Partial<Record<DataKey, InputImpact>>
  /** Inputs opcionais de UI, fora do contrato de execução. */
  extraSoft?: ExtraSoftInput[]
  /** Bloqueios HARD de UI, fora do contrato de execução. */
  extraBlocking?: ExtraBlockingInput[]
}

/**
 * Metadados de APRESENTAÇÃO por ação. Só o que a UI precisa a mais do contrato:
 * rótulo, graduação de impacto dos opcionais, e inputs extras que o predictor
 * usa mas o contrato (execução) não lista.
 */
export const GENERATOR_UI: Partial<Record<ActionName, GeneratorUi>> = {
  predict_interest_potential: {
    label: "Interesse ♥",
    inputImpact: {
      // Contrato lista canonical_synopsis + tags como optional_with_fallback.
      // Sem sinopse consolidada usa a bruta (perda pequena); tags idem.
      canonical_synopsis: "ajuda",
      tags: "ajuda",
    },
    extraSoft: [
      {
        // O predictor usa o resumo de reviews ("CONTEXTO DE LEITORES") quando
        // existe — melhora bastante o ♥ —, mas o contrato de execução não o
        // lista. Aqui é um opcional de alto impacto.
        dataKey: "review_digest",
        impact: "importa",
        hint: "melhora bastante a previsão do ♥",
        present: (s) => s.digest.present || s.summary.present,
      },
    ],
  },
  run_alignment: {
    label: "Veredito IA",
    // O contrato `run_alignment` tem inputs:[] (motor não modela). Tudo aqui.
    extraBlocking: [
      {
        // Único HARD: o ranker erra de cara com perfil stub.
        dataKey: "taste_profile",
        label: "perfil de gosto",
        present: (s) => s.tasteProfile.present && !s.tasteProfile.isStub,
        instruction: "Gere seu perfil de gosto (avalie ≥10 obras) antes do Veredito.",
      },
    ],
    extraSoft: [
      {
        // Sem os 9 atributos o veredito se apoia só em título/tags/perfil — fraco.
        // (expected_score é null exatamente quando attrs<9, então não o listo à parte.)
        dataKey: "category_scores_ai",
        impact: "importa",
        hint: "sem a avaliação IA o veredito se baseia só em título/tags/perfil",
        present: (s) => s.categoryScoresAiCount >= 9,
      },
      {
        dataKey: "canonical_synopsis",
        impact: "ajuda",
        hint: "a sinopse afina o veredito",
        present: (s) => s.canonical.present || s.rawSynopsisCount > 0,
      },
      {
        dataKey: "review_digest",
        impact: "ajuda",
        hint: "reviews afinam o veredito",
        present: (s) => s.digest.present || s.summary.present,
      },
    ],
  },
}

/**
 * Traduz o plano de execução + snapshot no modelo de 3 níveis da UI. Pura.
 * `buildPlan` continua a fonte da verdade de bloqueio/fallback/auto-steps; aqui
 * só graduamos e rotulamos pra apresentação.
 */
export function toUiReadiness(
  action: ActionName,
  plan: ExecutionPlan,
  snapshot: WorkReadinessSnapshot,
): UiReadiness {
  const ui = GENERATOR_UI[action] ?? { label: action }

  const blocking: UiReadinessItem[] = plan.blockedManual.map((b) => ({
    dataKey: (b.dataKey ?? "work_row") as DataKey,
    label: labelFor(b.dataKey),
    instruction: b.instruction,
  }))

  // Bloqueios HARD de UI (fora do contrato) — ex.: perfil não-stub p/ Veredito.
  for (const eb of ui.extraBlocking ?? []) {
    if (eb.present(snapshot)) continue
    blocking.push({
      dataKey: eb.dataKey,
      label: eb.label ?? labelFor(eb.dataKey),
      instruction: eb.instruction,
    })
  }

  const weakening: UiReadinessItem[] = []
  const softMissing: UiReadinessItem[] = []

  // Opcionais-com-fallback do contrato que caíram em fallback (parcial).
  for (const dk of plan.usedFallbacks) {
    const impact: InputImpact = ui.inputImpact?.[dk] ?? "ajuda"
    const item: UiReadinessItem = { dataKey: dk, label: labelFor(dk), impact }
    ;(impact === "importa" ? weakening : softMissing).push(item)
  }

  // Inputs extras de UI (fora do contrato) ausentes no snapshot.
  for (const ex of ui.extraSoft ?? []) {
    if (ex.present(snapshot)) continue
    const item: UiReadinessItem = {
      dataKey: ex.dataKey,
      label: labelFor(ex.dataKey),
      impact: ex.impact,
      hint: ex.hint,
    }
    ;(ex.impact === "importa" ? weakening : softMissing).push(item)
  }

  const autoSteps: UiAutoStep[] = plan.steps
    .filter((s) => s.costTier === "micro" || s.costTier === "metered")
    .map((s) => ({ action: s.action, costTier: s.costTier, label: labelFor(s.produces) }))

  const ready = blocking.length === 0
  let confidence: InputConfidence
  if (!ready) confidence = "baixa"
  else if (weakening.length >= 2) confidence = "baixa"
  else if (weakening.length === 1 || softMissing.length >= 1) confidence = "média"
  else confidence = "alta"

  return { action, label: ui.label, ready, blocking, weakening, softMissing, autoSteps, confidence }
}
