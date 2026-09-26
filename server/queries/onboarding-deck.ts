import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { pickDeckWorks } from "@/lib/onboarding/deck-sampler"
import type { DeckCandidate } from "@/lib/onboarding/deck-sampler"
import { coverCandidates } from "@/lib/work-derived"

type Linha = Record<string, unknown>

export interface OnboardingDeckWork {
  id: string
  title: string
  totalChapters: number | null
  synopsis: string
  coverUrls: string[]
  genres: string[]
}

/**
 * As obras do deck do onboarding para UM usuário: amostra que cobre os gêneros amados
 * (decisão de 2026-07-31; regra pura em `lib/onboarding/deck-sampler.ts`), com:
 *
 * - só obra com SINOPSE CANÔNICA (o deck mostra a sinopse inteira — é o rótulo limpo
 *   que treina o preditor de Interesse) e não-arquivada;
 * - 18+ fora quando o usuário escolheu ocultar (tela 2 grava `hide_adult_content`);
 * - fora o que o usuário JÁ tem estado (`user_work_state`) — não pergunta o que já sabe;
 * - popularidade = soma de votos das plataformas (`platform_ratings.vote_count`).
 *
 * Em DUAS fases de propósito: os candidatos saem SEM a sinopse (id/título/joins — a
 * `canonical_synopsis` é a coluna mais pesada de `works`, e o catálogo inteiro com ela
 * custa ~20 MB de egress); só as ~30 escolhidas são hidratadas com o texto.
 */
export async function getOnboardingDeck(opts: {
  userId: string
  lovedGenres: string[]
  hideAdult: boolean
  limit?: number
}): Promise<OnboardingDeckWork[]> {
  const supabase = createAdminClient()
  const limit = opts.limit ?? 30

  const [works, workGenres, genres, ratings, mine] = await Promise.all([
    fetchAllRows<Linha>(
      () => supabase.from("works").select("id, is_adult").eq("is_archived", false).not("canonical_synopsis", "is", null),
      { orderBy: ["id"], label: "getOnboardingDeck(works)" },
    ),
    fetchAllRows<Linha>(() => supabase.from("work_genres").select("work_id, genre_id"), {
      orderBy: ["work_id", "genre_id"],
      label: "getOnboardingDeck(work_genres)",
    }),
    fetchAllRows<Linha>(() => supabase.from("genres").select("id, name"), {
      orderBy: ["id"],
      label: "getOnboardingDeck(genres)",
    }),
    fetchAllRows<Linha>(() => supabase.from("platform_ratings").select("work_id, vote_count"), {
      orderBy: ["id"],
      label: "getOnboardingDeck(platform_ratings)",
    }),
    fetchAllRows<Linha>(() => supabase.from("user_work_state").select("work_id").eq("user_id", opts.userId), {
      orderBy: ["user_id", "work_id"],
      label: "getOnboardingDeck(user_work_state)",
    }),
  ])

  const genreName = new Map(genres.map((g) => [g.id as string, g.name as string]))
  const genresByWork = new Map<string, string[]>()
  for (const wg of workGenres) {
    const name = genreName.get(wg.genre_id as string)
    if (!name) continue
    const list = genresByWork.get(wg.work_id as string) ?? []
    list.push(name)
    genresByWork.set(wg.work_id as string, list)
  }

  const votesByWork = new Map<string, number>()
  for (const r of ratings) {
    const v = Number(r.vote_count ?? 0)
    if (!Number.isFinite(v)) continue
    votesByWork.set(r.work_id as string, (votesByWork.get(r.work_id as string) ?? 0) + v)
  }

  const knownIds = new Set(mine.map((m) => m.work_id as string))

  const candidates: DeckCandidate[] = works
    .filter((w) => !knownIds.has(w.id as string))
    .filter((w) => !opts.hideAdult || w.is_adult !== true)
    .map((w) => ({
      id: w.id as string,
      genres: genresByWork.get(w.id as string) ?? [],
      popularity: votesByWork.get(w.id as string) ?? 0,
    }))

  const pickedIds = pickDeckWorks(candidates, opts.lovedGenres, limit)
  if (pickedIds.length === 0) return []

  // Hidrata SÓ as escolhidas (30 ids — longe do limiar em que `.in` + embeds
  // despenca o plano do PostgREST).
  const { data: hydrated, error } = await supabase
    .from("works")
    .select("id, title, total_chapters, canonical_synopsis, work_covers(url, is_primary, position)")
    .in("id", pickedIds)
  if (error) throw new Error(`getOnboardingDeck(hidratação): ${error.message}`)

  const byId = new Map(
    ((hydrated ?? []) as Record<string, unknown>[]).map((w) => [w.id as string, w]),
  )
  return pickedIds
    .map((id) => {
      const w = byId.get(id)
      if (!w) return null
      return {
        id,
        title: w.title as string,
        totalChapters: (w.total_chapters as number | null) ?? null,
        synopsis: ((w.canonical_synopsis as string | null) ?? "").trim(),
        coverUrls: coverCandidates(w.work_covers as never),
        genres: genresByWork.get(id) ?? [],
      }
    })
    .filter((w): w is OnboardingDeckWork => w !== null && w.synopsis.length > 0)
}
