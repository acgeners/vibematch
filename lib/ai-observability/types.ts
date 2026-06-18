/**
 * Observabilidade das chamadas de IA (Plano 1 — Fase B, "observabilidade mínima").
 *
 * Catálogo ESTÁVEL das operações + taxonomias (workload, erro, status de imagem,
 * status de cache). NÃO altera nenhum fluxo de IA — só dá nomes estáveis ao que
 * já existe para que a telemetria (ai_api_calls) possa ser agregada com honestidade.
 *
 * Fonte da verdade dos custos/tokens segue sendo `ai_api_calls` (migration 059);
 * o cálculo de custo continua em `lib/ai/pricing.ts` (não duplicar aqui).
 *
 * Tudo neste módulo é PURO: sem acesso a banco, sem `Date.now()` implícito,
 * sem mutação de input. As tabelas/queries vivem em `server/queries/ai-usage.ts`.
 */

// ── Operações ───────────────────────────────────────────────────────────────
// Chaves exatamente como gravadas em ai_api_calls.operation pelos call sites.
// As 11 primeiras têm tráfego real medido; as 3 de tag são registradas no código
// (ações de tag-consolidation) e podem ter 0 chamadas no período.

export const AI_OPERATION_KEYS = [
  "ai_evaluation",
  "synopsis_quality_predict",
  "recommendation_rank",
  "recommendation_taste_profile",
  "recommendation_chat",
  "calibration_audit",
  "calibration_bias",
  "review_summarizer",
  "review_digest",
  "deep_dive",
  "synopsis_consolidator",
  "tag_clustering",
  "tag_classifier",
  "tag_enricher",
] as const

export type AiOperationKey = (typeof AI_OPERATION_KEYS)[number]

// ── Tipo de workload (origem da chamada) ─────────────────────────────────────
// Plano §9: na dúvida, "unknown" — NUNCA inventar "recurring" sem evidência.

export const AI_WORKLOAD_TYPES = [
  "recurring",
  "backfill",
  "test",
  "development",
  "manual_reprocess",
  "admin",
  "experiment",
  "unknown",
] as const

export type AiWorkloadType = (typeof AI_WORKLOAD_TYPES)[number]

// ── Categoria de erro ────────────────────────────────────────────────────────
// Falhas de uma TENTATIVA (status="error" em ai_api_calls ou throw capturado).
// O status de IMAGEM é separado (AiImageStatus) — uma imagem pode ser rejeitada
// localmente sem que a chamada falhe (avalia-se sem imagem).

export const AI_ERROR_CATEGORIES = [
  "provider_rate_limit", // 429
  "provider_overloaded", // 529 (Anthropic "Overloaded")
  "provider_timeout",
  "provider_network",
  "provider_5xx",
  "provider_image_invalid_request", // 400 + menção a image/media_type/base64
  "provider_invalid_request", // outro 400
  "structured_output_invalid", // sem tool_use / cortado por max_tokens
  "schema_validation_failed", // payload da tool reprovado no Zod
  "audit_rejected", // enforceAuditableReviewUsage
  "internal_error",
  "cancelled",
  "unknown",
] as const

export type AiErrorCategory = (typeof AI_ERROR_CATEGORIES)[number]

// ── Etapa em que o erro ocorreu (ajuda a classificar) ────────────────────────

export const AI_CALL_STAGES = [
  "pre_request",
  "provider",
  "structured_output",
  "audit",
  "persistence",
  "unknown",
] as const

export type AiCallStage = (typeof AI_CALL_STAGES)[number]

// ── Status do ciclo de vida da capa (avaliação IA) ───────────────────────────
// Espelha os resultados de lib/server/covers/fetch-cover-for-model.ts +
// o caso do MODELO recusar a imagem já enviada (provider_rejected).

export const AI_IMAGE_STATUSES = [
  "not_requested", // obra sem coverUrl
  "source_invalid_url", // URL inválida / protocolo não-http
  "host_not_allowed", // fora da allowlist
  "host_blocked", // bloqueio temporário (TTL)
  "blocked_redirect", // redirect pra host/URL inválido
  "http_error", // resposta !ok do host
  "too_large", // excede o limite (header ou stream)
  "unsupported_format", // magic bytes não reconhecidos
  "fetch_timeout",
  "fetch_error",
  "fetch_success", // base64 obtido e enviado
  "provider_rejected", // modelo recusou a imagem (400 image/media_type/base64)
  "fallback_without_image", // avaliou sem imagem após recusa/falha
  "unknown",
] as const

export type AiImageStatus = (typeof AI_IMAGE_STATUSES)[number]

