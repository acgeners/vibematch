import type { NoReviewsReason } from "@/lib/ai-evaluation/no-reviews"

/**
 * Tipos compartilhados da cascata generate_all_work_data. Vivem FORA do arquivo
 * "use server" (server/actions/generate-all.ts) porque um módulo "use server" só
 * pode exportar funções async — o client importa os tipos daqui.
 */

export type CascadeStatus =
  | "idle"
  | "verifying_sources"
  | "blocked_manual"
  | "needs_authorization"
  | "generating"
  | "done"
  | "failed"

export interface SourcesHealth {
  flaresolverr: boolean
  comix: boolean
  comick: boolean
  confirmed: boolean
}

export type GenerateAllResult =
  | { status: "blocked_manual"; missing: "comix_hid"; instruction: string }
  | {
      status: "needs_authorization"
      reason: "cost" | "no_reviews" | "sources_unconfirmed"
      estimatedUsd: number
      noReviewsReason: NoReviewsReason | null
      sources: SourcesHealth | null
    }
  | { status: "generating"; ran: string[] }
  | { status: "ready"; ran: string[] }
  | { status: "failed"; failed: string; error: string }

export interface GenerateAllOpts {
  /** Fase 1 (paga): só roda com autorização explícita do checkpoint. */
  proceed?: boolean
  /** Segue a avaliação IA mesmo sem reviews (checkpoint "sem review"). */
  proceedWithoutReviews?: boolean
  /** Segue mesmo sem o hid do Comix (escotilha "Seguir sem Comix"). */
  proceedWithoutComix?: boolean
  /** "Seguir mesmo assim" no gate de fontes não-confirmadas — pula a espera. */
  ignoreSourceGate?: boolean
  /** Teto de custo pré-autorizado (checkpoint). */
  allowPaidUsd?: number
}
