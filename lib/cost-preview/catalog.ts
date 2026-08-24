/**
 * Catálogo de PRÉ-visualização de custo + tempo das ações de IA da UI.
 *
 * Fonte única do que o popup de confirmação (`CostConfirmDialog`) exibe ANTES de
 * o usuário disparar uma ação paga. É data pura (client-safe): reusa o pricing
 * real (`lib/ai/pricing.ts`) e a margem de segurança do gate de orquestração
 * (`COST_SAFETY_MULTIPLIER`) — não chama LLM, não toca IO.
 *
 * As estimativas de token e os ETAs são HEURÍSTICAS (ordem de grandeza), semeadas
 * a partir dos custos observados que já apareciam hardcoded na UI (deep dive
 * ~$0.21, recomendação ~$0.05/run, calibração ~$0.0015/obra, digest ~$0.02–0.04,
 * resumo/consolidação ~$0.002). Refine quando `ai_api_calls` medir o p50 real por
 * operação — este é o ponto único pra ajustar.
 *
 * NÃO confundir com `lib/orchestration/contracts.ts`: aquele é o registro do
 * ORQUESTRADOR (planner/executor). Este é só a camada de exibição da UI, e cobre
 * também ações que não passam pelo orquestrador (recomendação, deep dive,
 * calibração). Onde os dois se sobrepõem, mantenha os números coerentes.
 */

import { computeCostUsd } from "@/lib/ai/pricing"
import type { UsageTokens } from "@/lib/ai/pricing"
import { COST_SAFETY_MULTIPLIER } from "@/lib/orchestration/cost"
import { ACTIVE_MODELS, SONNET_MODEL } from "@/lib/ai/models"
import { CONSOLIDATE_SYNOPSIS_USAGE } from "@/lib/ai-recommendation/synopsis-consolidator-usage"

// 🔴 O Sonnet vem do DONO, nunca de um literal. Este arquivo chumbava
// `claude-sonnet-4-6` enquanto o app chamava `claude-sonnet-5`, e o preview passou a
// superestimar em 50%: `ai_evaluation` exibia $0,0465 onde a chamada real custa ~$0,0310
// ($3/$15 contra $2/$10 por MTok). O popup que existe para a pessoa AUTORIZAR um gasto
// mostrava um número que não era o da chamada.
//
// ⚠️ O Haiku FICA literal, e a diferença é de natureza: ele não é "o modelo ativo" — é uma
// escolha deliberada de modelo BARATO para tarefas baratas, que não acompanha a troca do
// Sonnet. Trocar os dois por `SONNET_MODEL` seria uniformizar nome e perder a intenção.
// (Dar um dono também ao Haiku é trabalho do registry — A1b.)
const HAIKU = ACTIVE_MODELS.haiku
const SONNET = SONNET_MODEL

/** Limiar abaixo do qual o usuário pode optar por não ser mais avisado. */
export const DEFAULT_SUPPRESS_THRESHOLD_USD = 0.02

export type CostActionId =
  | "infer_tags"
  | "deep_dive"
  | "recommend"
  | "rerank_single"
  | "predict_interest"
  | "review_digest"
  | "review_summary"
  | "consolidate_synopsis"
  | "ai_evaluation"
  | "taste_profile"
  | "chat_message"
  | "suggest_groups"
  | "opening_structure"
  | "opening_structure_web"

interface CostSpec {
  /** Rótulo curto da ação (título default do popup). */
  label: string
  model: string
  /** Custo fixo de UMA invocação. */
  base: UsageTokens
  /** Custo marginal por item processado (multiplicado por `scale`). */
  perItem?: UsageTokens
  /** Tempo fixo estimado (s). */
  etaSeconds: number
  /** Tempo marginal por item (s) — some pra formar o ETA de lote. */
  etaPerItemSeconds?: number
  /** true = roda em segundo plano (indicador global), muda a copy do popup. */
  background?: boolean
  /** Aviso extra sobre custo condicional/oculto (ex.: 1ª run gera perfil). */
  note?: string
}

const ZERO: UsageTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
}

function tokens(inputTokens: number, outputTokens: number): UsageTokens {
  return { ...ZERO, inputTokens, outputTokens }
}

