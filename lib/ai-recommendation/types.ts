import type { CriterionSlug } from "@/types/domain"

export type RecommendationMode = "next_read" | "full_analysis" | "ranking"

export interface CandidateReview {
  source: string
  rating: number | null
  text: string
}

// ============================================================
// Review digest estruturado (Item C, Passe 2) — Sonnet 4.6.
// Preference-agnostic: o casamento com as preferências do user fica a jusante,
// no consultor (Item B v4). NÃO substitui o `review_summary` (texto Haiku da UI).
// ============================================================
export interface ReviewDigestTrait {
  trait: string
  /** Como o consenso enxerga o traço — não se o USER gosta dele (isso é a jusante). */
  polarity: "positive" | "negative" | "mixed"
  /** Eixo do traço: moralidade, tom, ritmo, arte, romance, personagens, etc. */
  axis: string
}

export interface ReviewDigest {
  /** O que os reviews concordam (1–3 frases). */
  consensus: string
  /** Onde as opiniões se dividem. */
  divergence: string
  /** Traços recorrentes citados, com polaridade do consenso e eixo. */
  salient_traits: ReviewDigestTrait[]
  /** Alertas de conteúdo (violência gráfica, etc.). */
  content_warnings: string[]
  /** Qualidade de execução (arte, ritmo, escrita). */
  execution: string
}

export interface ProfileTag {
  name: string
  group: string | null
  strength: number
}

export interface ProfileCriterionPreference {
  ideal_min: number
  ideal_max: number
  weight: number
  note?: string | null
}

export interface TasteProfilePayload {
  loved_tags: ProfileTag[]
  avoided_tags: ProfileTag[]
  loved_themes: string[]
  avoided_themes: string[]
  criterion_preferences: Partial<Record<CriterionSlug, ProfileCriterionPreference>>
  narrative_patterns: string[]
  /** Síntese completa (parágrafo) do gosto. */
  summary: string
  /** Síntese curta (2–3 frases, ~4–6 linhas) exibida por padrão; o `summary`
   *  completo fica atrás de "ver completo". Opcional: perfis pré-v7 não têm. */
  short_summary?: string
}

export interface TasteProfileRow {
  id: string
  version: number
  is_current: boolean
  is_stub: boolean
  n_works_used: number
  input_hash: string
  model_name: string
  prompt_version: string
  profile: TasteProfilePayload
  raw_response: unknown
  created_at: string
  /**
   * Fingerprint heurístico das obras que geraram o perfil (migration 118) —
   * base do gate de staleness por materialidade (classifyProfileStaleness).
   * null em perfis pré-migration. Shape = HeuristicFingerprint (inline p/ evitar
   * ciclo de import com profile-drift.ts).
   */
  heuristic_fingerprint?: { loved: string[]; avoided: string[]; criteria: string[] } | null
}

export interface RankedWork {
  work_id: string
  alignment_score: number
  justification: string
  top_match_factors: string[]
  // ============ Sub-fase 2.3.A — Smart Shortlist enriquecido ============
  // Todos opcionais (back-compat com prompt v1 e runs antigas).
  /** Confiança do modelo no alignment_score, 0–1. */
  confidence?: number | null
  /** 1–3 razões pra NÃO ler (mesmo se match alto). */
  risks?: string[]
  /** work_id de obras amadas (user_score ≥ 8) similares. */
  similar_loved?: string[]
  /** work_id de obras evitadas (user_score ≤ 5) similares — alerta. */
  similar_avoided?: string[]
  /** 1–2 quotes curtos das reviews fornecidas que sustentam match/risco. */
  review_quotes?: string[]
  /** Fit com mood/contexto, 0–1. NULL/omit quando sem mood na request. */
  mood_fit?: number | null
}

export interface RecommendationResult {
  mode_summary: string
  rankings: RankedWork[]
}

export interface RecommendationRunRow {
  id: string
  mode: RecommendationMode
  taste_profile_id: string | null
  user_context: string | null
  n_candidates: number
  candidate_work_ids: string[]
  results: RankedWork[]
  mode_summary: string | null
  model_name: string
  prompt_version: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  created_at: string
}