// ── Status do cache de RESULTADO (não confundir com cache de prompt) ─────────
// O cache de resultado (ai_evaluation: L1 memória + L2 ai_evaluations por hash)
// curto-circuita ANTES da chamada ao provider. "memory"/"db" = HIT; "miss" =
// foi ao provider; "bypass" = cache ignorado de propósito.
// (O cache de PROMPT da Anthropic é medido pelos tokens cache_read/cache_creation,
// que são outra coisa.)

export const AI_CACHE_STATUSES = ["memory", "db", "miss", "bypass"] as const

export type AiCacheStatus = (typeof AI_CACHE_STATUSES)[number]

export function isCacheHit(status: AiCacheStatus | null | undefined): boolean {
  return status === "memory" || status === "db"
}

// ── Definição documentada de uma operação (plano §5) ─────────────────────────

export interface AiOperationDefinition {
  key: AiOperationKey
  label: string
  /** Modelo padrão (pode ser sobrescrito por override A/B em ai_evaluation). */
  defaultModel: string
  /** Categoria de workload TÍPICA da operação (não substitui a classificação por linha). */
  typicalWorkload: AiWorkloadType
  /** Possui cache de resultado que pode curto-circuitar a chamada? */
  hasResultCache: boolean
  description: string
}

/**
 * Catálogo das operações conhecidas. Documentação — não muda execução.
 * `defaultModel` reflete a constante no respectivo serviço (lib/ai-*).
 */
export const AI_OPERATIONS: Record<AiOperationKey, AiOperationDefinition> = {
  ai_evaluation: {
    key: "ai_evaluation",
    label: "Avaliação IA (9 critérios)",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "recurring",
    hasResultCache: true,
    description: "Avaliação dos 9 critérios via tool/Zod, com capa em base64 e auditoria de reviews.",
  },
  synopsis_quality_predict: {
    key: "synopsis_quality_predict",
    label: "Qualidade da sinopse",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Rótulo de 4 níveis para a sinopse; feature do Ridge (expected_score).",
  },
  recommendation_rank: {
    key: "recommendation_rank",
    label: "Ranking de recomendação",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Re-rank de favoritos pelo LLM; persiste em recommendation_runs.",
  },
  recommendation_taste_profile: {
    key: "recommendation_taste_profile",
    label: "Perfil de gosto",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Gera o taste_profile a partir das obras rotuladas.",
  },
  recommendation_chat: {
    key: "recommendation_chat",
    label: "Chat de recomendação",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Turno conversacional de recomendação (pago).",
  },
  calibration_audit: {
    key: "calibration_audit",
    label: "Auditoria de calibração",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "admin",
    hasResultCache: false,
    description: "Auditoria administrativa de calibração (chunks paralelos).",
  },
  calibration_bias: {
    key: "calibration_bias",
    label: "Relatório de viés",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "admin",
    hasResultCache: false,
    description: "Relatório administrativo de viés de calibração.",
  },
  review_summarizer: {
    key: "review_summarizer",
    label: "Resumo de reviews",
    defaultModel: "claude-haiku-4-5-20251001",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Resumo curto por review (Haiku).",
  },
  review_digest: {
    key: "review_digest",
    label: "Digest de reviews",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Digest agregado das reviews de uma obra (Sonnet).",
  },
  deep_dive: {
    key: "deep_dive",
    label: "Deep dive",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Análise profunda com extended thinking; persiste em deep_dive_results.",
  },
  synopsis_consolidator: {
    key: "synopsis_consolidator",
    label: "Consolidador de sinopse",
    defaultModel: "claude-haiku-4-5-20251001",
    typicalWorkload: "recurring",
    hasResultCache: false,
    description: "Funde múltiplas sinopses externas numa só (Haiku).",
  },
  tag_clustering: {
    key: "tag_clustering",
    label: "Clusterização de tags",
    defaultModel: "claude-sonnet-4-6",
    typicalWorkload: "admin",
    hasResultCache: false,
    description: "Propõe clusters/sub-grupos de tags (administrativo).",
  },
  tag_classifier: {
    key: "tag_classifier",
    label: "Classificador de tags",
    defaultModel: "claude-haiku-4-5-20251001",
    typicalWorkload: "admin",
    hasResultCache: false,
    description: "Classifica tags por grupo (administrativo).",
  },
  tag_enricher: {
    key: "tag_enricher",
    label: "Enriquecedor de tags",
    defaultModel: "claude-haiku-4-5-20251001",
    typicalWorkload: "admin",
    hasResultCache: false,
    description: "Enriquece tags novas de um grupo (administrativo).",
  },
}

/** Operações inerentemente administrativas (sinal forte de workload=admin). */
export const ADMIN_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "calibration_audit",
  "calibration_bias",
  "tag_clustering",
  "tag_classifier",
  "tag_enricher",
])

export function isKnownAiOperation(op: string): op is AiOperationKey {
  return (AI_OPERATION_KEYS as readonly string[]).includes(op)
}
