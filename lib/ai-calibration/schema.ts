import { z } from "zod"
import { CRITERION_SLUGS } from "@/types/domain"

const criterionSlugSchema = z.enum([...CRITERION_SLUGS] as [string, ...string[]])


export const biasToolPayloadSchema = z.object({
  summary: z.string().min(1),
  entries: z.array(
    z.object({
      criterion_slug: criterionSlugSchema,
      bias_estimate: z.number().min(-5).max(5),
      dispersion: z.enum(["low", "medium", "high"]),
      confidence: z.number().min(0).max(1),
      recommendation: z.string().min(1),
    }),
  ),
})

export type BiasToolPayload = z.infer<typeof biasToolPayloadSchema>
