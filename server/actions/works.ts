"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { workFormSchema, workStatusSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues, WorkStatusValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  getPublicationStatusIdByName,
  getPersonalStatusIdByName,
  getPublicationStatusNameById,
  getPersonalStatusNameById,
  readingPersonalStatusName,
} from "@/lib/constants/status-lookups"
import {
  dedupeSynopsisEntries,
  pickPrimarySynopsis,
  pickPrimaryCover,
  splitSynopsesFromText,
} from "@/lib/work-derived"
import { markRecalcPending, recalculateScoresNow } from "@/server/recalc/queue"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import { capturePredictionForFirstRating } from "./prediction-ledger"
import {
  resolvePredictionsForWork,
  markPredictionLabelChanged,
} from "@/lib/server/predictions/resolve-prediction"
import { markWorkAlignmentStale } from "@/server/queries/alignment"
import { startUpdateJob, finishUpdateJob } from "@/lib/background/update-jobs"
import { fetchExternalData } from "./external"
import { buildCandidateFromExternalIds } from "@/lib/external/index"
import type { MergedCandidate, ExternalSourceId, ExternalWorkData, ConflictField, SourcedReview } from "@/lib/external/types"
import { resolveOrCreateTags, scheduleTagEnrichment } from "@/lib/tags/ingest"
import { recomputeAdultAuto } from "@/lib/tags/adult-classify"
import { getSynopsisCanonicalOnCreate, getTagInferenceOnCreate, getGenerateAllOnCreate, ensureAdmin, ensurePermission, ensureSignedIn, getOwnerUserId } from "@/server/queries/current-user"
import {
  writeReadingState,
  mirrorOwnerState,
  canWriteSharedWorkRow,
  toDay,
  getPersonalStateReader,
} from "@/server/queries/user-work-state"
import type {
  ReadingStatePatch,
  TasteStatePatch,
  PersonalStatePatch,
} from "@/server/queries/user-work-state"
import { buildAutoRefreshPlan } from "@/lib/external/auto-refresh"
import { getSynopsisPredictionForWork } from "@/server/queries/synopsis-quality"
import { getWorkTagReviewCounts } from "@/server/queries/work-card-meta"
import { titleToSlug } from "@/lib/utils"
import { DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"
import { personalStatusNameOrDefault } from "@/lib/constants/status-lookups"

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

/**
 * Dispara consolidação de sinopses via Haiku em background. Só roda quando o
 * hash do conjunto de fontes mudou, evitando re-chamadas desnecessárias.
 * Falhas são swallowed — o consumer da sinopse usa fallback split+longest.
 */
function scheduleSynopsisConsolidation(workId: string) {
  after(async () => {
    try {
      // Consolidação canônica (Haiku) via o helper aguardável compartilhado — o
      // mesmo usado pela cascata generate_all. Gate por hash lá dentro.
      const { consolidateSynopsisForWork } = await import(
        "@/lib/ai-recommendation/consolidate-for-work"
      )
      const result = await consolidateSynopsisForWork(workId)
      if (result.status !== "done") return

      // DEFERIR (2a): o helper já marcou a previsão como stale. A recomputação LLM
      // fica sob gatilho (botão "Prever interesse" / backfill / cascata), NÃO eager
      // por-edição. Exceção: 1ª vez (obra sem nenhuma previsão) ainda prevê eager,
      // pra a obra nova nascer com ♥.
      const supabase = createAdminClient()
      const { count: predCount } = await supabase
        .from("synopsis_quality_predictions")
        .select("id", { count: "exact", head: true })
        .eq("work_id", workId)
      if (!predCount) {
        const { autoPredictSynopsisQuality } = await import(
          "@/lib/ai-evaluation/synopsis-quality-runner"
        )
        await autoPredictSynopsisQuality(workId)
      }
    } catch (err) {
      console.error("[scheduleSynopsisConsolidation] falhou:", err)
    }
  })
}

async function hasCompletedAiEvaluation(
  supabase: SupabaseAdminClient,
  workId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("ai_evaluations")
    .select("id")
    .eq("work_id", workId)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle()

  return Boolean(data)
}

async function upsertWorkExternalIds(
  supabase: SupabaseAdminClient,
  workId: string,
  externalIds: Record<string, string> | undefined
): Promise<void> {
  if (!externalIds) return
  const rows = Object.entries(externalIds)
    .filter(([source, id]) => source.trim().length > 0 && id != null && String(id).trim().length > 0)
    .map(([source, id]) => ({ work_id: workId, source: source.trim(), external_id: String(id).trim() }))
  if (rows.length === 0) return
  const { error } = await supabase
    .from("work_external_ids")
    .upsert(rows, { onConflict: "work_id,source" })
  if (error) {
    console.error("[upsertWorkExternalIds] failed:", error.message)
  }
}

export interface DuplicateWorkForForm {
  id: string
  title: string
  values: WorkFormValues
}

const DUPLICATE_WORK_SELECT = `
  *,
  category_scores(*),
  platform_ratings(*),
  work_tags(tag_id, tags(*)),
  work_genres(genre_id, genres(id, name, slug)),
  work_covers(id, url, source, is_primary, position),
  work_synopses(id, source, text, is_primary, position),
  work_external_ids(source, external_id, is_rejected)
`

function normalizePlatformName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeTextList(values: Array<string | null | undefined> = []) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== "string") continue
    const item = value.trim()
    const key = item.toLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function normalizeCatalogKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

type GenreCatalogEntry = {
  id: string | null
  tagId: string | null
  name: string
}

async function fetchGenreCatalog(supabase: SupabaseAdminClient): Promise<GenreCatalogEntry[]> {
  const { data, error } = await supabase
    .from("genres")
    .select("id, name")
    .limit(10000)

  if (error) throw new Error(`Erro ao validar gêneros: ${error.message}`)

  return (data ?? []).flatMap((row) => {
    const name = (row.name as string | null)?.trim()
    return name ? [{ id: (row.id as string) ?? null, tagId: null, name }] : []
  })
}

