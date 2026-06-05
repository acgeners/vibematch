import { searchCoffeemanga, fetchCoffeemangaChapters } from "@/lib/external/coffeemanga"
import { fetchAniListById } from "@/lib/external/anilist"
import { fetchMangaDexById } from "@/lib/external/mangadex"
import { bestTitleMatch } from "@/lib/external/index"
import type { ChapterCheckInput, ChapterLookup } from "./types"

const TITLE_MATCH_THRESHOLD = 0.72
const MAX_SEARCH_QUERIES = 4

function dedupe(names: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const q = (n ?? "").trim()
    if (!q) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
  }
  return out
}

/** Melhor similaridade do título do candidato contra qualquer nome conhecido da obra. */
function nameScore(candidateTitle: string, names: string[]): number {
  let best = 0
  for (const n of names) {
    const s = bestTitleMatch(n, { title: candidateTitle })
    if (s > best) best = s
  }
  return best
}

/**
 * Busca o coffeemanga por um conjunto de queries e aceita o slug cujo título bate
 * (acima do limiar) com algum nome conhecido da obra. Sem cross-IDs aqui — só título.
 */
async function resolveBySearch(queries: string[], names: string[]): Promise<string | null> {
  const candidates = new Map<string, string>() // slug -> title
  for (const q of queries.slice(0, MAX_SEARCH_QUERIES)) {
    for (const c of await searchCoffeemanga(q)) {
      if (!candidates.has(c.slug)) candidates.set(c.slug, c.title)
    }
  }

  let best: { slug: string; score: number } | null = null
  for (const [slug, title] of candidates) {
    const score = nameScore(title, names)
    if (score >= TITLE_MATCH_THRESHOLD && (!best || score > best.score)) best = { slug, score }
  }
  return best?.slug ?? null
}

/**
 * Último capítulo no coffeemanga.ink (Madara, sem Cloudflare). Match por título
 * contra os nomes da obra; se os nomes salvos não acharem, usa sinônimos do
 * AniList (mesmo fallback do comix). Traz datas ABSOLUTAS (último cap + cadência).
 */
export async function getCoffeemangaLatestChapter(
  input: ChapterCheckInput,
): Promise<ChapterLookup> {
  const names = dedupe([input.title, input.originalTitle, ...(input.alternativeTitles ?? [])])

  let slug = await resolveBySearch(names, names)

  // Fallback: sem cross-ID, o coffeemanga depende do título. Quando os nomes
  // salvos não casam (caso de título alternativo), enriquece o conjunto com os
  // títulos autoritativos do MangaDex (pelo id salvo) + sinônimos do AniList — é
  // onde costuma estar o título inglês que o coffeemanga exibe.
  if (!slug && (input.crossIds?.anilist || input.crossIds?.mangadex)) {
    const extra: string[] = []
    if (input.crossIds.anilist) {
      const id = Number(input.crossIds.anilist)
      if (Number.isFinite(id)) extra.push(...((await fetchAniListById(id))?.alternativeTitles ?? []))
    }
    if (input.crossIds.mangadex) {
      const md = await fetchMangaDexById(input.crossIds.mangadex)
      if (md) extra.push(md.title, ...md.alternativeTitles)
    }
    const synonyms = dedupe(extra)
    if (synonyms.length > 0) {
      slug = await resolveBySearch(synonyms, dedupe([...names, ...synonyms]))
    }
  }

  if (!slug) return null

  const ch = await fetchCoffeemangaChapters(slug)
  if (!ch?.latest) return null

  return {
    chapter: ch.latest,
    source: "coffeemanga",
    sourceUrl: `https://coffeemanga.ink/manga/${slug}/`,
    releasedAt: ch.lastDateIso,
    cadenceDates: ch.recentDatesIso,
    chapterNumbers: ch.chapterNumbers,
  }
}
