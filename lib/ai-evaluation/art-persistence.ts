/**
 * Persistência da Arte (v32) em `ai_evaluation_art` — migration 201. Mapeamento PURO; quem grava é
 * `triggerAiEvaluation` (`server/actions/ai.ts`), depois de as notas dos 11 estarem gravadas.
 *
 * Uma linha por avaliação, presa a `ai_evaluations` por FK (ON DELETE CASCADE): modelo, versão de
 * prompt, `input_hash` e a linha de `ai_api_calls` são os da MESMA avaliação — a proveniência vem
 * da associação, não é copiada.
 *
 * ⚠️ Avaliação sem linha aqui significa "Arte NÃO AVALIADA" (avaliação anterior à v32, ou criada
 * pelo fluxo de cadastro, que não grava Arte). Isso é DIFERENTE de `abstained` — que é a Arte
 * avaliada e sem evidência suficiente. Confundir os dois afirmaria uma abstenção que não houve.
 *
 * Aceitar, editar ou pular os 11 (`submitAiReview` / `skipAiEvaluation`) não toca esta linha: a
 * Arte não tem revisão própria e é retida junto da avaliação que a produziu.
 */

import type { ArtAppendixItem } from "@/lib/ai-evaluation/art-appendix"
import type { ArtAvaliacao, ArtStatus } from "@/lib/ai-evaluation/art-signal"

export interface AiEvaluationArtRow {
  ai_evaluation_id: string
  work_id: string
  signal_version: string
  status: ArtStatus
  quality_signal: ArtAvaliacao["quality_signal"]
  quality_strength: ArtAvaliacao["evidence_strength"]["quality"]
  quality_agreement: number | null
  judging_count: number
  positive_count: number
  negative_count: number
  competent_count: number
  mixed_count: number
  judging_reviews: ArtAvaliacao["judging_reviews"]
  quality_evidence: ArtAvaliacao["quality_evidence"]
  justification: string
  change_signal: ArtAvaliacao["change_signal"]
  change_direction: ArtAvaliacao["change_direction"]
  change_evidence: ArtAvaliacao["change_evidence"]
  change_strength: ArtAvaliacao["evidence_strength"]["change"]
  /** 🧪 O eixo de mudança é experimental (`ART_CHANGE_EXPERIMENTAL`). A coluna só aceita `true`. */
  change_experimental: true
  /** Auditoria: rebaixamentos, descartes e o apêndice que foi ao prompt (as citações `A…` apontam para ele). */
  normalization: {
    rebaixamentos: string[]
    citacoes_descartadas: number
    julgamentos_descartados: number
    apendice: Array<{ id: string; source: string; trecho: string }>
  }
}

export function linhaDeArte(args: {
  aiEvaluationId: string
  workId: string
  art: ArtAvaliacao
  apendice: readonly ArtAppendixItem[]
}): AiEvaluationArtRow {
  const { art } = args
  return {
    ai_evaluation_id: args.aiEvaluationId,
    work_id: args.workId,
    signal_version: art.version,
    status: art.status,
    quality_signal: art.quality_signal,
    quality_strength: art.evidence_strength.quality,
    quality_agreement: art.evidence_strength.quality_agreement,
    judging_count: art.contagens.total,
    positive_count: art.contagens.positive,
    negative_count: art.contagens.negative,
    competent_count: art.contagens.competent,
    mixed_count: art.contagens.mixed,
    judging_reviews: art.judging_reviews,
    quality_evidence: art.quality_evidence,
    justification: art.justification,
    change_signal: art.change_signal,
    change_direction: art.change_direction,
    change_evidence: art.change_evidence,
    change_strength: art.evidence_strength.change,
    change_experimental: art.change_experimental,
    normalization: {
      rebaixamentos: art.rebaixamentos,
      citacoes_descartadas: art.citacoesDescartadas,
      julgamentos_descartados: art.julgamentosDescartados,
      apendice: args.apendice.map((a) => ({ id: a.id, source: a.source, trecho: a.trecho })),
    },
  }
}

/** O estado da Arte de UMA avaliação. Sem linha ⇒ `nao_avaliada` — nunca `abstained`. */
export type EstadoDaArte = "nao_avaliada" | ArtStatus

export function estadoDaArte(linha: Pick<AiEvaluationArtRow, "status"> | null | undefined): EstadoDaArte {
  return linha ? linha.status : "nao_avaliada"
}
