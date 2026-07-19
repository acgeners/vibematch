import { withTimeout } from "@/lib/external/with-timeout"
import type { PublicationStatus } from "@/types/domain"
import { getComixLatestChapter } from "./comix"
import { getCoffeemangaLatestChapter } from "./coffeemanga"
import { getMangagoLatestChapter } from "./mangago"
import type { ChapterCheckInput, ChapterLookup, ChapterSourceId } from "./types"

export type { ChapterCheckInput, ChapterLookup, ChapterSourceId } from "./types"

// Cada fonte é só uma checadora de release (último cap + datas), separada do
// pipeline de metadata/IA. O agregador pega o maior capítulo entre elas.
const CHAPTER_SOURCES: Array<{
  id: ChapterSourceId
  lookup: (input: ChapterCheckInput) => Promise<ChapterLookup>
}> = [
  { id: "comix", lookup: getComixLatestChapter },
  { id: "coffeemanga", lookup: getCoffeemangaLatestChapter },
  // Mangago é slug-only (não busca por título) → só roda em obra com Mangago confirmado.
  { id: "mangago", lookup: getMangagoLatestChapter },
]

// Scrapers atrás de Cloudflare (comix via FlareSolverr) podem travar; o timeout
// transforma a fonte lenta numa rejeição fail-soft sem somar dezenas de segundos.
const SOURCE_TIMEOUT_MS = 25_000

export interface LatestChapterResult {
  /** Maior capítulo entre as fontes (mais atualizado vence), ou `null` se nenhuma respondeu. */
  latest: number | null
  /** Capítulo por fonte (`null` = falhou/sem match), pra diagnóstico na UI. */
  bySource: Partial<Record<ChapterSourceId, number | null>>
  /** hid do comix resolvido via busca (quando não havia hid salvo) — pra persistir. */
  resolvedComixHid?: string | null
  /** Data relativa do último capítulo (string pré-formatada da fonte, ex.: "8mos ago"). */
  releasedLabel?: string | null
  /** Data absoluta (ISO) do último cap, quando a fonte vencedora fornece (coffeemanga). */
  releasedAt?: string | null
  /** Datas absolutas (ISO) dos caps recentes da fonte vencedora — pra cadência. */
  cadenceDates?: string[]
  /** Lista completa de números de capítulo da fonte autoritativa (coffeemanga) — pra contar caps de verdade. */
  chapterNumbers?: number[] | null
  /** URL da fonte autoritativa do capítulo (coffeemanga quando achou; senão comix). `null` se nenhuma deu URL. */
  latestUrl?: string | null
  /** Status de publicação declarado pela comix (só ela fornece). `null` se indisponível. */
  status?: PublicationStatus | null
}

/**
 * Consulta todas as fontes de capítulo em paralelo (fail-soft) e agrega o maior
 * capítulo encontrado. Uma fonte que falha/expira não derruba as demais. Os
 * metadados de data (relativa/absoluta/cadência) vêm da fonte vencedora.
 */
export async function getLatestChapter(
  input: ChapterCheckInput,
): Promise<LatestChapterResult> {
  const settled = await Promise.allSettled(
    CHAPTER_SOURCES.map((s) =>
      withTimeout(s.lookup(input), SOURCE_TIMEOUT_MS, `chapter:${s.id}`),
    ),
  )

  const bySource: Partial<Record<ChapterSourceId, number | null>> = {}
  let resolvedComixHid: string | null = null

  const fulfilled: NonNullable<ChapterLookup>[] = []
  settled.forEach((res, i) => {
    const id = CHAPTER_SOURCES[i].id
    if (res.status === "fulfilled" && res.value) {
      bySource[id] = res.value.chapter
      fulfilled.push(res.value)
      if (id === "comix" && res.value.resolvedHid) resolvedComixHid = res.value.resolvedHid
    } else {
      bySource[id] = null
    }
  })

  // Fonte autoritativa: coffeemanga quando achou a obra (dá a LISTA real de capítulos,
  // pra contar de verdade — cada decimal é 1 cap, sem aritmética de rótulo). Senão, a
  // fonte de maior capítulo (comix). Todo o display (latest, datas, URL) vem dela.
  const coffee = fulfilled.find((v) => v.source === "coffeemanga")
  const primary =
    coffee ??
    fulfilled.reduce<NonNullable<ChapterLookup> | undefined>(
      (best, v) => (!best || v.chapter > best.chapter ? v : best),
      undefined,
    )

  // Status vem SEMPRE da comix (coffeemanga não fornece), independente de quem
  // venceu como fonte autoritativa do capítulo.
  const comixLookup = fulfilled.find((v) => v.source === "comix")

  return {
    latest: primary?.chapter ?? null,
    bySource,
    resolvedComixHid,
    releasedLabel: primary?.releasedLabel ?? null,
    releasedAt: primary?.releasedAt ?? null,
    cadenceDates: primary?.cadenceDates ?? [],
    chapterNumbers: primary?.chapterNumbers ?? null,
    latestUrl: primary?.sourceUrl ?? null,
    status: comixLookup?.status ?? null,
  }
}
