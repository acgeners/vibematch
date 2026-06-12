"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getLatestChapter, type ChapterCheckInput } from "@/lib/external/chapter-sources"
import { predictNextFromAnchor, parseRelativeAgeToDate } from "@/lib/external/chapter-sources/cadence"
import { comixWorkUrl } from "@/lib/external/comix"
import { fetchMangaDexChapterDates } from "@/lib/external/mangadex"
import { withTimeout } from "@/lib/external/with-timeout"
import { markRecalcPending } from "@/server/actions/recalc-queue"

type ExternalIdRow = { source: string; external_id: string | null; is_rejected: boolean }

/** Extrai o hid do comix (não-rejeitado) e os cross-IDs de uma obra a partir das linhas de work_external_ids. */
function readExternalIds(rows: ExternalIdRow[] | null | undefined): {
  comixHid: string | null
  comixRejected: boolean
  crossIds: NonNullable<ChapterCheckInput["crossIds"]>
} {
  const active = (rows ?? []).filter((e) => !e.is_rejected && e.external_id)
  const bySource = (s: string) => active.find((e) => e.source === s)?.external_id ?? null
  return {
    comixHid: bySource("comix"),
    comixRejected: (rows ?? []).some((e) => e.source === "comix" && e.is_rejected),
    crossIds: {
      anilist: bySource("anilist"),
      myanimelist: bySource("myanimelist"),
      mangadex: bySource("mangadex"),
      mangaupdates: bySource("mangaupdates"),
    },
  }
}

export interface ReadingUpdateResult {
  workId: string
  /** Último capítulo encontrado nas fontes externas (`null` = nenhuma respondeu). */
  latestExternal: number | null
  /** `true` quando há capítulo externo maior que o `total_chapters` salvo (ou quando ainda não sabíamos o total). */
  hasNew: boolean
  /** Quantos capítulos a mais que o salvo; `null` quando o total era desconhecido. */
  delta: number | null
  /** Contagem EXATA de capítulos lançados não lidos, da lista real (coffeemanga). `null` = sem lista (cai na estimativa). */
  unreadCount: number | null
  /** `true` quando nenhuma fonte retornou capítulo (timeout/Cloudflare/sem match). */
  failed: boolean
  /** Data relativa do último capítulo (string pré-formatada da fonte, ex.: "8mos ago"). */
  releasedLabel: string | null
  /** Data absoluta (ISO) do último cap, quando a fonte fornece (coffeemanga). */
  releasedAt: string | null
  /** URL de "Continuar lendo": comix quando há hid (leitura preferida); senão a fonte que achou. `null` se não há link. */
  latestUrl: string | null
  /** Próxima data de lançamento prevista (ISO) = último cap + cadência; `null` se indisponível. */
  nextPredictedAt: string | null
}

/**
 * Verifica, pra cada obra, o último capítulo disponível nas fontes externas e
 * compara com o `total_chapters` salvo. Não grava nada — só sinaliza. Fan-out
 * por obra; falhas de fonte caem fail-soft (`failed: true`).
 */