async function filterKnownGenres(supabase: SupabaseAdminClient, values: string[]) {
  const catalog = await fetchGenreCatalog(supabase)
  if (catalog.length === 0 && values.length > 0) {
    throw new Error("Nenhum gênero cadastrado foi encontrado para validar os dados.")
  }

  const byKey = new Map(catalog.map((genre) => [normalizeCatalogKey(genre.name), genre]))
  const seen = new Set<string>()
  const names: string[] = []
  const tagIds: string[] = []
  const genreIds: string[] = []

  for (const value of normalizeTextList(values)) {
    const genre = byKey.get(normalizeCatalogKey(value))
    if (!genre) continue
    const key = normalizeCatalogKey(genre.name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(genre.name)
    if (genre.tagId) tagIds.push(genre.tagId)
    if (genre.id) genreIds.push(genre.id)
  }

  return { names, tagIds, genreIds }
}

function normalizeTitleMatch(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase()
}

const WEAK_DUPLICATE_ALIAS_KEYS = new Set([
  "status",
  "official",
  "english",
  "korean",
  "japanese",
  "chinese",
  "novel",
  "webtoon",
  "oneshot",
  "one shot",
  "promo",
  "promo art",
])

function isWeakDuplicateAlias(key: string) {
  return WEAK_DUPLICATE_ALIAS_KEYS.has(key)
}

function uniqueComparableKeys(keys: string[]) {
  const seen = new Set<string>()
  return keys.filter((key) => {
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getComparableNames(values: Pick<WorkFormValues, "title" | "original_title" | "alternative_titles">) {
  const names = normalizeTextList([
    values.title,
    values.original_title ?? "",
  ]).map(normalizeTitleMatch).filter(Boolean)

  const aliases = normalizeTextList(values.alternative_titles ?? [])
    .map(normalizeTitleMatch)
    .filter((key) => key && !isWeakDuplicateAlias(key))

  return uniqueComparableKeys([...names, ...aliases])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSavedComparableNames(work: any) {
  const names = normalizeTextList([
    work.title,
    work.original_title,
  ]).map(normalizeTitleMatch).filter(Boolean)

  const aliases = normalizeTextList(work.alternative_titles ?? [])
    .map(normalizeTitleMatch)
    .filter((key) => key && !isWeakDuplicateAlias(key))

  return uniqueComparableKeys([...names, ...aliases])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findMatchingWorkName(work: any, incomingNames: Set<string>) {
  const savedNames = getSavedComparableNames(work)
  return savedNames.find((name) => incomingNames.has(name)) ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function workMatchesAnyName(work: any, incomingNames: Set<string>) {
  const savedNames = getSavedComparableNames(work)
  return savedNames.some((name) => incomingNames.has(name))
}

function normalizePlatformRatings(
  platforms: Array<{ platform: string; rating?: number | null; votes?: number | null }>
) {
  const normalized = new Map<string, { platform: string; rating: number | null; votes: number }>()

  for (const item of platforms) {
    const platform = normalizePlatformName(item.platform)
    if (!platform) continue
    if (item.rating == null && (item.votes == null || item.votes <= 0)) continue

    normalized.set(platform, {
      platform,
      rating: item.rating ?? null,
      votes: item.votes ?? 0,
    })
  }

  return [...normalized.values()]
}

function normalizeExternalPlatformUpdates(
  platforms: Array<{ platform: string; rating?: number | null; votes?: number | null }>
) {
  const normalized = new Map<string, { platform: string; rating: number | null; votes: number | null }>()

  for (const item of platforms) {
    const platform = normalizePlatformName(item.platform)
    if (!platform) continue

    const hasRating = item.rating != null
    const hasVotes = item.votes != null && item.votes > 0
    if (!hasRating && !hasVotes) continue

    const current = normalized.get(platform)
    const rating = hasRating ? item.rating ?? null : current?.rating ?? null
    const votes = hasVotes ? item.votes ?? null : current?.votes ?? null
    normalized.set(platform, {
      platform,
      rating,
      votes,
    })
  }

  return [...normalized.values()]
}

// Resolves tag names to ids (creating missing tags via the shared ingestion
// helper) and schedules background classification (group/sub-group/cluster) for
// any newly-created tag. Drops names whose slug is empty.
async function upsertTagsBatch(
  supabase: SupabaseAdminClient,
  names: string[],
): Promise<string[]> {
  const { ids, createdIds } = await resolveOrCreateTags(supabase, names)
  scheduleTagEnrichment(createdIds)
  return ids
}

async function syncWorkTags(
  supabase: SupabaseAdminClient,
  workId: string,
  tags: string[]
) {
  await supabase.from("work_tags").delete().eq("work_id", workId)

  const uniqueTagIds = [...new Set(await upsertTagsBatch(supabase, tags))]
  if (uniqueTagIds.length > 0) {
    const { error } = await supabase
      .from("work_tags")
      .upsert(
        uniqueTagIds.map((tag_id) => ({ work_id: workId, tag_id })),
        { onConflict: "work_id,tag_id", ignoreDuplicates: true }
      )
    if (error) {
      console.error(`[syncWorkTags] upsert work_tags failed (workId=${workId})`, error.message)
    }
  }
  // Tags mudaram → recomputa a classificação 18+ (monotônico; migração 161).
  await recomputeAdultAuto(supabase, workId)
}

async function syncWorkGenres(
  supabase: SupabaseAdminClient,
  workId: string,
  genreIds: string[],
  mode: "replace" | "add"
) {
  if (mode === "replace") {
    const { error: deleteError } = await supabase.from("work_genres").delete().eq("work_id", workId)
    if (deleteError) return
  }
  if (genreIds.length === 0) return
  await supabase
    .from("work_genres")
    .upsert(
      genreIds.map((genre_id) => ({ work_id: workId, genre_id })),
      { onConflict: "work_id,genre_id", ignoreDuplicates: true }
    )
}

async function syncWorkCovers(
  supabase: SupabaseAdminClient,
  workId: string,
  covers: Array<{ url: string; source: string; isPrimary: boolean }> | undefined
): Promise<{ error: string | null }> {
  if (covers === undefined) return { error: null }
  // Replace all on save — the multi-pick UI is the authoritative source.
  // Esvazia primeiro pra evitar conflitos no UNIQUE (work_id, url) e no
  // índice parcial work_covers_one_primary quando o usuário reordena/altera
  // primária. Sequência DELETE → INSERT acontece em duas requisições, mas
  // pra esse fluxo single-user não tem race relevante.
  const { error: deleteError } = await supabase
    .from("work_covers")
    .delete()
    .eq("work_id", workId)
  if (deleteError) return { error: `Falha ao limpar capas: ${deleteError.message}` }

  if (covers.length === 0) return { error: null }

  const rows = covers.map((c, position) => ({
    work_id: workId,
    url: c.url,
    source: c.source,
    is_primary: c.isPrimary,
    position,
  }))
  // Normaliza is_primary defensivamente: força exatamente um primário (o
  // primeiro marcado, ou rows[0] se nenhum vier marcado). Sem isso, o índice
  // parcial work_covers_one_primary rejeita o INSERT.
  const firstPrimaryIdx = rows.findIndex((r) => r.is_primary)
  const canonicalPrimaryIdx = firstPrimaryIdx === -1 ? 0 : firstPrimaryIdx
  for (let i = 0; i < rows.length; i++) {
    rows[i].is_primary = i === canonicalPrimaryIdx
  }

  const { error } = await supabase.from("work_covers").insert(rows)
  if (error) {
    console.error("[syncWorkCovers] insert failed", error.message)
    return { error: `Falha ao salvar capas: ${error.message}` }
  }
  return { error: null }
}

/**
 * Upsert incremental para capas vindas do diálogo "Atualizar dados".
 * Preserva capas pré-existentes não citadas na lista (apenas marca primária=false
 * em todas as outras). Quando a URL já existe, só atualiza is_primary; quando
 * é nova, faz INSERT.
 */
async function syncExternalCovers(
  supabase: SupabaseAdminClient,
  workId: string,
  covers: Array<{ url: string; source: string; isPrimary: boolean }>
): Promise<{ error: string | null }> {
  if (covers.length === 0) return { error: null }

  const normalizedPrimaryIdx = (() => {
    const idx = covers.findIndex((c) => c.isPrimary)
    return idx === -1 ? 0 : idx
  })()
  const primaryUrl = covers[normalizedPrimaryIdx].url

  // Replace mode: deleta todas as capas atuais da obra e insere a lista nova.
  // Antes era aditivo (mantinha capas não listadas), mas a UX de refresh +
  // refine espera que a seleção final do usuário SUBSTITUA o estado anterior.
  // Alinhado com syncWorkSynopses.
  const { error: deleteError } = await supabase
    .from("work_covers")
    .delete()
    .eq("work_id", workId)
  if (deleteError) return { error: `Falha ao limpar capas: ${deleteError.message}` }

  const rows = covers.map((cover, position) => ({
    work_id: workId,
    url: cover.url,
    source: cover.source,
    is_primary: cover.url === primaryUrl,
    position,
  }))
  const { error: insertError } = await supabase.from("work_covers").insert(rows)
  if (insertError) return { error: `Falha ao inserir capas: ${insertError.message}` }

  return { error: null }
}

function normalizeFormSynopses(values: Pick<WorkFormValues, "synopsis" | "synopses">) {
  const fromEntries = dedupeSynopsisEntries(values.synopses)
  if (fromEntries.length > 0) return fromEntries

  return splitSynopsesFromText(values.synopsis).map((text, index) => ({
    source: "manual",
    text,
    isPrimary: index === 0,
  }))
}

async function syncWorkSynopses(
  supabase: SupabaseAdminClient,
  workId: string,
  synopses: Array<{ source: string; text: string; isPrimary: boolean }> | undefined
): Promise<{ error: string | null }> {
  // undefined = o caller não controla sinopses; [] = o textarea foi esvaziado.
  if (!synopses) return { error: null }
  const normalizedSynopses = dedupeSynopsisEntries(synopses)

  const { error: deleteError } = await supabase
    .from("work_synopses")
    .delete()
    .eq("work_id", workId)
  if (deleteError) return { error: `Falha ao limpar sinopses: ${deleteError.message}` }

  if (normalizedSynopses.length === 0) return { error: null }

  const rows = normalizedSynopses.map((s, position) => ({
    work_id: workId,
    source: s.source,
    text: s.text,
    is_primary: s.isPrimary,
    position,
  }))
  const firstPrimaryIdx = rows.findIndex((r) => r.is_primary)
  const canonicalPrimaryIdx = firstPrimaryIdx === -1 ? 0 : firstPrimaryIdx
  for (let i = 0; i < rows.length; i++) {
    rows[i].is_primary = i === canonicalPrimaryIdx
  }

  const { error } = await supabase.from("work_synopses").insert(rows)
  if (error) {
    console.error("[syncWorkSynopses] insert failed", error.message)
    return { error: `Falha ao salvar sinopses: ${error.message}` }
  }
  return { error: null }
}

// Adds external genres/tags without deleting existing work_tags.
// Data entered manually (not returned by external search) is preserved.
async function syncWorkTagsPartial(
  supabase: SupabaseAdminClient,
  workId: string,
  tags: string[] | undefined,
  knownGenreIds: string[] = []
) {
  if (tags !== undefined) {
    const uniqueIdsToAdd = [...new Set(await upsertTagsBatch(supabase, tags))]
    if (uniqueIdsToAdd.length > 0) {
      const { data: existing } = await supabase
        .from("work_tags").select("tag_id").eq("work_id", workId)
      const existingSet = new Set<string>((existing ?? []).map((wt: { tag_id: string }) => wt.tag_id))

      const newEntries = uniqueIdsToAdd
        .filter((id) => !existingSet.has(id))
        .map((tag_id) => ({ work_id: workId, tag_id }))
      if (newEntries.length > 0) {
        const { error } = await supabase
          .from("work_tags")
          .upsert(newEntries, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
        if (error) {
          console.error(`[syncWorkTagsPartial] upsert work_tags failed (workId=${workId})`, error.message)
        }
      }
    }
  }

  if (knownGenreIds.length > 0) {
    await syncWorkGenres(supabase, workId, knownGenreIds, "add")
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbWorkToFormValues(work: any): WorkFormValues {
  const scoreMap: Record<string, number> = {}
  for (const score of work.category_scores ?? []) {
    scoreMap[score.criterion_slug] = score.score
  }

  const getPlatform = (platform: string) =>
    (work.platform_ratings ?? []).find((p: { platform: string }) =>
      normalizePlatformName(p.platform).replace(/-/g, "") === normalizePlatformName(platform).replace(/-/g, "")
    )

  const mu = getPlatform("mangaupdates")
  const ap = getPlatform("animeplanet")
  const cmx = getPlatform("comick")
  const knownPlatforms = new Set(["mangaupdates", "animeplanet", "comick"])
  const extraPlatformRatings = (work.platform_ratings ?? [])
    .filter((p: { platform: string }) => !knownPlatforms.has(normalizePlatformName(p.platform).replace(/-/g, "")))
    .map((p: { platform: string; rating: number | null; vote_count: number | null }) => ({
      platform: p.platform,
      rating: p.rating ?? null,
      votes: p.vote_count ?? null,
    }))

  const tags = (work.work_tags ?? [])
    .map((wt: { tags?: { name?: string } | null }) => wt.tags?.name)
    .filter(Boolean) as string[]

  const genres = (work.work_genres ?? [])
    .map((wg: { genres?: { name?: string } | null }) => wg.genres?.name)
    .filter(Boolean) as string[]

  const covers = ((work.work_covers ?? []) as Array<{
    url?: string | null
    source?: string | null
    is_primary?: boolean | null
    position?: number | null
  }>)
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .flatMap((cover) => {
      if (!cover.url) return []
      return [{
        url: cover.url,
        source: cover.source ?? "manual",
        isPrimary: Boolean(cover.is_primary),
      }]
    })

  const synopses = dedupeSynopsisEntries(
    ((work.work_synopses ?? []) as Array<{
      source?: string | null
      text?: string | null
      is_primary?: boolean | null
      position?: number | null
    }>)
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .flatMap((synopsis) => {
        if (!synopsis.text) return []
        return [{
          source: synopsis.source ?? "manual",
          text: synopsis.text,
          isPrimary: Boolean(synopsis.is_primary),
        }]
      })
  )

  const externalIds = Object.fromEntries(
    ((work.work_external_ids ?? []) as Array<{
      source?: string | null
      external_id?: string | null
      is_rejected?: boolean | null
    }>)
      .filter((row) => row.source && row.external_id && !row.is_rejected)
      .map((row) => [row.source!, row.external_id!])
  )

  const criterionValues = Object.fromEntries(
    CRITERION_SLUGS.map((slug) => [slug, scoreMap[slug] ?? null])
  )

  return workFormSchema.parse({
    title: work.title,
    original_title: work.original_title ?? "",
    alternative_titles: work.alternative_titles ?? [],
    synopsis: pickPrimarySynopsis(work.work_synopses) ?? "",
    genres,
    tags,
    year: work.year ?? null,
    year_end: work.year_end ?? null,
    publication_status: getPublicationStatusNameById(work.publication_status_id) ?? "Unknown",
    personal_status: personalStatusNameOrDefault(work.personal_status_id),
    publication_status_id: work.publication_status_id ?? null,
    personal_status_id: work.personal_status_id ?? null,
    total_chapters: work.total_chapters ?? null,
    chapters_read: work.chapters_read ?? null,
    synopsis_quality: work.synopsis_quality ?? null,
    observation_adjustment: work.observation_adjustment ?? 0,
    user_score: work.user_score ?? null,
    post_story_score: work.post_story_score ?? null,
    post_fl_score: work.post_fl_score ?? null,
    post_ml_score: work.post_ml_score ?? null,
    post_character_development_score: work.post_character_development_score ?? null,
    post_pacing_score: work.post_pacing_score ?? null,
    post_art_visual_score: work.post_art_visual_score ?? null,
    post_impact_immersion_score: work.post_impact_immersion_score ?? null,
    post_originality_score: work.post_originality_score ?? null,
    observations: work.observations ?? "",
    cover_url: pickPrimaryCover(work.work_covers) ?? "",
    ai_eval_status: work.ai_eval_status ?? "pending",
    mu_rating: mu?.rating ?? null,
    mu_votes: mu?.vote_count ?? null,
    ap_rating: ap?.rating ?? null,
    ap_votes: ap?.vote_count ?? null,
    cmx_rating: cmx?.rating ?? null,
    cmx_votes: cmx?.vote_count ?? null,
    extra_platform_ratings: extraPlatformRatings,
    covers,
    synopses,
    external_ids: externalIds,
    ...criterionValues,
  })
}

export interface WorkPreview {
  workId: string
  title: string
  coverUrl: string | null
  synopsis: string | null
  synopsisQuality: string | null
  /** True quando o Interesse manual foi APLICADO da previsão da IA (synopsis_quality_source = prediction_applied), não definido à mão. */
  synopsisFromPrediction: boolean
  /** Previsão IA de Interesse (♥..♥♥♥♥) — synopsis_quality_predictions. NULL se nunca prevista. */
  predictedSynopsisQuality: string | null
  /** True quando a previsão de Interesse ficou desatualizada (perfil/sinopse mudou). */
  predictedSynopsisStale: boolean
  publicationStatusId: number | null
  totalChapters: number | null
  observations: string | null
  year: number | null
  platformAvg: number | null
  totalVotes: number
}

export async function getWorkPreview(workId: string): Promise<WorkPreview | null> {
  const supabase = createAdminClient()
  // Predição de Interesse buscada em paralelo com a obra (round-trip único).
  const [{ data, error }, prediction] = await Promise.all([
    supabase
      .from("works")
      .select(`
        id, title, canonical_synopsis,
        publication_status_id, total_chapters, year,
        work_covers(url, is_primary, position),
        work_synopses(source, text, is_primary, position),
        calculated_scores(platform_avg, total_votes)
      `)
      .eq("id", workId)
      .maybeSingle(),
    getSynopsisPredictionForWork(workId),
  ])

  if (error || !data) return null

  const calc = (data as { calculated_scores?: { platform_avg?: number | null; total_votes?: number | null } | null }).calculated_scores
  const covers = (data as { work_covers?: Parameters<typeof pickPrimaryCover>[0] }).work_covers
  const synopses = (data as { work_synopses?: Parameters<typeof pickPrimarySynopsis>[0] }).work_synopses
  // Hover mostra a sinopse CANÔNICA (consolidada via IA) quando existe; cai na
  // primária das fontes enquanto a obra não passou pela consolidação.
  const canonicalSynopsis = ((data.canonical_synopsis as string | null) ?? "").trim()

  // Interesse ♥ e observações são PESSOAIS (Fatia 2a) — vêm do espelho de quem olha, não da
  // linha compartilhada de `works` (que é a do dono).
  const personal = await getPersonalStateReader()
  const state = personal.get(data.id as string)

  return {
    workId: data.id as string,
    title: data.title as string,
    coverUrl: pickPrimaryCover(covers),
    synopsis: canonicalSynopsis || pickPrimarySynopsis(synopses),
    synopsisQuality: state.synopsisQuality,
    synopsisFromPrediction: state.synopsisQualitySource === "prediction_applied",
    predictedSynopsisQuality: prediction?.predictedQuality ?? null,
    predictedSynopsisStale: prediction?.stale ?? false,
    publicationStatusId: (data.publication_status_id as number | null) ?? null,
    totalChapters: (data.total_chapters as number | null) ?? null,
    observations: state.observations,
    year: (data.year as number | null) ?? null,
    platformAvg: calc?.platform_avg ?? null,
    totalVotes: calc?.total_votes ?? 0,
  }
}

/**
 * Contagem de tags + reviews úteis de UMA obra, para o hover do título.
 * Reusa a RPC agregada `work_card_counts` (mesma regra do /ai-evaluation), então
 * os números batem com os cards da fila. Chamada sob demanda no hover (1 por obra).
 */
export async function getWorkHoverCounts(
  workId: string,
): Promise<{ tagCount: number; reviewCount: number }> {
  const counts = await getWorkTagReviewCounts([workId])
  return counts.get(workId) ?? { tagCount: 0, reviewCount: 0 }
}

export async function findDuplicateWorkByTitle(
  title: string,
  alternativeTitles: string[] = []
): Promise<DuplicateWorkForForm | null> {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) return null
  const incomingNames = new Set(getComparableNames({
    title,
    original_title: "",
    alternative_titles: alternativeTitles,
  }))

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(DUPLICATE_WORK_SELECT)
    .ilike("title", normalizedTitle)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data && !error) {
    const { data: originalTitleMatch } = await supabase
      .from("works")
      .select(DUPLICATE_WORK_SELECT)
      .ilike("original_title", normalizedTitle)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (originalTitleMatch) {
      return {
        id: originalTitleMatch.id,
        title: originalTitleMatch.title,
        values: dbWorkToFormValues(originalTitleMatch),
      }
    }

    const { data: allData } = await supabase
      .from("works")
      .select(DUPLICATE_WORK_SELECT)
      .limit(1000)
    const aliasMatch = (allData ?? []).find((work) => workMatchesAnyName(work, incomingNames))
    if (aliasMatch) {
      return {
        id: aliasMatch.id,
        title: aliasMatch.title,
        values: dbWorkToFormValues(aliasMatch),
      }
    }
  }

  if (error || !data) return null

  return {
    id: data.id,
    title: data.title,
    values: dbWorkToFormValues(data),
  }
}

export async function findDuplicateWorkById(id: string): Promise<DuplicateWorkForForm | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(DUPLICATE_WORK_SELECT)
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    title: data.title,
    values: dbWorkToFormValues(data),
  }
}

/**
 * Insere a obra completa no banco (works + category_scores + platform_ratings + tags)
 * mas NÃO dispara o recálculo. Usado tanto pelo fluxo normal quanto pelo batch.
 */
export interface CreateWorkAiMeta {
  inputHash: string
  modelName: string
  promptVersion: string
  confidence: number | null
  summary?: string | null
}

/**
 * O estado PESSOAL que o form de obra carrega junto com os dados do catálogo.
 *
 * ⚠️ O form de criação/edição mistura duas coisas que não são a mesma: fato da OBRA (título,
 * ano, capítulos totais, sinopse) e estado de QUEM CADASTROU (status de leitura, capítulos
 * lidos, nota, ♥, observações, pós-leitura). Os primeiros vivem em `works` por direito; os
 * segundos só estão lá por herança do tempo em que o app tinha um usuário só.
 *
 * `createWork`/`updateWork` seguem gravando os dois em `works` (é a linha do dono), mas agora
 * espelham a parte pessoal em `user_work_state` — senão o espelho dele apodrece a cada obra
 * criada ou editada, e a Fase 2 não pode confiar nele como fonte.
 */
function personalPatchFromForm(data: WorkFormValues): PersonalStatePatch {
  return {
    personal_status_id:
      data.personal_status_id ?? getPersonalStatusIdByName(data.personal_status) ?? null,
    chapters_read: data.chapters_read ?? null,
    synopsis_quality: data.synopsis_quality ?? null,
    synopsis_quality_source: data.synopsis_quality != null ? "human_manual" : "legacy_unknown",
    observation_adjustment: data.observation_adjustment,
    observations: data.observations ?? null,
    user_score: data.user_score ?? null,
    post_story_score: data.post_story_score ?? null,
    post_fl_score: data.post_fl_score ?? null,
    post_ml_score: data.post_ml_score ?? null,
    post_character_development_score: data.post_character_development_score ?? null,
    post_pacing_score: data.post_pacing_score ?? null,
    post_art_visual_score: data.post_art_visual_score ?? null,
    post_impact_immersion_score: data.post_impact_immersion_score ?? null,
    post_originality_score: data.post_originality_score ?? null,
  }
}

async function persistNewWork(
  values: WorkFormValues,
  aiMeta: CreateWorkAiMeta | undefined,
  /**
   * `skipAiCascade` — nada que queime token. É o caminho do Leitor FREE (Fatia 2b): ele pode
   * cadastrar uma obra que falta no catálogo, mas SÓ com o que a busca externa trouxe
   * (scraping das 8 fontes: título, capa, sinopse, capítulos — zero LLM). A sinopse canônica,
   * a inferência de tags e as 9 notas de atributo ficam PENDENTES pro Curador rodar.
   *
   * Sem esta opção, `createWorkPending` disparava a consolidação de sinopse por LLM (abaixo) —
   * ou seja, "pending" não era livre de IA. O nome mentia.
   *
   * 🔴 `creatorId` — QUEM está cadastrando. Não é decoração: o form de criação carrega, junto
   * do catálogo, o estado PESSOAL de quem preenche (status, capítulos, nota, ♥, pós-leitura).
   * Sem este argumento, esta função espelhava esse estado em `mirrorOwnerState(getOwnerUserId())`
   * — SEMPRE no dono, quem quer que estivesse cadastrando. Como `createWork` é aberto a qualquer
   * usuário logado (Fatia 2b/5), a Leitora cadastrando uma obra com "nota 9.5, cap. 12" gravava
   * a nota DELA na linha DELE — e `user_score` é o RÓTULO que treina o Ridge do dono. O modelo
   * dele passava a aprender o gosto dela. Sem erro, sem log; medido no banco antes de existir
   * este parâmetro (scripts/e2e/verify-create-ownership.mjs).
   */
  opts: { skipAiCascade?: boolean; creatorId: string },
): Promise<
  | { ok: true; workId: string }
  | { ok: false; error: Record<string, string[]> }
> {
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const data = parsed.data
  const supabase = createAdminClient()
  let knownGenres: Awaited<ReturnType<typeof filterKnownGenres>>
  try {
    knownGenres = await filterKnownGenres(supabase, data.genres ?? [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { genres: [message] } }
  }

  const incomingNames = new Set(getComparableNames(data))
  const { data: existingWorks } = await supabase
    .from("works")
    .select("title, original_title, alternative_titles")
    .limit(2000)

  const duplicate = (existingWorks ?? [])
    .map((work) => ({ work, matchingName: findMatchingWorkName(work, incomingNames) }))
    .find((match) => match.matchingName)

  if (duplicate?.matchingName) {
    return {
      ok: false,
      error: {
        title: [
          `Já existe uma obra com esse título (${duplicate.matchingName}: ${duplicate.work.title})`,
        ],
      },
    }
  }

  // ⚠️ NENHUMA coluna pessoal no insert (FASE E). A obra que nasce aqui é CATÁLOGO — título,
  // ano, capítulos, status de publicação. Status de leitura, capítulos lidos, nota, ♥,
  // anotações e pós-leitura são de QUEM CADASTROU e vão pra `user_work_state`, logo abaixo.
  //
  // `works.personal_status_id` era NOT NULL sem default e por isso obrigava este insert a
  // inventar um valor; a mig 153 tirou o NOT NULL. As outras 4 NOT NULL têm default e se
  // resolvem sozinhas. As colunas ficam aí, nulas, até o `DROP` (§13.4).
  const { data: work, error } = await supabase
    .from("works")
    .insert({
      title: data.title,
      original_title: data.original_title ?? null,
      alternative_titles: normalizeTextList(data.alternative_titles ?? []),
      year: data.year ?? null,
      year_end: data.year_end ?? null,
      publication_status_id:
        data.publication_status_id ?? getPublicationStatusIdByName(data.publication_status),
      total_chapters: data.total_chapters ?? null,
      ai_eval_status: "pending",
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: { _root: [error.message] } }

  const workId = work.id

  // O estado pessoal que nasceu junto com a obra é de QUEM CADASTROU — status, capítulos, nota,
  // ♥ e pós-leitura são dele, não da obra. Agora esta é a ÚNICA escrita dele.
  //
  // 🔴 Isto era `mirrorOwnerState(await getOwnerUserId(), ...)`: espelhava no DONO, quem quer que
  // estivesse cadastrando. A Leitora cadastrava com "nota 9.5" e a nota virava RÓTULO DE TREINO
  // do Ridge dele — enquanto ela ficava sem linha nenhuma, ou seja, perdia o próprio dado.
  //
  // Vai no cliente de SESSÃO de propósito. `mirrorOwnerState` usa service role, que IGNORA a
  // RLS — é por isso que um `user_id` errado ali virou dado errado em silêncio em vez de um
  // insert negado. Com o cliente de sessão, a política da mig 142 (`user_id = auth.uid()`)
  // torna este bug IMPOSSÍVEL de reescrever: escrever na linha de outra pessoa é negado pelo
  // Postgres.
  const mirror = await writeReadingState(opts.creatorId, [workId], personalPatchFromForm(data))
  if (mirror.error) return { ok: false, error: { _root: [mirror.error] } }

  // Create the AI evaluation row FIRST when AI justifications exist, so the
  // category_scores rows below can reference it with source="ai_accepted" +
  // ai_evaluation_id. Without this, scores produced by the AI search flow
  // get stamped as "manual" and lose their provenance.
  const aiJustifications = data.ai_justifications ?? {}
  const aiJustificationEntries = Object.entries(aiJustifications)
    .filter(([, justification]) => justification?.trim())

  let aiEvaluationId: string | null = null
  if (aiJustificationEntries.length > 0) {
    const { data: evaluation } = await supabase
      .from("ai_evaluations")
      .insert({
        work_id: workId,
        status: "completed",
        model_name: aiMeta?.modelName ?? "external-ai-criteria",
        prompt_version: aiMeta?.promptVersion ?? "external-import",
        summary: aiMeta?.summary?.trim() || "Notas e explicações geradas durante a busca externa do título.",
        confidence: aiMeta?.confidence ?? null,
        raw_response: { criteriaJustifications: aiJustifications },
        input_hash: aiMeta?.inputHash ?? null,
      })
      .select("id")
      .single()

    if (evaluation) {
      aiEvaluationId = evaluation.id
      await supabase.from("ai_evaluation_scores").insert(
        CRITERION_SLUGS.flatMap((slug) => {
          const score = data[slug as keyof WorkFormValues]
          const justification = aiJustifications[slug]
          if (score == null && !justification) return []
          return [{
            ai_evaluation_id: evaluation.id,
            criterion_slug: slug,
            suggested_score: score == null ? null : Number(score),
            accepted_score: score == null ? null : Number(score),
            was_accepted: score != null,
            was_edited: false,
            justification: justification ?? null,
          }]
        })
      )
    }
  }

  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    const hasAi = Boolean(aiJustifications[slug]?.trim()) && aiEvaluationId != null
    return [{
      work_id: workId,
      criterion_slug: slug,
      score: Number(score),
      source: hasAi ? ("ai_accepted" as const) : ("manual" as const),
      ai_evaluation_id: hasAi ? aiEvaluationId : null,
    }]
  })

  if (scores.length > 0) {
    await supabase.from("category_scores").insert(scores)
  }

  const platforms = normalizePlatformRatings([
    { platform: "mangaupdates", rating: data.mu_rating, votes: data.mu_votes },
    { platform: "animeplanet", rating: data.ap_rating, votes: data.ap_votes },
    { platform: "comick", rating: data.cmx_rating, votes: data.cmx_votes },
    ...(data.extra_platform_ratings ?? []).map((p) => ({
      platform: p.platform,
      rating: p.rating,
      votes: p.votes,
    })),
  ])

  if (platforms.length > 0) {
    const { error: platformError } = await supabase.from("platform_ratings").insert(
      platforms.map((p) => ({
        work_id: workId,
        platform: p.platform,
        rating: p.rating ?? null,
        vote_count: p.votes ?? 0,
      }))
    )
    if (platformError) return { ok: false, error: { _root: [platformError.message] } }
  }

  await syncWorkTags(supabase, workId, data.tags ?? [])
  await syncWorkGenres(supabase, workId, knownGenres.genreIds, "replace")
  const coversResult = await syncWorkCovers(supabase, workId, data.covers)
  if (coversResult.error) return { ok: false as const, error: { covers: [coversResult.error] } }
  const synopsesResult = await syncWorkSynopses(supabase, workId, normalizeFormSynopses(data))
  if (synopsesResult.error) return { ok: false as const, error: { synopses: [synopsesResult.error] } }
  // Gate por configuração: gerar a canônica na criação é opcional (toggle em
  // /settings). Desligado, adia pra depois do save (painel/edição). Tolerante:
  // default true preserva o comportamento histórico.
  if (!opts?.skipAiCascade && (await getSynopsisCanonicalOnCreate(supabase))) {
    scheduleSynopsisConsolidation(workId)
  }
  await upsertWorkExternalIds(supabase, workId, data.external_ids)

  const hasScores = scores.length >= CRITERION_SLUGS.length
  await supabase
    .from("works")
    .update({
      ai_eval_status: hasScores ? "done" : aiEvaluationId ? "review_pending" : "pending",
    })
    .eq("id", workId)

  return { ok: true, workId }
}

// Sinaliza pro Next que tanto o path /favorites quanto o cache `getFavoritesSummary`
// estão desatualizados. Necessário em toda mutação que possa mexer em
// is_favorite/is_archived ou nos scores agregados pelo summary.
function revalidateFavorites() {
  revalidatePath("/favorites")
  revalidateTag("favorites-summary", "max")
}

export async function createWork(
  values: WorkFormValues,
  aiMeta?: CreateWorkAiMeta,
  externalReviews?: SourcedReview[],
  opts: { skipAiEnrichment?: boolean } = {},
) {
  // FATIA 2b — o Leitor free pode cadastrar uma obra que falta no catálogo, mas SEM QUEIMAR UM
  // TOKEN. A busca externa é scraping (grátis); a IA fica pendente pro Curador.
  const session = await ensureSignedIn()
  if (!session.ok) return { error: session.error }
  const perm = await ensurePermission("own_state")
  if (!perm.ok) return { error: perm.error }

  // Curador = quem pode curar o catálogo (rodar a IA, digitar notas). Todo o resto cria a obra
  // no modo pendente.
  const isCurator = (await ensurePermission("curate_ai")).ok

  // 🔴 O buraco que isto fecha: o form carrega as 9 NOTAS DE ATRIBUTO e as justificativas da
  // IA — e toda função exportada de um "use server" é um endpoint HTTP público. Sem esta
  // limpeza, um Leitor free postaria as notas que quisesse direto no CATÁLOGO, sem passar pela
  // IA e sem passar por você. Elas não são opinião dele: são fato da obra, e custam dinheiro.
  const safeValues: WorkFormValues = isCurator
    ? values
    : {
        ...values,
        ...Object.fromEntries(CRITERION_SLUGS.map((slug) => [slug, null])),
        ai_justifications: {},
      }

  const result = await persistNewWork(safeValues, isCurator ? aiMeta : undefined, {
    skipAiCascade: !isCurator,
    creatorId: session.userId,
  })
  if (!result.ok) return { error: result.error }
  // `skipAiEnrichment`: o usuário optou por salvar SEM o enriquecimento pago
  // (Flow B do popup de custo). Pula a inferência de tags (Haiku) e o resumo/
  // digest de reviews (Haiku/Sonnet). As reviews ainda são persistidas (exibição);
  // resumo/digest/tags podem ser gerados sob demanda depois. O scraping é grátis.
  //
  // Pro não-curador é FORÇADO: ele não escolhe gastar o saldo da Anthropic de outra pessoa.
  const skipAi = opts.skipAiEnrichment === true || !isCurator
  // Inferência de tags (Haiku) em background, SEQUENCIADA após as reviews —
  // usa o contexto de leitores (digest → resumo) quando disponível, que puxa
  // tags que a sinopse omite (passada `--with-reviews` validada). Grava tags de
  // alta confiança (source='ai_inferred'); se adicionou, marca recalc pendente.
  const inferTagsForNewWork = async (workId: string) => {
    if (skipAi) return
    // Gate por configuração (toggle em /settings). Desligado, a obra nasce sem
    // tags ai_inferred e você as gera depois. Default true preserva o histórico.
    if (!(await getTagInferenceOnCreate())) return
    const { inferAndPersistTagsForWork } = await import("@/lib/tags/auto-infer")
    const added = await inferAndPersistTagsForWork(workId)
    if (added > 0) await markRecalcPending("ai_inferred_tags_on_create")
  }

  // Cascata "gerar todos os dados" (toggle /settings, default off). Quando ligada,
  // a cascata (server/actions/generate-all.ts) faz a aquisição de reviews + tags +
  // resto em ordem — então pulamos aqui o fluxo leve de reviews/tags pra não
  // duplicar. Fica só o saveWorkReviews do Path B (persiste as reviews do eval).
  const generateAll = !skipAi && (await getGenerateAllOnCreate())

  if (externalReviews && externalReviews.length > 0) {
    // A avaliação (Path B) já buscou as reviews pra montar o prompt — reusa o
    // pool em vez de re-buscar na borda. Tag-inference roda depois (usa o que
    // houver de contexto; o resumo é aguardado em saveWorkReviews).
    const { saveWorkReviews } = await import("@/lib/external/persist-reviews")
    // fromFreshEval: a obra acabou de ser avaliada com estas reviews ⇒ não marca
    // a avaliação como desatualizada (só atualiza o fingerprint do pool).
    await saveWorkReviews(result.workId, externalReviews, { fromFreshEval: true, skipPaidEnrichment: skipAi })
    if (!generateAll) after(() => inferTagsForNewWork(result.workId))
  } else if (!generateAll) {
    // Criada SEM avaliar: extrai + persiste reviews na borda, desacoplado da
    // avaliação, em background (`after()`). A obra passa a exibir reviews na
    // própria página sem esperar uma avaliação. No-op se não há IDs aceitos.
    // A inferência de tags roda DEPOIS, na MESMA task (reviews já persistidas).
    after(async () => {
      const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
      await acquireAndPersistWorkReviews(result.workId, { skipPaidEnrichment: skipAi })
      await inferTagsForNewWork(result.workId)
    })
  }

  // Resolve o hid da Comix na criação: a Comix não entra na busca multi-fonte
  // (precisa de browser real pro token), então a obra nasce sem hid e o app
  // nunca pegaria reviews de lá. Dispara a resolução escopada em background;
  // achado o hid, as reviews da Comix passam a fluir na próxima aquisição. Quando
  // a cascata está ligada, roda o resolve ANTES dela (na MESMA task) pra o hid já
  // estar presente no gate de fontes; a cascata termina em needs_authorization
  // (banner acionável na página da obra).
  after(async () => {
    const { resolveComixHidForWork } = await import("@/server/comix/resolver")
    await resolveComixHidForWork(result.workId)
    if (generateAll) {
      const { generateAllWorkData } = await import("@/server/actions/generate-all")
      await generateAllWorkData(result.workId)
    }
  })

  const slug = titleToSlug(values.title)

  // Recalc DEFERIDO (não-bloqueante): a obra recém-criada ainda não tem dados pra
  // uma Nota Prevista significativa (segue pra Avaliação IA) e adicionar um título
  // não-rotulado não muda o modelo global. Evita um recalc do catálogo inteiro a
  // cada create. A nota é preenchida no próximo recalc (auto ≥1h, "Recalcular
  // agora" ou o recalc do aceite da IA). Mesmo padrão que updateWork/createWorksBatch.
  await markRecalcPending("createWork")

  revalidatePath("/titles")
  revalidatePath(`/titles/${slug}`)
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { id: result.workId, slug } }
}

/**
 * Versão "batch": insere a obra mas adia o recálculo para finalizePendingBatch().
 * Use quando for adicionar vários títulos em sequência.
 */
/**
 * Cadastra uma obra SEM gastar um token — o caminho do Leitor free (Fatia 2b).
 *
 * A regra que você definiu: o free pode criar obra nova, mas só com a BUSCA DE DADOS externa
 * (scraping das 8 fontes — não passa por `ensureAiConsumption`, não custa nada). O resto —
 * as 9 notas de atributo, a sinopse canônica, a inferência de tags — fica PENDENTE pro Curador
 * acionar. A obra nasce `ai_eval_status = "pending"` e cai na fila de /ai-evaluation.
 *
 * ⚠️ O gate saiu de `ensureAdmin` para `own_state` + sessão. E o `skipAiCascade` não é
 * decoração: sem ele, esta função disparava a consolidação de sinopse por LLM em `after()` —
 * "pending" não era livre de IA, e o Leitor free estaria gastando o seu saldo da Anthropic
 * a cada obra cadastrada. Sem erro, sem log, direto na fatura.
 */
export async function createWorkPending(values: WorkFormValues) {
  const session = await ensureSignedIn()
  if (!session.ok) return { error: { _root: [session.error] } }
  const gate = await ensurePermission("own_state")
  if (!gate.ok) return { error: { _root: [gate.error] } }

  const isOwner = await canWriteSharedWorkRow(session.userId)
  const result = await persistNewWork(values, undefined, {
    skipAiCascade: !isOwner,
    creatorId: session.userId,
  })
  if (!result.ok) return { error: result.error }

  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/titles/new")
  revalidateFavorites()
  return { data: { id: result.workId } }
}

export interface CreateWorkBatchItem {
  values: WorkFormValues
  aiMeta?: CreateWorkAiMeta
  externalReviews?: SourcedReview[]
}

export async function createWorksBatch(
  items: Array<CreateWorkBatchItem | WorkFormValues>,
) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: { _root: [gate.error] } }
  // O estado pessoal do lote é de quem importou. ⚠️ `ensureAdmin()` NÃO diz que é o dono: um
  // segundo Curador passa nele e mesmo assim não pode herdar o estado pessoal de ninguém.
  const session = await ensureSignedIn()
  if (!session.ok) return { error: { _root: [session.error] } }
  if (items.length === 0) {
    return { error: { _root: ["Nenhuma obra para criar"] } }
  }

  const normalized: CreateWorkBatchItem[] = items.map((item) =>
    "values" in item ? item : { values: item }
  )

  const titleCounts = new Map<string, number>()
  for (const { values } of normalized) {
    for (const key of getComparableNames(values)) {
      titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
    }
  }

  const duplicatedTitle = [...titleCounts.entries()].find(([, count]) => count > 1)?.[0]
  if (duplicatedTitle) {
    return { error: { title: [`"${duplicatedTitle}" aparece mais de uma vez no lote`] } }
  }

  const created: Array<{ id: string; title: string }> = []
  const needEdgeReviews: string[] = []
  let saveWorkReviewsFn: typeof import("@/lib/external/persist-reviews").saveWorkReviews | null = null
  for (const { values, aiMeta, externalReviews } of normalized) {
    const result = await persistNewWork(values, aiMeta, { creatorId: session.userId })
    if (!result.ok) return { error: result.error, data: { created } }
    if (externalReviews && externalReviews.length > 0) {
      if (!saveWorkReviewsFn) {
        saveWorkReviewsFn = (await import("@/lib/external/persist-reviews")).saveWorkReviews
      }
      await saveWorkReviewsFn(result.workId, externalReviews)
    } else {
      needEdgeReviews.push(result.workId)
    }
    created.push({ id: result.workId, title: values.title })
  }

  // Paridade com createWork (que faz isso por obra): resolve o hid da Comix das
  // recém-criadas e extrai reviews na borda das que não vieram com pool. Um único
  // run "mop-up" do resolver (sem --work) evita N Chrome concorrentes no mesmo
  // userDataDir. Tudo em background.
  after(async () => {
    const { resolveComixHidsPending } = await import("@/server/comix/resolver")
    await resolveComixHidsPending(created.map((c) => c.id))
  })
  if (needEdgeReviews.length > 0) {
    after(async () => {
      const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
      for (const id of needEdgeReviews) await acquireAndPersistWorkReviews(id)
    })
  }

  // Recalc DEFERIDO (não-bloqueante): obras recém-criadas em lote ainda não têm
  // dados pra uma Nota Prevista significativa (vão direto pra Avaliação IA). Evita
  // um recalc global (re-treina o Ridge + recalcula ~todo o catálogo) a cada lote,
  // que só produziria uma nota sem sentido para essas obras. A Nota Prevista é
  // preenchida no próximo recalc (auto ≥1h, "Recalcular agora" ou o recalc do
  // aceite da IA). Mesmo padrão que updateWork usa.
  await markRecalcPending("createWorksBatch")

  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/titles/new")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { created } }
}

/**
 * Conta quantas obras estão "pendentes de cálculo" — isto é, foram criadas
 * via createWorkPending e ainda não têm linha em calculated_scores.
 */
export async function getPendingBatchCount(): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, calculated_scores(id)")
    .eq("is_archived", false)
    .limit(2000)
  if (error) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = (data ?? []).filter((w: any) => !w.calculated_scores)
  return pending.length
}

/**
 * Finaliza o batch: dispara o recálculo orquestrado uma única vez (deduplicado).
 */
export async function finalizePendingBatch() {
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, calculated_scores(id)")
    .eq("is_archived", false)
    .limit(2000)
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = (data ?? []).filter((w: any) => !w.calculated_scores).length

  const finalizeRecalc = await recalculateScoresNow()
  if (finalizeRecalc.status === "failed") throw new Error(finalizeRecalc.error)

  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/titles/new")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return { finalized: pending }
}

export async function updateWork(id: string, values: WorkFormValues, aiMeta?: CreateWorkAiMeta) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: { _root: [gate.error] } }
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data
  const supabase = createAdminClient()
  // `works_owner`: `user_score` aqui é a nota ANTERIOR do dono — ela alimenta o ledger de
  // previsões (`capturePredictionForFirstRating` / `resolvePredictionsForWork`). Lida de
  // `works` ela morre no `DROP`; lida da view, ela vem do espelho dele e sobrevive. O `title`
  // é catálogo e passa igual.
  const { data: existingWork } = await supabase
    .from("works_owner")
    .select("title, user_score")
    .eq("id", id)
    .maybeSingle()
  const previousSlug = existingWork?.title ? titleToSlug(existingWork.title) : null
  const prevUserScore = (existingWork?.user_score as number | null | undefined) ?? null
  const nextSlug = titleToSlug(data.title)
  const titleSlugChanged = Boolean(previousSlug && nextSlug && previousSlug !== nextSlug)

  // Item 1 (alias de slug): ao renomear, guarda o slug ANTIGO em works.previous_slugs pra
  // getWorkBySlug redirecionar URLs antigas em vez de 404. Best-effort: se a coluna ainda não
  // existe (migration 162), a leitura falha → não grava, e o rename segue normal.
  let previousSlugsUpdate: string[] | undefined
  if (titleSlugChanged && previousSlug) {
    const { data: cur, error: readErr } = await supabase
      .from("works")
      .select("previous_slugs")
      .eq("id", id)
      .maybeSingle()
    if (!readErr && cur) {
      const existing = ((cur as { previous_slugs?: string[] | null }).previous_slugs ?? []) as string[]
      // Dedup e nunca lista o slug ATUAL como alias (ex.: rename A→B→A limpa o A).
      previousSlugsUpdate = Array.from(new Set([...existing, previousSlug])).filter((s) => s !== nextSlug)
    }
  }
  let knownGenres: Awaited<ReturnType<typeof filterKnownGenres>>
  try {
    knownGenres = await filterKnownGenres(supabase, data.genres ?? [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: { genres: [message] } }
  }

  // ⚠️ Só CATÁLOGO (Fase E). A parte pessoal do form (status, capítulos, nota, ♥, anotações,
  // pós-leitura) vai pro espelho do dono logo abaixo — e SÓ pra lá.
  const { error } = await supabase
    .from("works")
    .update({
      title: data.title,
      original_title: data.original_title ?? null,
      alternative_titles: normalizeTextList(data.alternative_titles ?? []),
      year: data.year ?? null,
      year_end: data.year_end ?? null,
      publication_status_id:
        getPublicationStatusIdByName(data.publication_status) ?? data.publication_status_id ?? null,
      total_chapters: data.total_chapters ?? null,
      ...(previousSlugsUpdate ? { previous_slugs: previousSlugsUpdate } : {}),
    })
    .eq("id", id)

  if (error) return { error: { _root: [error.message] } }

  // Espelha a parte pessoal do form (ver `personalPatchFromForm`). Sem isto, editar uma obra
  // pelo form completo reescrevia a nota/♥/capítulos em `works` e deixava o espelho do dono
  // para trás — e o espelho é o que a Fase 2 passa a usar como fonte.
  const personalMirror = await mirrorOwnerState(await getOwnerUserId(), [id], personalPatchFromForm(data))
  if (personalMirror.error) return { error: { _root: [personalMirror.error] } }

  // Sincronizar notas por critério: upsert presentes, deletar removidos.
  // Preserva a origem AI quando o score não muda (mantém ai_accepted/ai_edited
  // + ai_evaluation_id). Se o score era AI e foi alterado pelo usuário, marca
  // como ai_edited preservando o ai_evaluation_id. Score novo ou que já era
  // manual permanece manual.
  const { data: existingScoreRows } = await supabase
    .from("category_scores")
    .select("criterion_slug, score, source, ai_evaluation_id")
    .eq("work_id", id)
  const existingByCriterion = new Map(
    (existingScoreRows ?? []).map((row) => [row.criterion_slug, row])
  )

  const aiJustifications = data.ai_justifications ?? {}
  const aiJustificationEntries = Object.entries(aiJustifications)
    .filter(([slug, justification]) =>
      CRITERION_SLUGS.includes(slug as (typeof CRITERION_SLUGS)[number]) &&
      justification?.trim() &&
      data[slug as keyof WorkFormValues] != null
    )

  let aiEvaluationId: string | null = null
  if (aiJustificationEntries.length > 0) {
    const { data: evaluation } = await supabase
      .from("ai_evaluations")
      .insert({
        work_id: id,
        status: "completed",
        model_name: aiMeta?.modelName ?? "external-ai-criteria",
        prompt_version: aiMeta?.promptVersion ?? "external-import-update",
        summary: aiMeta?.summary?.trim() || "Notas e explicações geradas durante a busca externa do título.",
        confidence: aiMeta?.confidence ?? null,
        raw_response: { criteriaJustifications: aiJustifications },
        input_hash: aiMeta?.inputHash ?? null,
      })
      .select("id")
      .single()

    if (evaluation) {
      aiEvaluationId = evaluation.id
      await supabase.from("ai_evaluation_scores").insert(
        aiJustificationEntries.map(([slug, justification]) => ({
          ai_evaluation_id: evaluation.id,
          criterion_slug: slug,
          suggested_score: Number(data[slug as keyof WorkFormValues]),
          accepted_score: Number(data[slug as keyof WorkFormValues]),
          was_accepted: true,
          was_edited: false,
          justification: justification.trim(),
        }))
      )
    }
  }

  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    const numericScore = Number(score)
    const hasNewAi = aiEvaluationId != null && Boolean(aiJustifications[slug]?.trim())
    const prev = existingByCriterion.get(slug)
    const prevSource = prev?.source ?? null
    const wasAi = prevSource === "ai_accepted" || prevSource === "ai_edited"
    const sameValue = prev != null && Number(prev.score) === numericScore
    const source: "manual" | "ai_accepted" | "ai_edited" = wasAi
      ? hasNewAi
        ? "ai_accepted"
        : sameValue
          ? (prevSource as "ai_accepted" | "ai_edited")
          : "ai_edited"
      : hasNewAi
        ? "ai_accepted"
        : "manual"
    return [{
      work_id: id,
      criterion_slug: slug,
      score: numericScore,
      source,
      ai_evaluation_id: hasNewAi ? aiEvaluationId : wasAi ? prev?.ai_evaluation_id ?? null : null,
    }]
  })

  const slugsToDelete = CRITERION_SLUGS.filter((slug) => data[slug as keyof WorkFormValues] == null)
  if (slugsToDelete.length > 0) {
    await supabase
      .from("category_scores")
      .delete()
      .eq("work_id", id)
      .in("criterion_slug", slugsToDelete)
  }

  if (scores.length > 0) {
    await supabase
      .from("category_scores")
      .upsert(scores, { onConflict: "work_id,criterion_slug" })
  }

  // Upsert plataformas
  const platforms = normalizePlatformRatings([
    { platform: "mangaupdates", rating: data.mu_rating, votes: data.mu_votes },
    { platform: "animeplanet", rating: data.ap_rating, votes: data.ap_votes },
    { platform: "comick", rating: data.cmx_rating, votes: data.cmx_votes },
    ...(data.extra_platform_ratings ?? []).map((p) => ({
      platform: p.platform,
      rating: p.rating,
      votes: p.votes,
    })),
  ])

  await supabase.from("platform_ratings").delete().eq("work_id", id)

  if (platforms.length > 0) {
    const { error: platformError } = await supabase
      .from("platform_ratings")
      .insert(
        platforms.map((p) => ({
          work_id: id,
          platform: p.platform,
          rating: p.rating ?? null,
          vote_count: p.votes ?? 0,
        }))
      )
    if (platformError) return { error: { _root: [platformError.message] } }
  }

  // Salvar tags
  await syncWorkTags(supabase, id, data.tags ?? [])
  await syncWorkGenres(supabase, id, knownGenres.genreIds, "replace")
  const coversResult = await syncWorkCovers(supabase, id, data.covers)
  if (coversResult.error) return { error: { covers: [coversResult.error] } }
  const synopsesResult = await syncWorkSynopses(supabase, id, normalizeFormSynopses(data))
  if (synopsesResult.error) return { error: { synopses: [synopsesResult.error] } }
  scheduleSynopsisConsolidation(id)
  await upsertWorkExternalIds(supabase, id, data.external_ids)

  // Atualizar status IA com base na cobertura de critérios
  const hasAllScores = scores.length >= CRITERION_SLUGS.length
  const hasCompletedEval =
    aiEvaluationId != null || (!hasAllScores && await hasCompletedAiEvaluation(supabase, id))
  await supabase
    .from("works")
    .update({ ai_eval_status: hasAllScores ? "done" : hasCompletedEval ? "review_pending" : "pending" })
    .eq("id", id)
    .neq("ai_eval_status", "skipped")

  // Editar a obra invalida o IA Rk (alignment_score) persistido — os atributos
  // que alimentam o re-rank mudaram. Marca como desatualizado (não recomputa;
  // re-rank é manual). No-op se a obra nunca foi rankeada.
  await markWorkAlignmentStale(id)

  // Validação prospectiva: se a obra ganhou a PRIMEIRA nota agora (null → valor),
  // congela a previsão de-registro (ainda pré-rótulo, pois o recalc é deferido).
  if (prevUserScore == null && data.user_score != null) {
    await capturePredictionForFirstRating(id, data.user_score)
  }

  // P1: resolve snapshots prospectivos (prediction_snapshots) com a nota real.
  // 1ª nota → resolve (imutável); edição → relabel (preserva a 1ª medição);
  // remoção → só carimba label_changed_at. Idempotente. Best-effort.
  if (data.user_score != null) {
    await resolvePredictionsForWork(id, data.user_score)
  } else if (prevUserScore != null) {
    await markPredictionLabelChanged(id)
  }

  // Editar a obra muda as features do Ridge global → marca a base como recálculo
  // pendente em vez de recalcular na hora. A Nota Prevista atualiza quando o
  // usuário clica "Recalcular agora" ou no auto-recalc (≥1h sem novas edições).
  await markRecalcPending("updateWork")

  revalidatePath(`/titles/${id}`)
  revalidatePath(`/titles/${id}/edit`)
  if (previousSlug) {
    revalidatePath(`/titles/${previousSlug}`)
    revalidatePath(`/titles/${previousSlug}/edit`)
  }
  revalidatePath(`/titles/${nextSlug}`)
  revalidatePath(`/titles/${nextSlug}/edit`)
  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { id, slug: nextSlug } }
}

