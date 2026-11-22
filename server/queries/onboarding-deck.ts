import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { pickDeckWorks } from "@/lib/onboarding/deck-sampler"
import type { DeckCandidate } from "@/lib/onboarding/deck-sampler"
import { coverCandidates } from "@/lib/work-derived"
import { workIdsWithAnyTag } from "@/server/queries/works-with-tags"

type Linha = Record<string, unknown>

export interface OnboardingDeckWork {
  id: string
  title: string
  totalChapters: number | null
  synopsis: string
  coverUrls: string[]
  genres: string[]
  /** Média das plataformas (nota da comunidade, `calculated_scores.platform_avg`). */
  platformAvg: number | null
  /** Votos somados das plataformas (`calculated_scores.total_votes`). */
  totalVotes: number | null
  /** Status de publicação (`works.publication_status_id`): a lista de notas o mostra ao lado dos gêneros. */
  publicationStatusId: number | null
}

/**
 * As obras do deck do onboarding para UM usuário: amostra que cobre os gêneros amados
 * (decisão de 2026-07-31; regra pura em `lib/onboarding/deck-sampler.ts`), com:
 *
 * - só obra com SINOPSE CANÔNICA (o deck mostra a sinopse inteira — é o rótulo limpo
 *   que treina o preditor de Interesse) e não-arquivada;
 * - 18+ fora quando o usuário escolheu ocultar (tela 2 grava `hide_adult_content`);
 * - fora o que o usuário JÁ tem estado (`user_work_state`) — não pergunta o que já sabe;
 * - fora obra com tag que o usuário EVITA (`avoidedTagSlugs`): quem vetou isekai na tela anterior
 *   não pode receber isekai na seguinte;
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
  /** Slugs das tags que o usuário evita (todas as declaradas, com grupo e subgrupo expandidos). */
  avoidedTagSlugs?: string[]
  limit?: number
}): Promise<OnboardingDeckWork[]> {
  const supabase = createAdminClient()
  const limit = opts.limit ?? 30

  const [works, workGenres, genres, ratings, mine, vetoed] = await Promise.all([
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
    workIdsWithAnyTag(supabase, opts.avoidedTagSlugs ?? []),
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
    .filter((w) => !vetoed.has(w.id as string))
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
    .select(
      "id, title, total_chapters, publication_status_id, canonical_synopsis, work_covers(url, is_primary, position), calculated_scores(platform_avg, total_votes)",
    )
    .in("id", pickedIds)
  if (error) throw new Error(`getOnboardingDeck(hidratação): ${error.message}`)

  const byId = new Map(
    ((hydrated ?? []) as Record<string, unknown>[]).map((w) => [w.id as string, w]),
  )
  return pickedIds
    .map((id) => {
      const w = byId.get(id)
      if (!w) return null
      // Embed to-one: o PostgREST devolve OBJETO (unique em work_id); aceitar as duas formas.
      const cs = (Array.isArray(w.calculated_scores) ? w.calculated_scores[0] : w.calculated_scores) as
        | { platform_avg: number | null; total_votes: number | null }
        | null
        | undefined
      return {
        platformAvg: cs?.platform_avg ?? null,
        totalVotes: cs?.total_votes ?? null,
        id,
        title: w.title as string,
        totalChapters: (w.total_chapters as number | null) ?? null,
        publicationStatusId: (w.publication_status_id as number | null) ?? null,
        synopsis: ((w.canonical_synopsis as string | null) ?? "").trim(),
        coverUrls: coverCandidates(w.work_covers as never),
        genres: genresByWork.get(id) ?? [],
      }
    })
    .filter((w): w is OnboardingDeckWork => w !== null && w.synopsis.length > 0)
}

/**
 * Monta obras pelo id, no mesmo formato do deck: as que a pessoa trouxe da lista importada e
 * chegaram SEM nota vão para a tela de notas ao lado das marcadas no deck.
 *
 * Em fatias de 50: `.in("id")` com embeds degrada o plano do PostgREST quando a lista cresce, e uma
 * lista importada pode trazer centenas. Sem sinopse a obra entra igual (aqui não há cartão).
 */
export async function hydrateOnboardingWorks(ids: string[]): Promise<OnboardingDeckWork[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return []
  const supabase = createAdminClient()
  const byId = new Map<string, OnboardingDeckWork>()
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const { data, error } = await supabase
      .from("works")
      .select(
        "id, title, total_chapters, publication_status_id, canonical_synopsis, work_covers(url, is_primary, position), calculated_scores(platform_avg, total_votes), work_genres(genres(name))",
      )
      .in("id", chunk)
    if (error) throw new Error(`hydrateOnboardingWorks: ${error.message}`)
    for (const w of (data ?? []) as Record<string, unknown>[]) {
      const cs = (Array.isArray(w.calculated_scores) ? w.calculated_scores[0] : w.calculated_scores) as
        | { platform_avg: number | null; total_votes: number | null }
        | null
        | undefined
      const genres = ((w.work_genres as { genres?: { name?: string } | { name?: string }[] | null }[] | null) ?? [])
        .map((wg) => (Array.isArray(wg.genres) ? wg.genres[0]?.name : wg.genres?.name))
        .filter((n): n is string => typeof n === "string")
      byId.set(w.id as string, {
        id: w.id as string,
        title: w.title as string,
        totalChapters: (w.total_chapters as number | null) ?? null,
        publicationStatusId: (w.publication_status_id as number | null) ?? null,
        synopsis: ((w.canonical_synopsis as string | null) ?? "").trim(),
        coverUrls: coverCandidates(w.work_covers as never),
        genres,
        platformAvg: cs?.platform_avg ?? null,
        totalVotes: cs?.total_votes ?? null,
      })
    }
  }
  // A ordem de entrada (a mais recente primeiro) vale mais que a do banco.
  return unique.map((id) => byId.get(id)).filter((w): w is OnboardingDeckWork => w != null)
}