const CATALOG: Record<CostActionId, CostSpec> = {
  infer_tags: {
    label: "Inferir tags por IA",
    model: HAIKU,
    base: ZERO,
    perItem: tokens(2000, 2048),
    etaSeconds: 2,
    etaPerItemSeconds: 8,
    background: true,
  },
  deep_dive: {
    label: "Consultor IA — Deep Dive",
    model: SONNET,
    // Extended thinking + max_tokens alto: output domina o custo (~$0.21 observado).
    base: tokens(6000, 12000),
    etaSeconds: 35,
    background: true,
  },
  opening_structure: {
    label: "Analisar estrutura de abertura",
    model: SONNET,
    // Medido em 19 obras (piloto 2026-08-12): US$0,0163/obra. O input é a síntese das reviews
    // + até 40 reviews (mediana ~3.700 tokens, p90 ~7.900); o output é uma tool call curta.
    base: tokens(4200, 300),
    etaSeconds: 15,
    background: true,
    note: "Decide ~1 obra em 5. Quando a evidência não sustenta nenhum veredito, a resposta é \"não sei\" — e isso é resultado, não falha.",
  },
  opening_structure_web: {
    label: "Buscar a abertura na web",
    model: SONNET,
    // ~15× o passo local, e o custo NÃO são as buscas (US$0,01 cada): são os resultados delas
    // voltando ao input a cada volta do loop de tool use. Medido: US$0,13–0,41/obra com 4
    // voltas × 3 buscas; contido para 2 × 2. Resgatou 1 de 5 indeterminadas no piloto.
    base: tokens(90000, 700),
    etaSeconds: 40,
    background: true,
    note: "Só vale depois de a análise local não decidir. No piloto resgatou 1 obra a cada 5 tentativas.",
  },
  recommend: {
    label: "Recomendar com IA",
    model: SONNET,
    base: tokens(2500, 0),
    perItem: tokens(250, 120),
    etaSeconds: 15,
    etaPerItemSeconds: 0.75,
    background: true,
    note: "Na 1ª execução também destila seu perfil de gosto (+~$0,40).",
  },
  rerank_single: {
    label: "Atualizar Veredito IA",
    model: SONNET,
    base: tokens(3000, 800),
    etaSeconds: 20,
    background: true,
  },
  predict_interest: {
    label: "Prever Interesse",
    model: SONNET,
    base: ZERO,
    perItem: tokens(1500, 400),
    etaSeconds: 0,
    etaPerItemSeconds: 15,
    background: true,
  },
  review_digest: {
    label: "Gerar digest de reviews",
    model: SONNET,
    base: ZERO,
    perItem: tokens(5000, 1000),
    etaSeconds: 2,
    etaPerItemSeconds: 20,
    background: true,
  },
  review_summary: {
    label: "Resumir reviews",
    model: HAIKU,
    base: ZERO,
    perItem: tokens(1500, 700),
    etaSeconds: 2,
    etaPerItemSeconds: 8,
    background: true,
  },
  consolidate_synopsis: {
    // Sonnet desde o prompt v3 (era Haiku).
    // 🔴 Os tokens vêm do DONO ÚNICO (`CONSOLIDATE_SYNOPSIS_USAGE`), compartilhado com o
    // GATE em `lib/orchestration/contracts.ts` — preview e gate descrevem a MESMA chamada.
    // O `~1500/330` que morava aqui saiu de um laboratório de 10 obras escolhidas por
    // defeito conhecido; contra as 228 chamadas reais ele estava no percentil 11.
    // ⚠️ O ETA continua local: é tempo, não custo, e não tem o outro lado para divergir.
    label: "Consolidar sinopse",
    model: SONNET,
    base: ZERO,
    perItem: CONSOLIDATE_SYNOPSIS_USAGE,
    etaSeconds: 2,
    etaPerItemSeconds: 7,
    background: true,
  },
  ai_evaluation: {
    label: "Avaliação IA",
    model: SONNET,
    // Envia a capa em base64 (input alto) + reviews amostradas + os 9 critérios.
    base: tokens(8000, 1500),
    etaSeconds: 60,
    background: true,
  },
  taste_profile: {
    label: "Destilar perfil de gosto",
    model: SONNET,
    // ~500 tok/obra rotulada (título/tags/notas/sinopse); max_tokens alto.
    base: tokens(3000, 6000),
    perItem: tokens(500, 0),
    etaSeconds: 40,
    background: true,
  },
  chat_message: {
    label: "Mensagem do chat",
    model: SONNET,
    base: tokens(5000, 800),
    etaSeconds: 12,
    background: false,
  },
  suggest_groups: {
    label: "Sugerir grupos com IA",
    // Lê os favoritos (título+gêneros+tags) e propõe grupos coesos num único
    // passo. Input escala com o nº de favoritos; ~2k in / ~1.5k out p/ dezenas
    // de obras. Abaixo do limiar de supressão ($0,02).
    model: HAIKU,
    base: tokens(2000, 1500),
    etaSeconds: 8,
    background: false,
  },
}

