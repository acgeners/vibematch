import { z } from "zod"
import { CRITERION_SLUGS } from "@/types/domain"

const criterionSlugSchema = z.enum([...CRITERION_SLUGS] as [string, ...string[]])

const profileTagSchema = z.object({
  name: z.string().min(1),
  group: z.string().nullable().optional().transform((g) => g ?? null),
  strength: z.number().min(0).max(1),
})

const criterionPreferenceSchema = z.object({
  ideal_min: z.number().min(0).max(10),
  ideal_max: z.number().min(0).max(10),
  weight: z.number().min(0).max(1),
  note: z.string().nullable().optional(),
})

export const tasteProfileToolPayloadSchema = z.object({
  loved_tags: z.array(profileTagSchema),
  avoided_tags: z.array(profileTagSchema),
  loved_themes: z.array(z.string().min(1)),
  avoided_themes: z.array(z.string().min(1)),
  criterion_preferences: z.record(criterionSlugSchema, criterionPreferenceSchema),
  narrative_patterns: z.array(z.string().min(1)),
  summary: z.string().min(1),
})

export type TasteProfileToolPayload = z.infer<typeof tasteProfileToolPayloadSchema>

export const rankingToolPayloadSchema = z.object({
  mode_summary: z.string().min(1),
  rankings: z.array(
    z.object({
      work_id: z.string().min(1),
      alignment_score: z.number().min(0).max(100),
      justification: z.string().min(1),
      top_match_factors: z.array(z.string().min(1)),
    })
  ),
})

export type RankingToolPayload = z.infer<typeof rankingToolPayloadSchema>