export async function archiveWork(id: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ is_archived: true })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: null }
}

export async function unarchiveWork(id: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ is_archived: false })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath(`/titles/${id}`)
  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidateFavorites()
  return { data: null }
}

/**
 * Override HUMANO da classificação 18+ (migração 161). É a garantia contra erro
 * da IA/tag: vence o `adult_auto`. Curadoria — `is_adult` mora na linha
 * compartilhada de `works`, então só o dono (ensureAdmin). Valores:
 *   true  → força 18+   | false → força limpo | null → volta ao automático.
 */
export async function setAdultOverride(id: string, value: boolean | null) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase.from("works").update({ adult_override: value }).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(`/titles/${id}`)
  revalidatePath("/titles")
  revalidatePath("/")
  return { data: null }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Estado de LEITURA — FATIA 1 (PLANO-MULTIUSER-FASE2.md §13)
//
// Estes 4 writers eram `ensureAdmin()`, e TINHAM que ser: as colunas moram na linha
// compartilhada de `works`, então um Leitor marcando um capítulo estaria escrevendo no
// catálogo de todo mundo. Era isso que fazia do Leitor um espectador — sem poder favoritar
// nem marcar um capítulo. Agora o estado tem casa própria (`user_work_state`), e o gate pode
// ser o verbo certo: `own_state` (que o Leitor tem).
//
// A regra, em uma linha: **`user_work_state` sempre; `works` só se for o DONO.**
// Ver `server/queries/user-work-state.ts` pro porquê inteiro — e pro que acontece se alguém
// "simplificar" isso para um dual-write incondicional.
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Gate dos writers de estado de leitura.
 *
 * ⚠️ IDENTIDADE antes de PERMISSÃO, e nesta ordem. `ensurePermission("own_state")` sozinho
 * NÃO basta: o papel de um anônimo é `leitor` (fail-closed) e `own_state` é liberado pro
 * leitor — ou seja, o gate de papel PASSA. O que falta ao anônimo não é permissão, é um
 * `user_id` próprio: sem sessão, `getCurrentUserId()` cai no singleton e ele escreveria
 * como o DONO. Só `ensureSignedIn()` fecha isso.
 */
