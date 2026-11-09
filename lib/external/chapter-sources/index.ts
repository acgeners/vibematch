import { withTimeout } from "@/lib/external/with-timeout"
import { pickTotalChapters } from "@/lib/external/chapter-total"
import type { PublicationStatus } from "@/types/domain"
import { getComixLatestChapter } from "./comix"
import { getMangagoLatestChapter } from "./mangago"
import { CHAPTER_SOURCE_IDS } from "./types"
import type { ChapterCheckInput, ChapterLookup, ChapterSourceId } from "./types"

export type { ChapterCheckInput, ChapterLookup, ChapterSourceId } from "./types"

// Cada fonte é só uma checadora de release (último cap + datas), separada do
// pipeline de metadata/IA. Quem escolhe entre elas é `pickTotalChapters` (Comix primeiro).
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
//
// ⚠️ O registro é um `Record` sobre `CHAPTER_SOURCE_IDS` de propósito: fonte nova na lista
// sem checadora aqui (ou o contrário) não compila — e a lista é a mesma que o merge do
// "Atualizar dados" usa como autoridade (`pickTotalChapters`).
const CHAPTER_LOOKUPS: Record<ChapterSourceId, (input: ChapterCheckInput) => Promise<ChapterLookup>> = {
  comix: getComixLatestChapter,
  // Mangago é slug-only (não busca por título) → só roda em obra com Mangago confirmado.
  mangago: getMangagoLatestChapter,
}
const CHAPTER_SOURCES = CHAPTER_SOURCE_IDS.map((id) => ({ id, lookup: CHAPTER_LOOKUPS[id] }))

// Scrapers atrás de Cloudflare (comix via FlareSolverr) podem travar; o timeout
// transforma a fonte lenta numa rejeição fail-soft sem somar dezenas de segundos.
const SOURCE_TIMEOUT_MS = 25_000

export interface LatestChapterResult {
  /** Último capítulo disponível pela régua de `pickTotalChapters`, ou `null` se nenhuma fonte serviu. */
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
 * Consulta todas as fontes de capítulo em paralelo (fail-soft) e escolhe o último capítulo
 * disponível pela régua de `pickTotalChapters` (Comix primeiro; o Mangago só sem ele). Uma
 * fonte que falha/expira não derruba as demais.
 *
 * `opts.currentTotal` é o total já gravado — só a referência da conferência de número
 * corrompido, nunca um valor escolhível.
 */
export async function getLatestChapter(
  input: ChapterCheckInput,
  opts: { currentTotal?: number | null } = {},
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

  // O capítulo é do dono da régua (`pickTotalChapters`), o MESMO que o "Atualizar dados" usa:
  // Comix primeiro, o Mangago só sem ele (ou com o Comix descartado como número corrompido).
  // Até 2026-11-09 vencia o MAIOR dos dois — e um capítulo-AVISO do Mangago virava capítulo novo.
  const pick = pickTotalChapters(
    fulfilled.map((v) => ({ source: v.source, chapters: v.chapter })),
    null,
    { current: opts.currentTotal },
  )
  const primary = pick.source ? fulfilled.find((v) => v.source === pick.source) : undefined

  // As DATAS absolutas e a LISTA real de capítulos são do Mangago, e só valem quando ele mostra o
  // MESMO capítulo que venceu: aí a data é a desse capítulo e a lista conta exatamente o que falta
  // ler. Com o Mangago atrás (ou à frente, num aviso), elas falariam de outro capítulo — e a data
  // fica a relativa do Comix, como já era quando o Comix vencia pelo tamanho.
  const mangago = fulfilled.find((v) => v.source === "mangago")
  const datas = primary && mangago && mangago.chapter === primary.chapter ? mangago : primary

  // Status vem SEMPRE da comix (o mangago não fornece), independente de quem
  // venceu como fonte autoritativa do capítulo.
  const comixLookup = fulfilled.find((v) => v.source === "comix")

  return {
    latest: primary?.chapter ?? null,
    bySource,
    resolvedComixHid,
    releasedLabel: primary?.releasedLabel ?? null,
    releasedAt: datas?.releasedAt ?? null,
    cadenceDates: datas?.cadenceDates ?? [],
    chapterNumbers: datas?.chapterNumbers ?? null,
    latestUrl: primary?.sourceUrl ?? null,
    status: comixLookup?.status ?? null,
  }
}
