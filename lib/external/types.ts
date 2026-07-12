import type { PublicationStatus, CriterionSlug } from "@/types/domain"

export interface TagSuggestion {
  id: string
  name: string
  slug: string
}

export type ExternalSourceId =
  | "mangaupdates"
  | "comick"
  | "comix"
  | "animeplanet"
  | "myanimelist"
  | "mangadex"
  | "kitsu"
  | "anilist"
  | "mangago"
  | "outros"

export interface ExternalSearchResult {
  id: string           // "anilist:123" | "mu:456" | "kitsu:abc" | "mangadex:uuid" | "mal:789"
  source: ExternalSourceId
  title: string
  originalTitle?: string
  alternativeTitles?: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: PublicationStatus
  chapters?: number
  score?: number
  votes?: number
  genres?: string[]
  /** Classificação de conteúdo da fonte (MangaDex `contentRating`, ComicK `content_rating`): "safe" | "suggestive" | "erotica" | "pornographic". Sinal de conteúdo adulto — eleva o piso de adult_content na avaliação. */
  contentRating?: string
  /** Data relativa pré-formatada do último capítulo (ex.: comix "8mos ago"). */
  lastChapterAt?: string
  /** Cross-platform IDs the source itself surfaces (e.g. MangaDex `attributes.links`, AniList `idMal`). Used by the search pipeline to populate sibling-source IDs on the merged candidate so we can hydrate sources whose title search failed. */
  crossIds?: Partial<Record<ExternalSourceId, string>>
}

export interface ExternalSourceCandidateOption {
  source: ExternalSourceId
  externalId: string
  title: string
  coverUrl: string | null
  matchScore: number
  synopsis: string | null
  year: number | null
  chapters: number | null
  trusted?: boolean
}

/** One title deduplicated across sources — what the UI shows */
export interface MergedCandidate {
  title: string
  originalTitle?: string
  alternativeTitles?: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: PublicationStatus
  chapters?: number
  score?: number
  genres?: string[]
  anilistId?: number
  muId?: number
  animePlanetSlug?: string
  kitsuId?: string
  mangadexId?: string
  malId?: number
  sources: ExternalSourceId[]
  matchScore?: number
  comickHid?: string
  comixHid?: string
  mangagoSlug?: string
  sourceResults?: ExternalSearchResult[]
  sourceCandidates?: ExternalSourceCandidateOption[]
  /** Sources whose IDs came from another source's canonical cross-link (e.g. MangaDex `attributes.links`). At hydrate time we skip the title/synopsis acceptance filter for these — the cross-link is the trust signal. */
  trustedSources?: ExternalSourceId[]
}

export interface MultiSourceResult {
  data: ExternalWorkData
  conflicts: ConflictField[]
  debug?: ExternalMergeDebug
}

export interface ConflictOption {
  source: string
  displayValue: string
  value: unknown
}

export interface ConflictField {
  field: keyof ExternalWorkData
  label: string
  options: ConflictOption[]
}