export async function checkReadingUpdates(
  workIds: string[],
): Promise<ReadingUpdateResult[]> {
  if (workIds.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(
      "id, title, original_title, alternative_titles, total_chapters, chapters_read, work_external_ids(source, external_id, is_rejected)",
    )
    .in("id", workIds)

  if (error) throw new Error(error.message)

  const works = (data ?? []) as Array<{
    id: string
    title: string
    original_title: string | null
    alternative_titles: string[] | null
    total_chapters: number | null
    chapters_read: number | null
    work_external_ids?: ExternalIdRow[] | null
  }>

  return Promise.all(
    works.map(async (w): Promise<ReadingUpdateResult> => {
      try {
        const { comixHid, comixRejected, crossIds } = readExternalIds(w.work_external_ids)
        // Respeita rejeição explícita do comix: não busca nem persiste.
        if (comixRejected && !comixHid) {
          return { workId: w.id, latestExternal: null, hasNew: false, delta: null, unreadCount: null, failed: true, releasedLabel: null, releasedAt: null, latestUrl: null, nextPredictedAt: null }
        }

        const { latest, resolvedComixHid, releasedLabel, releasedAt, cadenceDates, chapterNumbers, latestUrl: winnerUrl } =
          await getLatestChapter({
            title: w.title,
            originalTitle: w.original_title,
            alternativeTitles: w.alternative_titles ?? [],
            comixHid,
            crossIds,
          })

        // Self-healing: hid resolvido via busca e ainda não salvo → persiste pra
        // próximas checagens virem exatas (e backfill implícito de todas as obras).
        if (resolvedComixHid && !comixHid) {
          await persistComixHid(supabase, w.id, resolvedComixHid)
        }

        // Âncora do último cap: data absoluta da fonte (coffeemanga) tem prioridade
        // sobre a relativa do comix ("4d ago").
        const anchor = releasedAt ? new Date(releasedAt) : parseRelativeAgeToDate(releasedLabel)
        const lastReleasedIso =
          anchor && Number.isFinite(anchor.getTime()) ? anchor.toISOString() : null

        // Cadência: datas absolutas da própria fonte (coffeemanga); na falta, MangaDex.
        let cadence = cadenceDates ?? []
        if (cadence.length < 3 && crossIds.mangadex) {
          cadence = await withTimeout(
            fetchMangaDexChapterDates(crossIds.mangadex),
            8000,
            "cadence:mangadex",
          ).catch(() => [] as string[])
        }
        const nextPredictedAt = anchor ? predictNextFromAnchor(anchor, cadence) : null

        // Cacheia as datas pra exibir já no load (sem refazer a checagem).
        if (latest != null) {
          await persistReadingDates(supabase, w.id, lastReleasedIso, nextPredictedAt)
        }

        const hid = comixHid ?? resolvedComixHid ?? null
        const total = w.total_chapters ?? null
        const hasNew = latest != null && (total == null || latest > total)
        const delta = latest != null && total != null ? latest - total : null
        // Contagem exata: capítulos da lista real (coffeemanga) com nº > lido.
        const unreadCount = chapterNumbers
          ? chapterNumbers.filter((n) => n > (w.chapters_read ?? 0)).length
          : null

        // Sincroniza total_chapters com o cap da fonte autoritativa (coffeemanga quando
        // achou; senão comix) e recalcula. `ceil` porque um cap decimal é 1 cap inteiro
        // e mantém total ≥ latest (não re-detecta o mesmo decimal como "novo"). Ajusta
        // pra cima OU pra baixo — corrige totais antigos inflados (ex.: 130 do round(129.7)).
        if (latest != null && Math.ceil(latest) !== total) {
          await supabase.from("works").update({ total_chapters: Math.ceil(latest) }).eq("id", w.id)
          // total_chapters é feature do Ridge → marca pendente em vez de N
          // recalc-all dentro deste loop de sync de capítulos.
          await markRecalcPending("reading-chapter-sync").catch(() => {})
        }

        return {
          workId: w.id,
          latestExternal: latest,
          hasNew,
          delta,
          unreadCount,
          failed: latest == null,
          releasedLabel: releasedLabel ?? null,
          releasedAt: lastReleasedIso,
          // "Continuar lendo" sempre no comix quando há hid (leitura preferida); só cai
          // na fonte que achou (coffeemanga) quando a obra não está no comix.
          latestUrl: hid ? comixWorkUrl(hid) : (winnerUrl ?? null),
          nextPredictedAt,
        }
      } catch {
        return { workId: w.id, latestExternal: null, hasNew: false, delta: null, unreadCount: null, failed: true, releasedLabel: null, releasedAt: null, latestUrl: null, nextPredictedAt: null }
      }
    }),
  )
}

/**
 * Cacheia as datas (último cap + previsão) na linha da obra. Fail-soft: se a
 * migration 087 ainda não foi aplicada (colunas inexistentes), ignora em silêncio.
 */
async function persistReadingDates(
  supabase: ReturnType<typeof createAdminClient>,
  workId: string,
  lastChapterReleasedAt: string | null,
  nextChapterPredictedAt: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("works")
    .update({
      last_chapter_released_at: lastChapterReleasedAt,
      next_chapter_predicted_at: nextChapterPredictedAt,
      chapters_checked_at: new Date().toISOString(),
    })
    .eq("id", workId)
  if (error && !/does not exist|42703|could not find/i.test(error.message)) {
    console.error("[persistReadingDates] failed:", error.message)
  }
}

/** Persiste o hid do comix em work_external_ids (idempotente; não sobrescreve is_rejected). */
async function persistComixHid(
  supabase: ReturnType<typeof createAdminClient>,
  workId: string,
  hid: string,
): Promise<void> {
  const { error } = await supabase
    .from("work_external_ids")
    .upsert(
      { work_id: workId, source: "comix", external_id: hid },
      { onConflict: "work_id,source" },
    )
  if (error) console.error("[persistComixHid] failed:", error.message)
}
