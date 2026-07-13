import type { ConflictField, ExternalWorkData } from "./types"

/**
 * Campos que a atualização AUTOMÁTICA (Assinante) pode gravar.
 *
 * O Assinante paga por dado FRESCO, não por decidir o conteúdo. `works` é
 * COMPARTILHADA (não tem `user_id`), então toda escrita dele vale pra todo mundo —
 * e não há reversão por usuário enquanto a Fase 2 não existir. A fronteira, então:
 *
 *   ✅ o que ENVELHECE   → status de publicação, nº de capítulos, notas/votos das
 *                          plataformas, gêneros/tags, IDs externos.
 *   ❌ o que é ESCOLHA   → título, sinopse primária, capa primária.
 *
 * Título/sinopse/capa não entram por princípio, não por precaução: escolher a capa é
 * um ato de curadoria (o catálogo tem 520 obras com capa pior justamente porque a
 * escolha automática errava). Quem escolhe é o Curador.
 */
const AUTO_REFRESHABLE = [
  "publicationStatus",
  "totalChapters",
  "genres",
  "tags",
  "externalIds",
] as const

export interface AutoRefreshUpdate {
  publicationStatus?: string | null
  totalChapters?: number | null
  genres?: string[]
  tags?: string[]
  platformRatings?: Array<{ platform: string; rating?: number | null; votes?: number | null }>
  externalIds?: Record<string, string>
}

export interface AutoRefreshPlan {
  updates: AutoRefreshUpdate
  /** Campos que as fontes querem mudar mas DIVERGEM do salvo — deixados pro Curador. */
  skippedConflicts: string[]
}

/**
 * Achata as notas/votos das fontes num array por plataforma.
 *
 * Vivia dentro do update-data-dialog (client). Subiu pra cá quando o Assinante ganhou
 * a atualização automática: os dois caminhos precisam da MESMA regra, e duas cópias
 * divergem com o tempo.
 */
export function buildPlatformRatings(
  data: ExternalWorkData,
): Array<{ platform: string; rating?: number | null; votes?: number | null }> {
  const ratings: Array<{ platform: string; rating?: number | null; votes?: number | null }> = []
  const add = (platform: string, rating: number | null | undefined, votes: number | null | undefined) => {
    if (rating != null || (votes ?? 0) > 0) {
      ratings.push({ platform, rating: rating ?? null, votes: votes ?? null })
    }
  }
  if (data.externalPlatformRatings?.length) {
    for (const r of data.externalPlatformRatings) add(r.platform, r.rating, r.votes)
  }
  add("mangaupdates", data.muRating, data.muVotes)
  add("comick", data.cmxRating, data.cmxVotes)
  add("animeplanet", data.apRating, data.apVotes)
  return ratings
}

/**
 * Monta o update determinístico a partir do merge que o app já calculou.
 *
 * Duas regras, nesta ordem:
 *  1. Campo em CONFLITO (as fontes divergem do que está salvo) → NÃO toca. Conflito é
 *     exatamente onde faria falta uma decisão humana; sem humano, o certo é preservar
 *     o que o Curador deixou, não chutar.
 *  2. Campo fora da lista `AUTO_REFRESHABLE` → NÃO toca (ver a fronteira acima).
 *
 * `platformRatings` é sempre aplicado: é aditivo por plataforma (nota/votos de cada
 * fonte), nunca ambíguo, e é o dado que mais envelhece.
 */
export function buildAutoRefreshPlan(
  data: ExternalWorkData,
  conflicts: ConflictField[],
): AutoRefreshPlan {
  const conflicted = new Set<string>(conflicts.map((c) => String(c.field)))
  const updates: AutoRefreshUpdate = {}
  const skippedConflicts: string[] = []

  for (const field of AUTO_REFRESHABLE) {
    if (conflicted.has(field)) {
      skippedConflicts.push(field)
      continue
    }
    switch (field) {
      case "publicationStatus":
        if (data.publicationStatus != null) updates.publicationStatus = data.publicationStatus
        break
      case "totalChapters":
        if (data.totalChapters != null) updates.totalChapters = data.totalChapters
        break
      case "genres":
        if ((data.genres?.length ?? 0) > 0) updates.genres = data.genres
        break
      case "tags":
        if ((data.tags?.length ?? 0) > 0) updates.tags = data.tags
        break
      case "externalIds": {
        const cleaned: Record<string, string> = {}
        for (const [source, id] of Object.entries(data.externalIds ?? {})) {
          if (id) cleaned[source] = String(id)
        }
        if (Object.keys(cleaned).length > 0) updates.externalIds = cleaned
        break
      }
    }
  }

  // Aditivo por plataforma, nunca ambíguo — e é o que mais envelhece.
  const platformRatings = buildPlatformRatings(data)
  if (platformRatings.length > 0) updates.platformRatings = platformRatings

  return { updates, skippedConflicts }
}
