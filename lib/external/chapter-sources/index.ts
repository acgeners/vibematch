import { withTimeout } from "@/lib/external/with-timeout"
import type { PublicationStatus } from "@/types/domain"
import { getComixLatestChapter } from "./comix"
import { getMangagoLatestChapter } from "./mangago"
import type { ChapterCheckInput, ChapterLookup, ChapterSourceId } from "./types"

export type { ChapterCheckInput, ChapterLookup, ChapterSourceId } from "./types"

// Cada fonte é só uma checadora de release (último cap + datas), separada do
// pipeline de metadata/IA. O agregador pega o maior capítulo entre elas.
//
// 🔴 O **coffeemanga saiu em 2026-08-12: o site deixou de existir**. `coffeemanga.ink`
// (e o `.com`) fazem 301 pra `bunnynovel.com`, um site de NOVELS — a busca Madara
// devolve zero resultados e `/manga/<slug>/` cai na home. O `.org` é página vazia e o
// `.net` dá 403. Medido rodando o acompanhamento inteiro: **0 acertos em 38 obras**,
// contra comix 30 e mangago 36. Ele não falhava alto: `searchCoffeemanga` lia a home
// do outro site, achava zero `post-title` e devolvia `[]` — indistinguível de "essa
// obra não está lá". Se um dia voltar, o módulo está no histórico do git.
//
// ⚠️ Ele era a fonte preferida de data ABSOLUTA e da lista real de capítulos
// (`chapterNumbers` → a contagem exata de não lidos). O mangago fornece as duas, então
// isso sobrevive — mas só em obra com slug do Mangago salvo.
const CHAPTER_SOURCES: Array<{
  id: ChapterSourceId
  lookup: (input: ChapterCheckInput) => Promise<ChapterLookup>
}> = [
  { id: "comix", lookup: getComixLatestChapter },
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
  /** Data absoluta (ISO) do último cap, quando a fonte vencedora fornece (mangago). */
  releasedAt?: string | null
  /** Datas absolutas (ISO) dos caps recentes da fonte vencedora — pra cadência. */
  cadenceDates?: string[]
  /** Lista completa de números de capítulo da fonte autoritativa (mangago) — pra contar caps de verdade. */
  chapterNumbers?: number[] | null
  /** URL da fonte autoritativa do capítulo (mangago quando achou; senão comix). `null` se nenhuma deu URL. */
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

  // Fonte autoritativa = a de MAIOR capítulo; EMPATE → mangago, que dá a LISTA real de
  // capítulos (contagem de verdade: cada decimal é 1 cap, sem aritmética de rótulo) e datas
  // absolutas. ⚠️ Nunca faça a fonte da lista vencer INCONDICIONALMENTE: quando ela está
  // ATRÁS de outra, isso SUBCONTA — se o comix já tem o cap novo (ex.: ch23) e a outra ainda
  // não o indexou (ch22), a obra fica PRESA no total antigo e o "cap novo" nunca aparece
  // (bug real: "My Husband Is Definitely a Paladin"). Quem tem o cap mais alto vence; o
  // desempate só decide o que já empatou.
  const primary = fulfilled.reduce<NonNullable<ChapterLookup> | undefined>((best, v) => {
    if (!best || v.chapter > best.chapter) return v
    if (v.chapter === best.chapter && v.source === "mangago" && best.source !== "mangago") {
      return v
    }
    return best
  }, undefined)

  // Status vem SEMPRE da comix (o mangago não fornece), independente de quem
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
