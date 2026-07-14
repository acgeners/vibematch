"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getLatestChapter, type ChapterCheckInput } from "@/lib/external/chapter-sources"
import { predictNextFromAnchor, parseRelativeAgeToDate } from "@/lib/external/chapter-sources/cadence"
import { comixWorkUrl } from "@/lib/external/comix"
import { fetchMangaDexChapterDates } from "@/lib/external/mangadex"
import { fetchMangaUpdatesStatus } from "@/lib/external/mangaupdates"
import { withTimeout } from "@/lib/external/with-timeout"
import { markRecalcPending } from "@/server/recalc/queue"
import { ensureAdmin } from "@/server/queries/current-user"
import { persistComixHid } from "@/server/actions/comix-hid"
import {
  getPublicationStatusIdByName,
  getPublicationStatusNameById,
} from "@/lib/constants/status-lookups"

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
  /** Status de publicação das fontes nesta checagem (MangaUpdates preferido, senão comix). `null` se indisponível. */
  statusExternal: string | null
  /** Novo status GRAVADO nesta checagem (Completed/Hiatus/Cancelled), ou `null` se nada mudou. */
  statusApplied: string | null
  /** `true` quando a obra foi PULADA (publicação já concluída → sem capítulos novos). */
  skipped: boolean
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
  // Sincroniza total_chapters/publication_status (metadados compartilhados de works)
  // como efeito colateral → só o admin (dono). Sem canal de erro nesta shape:
  // não-admin recebe [] (nenhuma atualização); a UI que dispara isto some na parte C.
  const gate = await ensureAdmin()
  if (!gate.ok) return []

  const supabase = createAdminClient()
  // Lê o dado PESSOAL do DONO (chapters_read) → vem do espelho via a view `works_owner`,
  // não da linha compartilhada de `works` (que vai perder essas colunas).
  const { data, error } = await supabase
    .from("works_owner")
    .select(
      "id, title, original_title, alternative_titles, total_chapters, chapters_read, publication_status_id, work_external_ids(source, external_id, is_rejected)",
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
    publication_status_id: number | null
    work_external_ids?: ExternalIdRow[] | null
  }>

  return Promise.all(
    works.map(async (w): Promise<ReadingUpdateResult> => {
      try {
        // Obra com publicação já CONCLUÍDA não terá capítulos novos → pula o fetch
        // externo (o mais caro, via FlareSolverr). O contador de pendentes continua
        // vindo do total_chapters/chapters_read salvos (sem checagem).
        if (getPublicationStatusNameById(w.publication_status_id) === "Completed") {
          return { workId: w.id, latestExternal: null, hasNew: false, delta: null, unreadCount: null, failed: false, releasedLabel: null, releasedAt: null, latestUrl: null, nextPredictedAt: null, statusExternal: "Completed", statusApplied: null, skipped: true }
        }

        const { comixHid, comixRejected, crossIds } = readExternalIds(w.work_external_ids)
        // Respeita rejeição explícita do comix: não busca nem persiste.
        if (comixRejected && !comixHid) {
          return { workId: w.id, latestExternal: null, hasNew: false, delta: null, unreadCount: null, failed: true, releasedLabel: null, releasedAt: null, latestUrl: null, nextPredictedAt: null, statusExternal: null, statusApplied: null, skipped: false }
        }

        const [chapterResult, muStatus] = await Promise.all([
          getLatestChapter({
            title: w.title,
            originalTitle: w.original_title,
            alternativeTitles: w.alternative_titles ?? [],
            comixHid,
            crossIds,
          }),
          fetchMuStatus(crossIds.mangaupdates),
        ])
        const { latest, resolvedComixHid, releasedLabel, releasedAt, cadenceDates, chapterNumbers, latestUrl: winnerUrl } =
          chapterResult
        // Status de publicação: MangaUpdates é a fonte mais confiável → tem
        // precedência; a comix é fallback quando o MU não tem ID/dado.
        const comixStatus =
          chapterResult.status && chapterResult.status !== "Unknown" ? chapterResult.status : null
        const statusExternal = muStatus ?? comixStatus

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

        // Sincroniza status de publicação da comix. Política: só aplica transições de
        // FIM/HIATO (Completed/Hiatus/Cancelled) que diferem do atual; nunca escreve
        // "Ongoing" (não reverte); e não mexe em obra já terminal (Completed/Cancelled)
        // pra não "des-terminar". Status é feature do Ridge → marca recálculo pendente.
        const statusApplied = await maybeApplyPublicationStatus(
          supabase,
          w.id,
          w.publication_status_id,
          statusExternal ?? null,
        )

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
          statusExternal: statusExternal ?? null,
          statusApplied,
          skipped: false,
        }
      } catch {
        return { workId: w.id, latestExternal: null, hasNew: false, delta: null, unreadCount: null, failed: true, releasedLabel: null, releasedAt: null, latestUrl: null, nextPredictedAt: null, statusExternal: null, statusApplied: null, skipped: false }
      }
    }),
  )
}

/** Status de publicação do MangaUpdates por ID (fail-soft, com timeout). `null` se sem ID/dado. */
async function fetchMuStatus(muId: string | null | undefined): Promise<string | null> {
  const n = muId != null ? Number(muId) : NaN
  if (!Number.isFinite(n)) return null
  return withTimeout(fetchMangaUpdatesStatus(n), 8000, "status:mangaupdates").catch(() => null)
}

/**
 * Aplica o status de publicação resolvido das fontes (MangaUpdates preferido,
 * senão comix), com política conservadora: só grava transições de FIM/HIATO
 * (Completed/Hiatus/Cancelled) que diferem do atual; nunca escreve "Ongoing"
 * (não reverte); e não mexe em obra já terminal (Completed/Cancelled), pra não
 * "des-terminar". Status é feature categórica do Ridge → dispara markRecalcPending.
 * Retorna o status gravado (pra UI) ou `null`.
 */
async function maybeApplyPublicationStatus(
  supabase: ReturnType<typeof createAdminClient>,
  workId: string,
  currentStatusId: number | null,
  externalStatus: string | null,
): Promise<string | null> {
  if (
    externalStatus !== "Completed" &&
    externalStatus !== "Hiatus" &&
    externalStatus !== "Cancelled"
  ) {
    return null
  }
  const currentName = getPublicationStatusNameById(currentStatusId)
  if (currentName === "Completed" || currentName === "Cancelled" || currentName === externalStatus) {
    return null
  }
  const newId = getPublicationStatusIdByName(externalStatus)
  if (newId == null) return null

  const { error } = await supabase
    .from("works")
    .update({ publication_status_id: newId })
    .eq("id", workId)
  if (error) {
    console.error("[maybeApplyPublicationStatus] failed:", error.message)
    return null
  }
  await markRecalcPending("reading-status-sync").catch(() => {})
  return externalStatus
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