async function ensureReadingStateWriter(): Promise<
  { ok: true; userId: string; isOwner: boolean } | { ok: false; error: string }
> {
  const session = await ensureSignedIn()
  if (!session.ok) return { ok: false, error: session.error }

  const gate = await ensurePermission("own_state")
  if (!gate.ok) return { ok: false, error: gate.error }

  return {
    ok: true,
    userId: session.userId,
    isOwner: await canWriteSharedWorkRow(session.userId),
  }
}

/**
 * Aplica o patch nos DOIS lugares, na ordem certa: primeiro o dado de quem clicou
 * (`user_work_state`), depois — e só se ele for o dono — o espelho compartilhado (`works`).
 * Se o espelho falhar, o estado pessoal já está salvo; o inverso perderia o clique.
 */
async function applyReadingState(
  gate: { userId: string; isOwner: boolean },
  workIds: string[],
  patch: ReadingStatePatch,
): Promise<{ error: string | null }> {
  // FASE E: uma escrita, um destino. O `if (gate.isOwner)` que espelhava o mesmo `patch` em
  // `works` saiu — a linha compartilhada não guarda mais estado pessoal de ninguém, nem do dono.
  // Ele lê do espelho desde a Fase D, então este segundo write não tinha mais leitor.
  return writeReadingState(gate.userId, workIds, patch)
}

