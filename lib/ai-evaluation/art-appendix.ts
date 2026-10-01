/**
 * Apêndice de evidência de ARTE — parte da avaliação canônica (v32). A `VARIANTE_V30` não o usa.
 *
 * Por que existe (medido em 2026-10-01, `Auditoria/piloto-arte-abc/CRITERIO-ADAPTATIVO-EVIDENCIA-ARTE.md`):
 * as ≤30 reviews do prompt são escolhidas para os 11 atributos (as mais longas, balanceando nota e
 * fonte) e nada nelas olha arte. No catálogo, só 62% das reviews que julgam a arte chegam ao
 * prompt; acima de 100 reviews, 40%. O apêndice acrescenta trechos de arte do pool SEM mexer nas
 * 30 — a seleção dos 11 fica byte-idêntica — e sem segunda chamada ao provider.
 *
 * É RECUPERAÇÃO de evidência, não julgamento: a regex escolhe o que o modelo VÊ; quem julga a arte
 * é o modelo, e o validador `normalizarArte` confere as citações contra o trecho enviado.
 */

import { classificarEvidenciaDeArte } from "@/lib/art/signal"
import { deduplicateReviews } from "@/lib/ai-evaluation/review-dedup"
import type { SourcedReview } from "@/lib/external/types"

/** Teto de itens. Medido: K=10 leva toda a evidência de arte do pool em 94% das obras do catálogo. */
export const ART_APPENDIX_MAX = 10
/** Teto por trecho — um item não pode virar uma review inteira. */
export const ART_APPENDIX_TRECHO_MAX = 500

export interface ArtAppendixItem {
  /** `A1…An` — ids próprios, distintos dos `R…` das reviews principais. */
  id: string
  source: string
  /** O texto em torno das menções à arte, como o modelo o recebe (antes do escape da fronteira). */
  trecho: string
  julga: boolean
  mudanca: boolean
}

export interface ArtAppendixSelection {
  itens: ArtAppendixItem[]
  /** Reviews do pool com evidência de arte (julga ou mudança), depois do dedup do pool. */
  candidatasNoPool: number
  /** Quantas dessas já estão nas reviews principais — não repetidas no apêndice. */
  jaNoPrompt: number
  /** Quantas ficaram de fora pelo teto. */
  foraPeloTeto: number
}

/**
 * Seleciona até `max` trechos de arte do POOL que não estejam nas reviews já enviadas.
 *
 * Ordem (precisão primeiro): julga E fala de mudança → julga → só mudança; dentro de cada grupo, a
 * review mais longa, depois fonte e texto (desempate determinístico). "Já está no prompt" é a MESMA
 * régua do `prepareReviews` (`deduplicateReviews`), aplicada às enviadas seguidas das candidatas.
 */
export function selecionarApendiceArte(
  pool: readonly SourcedReview[],
  enviadas: readonly SourcedReview[],
  max: number = ART_APPENDIX_MAX,
): ArtAppendixSelection {
  const candidatas = deduplicateReviews([...pool])
    .map((r) => ({ r, e: classificarEvidenciaDeArte(r.text) }))
    .filter(({ e }) => e.julga || e.mudanca)

  // Enviadas primeiro: a candidata que repete uma enviada é a que cai.
  const sobreviventes = new Set(
    deduplicateReviews([...enviadas.map((r) => ({ text: r.text })), ...candidatas.map((c) => ({ text: c.r.text, c }))])
      .filter((x): x is { text: string; c: (typeof candidatas)[number] } => "c" in x)
      .map((x) => x.c),
  )
  const fora = candidatas.filter((c) => sobreviventes.has(c))
  const grupo = (e: { julga: boolean; mudanca: boolean }) => (e.julga && e.mudanca ? 0 : e.julga ? 1 : 2)
  fora.sort(
    (a, b) =>
      grupo(a.e) - grupo(b.e) ||
      (b.r.textLength ?? b.r.text.length) - (a.r.textLength ?? a.r.text.length) ||
      a.r.source.localeCompare(b.r.source) ||
      a.r.text.localeCompare(b.r.text),
  )
  const escolhidas = fora.slice(0, max)
  return {
    itens: escolhidas.map(({ r, e }, i) => ({
      id: `A${i + 1}`,
      source: r.source,
      trecho: e.trecho.length > ART_APPENDIX_TRECHO_MAX ? e.trecho.slice(0, ART_APPENDIX_TRECHO_MAX).replace(/\s+\S*$/, "") : e.trecho,
      julga: e.julga,
      mudanca: e.mudanca,
    })),
    candidatasNoPool: candidatas.length,
    jaNoPrompt: candidatas.length - fora.length,
    foraPeloTeto: Math.max(0, fora.length - max),
  }
}
