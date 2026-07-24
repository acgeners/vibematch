import { z } from "zod"
import {
  PUBLICATION_STATUSES,
  PERSONAL_STATUSES,
  SYNOPSIS_QUALITIES,
  AI_EVAL_STATUSES,
} from "@/types/domain"
import { UNTRACKED_PERSONAL_STATUS } from "@/lib/constants/status-lookups"

const scoreField = (label: string) =>
  z
    .number({ message: `${label} deve ser um número` })
    .min(0, `${label} mínimo: 0`)
    .max(10, `${label} máximo: 10`)
    .nullable()
    .optional()

export const platformRatingSchema = z.object({
  rating: z
    .number()
    .min(0)
    .max(10)
    .nullable()
    .optional(),
  vote_count: z.number().int().min(0).optional().default(0),
})

const extraPlatformRatingSchema = z.object({
  platform: z.string().trim().min(1).max(80),
  rating: z.number().min(0).max(10).nullable().optional(),
  votes: z.number().int().min(0).nullable().optional(),
})

const coverEntrySchema = z.object({
  url: z.string().url(),
  source: z.string().trim().min(1).max(80),
  isPrimary: z.boolean(),
})

// Capa arquivada (migration 163). `source` é rótulo, não chave: aceita vazio
// porque uma capa legada pode ter sido salva sem fonte e ainda assim precisa
// poder ser arquivada.
const archivedCoverEntrySchema = z.object({
  url: z.string().url(),
  source: z.string().trim().max(80).nullable().optional(),
})

const synopsisEntrySchema = z.object({
  source: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(5000),
  isPrimary: z.boolean(),
})

// Objeto-base SEM a checagem de campo cruzado. Exportado porque o LOADER (que
// converte uma obra armazenada → valores do form pra edição) precisa parsear SEM
// lançar: se um dado corrompido (year_end < year) já existir no banco, você tem que
// conseguir ABRIR a obra pra corrigi-la — a rejeição vale só na SUBMISSÃO.
export const workFormBase = z.object({
  title: z.string().min(1, "Título obrigatório").max(500),
  original_title: z.string().max(500).nullable().optional(),
  alternative_titles: z.array(z.string().trim().min(1).max(500)).default([]),
  synopsis: z.string().max(30000).nullable().optional(),
  genres: z.array(z.string().max(100)).default([]),
  tags: z.array(z.string().max(100)).default([]),
  year: z.number({ message: "Ano deve ser um número" }).int().min(1900).max(2100).nullable().optional(),
  year_end: z.number({ message: "Ano deve ser um número" }).int().min(1900).max(2100).nullable().optional(),
  publication_status: z.enum(PUBLICATION_STATUSES).default("Unknown"),
  personal_status: z.enum(PERSONAL_STATUSES).default(UNTRACKED_PERSONAL_STATUS),
  // FKs canônicos (derivados do nome canônico no save). Opcionais aqui porque
  // o form ainda usa as colunas texto como binding; o server action faz a
  // conversão e grava ambos. Sairão obrigatórios após Fase 4.1.
  publication_status_id: z.number().int().nullable().optional(),
  personal_status_id: z.number().int().nullable().optional(),
  total_chapters: z.number().int().min(0).nullable().optional(),
  chapters_read: z.number().int().min(0).nullable().optional(),
  synopsis_quality: z.enum(SYNOPSIS_QUALITIES).nullable().optional(),
  observation_adjustment: z.number().min(-0.30).max(0.30).default(0),
  user_score: scoreField("Nota pessoal"),
  post_story_score: scoreField("História"),
  post_fl_score: scoreField("Female Lead"),
  post_ml_score: scoreField("Male Lead"),
  post_character_development_score: scoreField("Desenvolvimento dos Personagens"),
  post_pacing_score: scoreField("Ritmo"),
  post_art_visual_score: scoreField("Arte/Visual"),
  post_impact_immersion_score: scoreField("Impacto/Imersão"),
  post_originality_score: scoreField("Originalidade"),
  observations: z.string().max(2000).nullable().optional(),
  cover_url: z.string().url().nullable().optional().or(z.literal("")),
  ai_eval_status: z.enum(AI_EVAL_STATUSES).default("pending"),
  ai_justifications: z.record(z.string(), z.string()).optional().default({}),

  // Notas por critério
  romance: scoreField("Romance"),
  couple_dynamics: scoreField("Dinâmica do Casal"),
  fantasy_nobility: scoreField("Fantasia/Nobreza"),
  action_adventure: scoreField("Ação/Aventura"),
  adult_content: scoreField("Conteúdo Adulto"),
  protagonist: scoreField("Protagonista Marcante"),
  humor: scoreField("Humor"),
  drama: scoreField("Drama"),
  tragedy: scoreField("Tragédia"),

  // Plataformas externas
  mu_rating: z.number().min(0).max(10).nullable().optional(),
  mu_votes: z.number().int().min(0).nullable().optional(),
  ap_rating: z.number().min(0).max(10).nullable().optional(),
  ap_votes: z.number().int().min(0).nullable().optional(),
  cmx_rating: z.number().min(0).max(10).nullable().optional(),
  cmx_votes: z.number().int().min(0).nullable().optional(),
  extra_platform_ratings: z.array(extraPlatformRatingSchema).default([]),

  // Multi-source metadata (Fase 2)
  covers: z.array(coverEntrySchema).default([]),
  // Capas que você apagou. Ficam fora de `covers` mas persistem, pra que
  // "Atualizar dados" não as traga de volta (migration 163).
  archived_covers: z.array(archivedCoverEntrySchema).default([]),
  synopses: z.array(synopsisEntrySchema).default([]),

  // External source IDs (anilist, mangaupdates, myanimelist, kitsu, mangadex, comick, comix, animeplanet)
  // Persisted to work_external_ids so future "Atualizar dados" can rehydrate without a title search.
  external_ids: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
})