export async function toggleFavorite(id: string, isFavorite: boolean) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }

  const { error } = await applyReadingState(gate, [id], { is_favorite: isFavorite })
  if (error) return { error }

  revalidatePath(`/titles/${id}`)
  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/favorites")
  revalidateTag("works-slug-index", "max")
  revalidateFavorites()
  return { data: null }
}

export async function setFavoriteMany(ids: string[], isFavorite: boolean) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }
  const filtered = Array.from(new Set(ids.filter(Boolean)))
  if (filtered.length === 0) return { data: { count: 0 } }

  const { error } = await applyReadingState(gate, filtered, { is_favorite: isFavorite })
  if (error) return { error }

  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/favorites")
  revalidateTag("works-slug-index", "max")
  revalidateFavorites()
  return { data: { count: filtered.length } }
}

/**
 * Escrita ENXUTA do progresso de leitura, disparada in-loco pelo card da /leitura
 * (stepper − / + e "Marcar até o último"). Grava só `chapters_read` (+ carimba
 * `last_read_at` quando o número CRESCE) — nada de nota, status ou pós-leitura, ao
 * contrário do `updateWorkStatus` completo. Sem recalc: `chapters_read` não é feature
 * do Ridge (o modelo usa `total_chapters`, não o quanto VOCÊ leu).
 *
 * Vai por `applyReadingState` → `user_work_state` (cliente de sessão): o dado é de quem
 * clicou, e a RLS da mig 142 barra escrever na linha de outra pessoa.
 */