// ============================================================
// Chat de recomendação conversacional (plano Pago)
// ============================================================
// O chat é uma camada fina sobre o ranker: conversa em multi-turn e, quando
// entende o mood, dispara `runRecommendationAction`. Cada turno do assistente
// pode carregar um snapshot compacto da recomendação que gerou — auto-contido
// pra render (sem re-fetch da run), espelhando `recommendation_runs.results`.

export interface ChatRecommendationItem {
  work_id: string
  title: string
  /** Candidatas de capa (ver MAX_COVER_CANDIDATES). */
  coverUrls: string[]
  alignment_score: number
  justification: string
  top_match_factors: string[]
}

export interface ChatRecommendationSnapshot {
  /** Slug da recommendation_run criada (link pro detalhe completo). */
  runSlug: string
  runId: string
  modeSummary: string
  /** Contexto/mood que o modelo derivou da conversa pra rodar o ranker. */
  userContext: string | null
  candidatesEvaluated: number
  truncated: boolean
  items: ChatRecommendationItem[]
}

export interface ChatEvaluationScore {
  criterionSlug: string
  score: number | null
  justification: string | null
}

/** Resultado da avaliação completa (9 critérios) disparada pelo chat. Os scores
 * são SUGERIDOS (review_pending) — o usuário revisa/salva em /curation/works. */
export interface ChatEvaluationSnapshot {
  workId: string
  title: string
  coverUrl: string | null
  scores: ChatEvaluationScore[]
  summary: string | null
  confidence: number | null
  /** Link pra página de revisão/commit dos scores. */
  reviewHref: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  /** Texto exibido e re-enviado ao modelo nos turnos seguintes. */
  content: string
  /** Presente quando o turno do assistente gerou recomendações. */
  recommendation?: ChatRecommendationSnapshot
  /** Presente quando o turno gerou uma avaliação completa de 1 obra. */
  evaluation?: ChatEvaluationSnapshot
  /** Respostas rápidas sugeridas pelo modelo quando ele faz uma pergunta. */
  suggestions?: string[]
  created_at?: string
}

export interface ChatRow {
  id: string
  slug: string
  title: string | null
  messages: ChatMessage[]
  taste_profile_id: string | null
  model_name: string
  prompt_version: string
  created_at: string
  updated_at: string
}

export interface RatedWorkInput {
  id: string
  title: string
  userScore: number | null
  postScores: Partial<Record<string, number>>
  personalStatus: string | null
  synopsis: string | null
  categoryScores: Partial<Record<CriterionSlug, number>>
  tags: Array<{ name: string; group: string | null }>
}

export interface CandidateWorkInput {
  id: string
  title: string
  /** Conteúdo adulto (18+) efetivo — works.is_adult. Só pra exibição (selo no card). */
  isAdult: boolean
  synopsis: string | null
  categoryScores: Partial<Record<CriterionSlug, number>>
  tags: Array<{ name: string; group: string | null }>
  platformAvg: number | null
  totalVotes: number | null
  /** Nota Esperada (L1) — a previsão de referência enviada ao LLM. */
  expectedScore: number | null
  /** Alinhamento com o perfil (0–1). */
  fitScore: number | null
  /** Resumo de consenso das reviews (Haiku, preference-agnostic). Null se ausente. */
  reviewSummary: string | null
  /** Digest estruturado das reviews (Sonnet, Passe 2). Preferido sobre reviewSummary. */
  reviewDigest: ReviewDigest | null
}

export interface RankedCandidate extends RankedWork {
  work: CandidateWorkInput
  /** Candidatas de capa (ver MAX_COVER_CANDIDATES) — a UI cai pra próxima se a 1ª morrer. */
  coverUrls: string[]
}

// ============================================================
// Deep Dive (Sub-fase 2.3.C) — análise profunda por obra com
// extended thinking. Tipos derivados do Zod schema em
// deep-dive-schema.ts; mantidos aqui pra ficar próximo dos demais
// tipos de recomendação e facilitar imports nos clientes.
// ============================================================

export interface DeepDiveTagItem {
  tag: string
  impact: number
  why: string
}

export interface DeepDiveCriterionItem {
  criterion: string
  score: number
  ideal_range: [number, number]
  why: string
}