/** Um passo de cascata (compatível com CostStep da UI). */
export interface CascadeStep {
  label: string
  model: string
  likelyUsd: number
  etaSeconds: number
}

/**
 * Soma várias ações numa cascata (ex.: "Salvar obra" → resumo + digest + tags…):
 * total = soma dos custos/tempos; `steps` para o breakdown itemizado no popup.
 */
export function previewCascade(
  parts: { action: CostActionId; scale?: number; label?: string }[],
): { likelyUsd: number; upperBoundUsd: number; etaSeconds: number; steps: CascadeStep[] } {
  const pvs = parts.map((p) => ({ p, pv: previewCost(p.action, p.scale) }))
  return {
    likelyUsd: pvs.reduce((s, { pv }) => s + pv.likelyUsd, 0),
    upperBoundUsd: pvs.reduce((s, { pv }) => s + pv.upperBoundUsd, 0),
    etaSeconds: pvs.reduce((s, { pv }) => s + pv.etaSeconds, 0),
    steps: pvs.map(({ p, pv }) => ({
      label: p.label ?? pv.label,
      model: pv.model,
      likelyUsd: pv.likelyUsd,
      etaSeconds: pv.etaSeconds,
    })),
  }
}

export interface CostPreview {
  label: string
  model: string
  /** Custo provável (sem margem) — o número exibido em destaque. */
  likelyUsd: number
  /** Teto (likely × margem de segurança) — usado no opt-out e no rótulo "até". */
  upperBoundUsd: number
  etaSeconds: number
  background: boolean
  note?: string
  /** Itens processados (para a copy "N × …" em lote). */
  scale: number
}

function usageFor(spec: CostSpec, scale: number): UsageTokens {
  const s = Math.max(1, scale)
  const p = spec.perItem
  return {
    inputTokens: spec.base.inputTokens + (p?.inputTokens ?? 0) * s,
    outputTokens: spec.base.outputTokens + (p?.outputTokens ?? 0) * s,
    cacheReadTokens: 0,
    cacheCreationTokens: spec.base.cacheCreationTokens + (p?.cacheCreationTokens ?? 0) * s,
  }
}

/** Estimativa de custo + tempo de uma ação da UI, escalada por `scale` (itens). */
export function previewCost(action: CostActionId, scale = 1): CostPreview {
  const spec = CATALOG[action]
  const s = Math.max(1, scale)
  const usage = usageFor(spec, s)
  const b = computeCostUsd(spec.model, usage)
  const likely = b.costInputUsd + b.costOutputUsd + b.costCacheReadUsd + b.costCacheCreationUsd
  const eta = spec.etaSeconds + (spec.etaPerItemSeconds ?? 0) * s
  return {
    label: spec.label,
    model: spec.model,
    likelyUsd: likely,
    upperBoundUsd: likely * COST_SAFETY_MULTIPLIER,
    etaSeconds: eta,
    background: spec.background ?? false,
    note: spec.note,
    scale: s,
  }
}

/** Nome curto do modelo pra badge ("Sonnet"/"Haiku"/"Opus"). */
export function shortModelName(model: string): string {
  if (model.includes("haiku")) return "Haiku"
  if (model.includes("opus")) return "Opus"
  if (model.includes("sonnet")) return "Sonnet"
  return model
}

// Dinheiro mora em `lib/format/money.ts` — `formatUsd`/`formatUsdApprox`. O que
// existia aqui (`formatUsd` com "~", `formatUsdExact` sem) achatava tudo abaixo
// de um centavo em "<$0,01", então a operação mais barata do catálogo e uma
// dez vezes menor apareciam com o mesmo rótulo.

/** Tempo aproximado: "~8 s", "~2 min", "~30 min". */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—"
  if (seconds < 60) return `~${Math.round(seconds)} s`
  const min = Math.round(seconds / 60)
  if (min < 60) return `~${min} min`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem === 0 ? `~${h} h` : `~${h} h ${rem} min`
}