export async function setChaptersRead(id: string, chaptersRead: number) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }

  const n = Math.floor(Number(chaptersRead))
  if (!Number.isFinite(n) || n < 0) return { error: "Número de capítulos inválido." }

  // Estado atual DE QUEM ESCREVE (mora em user_work_state pra todo mundo desde a Fase E),
  // pra decidir o carimbo de `last_read_at`: só marca "li agora" quando o número avança —
  // corrigir um typo pra baixo não deve mexer na data de última leitura.
  const supabase = createAdminClient()
  const { data: current } = await supabase
    .from("user_work_state")
    .select("chapters_read")
    .eq("user_id", gate.userId)
    .eq("work_id", id)
    .maybeSingle()

  const prev = (current?.chapters_read as number | null | undefined) ?? null
  const grew = prev == null || n > prev
  const patch: ReadingStatePatch = {
    chapters_read: n,
    ...(grew ? { last_read_at: new Date().toISOString().slice(0, 10) } : {}),
  }

  const { error } = await applyReadingState(gate, [id], patch)
  if (error) return { error }

  revalidatePath("/leitura")
  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { chaptersRead: n } }
}

/**
 * O estado de GOSTO (FATIA 2a): nota, anotações, interesse ♥ e as 8 pós-leitura.
 *
 * Até a Fatia 1 estes campos eram RECUSADOS para quem não é o dono — moravam só na linha
 * compartilhada de `works`, e aceitá-los teria sobrescrito a nota dele. Agora eles têm casa
 * própria em `user_work_state` e qualquer usuário logado pode avaliar.
 *
 * ⚠️ O que NÃO mudou, e é o coração da fatia: o **scoring continua lendo `works`**. O Ridge, a
 * chance, o viés de atributo, o ledger e o perfil de gosto treinam com os RÓTULOS DO DONO — e
 * `works` é onde eles moram. Por isso `works` só é escrita quando quem avalia é ele: se a nota
 * da Leitora entrasse ali, o modelo DELE passaria a aprender o gosto DELA, e a Nota Prevista de
 * 878 obras mudaria sem que ninguém tivesse pedido nada.
 */
