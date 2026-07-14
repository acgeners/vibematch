"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { searchAllSources, bestTitleMatch } from "@/lib/external"
import { fetchExternalData } from "@/server/actions/external"
import { updateWorkExternalData, refreshWorkExternalData } from "@/server/actions/works"
import type { ExternalWorkUpdate } from "@/server/actions/works"
import { getWorksByIds } from "@/server/queries/works"
import { getPublicationStatusNameById } from "@/lib/constants/status-lookups"
import { dedupeSynopsisEntries } from "@/lib/work-derived"
import { ensureAdmin } from "@/server/queries/current-user"
import type { ExternalWorkData } from "@/lib/external/types"

// Confiança mínima do título (busca por nome) para auto-aceitar sem revisão.
const AUTO_ACCEPT_TITLE_SCORE = 0.85

export type EnrichResult =
  | { workId: string; status: "enriched"; coverUrl: string | null; title: string; sources: string[] }
  | { workId: string; status: "needs_review"; reason: string; suggestion?: { title: string; score: number } }
  | { workId: string; status: "error"; message: string }

function buildPlatformRatings(data: ExternalWorkData): ExternalWorkUpdate["platformRatings"] {
  const ratings: NonNullable<ExternalWorkUpdate["platformRatings"]> = []
  const add = (platform: string, rating: number | null | undefined, votes: number | null | undefined) => {
    if (rating != null || (votes ?? 0) > 0) ratings.push({ platform, rating: rating ?? null, votes: votes ?? null })
  }
  for (const r of data.externalPlatformRatings ?? []) add(r.platform, r.rating, r.votes)
  add("mangaupdates", data.muRating, data.muVotes)
  add("comick", data.cmxRating, data.cmxVotes)
  add("animeplanet", data.apRating, data.apVotes)
  return ratings
}

function buildUpdate(currentTitle: string, data: ExternalWorkData): ExternalWorkUpdate {
  const update: ExternalWorkUpdate = {
    // Preserva o título importado — enriquecimento em lote não renomeia obras.
    title: currentTitle,
    platformRatings: buildPlatformRatings(data),
  }
  if (data.coverUrl) update.coverUrl = data.coverUrl
  if (data.multiCovers && data.multiCovers.length > 0) {
    const primary = data.coverUrl ?? data.multiCovers[0]?.url
    update.covers = data.multiCovers.map((c) => ({ url: c.url, source: c.source, isPrimary: c.url === primary }))
  }
  if (data.synopsis) update.synopsis = data.synopsis
  if (data.multiSynopses && data.multiSynopses.length > 0) {
    // dedup por texto (fontes diferentes às vezes trazem a mesma sinopse) e
    // fixa a principal — espelha o que o "Atualizar dados" faz no client.
    const deduped = dedupeSynopsisEntries(
      data.multiSynopses.map((s, i) => ({
        text: s.text,
        source: s.source,
        isPrimary: s.text === data.synopsis || (data.synopsis == null && i === 0),
      }))
    )
    update.synopses = deduped.map((s) => ({ text: s.text, source: s.source, isPrimary: s.isPrimary }))
  }
  if (data.publicationStatus) update.publicationStatus = data.publicationStatus
  if (data.totalChapters != null) update.totalChapters = data.totalChapters
  if (data.genres && data.genres.length > 0) update.genres = data.genres
  if (data.tags && data.tags.length > 0) update.tags = data.tags
  if (data.externalIds && Object.keys(data.externalIds).length > 0) {
    const cleaned: Record<string, string> = {}
    for (const [source, id] of Object.entries(data.externalIds)) if (id) cleaned[source] = String(id)
    if (Object.keys(cleaned).length > 0) update.externalIds = cleaned
  }
  return update
}

// Resolve os dados externos de uma obra: fast-path pelos IDs já vinculados,
// senão busca por título e auto-aceita o melhor candidato acima do threshold.
async function resolveExternalData(work: {
  id: string
  title: string
  original_title: string | null
  alternative_titles: string[] | null
}): Promise<
  | { ok: true; data: ExternalWorkData }
  | { ok: false; reason: string; suggestion?: { title: string; score: number } }
