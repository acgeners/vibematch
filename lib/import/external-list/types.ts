import type { PersonalStatus } from "@/types/domain"

// Fontes de listas externas suportadas na importação.
// "animeplanet" é exportado no formato XML do MyAnimeList (gzip).
// "anilist" não vem de arquivo — é buscado pela API pública a partir do usuário.
// "titles" é uma lista de títulos colada (só-título, pra curadoria em massa do admin).
export type ExternalListSource = "myanimelist" | "mangaupdates" | "animeplanet" | "anilist" | "titles"

export const EXTERNAL_LIST_SOURCE_LABELS: Record<ExternalListSource, string> = {
  myanimelist: "MyAnimeList (JSON)",
  mangaupdates: "MangaUpdates (JSON)",
  animeplanet: "Anime-Planet (XML)",
  anilist: "AniList (usuário)",
  titles: "Lista de títulos",
}

// Entrada já normalizada a partir do arquivo de origem.
// userScore sempre na escala 0–10 do app (ou null quando sem nota).
export interface ExternalListEntry {
  source: ExternalListSource
  externalId: string | null
  title: string
  personalStatus: PersonalStatus | null
  userScore: number | null
  chaptersRead: number | null
}

// Campos de uma obra que a importação pode tocar.
export type ReconcileField = "personal_status" | "user_score" | "chapters_read"

// Mudança proposta em um campo de uma obra já existente.
// kind "fill" = campo local vazio → aplica direto.
// kind "conflict" = local difere do importado → usuário escolhe.
export interface FieldChange {
  field: ReconcileField
  local: string | number | null
  imported: string | number
  kind: "fill" | "conflict"
  // Sugestão de seleção inicial para conflitos.
  defaultChoice: "local" | "imported"
}

export interface MatchPlan {
  entryIndex: number
  workId: string
  workTitle: string
  entryTitle: string
  matchedBy: "external_id" | "title"
  score: number
  changes: FieldChange[]
}

export interface AmbiguousCandidate {
  workId: string
  title: string
  score: number
}

export interface AmbiguousPlan {
  entryIndex: number
  entry: ExternalListEntry
  candidates: AmbiguousCandidate[]
}

export interface CreatePlan {
  entryIndex: number
  entry: ExternalListEntry
}

export interface ReconciliationBuckets {
  // Matches sem conflito, apenas preenchendo campos vazios.
  autoUpdate: MatchPlan[]
  // Matches com pelo menos um conflito a resolver.
  conflicts: MatchPlan[]
  // Match de confiança média — precisa confirmação manual.
  ambiguous: AmbiguousPlan[]
  // Não encontrados — serão criados.
  creates: CreatePlan[]
  // Matches sem nenhuma mudança (apenas contagem).
  unchangedCount: number
}

export interface AnalyzeExternalListResult {
  source: ExternalListSource
  entryCount: number
  buckets: ReconciliationBuckets
}

// ── Decisões enviadas de volta no commit ─────────────────────────────
// O servidor re-parseia o arquivo e re-roda o matching (determinístico),
// então só precisa das escolhas do usuário, indexadas por entryIndex.

export type AmbiguousDecision =
  | { action: "match"; workId: string }
  | { action: "create" }
  | { action: "skip" }

export interface ExternalListDecisions {
  // Por conflito: para cada campo, "imported" sobrescreve; ausente/"local" mantém.
  conflicts: Record<number, Partial<Record<ReconcileField, "local" | "imported">>>
  // Por entrada ambígua: casar com workId, criar nova, ou pular.
  ambiguous: Record<number, AmbiguousDecision>
  // entryIndex das novas obras que o usuário desmarcou (não criar).
  skipCreates: number[]
}

export interface CommitExternalListResult {
  importId: string
  updatedCount: number
  createdCount: number
  skippedCount: number
  errorCount: number
  errors: string[]
  // IDs das obras criadas nesta importação — alimentam a etapa de revisão.
  createdWorkIds: string[]
}
