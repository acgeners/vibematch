import { z } from "zod"

// ============================================================================
// Contrato PÚBLICO do sidecar comix-render (fronteira estável app ↔ sidecar).
// Fonte única da forma do payload: os tipos são inferidos daqui (z.infer), e o
// client HTTP valida TODA resposta contra `comixSidecarResponseSchema` antes de
// entregá-la ao app — nunca aceitamos payload inválido em silêncio.
// Uma v2 da API muda AQUI (+ o path no client), não espalhado pelo código.
// ============================================================================

/** Entrada de `POST /resolve`. IDs opcionais/reservados (o sidecar pode ignorá-los). */
export const comixResolveInputSchema = z.object({
  title: z.string().min(1),
  anilistId: z.number().int().positive().optional(),
  malId: z.number().int().positive().optional(),
  mangaUpdatesId: z.string().min(1).optional(),
})

/** Item cru da busca (passthrough do Comix). `links` = URLs completas por fonte. */
export const comixSidecarItemSchema = z.object({
  hid: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  altTitles: z.array(z.string()).optional(),
  links: z.record(z.string(), z.string().nullable()).optional(),
})

export const comixSidecarMetaSchema = z.object({
  query: z.string(),
  elapsedMs: z.number(),
  totalCandidates: z.number(),
  source: z.string(),
})

/** Resposta de `/resolve`: união discriminada por `ok`. */
export const comixSidecarResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    items: z.array(comixSidecarItemSchema),
    meta: comixSidecarMetaSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    meta: z.object({ elapsedMs: z.number(), source: z.string() }),
  }),
])

export type ComixResolveInput = z.infer<typeof comixResolveInputSchema>
export type ComixSidecarItem = z.infer<typeof comixSidecarItemSchema>
export type ComixSidecarMeta = z.infer<typeof comixSidecarMetaSchema>
export type ComixSidecarResponse = z.infer<typeof comixSidecarResponseSchema>