export interface ExternalWorkData {
  title: string
  originalTitle?: string
  alternativeTitles?: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: PublicationStatus
  totalChapters?: number
  genres: string[]
  tags: string[]
  muRating?: number
  muVotes?: number
  cmxRating?: number
  cmxVotes?: number
  apRating?: number
  apVotes?: number
  externalPlatformRatings?: Array<{
    platform: string
    rating?: number | null
    votes?: number | null
  }>
  /** Indicates that synopsis was concatenated from multiple sources (used by UI for hint) */
  synopsisIsMerged?: boolean
  /** Per-source cover URLs collected during fetch (post-acceptance). Empty when only one accepted source. */
  multiCovers?: Array<{ url: string; source: ExternalSourceId }>
  /** Per-source synopsis blocks collected during fetch (cleaned + deduped). Empty when only one accepted source. */
  multiSynopses?: Array<{ source: ExternalSourceId; text: string }>
  /** Per-source external IDs from accepted sources, persisted to `work_external_ids` so future refreshes skip title search. */
  externalIds?: Partial<Record<ExternalSourceId, string>>
  /** Texto cru de "Status in Country of Origin" do MU detail. Usado pra
   * pré-preencher `observations` quando a obra está em Hiatus. */
  mangaUpdatesStatusText?: string
  criteriaScores?: Partial<Record<CriterionSlug, number>>
  criteriaJustifications?: Partial<Record<CriterionSlug, string>>
  /**
   * Metadata da avaliação IA usada pra popular criteriaScores/Justifications.
   * Plumbada até works.ts pra preencher ai_evaluations.input_hash, permitindo
   * cache hit no Path A (página /ai-evaluation) do mesmo título.
   */
  aiMeta?: {
    inputHash: string
    modelName: string
    promptVersion: string
    confidence: number | null
    /** Resumo gerado pela IA. Mostrado no work-form abaixo das notas por critério. */
    summary?: string | null
    /** Diagnóstico de por que não há reviews externas no prompt — usado na UI pra orientar a ação certa. */
    noReviewsReason?: "no_external_ids" | "all_rejected" | "search_miss" | "sources_returned_empty" | null
  }
  /** Pool completo de reviews externos coletados durante a avaliação. Plumbado
   * até `createWork` pra persistir em `work_reviews` depois da obra existir. */
  externalReviews?: SourcedReview[]
  debug?: ExternalMergeDebug
}

export interface SourcedReview {
  source: ExternalSourceId
  sourceTitle: string
  matchScore: number
  text: string
  /** Nota 0-10 extraída do prefixo "Nota do usuário: X/10" (quando a fonte expõe). */
  userRating?: number
  /** Comprimento do texto antes de qualquer truncamento — usado pelo sampler. */
  textLength?: number
  /**
   * Review escrita manualmente pelo usuário (vinda de `work_manual_reviews`).
   * Quando true, é tratada como evidência DIRETA sobre a obra no prompt (sem o
   * aviso de "verifique se descreve a mesma obra") e nunca é descartada pelo cap.
   */
  isManual?: boolean
}

/** Avaliação numérica de uma plataforma externa para a obra (rating 0-10 + nº de votos). Usada como sinal de recepção/popularidade no prompt da IA. */
export interface PlatformRating {
  platform: ExternalSourceId
  rating?: number
  votes?: number
}

/** Obra externa frequentemente recomendada a quem gostou da obra avaliada. Sinal estrutural de cluster temático para a IA — não autoridade sobre o conteúdo da obra avaliada. */
export interface SimilarWork {
  title: string
  genres: string[]
  /** Tags com nome (e rank quando a fonte fornece, ex.: AniList rank 0-100%). */
  tags?: string[]
  /** Fontes que recomendaram esta obra (uma obra pode aparecer em múltiplas listas). */
  sources: ExternalSourceId[]
  /** Soma dos pesos das recomendações (rating do AniList ou `num_recommendations` do MAL). Quanto maior, mais consenso. */
  weight?: number
}

export interface ExternalSourceDebug {
  source: string
  sourceId: string
  title?: string
  originalTitle?: string
  alternativeTitles: string[]
  matchScore: number
  accepted: boolean
  rejectionReason?: string
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: string
  chapters?: number
  score?: number
  votes?: number
  genres: string[]
  tags: string[]
}

export interface ExternalMergeDebug {
  queryTitle?: string
  acceptedSources: ExternalSourceDebug[]
  rejectedSources: ExternalSourceDebug[]
  mergedSynopses: Array<{ source: ExternalSourceId; text: string }>
}

/**
 * Saúde observada de uma fonte externa (`external_source_health`), como a UI lê.
 * Mora AQUI, e não no `source-health-store`, porque aquele módulo é `server-only`
 * — um componente cliente que importasse o tipo de lá arrastaria o guard pro
 * bundle do browser.
 */
export interface SourceHealthRow {
  status: string
  failReason: string | null
  lastOkAt: string | null
}
