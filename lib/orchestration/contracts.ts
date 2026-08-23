/**
 * Registro DECLARATIVO das ações da obra e seus contratos de dependência.
 *
 * Fonte única de verdade do orquestrador (Fase B passo 1) — ver
 * ARQUITETURA-ORQUESTRACAO.md §1. É data pura (sem efeito colateral, sem IO):
 * o planner/cost/executor consomem estas estruturas. NÃO importa nada de
 * servidor — é importável em qualquer ambiente e testável diretamente.
 *
 * As estimativas de token são HEURÍSTICAS (ordem de grandeza p/ o gate de
 * custo), não medições. Refine quando a integração real medir o uso por op.
 */

import type { UsageTokens } from "@/lib/ai/pricing"
import { SONNET_MODEL } from "@/lib/ai/models"

// ---- Identidades -----------------------------------------------------------

export type ActionName =
  | "create_work"
  | "update_work"
  | "refresh_external_data"
  | "consolidate_synopsis"
  | "enrich_tags"
  | "acquire_reviews"
  | "generate_review_summary"
  | "generate_review_digest"
  | "ensure_taste_profile"
  | "predict_interest_potential"
  | "run_ai_evaluation"
  | "recalculate_scores"
  | "run_alignment"
  | "run_deep_dive"
  | "generate_embedding"
  | "generate_all_work_data"

/** Custo da ação. Governa se ela pode ser encadeada sem confirmação (ver cost.ts). */
export type CostTier = "free" | "micro" | "metered" | "manual"

/** Classificação de cada ENTRADA de uma ação (regra fundamental do plano). */
export type RequirementKind =
  | "required_automatic_free"
  | "required_automatic_paid"
  | "required_manual"
  | "optional_with_fallback"

/** Dimensões de dado cuja prontidão o resolver de readiness mede. */
export type DataKey =
  | "work_row"
  | "raw_synopsis"
  | "canonical_synopsis"
  | "tags"
  | "tags_enriched"
  | "external_ids_accepted"
  | "platform_ratings"
  | "reviews"
  | "review_summary"
  | "review_digest"
  | "taste_profile"
  | "category_scores_ai"
  | "calculated_scores"
  | "interest_prediction"
  | "work_embedding"
  | "alignment_score"
  | "comix_hid"

// ---- Contrato --------------------------------------------------------------

export interface TokenEstimate {
  model: string
  /** Custo fixo da chamada. */
  base: UsageTokens
  /** Custo marginal por item processado — multiplicado por `scale` no cost.ts. */
  perItem?: UsageTokens
}

export interface ContractInput {
  dataKey: DataKey
  requirement: RequirementKind
  /** Texto do fallback quando `optional_with_fallback` (documenta o comportamento parcial). */
  fallback?: string
}

export interface ActionContract {
  action: ActionName
  costTier: CostTier
  /** true ⇒ a ação NUNCA é encadeada automaticamente como pré-requisito de outra. */
  manual: boolean
  /** DataKey que a ação torna pronto, ou null p/ entry-points sem saída de dado única. */
  produces: DataKey | null
  inputs: ContractInput[]
  /** Estimativa heurística de tokens (cost.ts). Ausente ⇒ custo 0 (free/manual sem auto-custo). */
  estimate?: TokenEstimate
  /** Pré-condição de DADO não-produzível por ação (ex.: ≥10 obras rotuladas p/ perfil). */
  precondition?: (snapshot: ContractPreconditionSnapshot) => { ok: boolean; reason?: string }
  /** Instrução exibida quando a ação/entrada bloqueia por ser manual. */
  manualInstruction?: string
}

/** Subconjunto do snapshot que as pré-condições consultam (evita acoplar ao readiness). */
export interface ContractPreconditionSnapshot {
  ratedWorksCount: number
  rawSynopsisCount: number
  canonicalPresent: boolean
}

// ---- Estimativas (heurísticas) ---------------------------------------------

// Mesmo caso do `cost-preview/catalog.ts`: o Sonnet vem do dono (as estimativas deste
// registro alimentam o GATE de custo, então um modelo errado aqui bloqueia ou libera pelo
// preço errado). O Haiku continua literal — é escolha de modelo barato, não "o ativo".
const HAIKU = "claude-haiku-4-5-20251001"
const SONNET = SONNET_MODEL

const ZERO: UsageTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
}

function tokens(inputTokens: number, outputTokens: number): UsageTokens {
  return { ...ZERO, inputTokens, outputTokens }
}

// ---- Mínimo de obras rotuladas p/ um perfil não-stub (espelha taste-profile.ts) ----
export const MIN_RATED_WORKS_FOR_PROFILE = 10

