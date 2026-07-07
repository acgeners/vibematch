import { createAdminClient } from "@/lib/supabase/admin"
import { ensureMangagoSlug } from "./mangago-persist"
import { resolveMangagoUrlProd } from "./mangago-resolve-prod"
import type { EnsureMangagoReason, EnsureMangagoResult, EnsureMangagoSlugParams } from "./mangago-persist"
import type { MangagoResolved } from "./mangago-resolve"
import type { MangagoResolveInput } from "./mangago-variants"
import type { ExternalSourceId } from "./types"

// ============================================================================
// E10B.4 — Cola do resolvedor do Mangago no contexto de avaliação (ai.ts), no
// MESMO ponto do Comix. Helper isolado e testável (o repo não tem testes de
// server-action). Fail-soft TOTAL: nunca quebra a avaliação.
// ============================================================================

type Supa = ReturnType<typeof createAdminClient>

// Reasons que produzem uma identidade Mangago SEGURA para o candidate path.
const INJECT_REASONS: ReadonlySet<EnsureMangagoReason> = new Set([
  "already_persisted",
  "manual_slug",
  "resolved_auto",
  "resolved_year_confirmed",
])

// External IDs vêm como string; AniList/MAL viram inteiro positivo (igual ai.ts).
function toPositiveInt(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export interface MangagoEvalContextParams {
  supabase: Supa
  workId: string
  identity: { title: string }
  /** Mutado in-place: injeta `.mangago` só em resultado seguro. */
  acceptedExternalIds: Partial<Record<ExternalSourceId, string>>
  rejectedSources: string[]
  enabled: boolean
  /** Injetáveis p/ teste; default = produção. */
  resolve?: (input: MangagoResolveInput) => Promise<MangagoResolved | null>
  ensure?: (p: EnsureMangagoSlugParams) => Promise<EnsureMangagoResult>
}

/**
 * Resolve/persiste o slug do Mangago reusando o estado já lido
 * (`alreadyKnownSlug`/`rejected` → sem 2ª query) e, SÓ em resultado seguro
 * (auto/year_confirmed/already_persisted/manual_slug), injeta
 * `acceptedExternalIds.mangago = slug` para o candidate path já hidratar
 * metadados/reviews do Mangago neste run. review/no_match/rejected/disabled/erro
 * NÃO injetam (review não pode virar identidade aceita). Nunca lança.
 */
export async function resolveMangagoForEvalContext(
  p: MangagoEvalContextParams
): Promise<EnsureMangagoResult | null> {
  try {
    const ensure = p.ensure ?? ensureMangagoSlug
    const resolve = p.resolve ?? resolveMangagoUrlProd
    const ext = p.acceptedExternalIds
    const result = await ensure({
      supabase: p.supabase,
      workId: p.workId,
      enabled: p.enabled,
      resolve,
      input: {
        title: p.identity.title,
        anilistId: toPositiveInt(ext.anilist),
        malId: toPositiveInt(ext.myanimelist),
        mangaUpdatesId: ext.mangaupdates,
      },
      alreadyKnownSlug: ext.mangago ?? null,
      rejected: p.rejectedSources.includes("mangago"),
    })
    if (result.slug && INJECT_REASONS.has(result.reason)) {
      ext.mangago = result.slug
    }
    return result
  } catch (err) {
    // Fail-soft: qualquer erro inesperado → segue a avaliação sem Mangago.
    console.error("[resolveMangagoForEvalContext] fail-soft:", String(err).slice(0, 160))
    return null
  }
}
