import type { CostStep } from "@/components/cost/cost-summary"

import { SONNET_MODEL } from "@/lib/ai/models"

/**
 * Modelo exibido nos passos de custo. Vem do DONO: o comentário anterior dizia "o estimador
 * usa Sonnet 4-6 como base" e isso deixou de ser verdade quando o app foi para o Sonnet 5 —
 * a tela nomeava um modelo que não era o da chamada.
 */
const SONNET_LABEL_MODEL = SONNET_MODEL
/**
 * ETA da regeneração do perfil (Sonnet, ~100k tokens in + ~6k out). Medido no
 * ai_api_calls (`recommendation_taste_profile`): mediana ~33s, p90 ~39s → ~35s.
 */
const PROFILE_REGEN_ETA_SECONDS = 35
/** ETA por previsão amortizado pela concorrência (3 em paralelo). */
const PREDICT_ETA_PER_WORK_SECONDS = 10 / 3

export interface InterestBatchCostArgs {
  /** Nº de obras a prever. */
  needCalls: number
  /** true ⇒ o run regenera o perfil (muito defasado/ausente) antes de prever. */
  regenProfile: boolean
  /** Drift heurístico (0..1) — vira "~X% defasado" no rótulo/frase. */
  driftPct: number
  /** Custo provável (likely) SÓ da regeneração do perfil. */
  profileLikelyUsd: number
  /** Custo provável (likely) TOTAL (perfil + previsões). */
  totalLikelyUsd: number
  model?: string
}

export interface InterestBatchCostView {
  /**
   * Passos itemizados (perfil + previsões) — presentes SÓ quando regenera. Quando
   * não regenera, `undefined`: o popup mostra "N × por-obra", que aí é honesto (não
   * há custo fixo embutido).
   */
  steps: CostStep[] | undefined
  /** Frase que deixa claro o perfil defasado (vazia quando não regenera). */
  profileSentence: string
  /** ETA total (previsões + perfil quando regenera). */
  etaSeconds: number
}

/**
 * Monta o breakdown de custo/tempo do lote de Interesse pro popup de confirmação.
 * Quando o perfil vai ser regenerado, separa "Atualizar perfil (custo ÚNICO)" de
 * "Prever Interesse (N obras)" — senão o popup amortizava os ~$0,40 do perfil em
 * "N × por-obra", fazendo cada obra parecer ~$0,14 quando na verdade custa ~$0,01.
 * Reusado pelo botão "Reprocessar Interesse" e pelo painel de previsão em lote.
 */
export function buildInterestBatchCost(args: InterestBatchCostArgs): InterestBatchCostView {
  const predictEta = args.needCalls * PREDICT_ETA_PER_WORK_SECONDS
  const worksLabel = `${args.needCalls} obra${args.needCalls === 1 ? "" : "s"}`

  if (!args.regenProfile) {
    return { steps: undefined, profileSentence: "", etaSeconds: predictEta }
  }

  const model = args.model ?? SONNET_LABEL_MODEL
  const predictLikely = Math.max(0, args.totalLikelyUsd - args.profileLikelyUsd)
  const pct = Math.round(args.driftPct * 100)
  const driftTag = pct > 0 ? ` · ~${pct}% defasado` : " · defasado"

  const steps: CostStep[] = [
    {
      label: `Atualizar perfil de gosto${driftTag}`,
      model,
      likelyUsd: args.profileLikelyUsd,
      etaSeconds: PROFILE_REGEN_ETA_SECONDS,
    },
    {
      label: `Prever Interesse · ${worksLabel}`,
      model,
      likelyUsd: predictLikely,
      etaSeconds: predictEta,
    },
  ]

  const profileSentence =
    pct > 0
      ? `Seu perfil de gosto está significativamente desatualizado (~${pct}%) e será atualizado 1× antes de prever. `
      : `Seu perfil de gosto está desatualizado e será atualizado 1× antes de prever. `

  return { steps, profileSentence, etaSeconds: predictEta + PROFILE_REGEN_ETA_SECONDS }
}
