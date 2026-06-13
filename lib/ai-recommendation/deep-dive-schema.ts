import { z } from "zod"

// ============================================================
// Schema do payload do tool `submit_deep_analysis`.
// Estilo dos demais tools estruturados: nested arrays + campos
// opcionais quando há lacuna informacional, IDs validados contra
// Set conhecido depois do parse (não no Zod) pra permitir filtro
// silencioso em vez de hard fail.
// ============================================================

const tagItemSchema = z.object({
  tag: z.string().min(1),
  impact: z.number().min(0).max(1),
  why: z.string().min(1),
})

const criterionItemSchema = z.object({
  criterion: z.string().min(1),
  score: z.number().min(0).max(10),
  ideal_range: z.tuple([z.number().min(0).max(10), z.number().min(0).max(10)]),
  why: z.string().min(1),
})

const narrativeItemSchema = z.object({
  pattern: z.string().min(1),
  evidence: z.string().min(1),
})

const alignmentBreakdownSchema = z.object({
  tags_pros: z.array(tagItemSchema),
  tags_cons: z.array(tagItemSchema),
  criteria_pros: z.array(criterionItemSchema),
  criteria_cons: z.array(criterionItemSchema),
  narrative_match: z.array(narrativeItemSchema),
})

const similarInLibraryItemSchema = z.object({
  work_id: z.string().min(1),
  similarity_reason: z.string().min(1),
  user_score: z.number().min(0).max(10),
  alignment_signal: z.enum(["positive", "negative", "neutral"]),
})

const reviewSynthesisSchema = z.object({
  consensus: z.string().min(1),
  divergence: z.string().min(1),
  flags: z.array(z.string().min(1)),
})

const moodMatchSchema = z
  .object({
    fit: z.number().min(0).max(1),
    why: z.string().min(1),
  })
  .nullable()

const readRecommendationSchema = z.object({
  when: z.enum(["agora", "guardar", "evitar"]),
  reasoning: z.string().min(1),
  suggested_alternative_id: z.string().min(1).optional(),
})

export const deepDiveToolPayloadSchema = z.object({
  match_score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  one_liner: z.string().min(1).max(220),
  alignment_breakdown: alignmentBreakdownSchema,
  similar_in_library: z.array(similarInLibraryItemSchema),
  review_synthesis: reviewSynthesisSchema,
  mood_match: moodMatchSchema,
  read_recommendation: readRecommendationSchema,
})

export type DeepDiveToolPayload = z.infer<typeof deepDiveToolPayloadSchema>
export type DeepDiveAlignmentBreakdown = z.infer<typeof alignmentBreakdownSchema>
export type DeepDiveSimilarItem = z.infer<typeof similarInLibraryItemSchema>
export type DeepDiveTagItem = z.infer<typeof tagItemSchema>
export type DeepDiveCriterionItem = z.infer<typeof criterionItemSchema>
export type DeepDiveNarrativeItem = z.infer<typeof narrativeItemSchema>
export type DeepDiveReviewSynthesis = z.infer<typeof reviewSynthesisSchema>
export type DeepDiveReadRecommendation = z.infer<typeof readRecommendationSchema>