// Regra de campo cruzado: o ano de fim não pode ser anterior ao de início. Barra na
// ENTRADA MANUAL o dado corrompido (year_end < year) que virava RunLength negativo =
// outlier de dezenas de σ inflando a Nota Prevista (ver buildWork em
// server/actions/calculations.ts:256 e a memória do outlier de RunLength). O import NÃO
// é rejeitado aqui — ele SANITIZA no merge (lib/external/index.ts) pra uma fonte com ano
// ruim não bloquear a obra inteira.
const yearEndNotBeforeStart = (d: { year?: number | null; year_end?: number | null }) =>
  d.year == null || d.year_end == null || d.year_end >= d.year
const yearEndIssue = {
  message: "Ano de fim não pode ser anterior ao ano de início",
  path: ["year_end"],
}

export const workFormSchema = workFormBase.refine(yearEndNotBeforeStart, yearEndIssue)

export type WorkFormValues = z.infer<typeof workFormSchema>
export type WorkFormInput = z.input<typeof workFormSchema>

export const workUpdateSchema = workFormBase
  .partial()
  .extend({ title: z.string().min(1).max(500) })
  .refine(yearEndNotBeforeStart, yearEndIssue)

export type WorkUpdateValues = z.infer<typeof workUpdateSchema>

export const workStatusSchema = z.object({
  personal_status: z.enum(PERSONAL_STATUSES),
  personal_status_id: z.number().int().nullable().optional(),
  synopsis_quality: z.enum(SYNOPSIS_QUALITIES).nullable().optional(),
  observation_adjustment: z.number().min(-0.30).max(0.30).default(0),
  observations: z.string().max(2000).nullable().optional(),
  chapters_read: z.number().int().min(0).nullable().optional(),
  last_read_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .refine(
      (v) => v <= new Date().toISOString().slice(0, 10),
      { message: "A data não pode ser no futuro" }
    )
    .nullable()
    .optional(),
  user_score: scoreField("Nota pessoal"),
  post_story_score: scoreField("História"),
  post_fl_score: scoreField("Female Lead"),
  post_ml_score: scoreField("Male Lead"),
  post_character_development_score: scoreField("Desenvolvimento dos Personagens"),
  post_pacing_score: scoreField("Ritmo"),
  post_art_visual_score: scoreField("Arte/Visual"),
  post_impact_immersion_score: scoreField("Impacto/Imersão"),
  post_originality_score: scoreField("Originalidade"),
})

export type WorkStatusValues = z.infer<typeof workStatusSchema>
export type WorkStatusInput = z.input<typeof workStatusSchema>