export interface DeepDiveNarrativeItem {
  pattern: string
  evidence: string
}

export interface DeepDiveAlignmentBreakdown {
  tags_pros: DeepDiveTagItem[]
  tags_cons: DeepDiveTagItem[]
  criteria_pros: DeepDiveCriterionItem[]
  criteria_cons: DeepDiveCriterionItem[]
  narrative_match: DeepDiveNarrativeItem[]
}

export type DeepDiveAlignmentSignal = "positive" | "negative" | "neutral"

export interface DeepDiveSimilarItem {
  work_id: string
  similarity_reason: string
  user_score: number
  alignment_signal: DeepDiveAlignmentSignal
  /** Hidratado server-side pós-parse pra evitar roundtrip no render. */
  title?: string
  /** Candidatas de capa (ver MAX_COVER_CANDIDATES). */
  coverUrls?: string[]
}

export interface DeepDiveReviewSynthesis {
  consensus: string
  divergence: string
  flags: string[]
}

export interface DeepDiveMoodMatch {
  fit: number
  why: string
}

export type DeepDiveReadWhen = "agora" | "guardar" | "evitar"

export interface DeepDiveReadRecommendation {
  when: DeepDiveReadWhen
  reasoning: string
  suggested_alternative_id?: string
  /** Hidratado server-side junto com suggested_alternative_id. */
  suggested_alternative_title?: string
}

/**
 * Payload do tool `submit_deep_analysis` após validação Zod e
 * filtragem de IDs inválidos. Persistido em `deep_dive_results.payload`.
 */
export interface DeepDivePayload {
  match_score: number
  confidence: number
  one_liner: string
  alignment_breakdown: DeepDiveAlignmentBreakdown
  similar_in_library: DeepDiveSimilarItem[]
  review_synthesis: DeepDiveReviewSynthesis
  mood_match: DeepDiveMoodMatch | null
  read_recommendation: DeepDiveReadRecommendation
}

/** Linha da tabela `deep_dive_results` (com payload tipado). */
export interface DeepDiveResultRow {
  id: string
  work_id: string
  taste_profile_id: string | null
  user_context: string | null
  payload: DeepDivePayload
  match_score: number | null
  confidence: number | null
  read_when: DeepDiveReadWhen | null
  one_liner: string | null
  model_name: string
  prompt_version: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  thinking_tokens: number | null
  ai_api_call_id: string | null
  created_at: string
}

export interface DeepDiveSimilarsBundle {
  loved: Array<{
    id: string
    title: string
    coverUrl: string | null
    userScore: number | null
    similarity: number
    synopsis: string | null
  }>
  avoided: Array<{
    id: string
    title: string
    coverUrl: string | null
    userScore: number | null
    similarity: number
    synopsis: string | null
  }>
}

export interface DeepDiveAlternativeCandidate {
  id: string
  title: string
  alignmentScore: number | null
}

export interface DeepDiveWorkBundle {
  id: string
  title: string
  synopsis: string | null
  tags: Array<{ name: string; group: string | null }>
  categoryScores: Partial<Record<CriterionSlug, number>>
  postScores: Partial<Record<string, number>>
  platformAvg: number | null
  totalVotes: number | null
  reviews: CandidateReview[]
  /** Resumo de consenso das reviews (Haiku, preference-agnostic). Null se ausente. */
  reviewSummary: string | null
  /** Digest estruturado das reviews (Sonnet, Passe 2). Preferido sobre reviewSummary. */
  reviewDigest: ReviewDigest | null
  /** Nota Esperada (L1) — predição offline; âncora de previsão pro consultor. */
  expectedScore: number | null
  /** true quando o expected_score é stub/fallback (poucos labels). */
  expectedIsStub: boolean
  /** fit_score (0–1) — alinhamento determinístico com o TasteProfile. */
  fit: number | null
}

export interface DeepDiveContext {
  profile: TasteProfilePayload
  profileId: string
  work: DeepDiveWorkBundle
  similars: DeepDiveSimilarsBundle
  alternatives: DeepDiveAlternativeCandidate[]
  recentActivity: Array<{ id: string; title: string; userScore: number | null; updatedAt: string }>
  workCoverUrl: string | null
}
