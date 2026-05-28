import { z } from "zod"
import { PUBLICATION_STATUSES, PERSONAL_STATUSES, SYNOPSIS_QUALITIES } from "@/types/domain"

const optionalScore = z
  .number()
  .min(0)
  .max(10)
  .nullable()
  .optional()

export const importRowSchema = z.object({
  title: z.string().min(1, "Título obrigatório"),
  romance: optionalScore,
  couple_dynamics: optionalScore,
  fantasy_nobility: optionalScore,
  action_adventure: optionalScore,
  adult_content: optionalScore,
  protagonist: optionalScore,
  humor: optionalScore,
  drama: optionalScore,
  tragedy: optionalScore,
  mu_rating: optionalScore,
  mu_votes: z.number().int().min(0).nullable().optional(),
  ap_rating: optionalScore,
  ap_votes: z.number().int().min(0).nullable().optional(),
  cmx_rating: optionalScore,
  cmx_votes: z.number().int().min(0).nullable().optional(),
  publication_status: z.enum(PUBLICATION_STATUSES).nullable().optional(),
  total_chapters: z.number().int().min(0).nullable().optional(),
  chapters_read: z.number().int().min(0).nullable().optional(),
  synopsis_quality: z.enum(SYNOPSIS_QUALITIES).nullable().optional(),
  personal_status: z.enum(PERSONAL_STATUSES).nullable().optional(),
  observation_adjustment: z.number().min(-0.30).max(0.30).nullable().optional(),
  user_score: optionalScore,
  predicted_score: optionalScore,
})

export type ImportRowInput = z.infer<typeof importRowSchema>

export const columnMappingSchema = z.object({
  sourceColumn: z.string(),
  targetField: z.string(),
})

export type ColumnMapping = z.infer<typeof columnMappingSchema>