// ---- Registro --------------------------------------------------------------

export const ACTION_CONTRACTS: Record<ActionName, ActionContract> = {
  create_work: {
    action: "create_work",
    costTier: "free",
    manual: false,
    produces: "work_row",
    inputs: [],
  },
  update_work: {
    action: "update_work",
    costTier: "free",
    manual: false,
    produces: null,
    inputs: [],
  },
  refresh_external_data: {
    action: "refresh_external_data",
    costTier: "free",
    manual: false,
    produces: "platform_ratings",
    inputs: [{ dataKey: "external_ids_accepted", requirement: "required_manual" }],
    manualInstruction:
      "Atribua fontes externas em \"Revalidar fontes\" antes de atualizar os dados.",
  },
  consolidate_synopsis: {
    action: "consolidate_synopsis",
    costTier: "micro",
    manual: false,
    produces: "canonical_synopsis",
    inputs: [{ dataKey: "raw_synopsis", requirement: "required_automatic_free" }],
    estimate: { model: HAIKU, base: tokens(1500, 400) },
  },
  enrich_tags: {
    action: "enrich_tags",
    costTier: "micro",
    manual: false,
    produces: "tags_enriched",
    inputs: [{ dataKey: "tags", requirement: "required_automatic_free" }],
    estimate: { model: HAIKU, base: tokens(1200, 300) },
  },
  acquire_reviews: {
    action: "acquire_reviews",
    costTier: "free",
    manual: false,
    produces: "reviews",
    inputs: [{ dataKey: "external_ids_accepted", requirement: "required_manual" }],
    manualInstruction:
      "A obra precisa de IDs externos aceitos para colher reviews (Revalidar fontes / Buscar dados).",
  },
  generate_review_summary: {
    action: "generate_review_summary",
    costTier: "micro",
    // Haiku, max_tokens=700; amostra até 40 reviews (~400 tok/review). Conservador.
    manual: false,
    produces: "review_summary",
    inputs: [{ dataKey: "reviews", requirement: "required_automatic_free" }],
    estimate: { model: HAIKU, base: tokens(1000, 700), perItem: tokens(400, 0) },
  },
  generate_review_digest: {
    action: "generate_review_digest",
    // micro por obra; vira metered quando rodado em lote (scale alto no cost.ts).
    // Sonnet, max_tokens=2000; amostra até 40 reviews (~350 tok/review). Conservador.
    costTier: "micro",
    manual: false,
    produces: "review_digest",
    inputs: [{ dataKey: "reviews", requirement: "required_automatic_free" }],
    estimate: { model: SONNET, base: tokens(1500, 2000), perItem: tokens(350, 0) },
  },
  ensure_taste_profile: {
    action: "ensure_taste_profile",
    costTier: "metered",
    manual: false,
    produces: "taste_profile",
    inputs: [],
    // Sonnet, max_tokens=6000 (cap real do call); ~500 tok/obra (prompt envia
    // título/tags/notas/sinopse; ~90K tok p/ ~192 obras). Conservador.
    estimate: { model: SONNET, base: tokens(3000, 6000), perItem: tokens(500, 0) },
    precondition: (s) =>
      s.ratedWorksCount >= MIN_RATED_WORKS_FOR_PROFILE
        ? { ok: true }
        : {
            ok: false,
            reason: `Avalie ao menos ${MIN_RATED_WORKS_FOR_PROFILE} obras com nota pessoal (atual: ${s.ratedWorksCount}).`,
          },
    manualInstruction:
      "Avalie mais obras com nota pessoal para destilar um perfil de gosto não-stub.",
  },
  predict_interest_potential: {
    action: "predict_interest_potential",
    costTier: "micro",
    manual: false,
    produces: "interest_prediction",
    inputs: [
      { dataKey: "taste_profile", requirement: "required_automatic_paid" },
      {
        dataKey: "canonical_synopsis",
        requirement: "optional_with_fallback",
        fallback: "usa a sinopse bruta (split + bloco mais longo)",
      },
      { dataKey: "tags", requirement: "optional_with_fallback", fallback: "previsão sem contexto de tags" },
    ],
    // Sonnet, max_tokens=400; perfil cacheado + 1 sinopse. Output máximo plausível.
    estimate: { model: SONNET, base: tokens(1500, 400) },
    precondition: (s) =>
      s.canonicalPresent || s.rawSynopsisCount > 0
        ? { ok: true }
        : { ok: false, reason: "Obra sem nenhuma sinopse utilizável." },
  },
  run_ai_evaluation: {
    action: "run_ai_evaluation",
    costTier: "metered",
    manual: true,
    produces: "category_scores_ai",
    inputs: [{ dataKey: "external_ids_accepted", requirement: "required_manual" }],
    estimate: { model: SONNET, base: tokens(6000, 1500) },
    manualInstruction:
      "A avaliação IA completa é manual: rode em /curation/works ou no botão da página da obra.",
  },
  recalculate_scores: {
    action: "recalculate_scores",
    costTier: "free",
    manual: false,
    produces: "calculated_scores",
    inputs: [
      { dataKey: "category_scores_ai", requirement: "optional_with_fallback", fallback: "features de IA parciais (imputer)" },
      { dataKey: "taste_profile", requirement: "optional_with_fallback", fallback: "sem features de fit (null → imputer)" },
    ],
  },
  run_alignment: {
    action: "run_alignment",
    costTier: "metered",
    manual: true,
    produces: "alignment_score",
    inputs: [],
    // Sonnet, re-rank de 1 obra. max_tokens ~800.
    estimate: { model: SONNET, base: tokens(3000, 800) },
    manualInstruction: "O Veredito IA (re-rank) é acionado manualmente no ranking.",
  },
  run_deep_dive: {
    action: "run_deep_dive",
    costTier: "metered",
    manual: true,
    produces: null,
    inputs: [
      { dataKey: "review_digest", requirement: "optional_with_fallback", fallback: "usa review_summary ou nada" },
    ],
    manualInstruction: "O Deep Dive é acionado manualmente na página da obra.",
  },
  generate_embedding: {
    action: "generate_embedding",
    // OpenAI text-embedding-3-small (~$0,00003/obra). Não é Claude ⇒ sem
    // `estimate` (custo 0 no gate). Depende de sinopse+tags+scores+digest, então
    // roda por ÚLTIMO na cascata (o hash reflete o que estiver presente).
    costTier: "free",
    manual: false,
    produces: "work_embedding",
    inputs: [
      { dataKey: "canonical_synopsis", requirement: "optional_with_fallback", fallback: "usa sinopse bruta" },
      { dataKey: "tags", requirement: "optional_with_fallback", fallback: "embedding sem tags" },
      { dataKey: "category_scores_ai", requirement: "optional_with_fallback", fallback: "sem critérios no texto" },
      { dataKey: "review_digest", requirement: "optional_with_fallback", fallback: "sem contexto de review" },
    ],
  },
  generate_all_work_data: {
    // Entry-point da cascata IMPERATIVA (server/actions/generate-all.ts). NÃO é
    // encadeada por buildPlan — existe só como rótulo/dedup do job guarda-chuva.
    // A ordem dos passos vive no laço imperativo, não aqui.
    action: "generate_all_work_data",
    costTier: "metered",
    manual: false,
    produces: null,
    inputs: [],
  },
}