function tastePatchFrom(data: WorkStatusValues): TasteStatePatch {
  return {
    user_score: data.user_score ?? null,
    observations: data.observations ?? null,
    observation_adjustment: data.observation_adjustment,
    synopsis_quality: data.synopsis_quality ?? null,
    // Proveniência (Plano 3): valor vindo do form = informado/aceito pelo usuário.
    synopsis_quality_source: data.synopsis_quality != null ? "human_manual" : "legacy_unknown",
    post_story_score: data.post_story_score ?? null,
    post_fl_score: data.post_fl_score ?? null,
    post_ml_score: data.post_ml_score ?? null,
    post_character_development_score: data.post_character_development_score ?? null,
    post_pacing_score: data.post_pacing_score ?? null,
    post_art_visual_score: data.post_art_visual_score ?? null,
    post_impact_immersion_score: data.post_impact_immersion_score ?? null,
    post_originality_score: data.post_originality_score ?? null,
  }
}

export async function updateWorkStatus(id: string, values: WorkStatusValues) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: { _root: [gate.error] } }
  const parsed = workStatusSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data

  // "Want to Read" = "não comecei". Capítulos lidos > 0 contradiz isso → promove pra "Reading".
  // Espelha o auto-switch do WorkStatusForm e fecha os caminhos que não passam por ele (a action
  // é um endpoint público). O id é resolvido do nome mais abaixo (getPersonalStatusIdByName).
  if (data.personal_status === DEFAULT_PERSONAL_STATUS && (data.chapters_read ?? 0) > 0) {
    data.personal_status = readingPersonalStatusName() as typeof data.personal_status
    data.personal_status_id = null
  }

  const supabase = createAdminClient()

  // O estado ATUAL do DONO (e, pra ele, a `user_score` anterior que o ledger de previsões usa).
  // Vem da view: é o espelho dele, não a linha compartilhada — que vai perder estas colunas.
  // Literal de propósito: o client do Supabase tipa o retorno a partir da STRING do select —
  // montá-la com template/`join()` devolve `ParserError`.
  const { data: sharedRow } = await supabase
    .from("works_owner")
    .select(
      `personal_status_id, chapters_read, last_read_at,
       user_score, observation_adjustment, observations, synopsis_quality,
       post_story_score, post_fl_score, post_ml_score, post_character_development_score,
       post_pacing_score, post_art_visual_score, post_impact_immersion_score,
       post_originality_score`,
    )
    .eq("id", id)
    .single()

  // ⚠️ O estado ANTERIOR tem que ser o DE QUEM ESTÁ ESCREVENDO. As regras de data abaixo
  // ("o capítulo cresceu?", "saiu de Want to Read?") dependem dele — com o estado do dono, a
  // Leitora que marca o capítulo 3 numa obra em que ele está no 200 não teria a data
  // carimbada, porque "não cresceu". Certo, e sem erro nenhum: só a data errada.
  let current: {
    personal_status_id: number | null
    chapters_read: number | null
    last_read_at: string | null
  } | null

  if (gate.isOwner) {
    current = sharedRow
      ? {
          personal_status_id: sharedRow.personal_status_id as number | null,
          chapters_read: sharedRow.chapters_read as number | null,
          last_read_at: toDay(sharedRow.last_read_at as string | null),
        }
      : null
  } else {
    const { data: own } = await supabase
      .from("user_work_state")
      .select("personal_status_id, chapters_read, last_read_at")
      .eq("user_id", gate.userId)
      .eq("work_id", id)
      .maybeSingle()
    current = own
      ? {
          personal_status_id: own.personal_status_id as number | null,
          chapters_read: own.chapters_read as number | null,
          last_read_at: toDay(own.last_read_at as string | null),
        }
      : null
  }

  // Só do DONO: é a nota DELE que o ledger de previsões resolve e que o Ridge treina.
  const prevUserScore = (sharedRow?.user_score as number | null | undefined) ?? null

  const currentStatusName = current
    ? getPersonalStatusNameById(current.personal_status_id)
    : null
  const newStatus = data.personal_status
  const today = new Date().toISOString().slice(0, 10)
  const currentLastRead = current?.last_read_at ?? null
  const userTouchedDate =
    data.last_read_at !== undefined && (data.last_read_at ?? null) !== currentLastRead
  const chaptersGrew =
    data.chapters_read != null &&
    data.chapters_read > 0 &&
    (current?.chapters_read == null || data.chapters_read > current.chapters_read)

  let nextLastReadAt: string | null
  if (newStatus === DEFAULT_PERSONAL_STATUS) {
    nextLastReadAt = null
  } else if (userTouchedDate) {
    nextLastReadAt = data.last_read_at ?? null
  } else if (currentStatusName === DEFAULT_PERSONAL_STATUS || chaptersGrew) {
    nextLastReadAt = today
  } else {
    nextLastReadAt = currentLastRead
  }

  const readingState: ReadingStatePatch = {
    personal_status_id:
      getPersonalStatusIdByName(data.personal_status) ?? data.personal_status_id ?? null,
    chapters_read: data.chapters_read ?? null,
    last_read_at: nextLastReadAt,
  }
  const personalState: PersonalStatePatch = { ...readingState, ...tastePatchFrom(data) }

  // ── Não-dono: TUDO dela (acompanhamento + gosto) vai pra `user_work_state`. `works` NÃO é
  // tocada — nem a nota, nem as observações. É o que impede a nota dela de virar o rótulo que
  // treina o modelo DELE.
  if (!gate.isOwner) {
    const write = await writeReadingState(gate.userId, [id], personalState)
    if (write.error) return { error: { _root: [write.error] } }

    // O MODELO DELA (Fatia 2b). Sem prediction ledger e sem `formula_config`: aquilo mede e
    // calibra o modelo do DONO. Aqui só recalculamos os scores DELA, em `user_calculated_scores`.
    //
    // Vai em `after()`: é Ridge em TS puro (zero IA, zero dinheiro), mas são ~880 obras — não é
    // trabalho pra segurar a resposta do clique. Best-effort: se falhar, o pior que acontece é
    // a Nota Prevista dela ficar uma avaliação atrasada, e o próximo save conserta.
    after(async () => {
      try {
        await recalculateForUser(gate.userId)
      } catch (err) {
        console.error("[updateWorkStatus] recalc do usuário falhou:", err)
      }
    })

    revalidatePath("/titles/[id]", "page")
    revalidatePath("/titles")
    revalidatePath("/ranking")
    revalidatePath("/leitura")
    revalidatePath("/")
    revalidateFavorites()
    return { data: { id } }
  }

  // ── Dono: MESMO destino que qualquer outra pessoa (Fase E). O `update` em `works` que existia
  // aqui gravava o mesmo `personalState` que a linha abaixo já grava no espelho — inclusive a
  // nota que treina o Ridge, que desde a Fase B é lida do espelho. Era uma cópia sem leitor.
  const mirror = await writeReadingState(gate.userId, [id], personalState)
  if (mirror.error) return { error: { _root: [mirror.error] } }

  // Validação prospectiva: primeira nota (null → valor) → congela a previsão
  // de-registro antes do recalc deferido incluir o rótulo.
  if (prevUserScore == null && data.user_score != null) {
    await capturePredictionForFirstRating(id, data.user_score)
  }

  // P1: resolve snapshots prospectivos (prediction_snapshots) com a nota real.
  // 1ª nota → resolve (imutável); edição → relabel (preserva a 1ª medição);
  // remoção → só carimba label_changed_at. Idempotente. Best-effort.
  if (data.user_score != null) {
    await resolvePredictionsForWork(id, data.user_score)
  } else if (prevUserScore != null) {
    await markPredictionLabelChanged(id)
  }

  await markRecalcPending("updateWorkStatus")

  revalidatePath("/titles/[id]", "page")
  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidatePath("/leitura")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { id } }
}

/**
 * Troca o status de leitura (personal_status) de VÁRIAS obras de uma vez —
 * action enxuta pra aba "Untracked" do /ai-evaluation. Ao contrário de
 * `updateWorkStatus` (form completo), só mexe em `personal_status_id`, sem tocar
 * notas/observações/capítulos. 1 update em lote + 1 recalc deferido.
 */
export async function setReadingStatusForWorks(ids: string[], status: string) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }
  const cleanIds = [...new Set((ids ?? []).filter(Boolean))]
  if (cleanIds.length === 0) return { error: "Nenhuma obra selecionada." }
  const statusId = getPersonalStatusIdByName(status)
  if (statusId == null) return { error: `Status de leitura inválido: ${status}` }

  const { error } = await applyReadingState(gate, cleanIds, { personal_status_id: statusId })
  if (error) return { error }

  // Recalc só faz sentido pro dono: é a linha de `works` (e o modelo dele) que mudou.
  if (gate.isOwner) await markRecalcPending("setReadingStatusForWorks")

  revalidatePath("/leitura")
  revalidatePath("/ai-evaluation")
  revalidateTag("ai-eval-tab-counts", "max")
  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { updated: cleanIds.length } }
}

export async function deleteWork(id: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase.from("works").delete().eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: null }
}

export interface ExternalWorkUpdate {
  title?: string
  originalTitle?: string | null
  alternativeTitles?: string[]
  synopsis?: string | null
  coverUrl?: string | null
  /** Lista completa de capas escolhidas no multipick. Quando presente, faz upsert
   *  preservando capas existentes não listadas (apenas troca primária). Tem
   *  precedência sobre coverUrl. */
  covers?: Array<{ url: string; source: string; isPrimary: boolean }>
  /** Idem capas, mas para sinopses (chave: texto). */
  synopses?: Array<{ text: string; source: string; isPrimary: boolean }>
  publicationStatus?: string | null
  totalChapters?: number | null
  genres?: string[]
  tags?: string[]
  platformRatings?: Array<{ platform: string; rating?: number | null; votes?: number | null }>
  externalIds?: Record<string, string>
  /** Texto pra coluna `works.observations`. Usado pelo update dialog pra
   * pré-preencher com "Status in Country of Origin" do MU quando a obra está
   * em Hiatus e a coluna está vazia (decisão tomada no client). */
  observations?: string | null
}

export async function updateWorkExternalData(
  id: string,
  updates: ExternalWorkUpdate,
  opts: { acquireReviews?: boolean } = {},
) {
  // `updates` vem ESCOLHIDO PELO CLIENTE (capa, sinopse, resolução de conflito) — é
  // curadoria pura. Só o Curador. O Assinante entra por `autoRefreshWorkData`, onde
  // quem monta o payload é o servidor.
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  return doUpdateWorkExternalData(id, updates, opts)
}