> {
  // 1. Descoberta AMPLA por título — pega TODAS as fontes. Crucial pras obras
  //    importadas que têm só 1 ID (ex.: animeplanet): o refresh-por-ID limitaria
  //    o enriquecimento a essa única fonte (e o id do animeplanet do export é
  //    numérico, nem hidrata). A busca por título descobre AniList/MAL/MU/etc.
  const candidates = await searchAllSources(work.title)
  const ranked = candidates
    .map((c) => ({ candidate: c, score: bestTitleMatch(work.title, c) }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]

  if (best && best.score >= AUTO_ACCEPT_TITLE_SCORE) {
    const result = await fetchExternalData(best.candidate)
    const accepted = result.data.externalIds ? Object.keys(result.data.externalIds).length : 0
    if (accepted > 0 || result.data.coverUrl) return { ok: true, data: result.data }
  }

  // 2. Fallback: re-hidrata pelos IDs já vinculados (obra que a busca por título
  //    não casou com confiança, mas tem ID externo confirmado).
  const refreshed = await refreshWorkExternalData(work.id)
  if (refreshed.ok) return { ok: true, data: refreshed.data }

  // 3. Sem match confiável → revisar manualmente.
  if (!best) return { ok: false, reason: "Nenhum candidato encontrado" }
  return {
    ok: false,
    reason: "Confiança baixa no título",
    suggestion: { title: best.candidate.title, score: Math.round(best.score * 100) / 100 },
  }
}

// Dados que a etapa de revisão da importação precisa por obra (capa primária,
// contagens, e o que o picker "Atualizar dados" consome).
export interface ReviewWork {
  id: string
  title: string
  originalTitle: string | null
  synopsisPrimary: string | null
  coverPrimaryUrl: string | null
  coverCount: number
  synopsisCount: number
  publicationStatus: string | null
  totalChapters: number | null
  observations: string | null
  aiEvalStatus: string
}

interface ReviewWorkRow {
  id: string
  title: string
  original_title: string | null
  total_chapters: number | null
  observations: string | null
  publication_status_id: number | null
  ai_eval_status: string
  work_covers?: Array<{ url: string; is_primary: boolean }> | null
  work_synopses?: Array<{ text: string; is_primary: boolean }> | null
}

function toReviewWork(w: ReviewWorkRow): ReviewWork {
  const covers = w.work_covers ?? []
  const synopses = w.work_synopses ?? []
  const primaryCover = covers.find((c) => c.is_primary) ?? covers[0] ?? null
  const primarySynopsis = synopses.find((s) => s.is_primary) ?? synopses[0] ?? null
  return {
    id: w.id,
    title: w.title,
    originalTitle: w.original_title,
    synopsisPrimary: primarySynopsis?.text ?? null,
    coverPrimaryUrl: primaryCover?.url ?? null,
    coverCount: covers.length,
    synopsisCount: synopses.length,
    publicationStatus: getPublicationStatusNameById(w.publication_status_id),
    totalChapters: w.total_chapters,
    observations: w.observations,
    aiEvalStatus: w.ai_eval_status,
  }
}

// Revisão das obras criadas numa importação específica (etapa do wizard).
export async function getImportReviewWorks(ids: string[]): Promise<ReviewWork[]> {
  if (!ids || ids.length === 0) return []
  const works = await getWorksByIds(ids)
  return works.map((w) => toReviewWork(w))
}

// Revisão persistente: todas as obras pendentes de avaliação (inclui as
// importadas que ainda não foram avaliadas). Disponível em /import enquanto
// houver pendentes; uma obra sai daqui quando é avaliada (vira 'done'/'skipped').
export async function getPendingReviewWorks(limit = 300): Promise<ReviewWork[]> {
  const supabase = createAdminClient()
  // Lê o dado PESSOAL do DONO (observations) → vem do espelho via a view `works_owner`,
  // não da linha compartilhada de `works` (que vai perder essas colunas).
  const { data, error } = await supabase
    .from("works_owner")
    .select(
      "id, title, original_title, total_chapters, observations, publication_status_id, ai_eval_status, work_covers(url, is_primary), work_synopses(text, is_primary)"
    )
    .eq("ai_eval_status", "pending")
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as ReviewWorkRow[]).map(toReviewWork)
}

export async function enrichWorkExternal(workId: string): Promise<EnrichResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { workId, status: "error", message: gate.error }
  try {
    const supabase = createAdminClient()
    const { data: work, error } = await supabase
      .from("works")
      .select("id, title, original_title, alternative_titles")
      .eq("id", workId)
      .single()
    if (error || !work) return { workId, status: "error", message: error?.message ?? "Obra não encontrada" }

    const resolved = await resolveExternalData(work)
    if (!resolved.ok) {
      return { workId, status: "needs_review", reason: resolved.reason, suggestion: resolved.suggestion }
    }

    const update = buildUpdate(work.title, resolved.data)
    const res = await updateWorkExternalData(workId, update)
    if ("error" in res && res.error) return { workId, status: "error", message: res.error }

    return {
      workId,
      status: "enriched",
      coverUrl: update.coverUrl ?? resolved.data.coverUrl ?? null,
      title: work.title,
      sources: resolved.data.externalIds ? Object.keys(resolved.data.externalIds) : [],
    }
  } catch (err) {
    return { workId, status: "error", message: err instanceof Error ? err.message : String(err) }
  }
}
