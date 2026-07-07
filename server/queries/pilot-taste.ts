import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"

/** Os 7 campos de gosto (6 eixos + gostei geral), na ordem do banco. */
export const TASTE_SCORE_KEYS = [
  "like_leads_score",
  "like_setting_score",
  "like_tone_score",
  "like_art_score",
  "like_pacing_score",
  "like_ending_score",
  "like_overall_score",
] as const

export type TasteScoreKey = (typeof TASTE_SCORE_KEYS)[number]

export interface TasteCriterion {
  slug: string
  key: TasteScoreKey
  name: string
  emoji: string
  description: string
  hints: string[]
  allowsNa: boolean
  isOverall: boolean
}

export interface PilotWork {
  id: string
  title: string
  userScore: number
  cover: string | null
  synopsis: string | null
  tags: string[]
  scores: Record<TasteScoreKey, number | null>
  endingNa: boolean
  /** Data (YYYY-MM-DD) da última leitura; null quando não registrada. */
  lastReadAt: string | null
}

/** Critérios de gosto (criteria eval_type='Gosto'), na ordem de inserção. */
export async function getTasteCriteria(): Promise<TasteCriterion[]> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from("criteria")
    .select("slug, key, criteria, emoji, description, ranges")
    .eq("eval_type", "Gosto")
    .order("id")
  if (error) throw new Error(`getTasteCriteria: ${error.message}`)
  return (data ?? []).map((c) => ({
    slug: c.slug as string,
    key: c.key as TasteScoreKey,
    name: c.criteria as string,
    emoji: (c.emoji as string | null) ?? "",
    description: (c.description as string | null) ?? "",
    hints: Array.isArray(c.ranges) ? (c.ranges as string[]) : [],
    allowsNa: c.slug === "taste_ending",
    isOverall: c.slug === "taste_overall",
  }))
}

/**
 * Obras já lidas (com user_score, não arquivadas), com capa/sinopse/tags e as
 * notas de gosto já dadas. Ordenadas pela ÚLTIMA LEITURA (desc): obra recém-lida
 * = recall melhor = nota de gosto mais precisa. Sem data vai pro fim.
 */
export async function getPilotWorks(): Promise<PilotWork[]> {
  const sb = createAdminClient()
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("works")
      .select(
        "id, title, user_score, last_read_at, canonical_synopsis, work_covers(url,is_primary,position), work_synopses(text,is_primary,position), work_tags(tags(name)), pilot_taste_scores(*)",
      )
      .not("user_score", "is", null)
      .eq("is_archived", false)
      .range(from, from + 999)
    if (error) throw new Error(`getPilotWorks: ${error.message}`)
    const batch = (data ?? []) as Record<string, unknown>[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }

  const works: PilotWork[] = rows.map((w) => {
    const ptsRaw = w.pilot_taste_scores
    const pts = (Array.isArray(ptsRaw) ? ptsRaw[0] : ptsRaw) as Record<string, unknown> | undefined
    const scores = {} as Record<TasteScoreKey, number | null>
    for (const k of TASTE_SCORE_KEYS) {
      const v = pts?.[k]
      scores[k] = v == null ? null : Number(v)
    }
    const tags = ((w.work_tags as { tags?: { name?: string } }[] | null) ?? [])
      .map((wt) => wt.tags?.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 6)
    return {
      id: w.id as string,
      title: w.title as string,
      userScore: Number(w.user_score),
      cover: pickPrimaryCover(w.work_covers as never),
      synopsis:
        (w.canonical_synopsis as string | null)?.trim() ||
        pickPrimarySynopsis(w.work_synopses as never),
      tags,
      scores,
      endingNa: Boolean(pts?.ending_na),
      lastReadAt: (w.last_read_at as string | null) ?? null,
    }
  })

  // Última leitura desc; sem data vai pro fim; empate no dia desempata por nota.
  works.sort((a, z) => {
    if (a.lastReadAt && z.lastReadAt) {
      if (a.lastReadAt !== z.lastReadAt) return a.lastReadAt < z.lastReadAt ? 1 : -1
      return z.userScore - a.userScore
    }
    if (a.lastReadAt) return -1
    if (z.lastReadAt) return 1
    return z.userScore - a.userScore
  })
  return works
}