/** Núcleo da gravação, SEM gate. Não exportado (ver nota em doRefreshWorkExternalData). */
async function doUpdateWorkExternalData(
  id: string,
  updates: ExternalWorkUpdate,
  opts: { acquireReviews?: boolean } = {},
) {
  try {
    const supabase = createAdminClient()
    const { data: existingWork } = await supabase
      .from("works")
      .select("title")
      .eq("id", id)
      .maybeSingle()
    const previousSlug = existingWork?.title ? titleToSlug(existingWork.title) : null
    const knownGenres = updates.genres !== undefined
      ? await filterKnownGenres(supabase, updates.genres)
      : null

    const workFields: Record<string, unknown> = {}
    if (updates.title !== undefined) workFields.title = updates.title
    if (updates.originalTitle !== undefined) workFields.original_title = updates.originalTitle ?? null
    if (updates.alternativeTitles !== undefined) workFields.alternative_titles = updates.alternativeTitles
    if (updates.publicationStatus !== undefined) {
      workFields.publication_status_id = getPublicationStatusIdByName(updates.publicationStatus)
    }
    if (updates.totalChapters !== undefined) workFields.total_chapters = updates.totalChapters ?? null

    // "Atualizar dados" sempre carimba o timestamp de refresh de dados —
    // separado de updated_at (que o trigger toca em qualquer edição da linha).
    workFields.data_refreshed_at = new Date().toISOString()

    const { error } = await supabase.from("works").update(workFields).eq("id", id)
    if (error) return { error: error.message }

    // `observations` é a única coluna PESSOAL que este caminho escreve (o resto é catálogo:
    // título, status de publicação, capítulos totais, capas) — e agora vai SÓ pro espelho do
    // dono. Só quando o caller de fato mandou o campo: `undefined` aqui significa "não mexi",
    // não "apague".
    if (updates.observations !== undefined) {
      const mirror = await mirrorOwnerState(await getOwnerUserId(), [id], {
        observations: updates.observations ?? null,
      })
      if (mirror.error) return { error: mirror.error }
    }

    // Capas: se vier o array `covers` (multipick), upserta cada uma preservando
    // capas existentes que não estão na lista (só zera primária delas). Caso
    // contrário, cai no fallback de `coverUrl` único.
    if (updates.covers !== undefined) {
      const result = await syncExternalCovers(supabase, id, updates.covers)
      if (result.error) return { error: result.error }
    } else if (typeof updates.coverUrl === "string" && updates.coverUrl.trim().length > 0) {
      const result = await syncExternalCovers(supabase, id, [
        { url: updates.coverUrl, source: "manual", isPrimary: true },
      ])
      if (result.error) return { error: result.error }
    }

    let synopsesTouched = false
    if (updates.synopses !== undefined) {
      const result = await syncWorkSynopses(supabase, id, updates.synopses)
      if (result.error) return { error: result.error }
      synopsesTouched = true
    } else if (typeof updates.synopsis === "string" && updates.synopsis.trim().length > 0) {
      const result = await syncWorkSynopses(supabase, id, [
        { source: "manual", text: updates.synopsis, isPrimary: true },
      ])
      if (result.error) return { error: result.error }
      synopsesTouched = true
    }
    if (synopsesTouched) scheduleSynopsisConsolidation(id)

    if (updates.platformRatings?.length) {
      const platforms = normalizeExternalPlatformUpdates(updates.platformRatings)
      if (platforms.length > 0) {
        const platformNames = platforms.map((p) => p.platform)
        const { data: existingRatings, error: existingRatingsError } = await supabase
          .from("platform_ratings")
          .select("platform, rating, vote_count")
          .eq("work_id", id)
          .in("platform", platformNames)

        if (existingRatingsError) return { error: existingRatingsError.message }

        const existingByPlatform = new Map(
          (existingRatings ?? []).map((p) => [normalizePlatformName(p.platform), p])
        )

        const rows = platforms.map((p) => {
          const existing = existingByPlatform.get(p.platform)
          return {
            work_id: id,
            platform: p.platform,
            rating: p.rating ?? existing?.rating ?? null,
            vote_count: p.votes ?? existing?.vote_count ?? 0,
          }
        })

        const { error: platformError } = await supabase
          .from("platform_ratings")
          .upsert(rows, { onConflict: "work_id,platform" })

        if (platformError) return { error: platformError.message }
      }
    }

    if (updates.tags !== undefined || knownGenres) {
      await syncWorkTagsPartial(
        supabase,
        id,
        updates.tags,
        knownGenres?.genreIds ?? []
      )
    }

    await upsertWorkExternalIds(supabase, id, updates.externalIds)

    // Aquisição na BORDA: colhe + persiste reviews das fontes confirmadas agora
    // (opt-in — só o fluxo de "atualizar dados" pede; o enrich em massa NÃO, pra
    // não scrapar N obras) + enrich do Comix (capa/sinopse/rating) se um hid foi
    // (re)vinculado. Roda em background (`after()`), sem bloquear a resposta. Como o
    // Mangago é lento (~60s), registramos um JOB running→done (`update-jobs`, em
    // memória) pra a página da obra dar feedback visual de que terminou
    // (`UpdateProgressWatcher`) em vez de o usuário recarregar às cegas. Best-effort.
    const needsComixEnrich = Boolean(updates.externalIds?.comix?.trim())
    if (opts.acquireReviews || needsComixEnrich) {
      startUpdateJob(id)
      after(async () => {
        let reviewsAdded: number | undefined
        try {
          const countReviews = async (): Promise<number> =>
            (await supabase
              .from("work_reviews")
              .select("id", { count: "exact", head: true })
              .eq("work_id", id)).count ?? 0
          const before = opts.acquireReviews ? await countReviews() : 0
          const tasks: Array<Promise<unknown>> = []
          if (opts.acquireReviews) {
            const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
            tasks.push(acquireAndPersistWorkReviews(id))
          }
          if (needsComixEnrich) {
            const { resolveComixDataResilient } = await import("@/server/comix/resolver")
            tasks.push(resolveComixDataResilient(id))
          }
          await Promise.allSettled(tasks)
          if (opts.acquireReviews) reviewsAdded = Math.max(0, (await countReviews()) - before)
        } finally {
          finishUpdateJob(id, { reviewsAdded })
        }
      })
    }

    // "Atualizar dados" mexe em ratings/sinopse/tags que alimentam o re-rank →
    // invalida o IA Rk (alignment_score) persistido. Marca como desatualizado
    // (não recomputa; re-rank é manual). No-op se a obra nunca foi rankeada.
    await markWorkAlignmentStale(id)

    await markRecalcPending("updateWorkExternalData")
    const nextSlug = titleToSlug(
      typeof updates.title === "string" && updates.title.trim()
        ? updates.title
        : existingWork?.title ?? ""
    )
    revalidatePath(`/titles/${id}`)
    if (previousSlug) {
      revalidatePath(`/titles/${previousSlug}`)
      revalidatePath(`/titles/${previousSlug}/edit`)
    }
    revalidatePath(`/titles/${nextSlug}`)
    revalidatePath(`/titles/${nextSlug}/edit`)
    revalidatePath("/titles")
    revalidateTag("works-slug-index", "max")
    revalidatePath("/")
    return { data: { id, slug: nextSlug } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[updateWorkExternalData] Uncaught error:", message)
    return { error: message }
  }
}

// ============================================================================
// Refresh external data using persisted IDs (no title search, no AI evaluation)
// ============================================================================

export type RefreshWorkExternalDataResult =
  | { ok: true; data: ExternalWorkData; conflicts: ConflictField[]; sources: ExternalSourceId[] }
  | { ok: false; reason: "NO_IDS" | "ALL_404" | "FORBIDDEN"; message?: string }

function buildCandidateFromStoredIds(
  work: { title: string; original_title: string | null; alternative_titles: string[] | null },
  rows: Array<{ source: string; external_id: string }>
): MergedCandidate {
  return buildCandidateFromExternalIds({
    title: work.title,
    originalTitle: work.original_title ?? undefined,
    alternativeTitles: work.alternative_titles ?? [],
  }, Object.fromEntries(rows.map((row) => [row.source, row.external_id])) as Partial<Record<ExternalSourceId, string>>)
}

export async function refreshWorkExternalData(workId: string): Promise<RefreshWorkExternalDataResult> {
  // Re-hidrata a obra do catálogo compartilhado a partir das fontes externas
  // (sobrescreve capa/sinopse/notas de plataforma) → curadoria, não leitura.
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, reason: "FORBIDDEN", message: gate.error }
  return doRefreshWorkExternalData(workId)
}

/**
 * Núcleo do refresh, SEM gate. NÃO é exportado de propósito: num arquivo "use server",
 * export = endpoint HTTP público. Os dois chamadores (o fluxo do Curador e o
 * automático do Assinante) põem o gate ANTES de chegar aqui.
 */
async function doRefreshWorkExternalData(workId: string): Promise<RefreshWorkExternalDataResult> {
  const supabase = createAdminClient()

  const { data: work, error: workError } = await supabase
    .from("works")
    .select("title, original_title, alternative_titles")
    .eq("id", workId)
    .single()
  if (workError || !work) {
    return { ok: false, reason: "NO_IDS", message: workError?.message }
  }

  const { data: idRows } = await supabase
    .from("work_external_ids")
    .select("source, external_id, is_rejected")
    .eq("work_id", workId)
    .not("external_id", "is", null)
    .eq("is_rejected", false)

  if (!idRows || idRows.length === 0) {
    console.log(`[refreshWorkExternalData] no stored IDs for work=${workId}, falling back to search`)
    return { ok: false, reason: "NO_IDS" }
  }

  const candidate = buildCandidateFromStoredIds(work, idRows)
  console.log(`[refreshWorkExternalData] work=${workId} sources=${candidate.sources.join(",")}`)

  try {
    const result = await fetchExternalData(candidate)
    const acceptedSources = result.data.externalIds ? Object.keys(result.data.externalIds) : []
    if (acceptedSources.length === 0) {
      return { ok: false, reason: "ALL_404" }
    }
    return { ok: true, data: result.data, conflicts: result.conflicts, sources: candidate.sources }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[refreshWorkExternalData] fetch failed:", message)
    return { ok: false, reason: "ALL_404", message }
  }
}

export type AutoRefreshWorkResult =
  | { ok: true; updatedFields: string[]; skippedConflicts: string[]; sources: ExternalSourceId[] }
  | { ok: false; error: string }

/**
 * Atualização AUTOMÁTICA de uma obra — o caminho do ASSINANTE.
 *
 * Segurança está na ASSINATURA: o cliente manda só o `workId`. Quem busca nas fontes,
 * funde e grava é o servidor. Não existe payload de conteúdo pra ele forjar — é a
 * diferença essencial pra `updateWorkExternalData`, que recebe o que o cliente
 * escolheu e por isso continua exclusiva do Curador.
 *
 * O que grava está em `buildAutoRefreshPlan` (função pura, testada): só o que
 * ENVELHECE (status, capítulos, notas de plataforma, tags, IDs), nunca o que é
 * ESCOLHA (título, sinopse e capa primárias). Campo em conflito com o que está salvo
 * é PULADO — sem humano pra decidir, preservar o que o Curador deixou é o certo.
 *
 * `acquireReviews: false` de propósito: colher reviews dispara o digest (Sonnet) na
 * chave do dono. Enquanto não houver rate-limit por usuário (o P0 do PLANO-FREE-PAGO
 * §6), um clique do Assinante NÃO pode custar LLM. Reviews seguem só com o Curador.
 */
export async function autoRefreshWorkData(workId: string): Promise<AutoRefreshWorkResult> {
  const gate = await ensurePermission("refresh_work")
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!workId) return { ok: false, error: "Obra não informada." }

  const refreshed = await doRefreshWorkExternalData(workId)
  if (!refreshed.ok) {
    const message =
      refreshed.reason === "NO_IDS"
        ? "Esta obra ainda não tem fontes externas vinculadas — só o Curador consegue vinculá-las."
        : (refreshed.message ?? "As fontes externas não responderam. Tente de novo mais tarde.")
    return { ok: false, error: message }
  }

  const plan = buildAutoRefreshPlan(refreshed.data, refreshed.conflicts)
  if (Object.keys(plan.updates).length === 0) {
    return { ok: true, updatedFields: [], skippedConflicts: plan.skippedConflicts, sources: refreshed.sources }
  }

  const result = await doUpdateWorkExternalData(workId, plan.updates, { acquireReviews: false })
  if (result?.error) return { ok: false, error: result.error }

  return {
    ok: true,
    updatedFields: Object.keys(plan.updates),
    skippedConflicts: plan.skippedConflicts,
    sources: refreshed.sources,
  }
}