/**
 * Mapa DataKey → ação que o produz automaticamente (ou null se não-produzível
 * por ação — vem de form/import/fonte externa). O planner usa isto para, ao ver
 * uma entrada obrigatória ausente, descobrir qual ação executar.
 */
export const DATA_KEY_PRODUCER: Record<DataKey, ActionName | null> = {
  work_row: "create_work",
  raw_synopsis: null,
  canonical_synopsis: "consolidate_synopsis",
  tags: null,
  tags_enriched: "enrich_tags",
  external_ids_accepted: null,
  platform_ratings: "refresh_external_data",
  reviews: "acquire_reviews",
  review_summary: "generate_review_summary",
  review_digest: "generate_review_digest",
  taste_profile: "ensure_taste_profile",
  category_scores_ai: "run_ai_evaluation",
  calculated_scores: "recalculate_scores",
  interest_prediction: "predict_interest_potential",
  work_embedding: "generate_embedding",
  alignment_score: "run_alignment",
  comix_hid: null,
}

/** Instruções de bloqueio manual por data key (quando não há `manualInstruction` na ação). */
export const MANUAL_DATA_INSTRUCTIONS: Partial<Record<DataKey, string>> = {
  raw_synopsis: "Adicione ao menos uma sinopse à obra.",
  tags: "Adicione tags à obra.",
  external_ids_accepted: "Atribua fontes externas aceitas (Revalidar fontes / Buscar dados).",
  category_scores_ai:
    "Rode a Avaliação IA completa (manual) em /curation/works ou no botão da página da obra.",
  comix_hid: "Cole o hid do Comix na página da obra (Revalidar fontes).",
}

export function getContract(action: ActionName): ActionContract {
  return ACTION_CONTRACTS[action]
}
