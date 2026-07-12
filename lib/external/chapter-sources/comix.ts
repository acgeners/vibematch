import { searchComix, fetchComixById, comixWorkUrl } from "@/lib/external/comix"
import { fetchAniListById } from "@/lib/external/anilist"
import { bestTitleMatch } from "@/lib/external/index"
import type { ExternalSearchResult } from "@/lib/external/types"
import type { PublicationStatus } from "@/types/domain"
import type { ChapterCheckInput, ChapterLookup, ChapterCrossIds } from "./types"

// Acima desse score consideramos o resultado da busca por título como a obra
// certa. Mesmo patamar de aceitação usado no pipeline de hidratação (0.72).
const TITLE_MATCH_THRESHOLD = 0.72
// Teto de variantes de título pesquisadas por etapa (limita chamadas).
const MAX_SEARCH_QUERIES = 4

function comixChapter(res: { chapters?: number }): number | null {
  return res.chapters && res.chapters > 0 ? res.chapters : null
}

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

/** Igualdade de ID cross-source (anilist/mal/mangadex/mangaupdates) = confirmação forte. */
function crossIdMatch(res: ExternalSearchResult, crossIds: ChapterCrossIds | undefined): boolean {
  if (!crossIds || !res.crossIds) return false
  const pairs: Array<[string | null | undefined, string | null | undefined]> = [
    [res.crossIds.anilist, crossIds.anilist],
    [res.crossIds.myanimelist, crossIds.myanimelist],
    [res.crossIds.mangadex, crossIds.mangadex],
    [res.crossIds.mangaupdates, crossIds.mangaupdates],
  ]
  return pairs.some(([a, b]) => a != null && b != null && String(a).trim() === String(b).trim())
}

/** Melhor similaridade do candidato contra qualquer um dos nomes conhecidos da obra. */
function nameScore(res: ExternalSearchResult, names: string[]): number {
  let best = 0
  for (const n of names) {
    const s = bestTitleMatch(n, res)
    if (s > best) best = s
  }
  return best
}

interface ComixMatch {
  hid: string
  chapter: number
  /** `true` só quando confirmado por cross-ID — único caso seguro pra persistir o hid. */
  confident: boolean
  /** Data relativa do último capítulo (string pré-formatada da comix). */
  releasedLabel: string | null
  /** Status de publicação declarado pela comix (mapeado), quando disponível. */
  status: PublicationStatus | null
}

/**
 * Busca o comix por um conjunto de queries e aceita um candidato por igualdade
 * de cross-ID (forte, aceita na hora) ou, na falta dela, pelo melhor título
 * acima do limiar. Os resultados de busca do comix já trazem `links`/`chapters`,
 * então não há fetch de detalhe no caminho comum.
 */
async function resolveBySearch(
  queries: string[],
  names: string[],
  crossIds: ChapterCrossIds | undefined,
): Promise<ComixMatch | null> {
  let titleFallback:
    | { hid: string; chapter: number; score: number; releasedLabel: string | null; status: PublicationStatus | null }
    | null = null

  for (const q of queries.slice(0, MAX_SEARCH_QUERIES)) {
    const results = await searchComix(q)
    for (const res of results) {
      const hid = res.id.split(":")[1] ?? ""
      if (!hid) continue

      if (crossIdMatch(res, crossIds)) {
        const detail = comixChapter(res) == null ? await fetchComixById(hid) : null
        const ch = comixChapter(res) ?? detail?.chapters ?? null
        if (ch != null && ch > 0) {
          return {
            hid,
            chapter: ch,
            confident: true,
            releasedLabel: res.lastChapterAt ?? detail?.lastChapterAt ?? null,
            status: res.publicationStatus ?? detail?.publicationStatus ?? null,
          }
        }
        continue // cross-id bateu mas sem capítulo confiável — ignora
      }

      const ch = comixChapter(res)
      if (ch == null) continue
      const score = nameScore(res, names)
      if (score >= TITLE_MATCH_THRESHOLD && (!titleFallback || score > titleFallback.score)) {
        titleFallback = { hid, chapter: ch, score, releasedLabel: res.lastChapterAt ?? null, status: res.publicationStatus ?? null }
      }
    }
  }

  return titleFallback
    ? {
        hid: titleFallback.hid,
        chapter: titleFallback.chapter,
        confident: false,
        releasedLabel: titleFallback.releasedLabel,
        status: titleFallback.status,
      }
    : null
}

/**
 * Último capítulo disponível no comix.to.
 *
 * 1. hid salvo → detalhe direto (match exato).
 * 2. Busca pelos nomes salvos (title/original/alternativos), confirmando por
 *    cross-ID ou similaridade de título.
 * 3. Fallback: quando os nomes salvos não trazem a obra, puxa sinônimos do
 *    AniList (pelo id salvo) como termos de busca — fecha casos de título
 *    alternativo onde só temos o nome secundário/original não-latino.
 *
 * `resolvedHid` é preenchido quando o match veio da busca (não do input), pra
 * que o chamador persista o hid e as próximas checagens virem exatas.
 */
export async function getComixLatestChapter(
  input: ChapterCheckInput,
): Promise<ChapterLookup> {
  if (input.comixHid) {
    const detail = await fetchComixById(input.comixHid)
    const ch = comixChapter(detail ?? {})
    if (ch != null) {
      return {
        chapter: ch,
        source: "comix",
        sourceUrl: comixWorkUrl(input.comixHid),
        releasedLabel: detail?.lastChapterAt ?? null,
        status: detail?.publicationStatus ?? null,
      }
    }
    // Detalhe sem capítulos válidos → cai pra busca.
  }

  const names = dedupe([input.title, input.originalTitle, ...(input.alternativeTitles ?? [])])

  let match = await resolveBySearch(names, names, input.crossIds)

  if (!match && input.crossIds?.anilist) {
    const anilistId = Number(input.crossIds.anilist)
    if (Number.isFinite(anilistId)) {
      const media = await fetchAniListById(anilistId)
      const synonyms = dedupe(media?.alternativeTitles ?? [])
      if (synonyms.length > 0) {
        match = await resolveBySearch(synonyms, dedupe([...names, ...synonyms]), input.crossIds)
      }
    }
  }

  if (!match) return null
  return {
    chapter: match.chapter,
    source: "comix",
    sourceUrl: comixWorkUrl(match.hid),
    // Só persiste hid confirmado por cross-ID; match só-por-título re-busca a cada checagem.
    resolvedHid: match.confident ? match.hid : null,
    releasedLabel: match.releasedLabel,
    status: match.status,
  }
}
