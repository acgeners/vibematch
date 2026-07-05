/**
 * Jornadas do USUÁRIO → cascata de ações que custam IA.
 *
 * Reframe do custo do ponto de vista de "o que eu faço no app" (criar obra,
 * atualizar, avaliar…) em vez das operações técnicas. Cada jornada é uma ou mais
 * `CostActionId` do catálogo; o custo total sai de `previewCascade` — o MESMO
 * motor/estimativa que o popup de confirmação usa. Puro e client-safe.
 *
 * As composições espelham os fluxos reais da UI:
 *  - criar obra (com busca): consolida sinopse → avalia → tags → resumo → digest
 *    (ver components/titles/work-form.tsx + o path "Buscar dados")
 *  - avaliar IA: avaliação + resumo + digest (components/ai-evaluation/*)
 *  - atualizar dados: tags + resumo + digest (enriquecimento do refresh)
 */

import type { CostActionId } from "./catalog"

export type JourneyGroup = "obras" | "individuais" | "descobrir"

export interface CostJourney {
  id: string
  emoji: string
  label: string
  /** "O que está incluído" em linguagem do usuário. */
  summary: string
  group: JourneyGroup
  parts: { action: CostActionId; scale?: number; label?: string }[]
  /** Aviso amigável sobre custo condicional (1ª vez, modo manual grátis…). */
  note?: string
}

export const JOURNEY_GROUPS: { id: JourneyGroup; emoji: string; label: string }[] = [
  { id: "obras", emoji: "📚", label: "Adicionar e manter obras" },
  { id: "individuais", emoji: "🧩", label: "Ações individuais" },
  { id: "descobrir", emoji: "🔮", label: "Descobrir e recomendar" },
]

export const COST_JOURNEYS: CostJourney[] = [
  // ── Obras ──────────────────────────────────────────────────────────────────
  {
    id: "create_work",
    emoji: "🎬",
    group: "obras",
    label: "Criar uma obra do zero",
    summary: "Busca os dados, avalia com IA e enriquece com tags, resumo e digest das reviews",
    parts: [
      { action: "consolidate_synopsis", label: "Consolidar a sinopse" },
      { action: "ai_evaluation", label: "Avaliar os 9 critérios" },
      { action: "infer_tags", label: "Inferir tags da sinopse" },
      { action: "review_summary", label: "Resumir as reviews" },
      { action: "review_digest", label: "Digest das reviews" },
    ],
    note: "Criar manualmente (sem buscar dados externos) é praticamente grátis — o custo vem do enriquecimento por IA.",
  },
  {
    id: "update_work",
    emoji: "🔄",
    group: "obras",
    label: "Atualizar os dados de uma obra",
    summary: "Rebusca as fontes externas e refaz tags, resumo e digest das reviews",
    parts: [
      { action: "infer_tags", label: "Inferir tags da sinopse" },
      { action: "review_summary", label: "Resumir as reviews" },
      { action: "review_digest", label: "Digest das reviews" },
    ],
  },
  {
    id: "evaluate_ai",
    emoji: "✨",
    group: "obras",
    label: "Avaliar os atributos com IA",
    summary: "Nota dos 9 critérios + resumo e digest das reviews",
    parts: [
      { action: "ai_evaluation", label: "Avaliar os 9 critérios" },
      { action: "review_summary", label: "Resumir as reviews" },
      { action: "review_digest", label: "Digest das reviews" },
    ],
  },

  // ── Ações individuais ───────────────────────────────────────────────────────
  {
    id: "digest",
    emoji: "📝",
    group: "individuais",
    label: "Gerar o digest das reviews",
    summary: "Resumo agregado do que os leitores acharam da obra",
    parts: [{ action: "review_digest" }],
  },
  {
    id: "tags",
    emoji: "🏷️",
    group: "individuais",
    label: "Inferir tags da sinopse",
    summary: "Sugere tags a partir do texto da obra",
    parts: [{ action: "infer_tags" }],
  },
  {
    id: "summary",
    emoji: "📄",
    group: "individuais",
    label: "Resumir as reviews",
    summary: "Condensa cada review externa num parágrafo curto",
    parts: [{ action: "review_summary" }],
  },
  {
    id: "consolidate",
    emoji: "🧵",
    group: "individuais",
    label: "Consolidar a sinopse",
    summary: "Funde várias sinopses de fontes diferentes numa só",
    parts: [{ action: "consolidate_synopsis" }],
  },

  // ── Descobrir e recomendar ──────────────────────────────────────────────────
  {
    id: "deep_dive",
    emoji: "🧠",
    group: "descobrir",
    label: "Deep Dive (consultor IA)",
    summary: "Análise profunda de uma obra, com raciocínio estendido",
    parts: [{ action: "deep_dive" }],
  },
  {
    id: "recommend",
    emoji: "🎯",
    group: "descobrir",
    label: "Recomendar com IA",
    summary: "Re-ranqueia seus favoritos e explica as escolhas",
    // scale representativo (~nº de favoritos re-ranqueados); custo varia com isso.
    parts: [{ action: "recommend", scale: 25 }],
    note: "Na 1ª vez também monta o seu perfil de gosto (+~$0,40). Depois é só o valor acima. Varia com o nº de favoritos.",
  },
  {
    id: "predict_interest",
    emoji: "❤️",
    group: "descobrir",
    label: "Prever o interesse numa obra",
    summary: "Estima o quanto você tende a curtir a obra",
    parts: [{ action: "predict_interest" }],
  },
  {
    id: "chat",
    emoji: "💬",
    group: "descobrir",
    label: "Mensagem no chat de recomendação",
    summary: "Uma resposta do assistente conversacional",
    parts: [{ action: "chat_message" }],
  },
]
