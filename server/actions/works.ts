"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { workFormSchema, workStatusSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues, WorkStatusValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  getPublicationStatusIdByName,
  getPersonalStatusIdByName,
  getPublicationStatusNameById,
  getPersonalStatusNameById,
} from "@/lib/constants/status-lookups"
import { pickPrimarySynopsis, pickPrimaryCover } from "@/lib/work-derived"
import { recalculateAll } from "./calculations"
import { fetchExternalData } from "./external"
import type { MergedCandidate, ExternalSourceId, ExternalWorkData, ConflictField } from "@/lib/external/types"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"
import { TAG_GROUPS_CATALOG } from "@/lib/constants/tags"

let cachedTagNameToGroupId: Map<string, string> | null = null
function getTagNameToGroupId(): Map<string, string> {
  if (cachedTagNameToGroupId) return cachedTagNameToGroupId
  const map = new Map<string, string>()
  for (const group of TAG_GROUPS_CATALOG) {
    const groupId = (TAG_GROUP_IDS as Record<string, string>)[group.groupSlug]
    if (!groupId) continue
    for (const value of group.values) {
      const key = value.trim().toLowerCase()
      if (!key || map.has(key)) continue
      map.set(key, groupId)
    }
  }
  cachedTagNameToGroupId = map
  return map
}

function resolveTagGroupId(name: string): string | null {
  return getTagNameToGroupId().get(name.trim().toLowerCase()) ?? null
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

function recalculateAllInBackground(context: string) {
  void recalculateAll().catch((error) => {
    console.error(`[${context}] Failed to recalculate scores`, error)
  })
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

function normalizePlatformName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeTextList(values: string[] = []) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
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

function getComparableNames(values: Pick<WorkFormValues, "title" | "original_title" | "alternative_titles">) {
  return normalizeTextList([
    values.title,
    values.original_title ?? "",
    ...(values.alternative_titles ?? []),
  ]).map(normalizeTitleMatch).filter(Boolean)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function workMatchesAnyName(work: any, incomingNames: Set<string>) {
  const savedNames = [
    work.title,
    work.original_title,
    ...(work.alternative_titles ?? []),
  ].map(normalizeTitleMatch).filter(Boolean)

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

async function upsertTag(
  supabase: SupabaseAdminClient,
  name: string,
  tagGroupId: string | null
): Promise<string | null> {
  const trimmed = name.trim()
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  if (!slug) return null

  const { data: existingBySlug, error: slugError } = await supabase
    .from("tags").select("id").eq("slug", slug).maybeSingle()
  if (slugError) {
    console.error(`[upsertTag] select by slug failed (slug=${slug})`, slugError.message)
  }
  if (existingBySlug) return existingBySlug.id

  const { data: existingByName, error: nameError } = await supabase
    .from("tags").select("id").ilike("name", trimmed).limit(1).maybeSingle()
  if (nameError) {
    console.error(`[upsertTag] select by name failed (name=${trimmed})`, nameError.message)
  }
  if (existingByName) return existingByName.id

  const { data: created, error: insertError } = await supabase
    .from("tags")
    .insert({ slug, name: trimmed, tag_group_id: tagGroupId })
    .select("id").single()
  if (insertError) {
    console.error(`[upsertTag] insert failed (slug=${slug}, name=${trimmed})`, insertError.message)
    return null
  }
  return created?.id ?? null
}

async function syncWorkTags(
  supabase: SupabaseAdminClient,
  workId: string,
  tags: string[]
) {
  await supabase.from("work_tags").delete().eq("work_id", workId)

  const tagIds: string[] = []
  for (const name of tags) {
    const id = await upsertTag(supabase, name, resolveTagGroupId(name))
    if (id) tagIds.push(id)
  }

  const uniqueTagIds = [...new Set(tagIds)]
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
) {
  if (!covers || covers.length === 0) return
  // Replace all on save — the multi-pick UI is the authoritative source.
  await supabase.from("work_covers").delete().eq("work_id", workId)
  const rows = covers.map((c, position) => ({
    work_id: workId,
    url: c.url,
    source: c.source,
    is_primary: c.isPrimary,
    position,
  }))
  // Ensure only one primary (the table has a partial unique index enforcing this,
  // but normalize defensively first).
  const primaryIdx = rows.findIndex((r) => r.is_primary)
  if (primaryIdx === -1 && rows.length > 0) rows[0].is_primary = true
  for (let i = 0; i < rows.length; i++) if (i !== primaryIdx && primaryIdx !== -1) rows[i].is_primary = false
  const { error } = await supabase.from("work_covers").insert(rows)
  if (error) console.error("[syncWorkCovers] insert failed", error.message)
}

async function syncWorkSynopses(
  supabase: SupabaseAdminClient,
  workId: string,
  synopses: Array<{ source: string; text: string; isPrimary: boolean }> | undefined
) {
  if (!synopses || synopses.length === 0) return
  await supabase.from("work_synopses").delete().eq("work_id", workId)
  const rows = synopses.map((s, position) => ({
    work_id: workId,
    source: s.source,
    text: s.text,
    is_primary: s.isPrimary,
    position,
  }))
  const primaryIdx = rows.findIndex((r) => r.is_primary)
  if (primaryIdx === -1 && rows.length > 0) rows[0].is_primary = true
  for (let i = 0; i < rows.length; i++) if (i !== primaryIdx && primaryIdx !== -1) rows[i].is_primary = false
  const { error } = await supabase.from("work_synopses").insert(rows)
  if (error) console.error("[syncWorkSynopses] insert failed", error.message)
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
    const tagIdsToAdd: string[] = []
    for (const name of tags) {
      const id = await upsertTag(supabase, name, resolveTagGroupId(name))
      if (id) tagIdsToAdd.push(id)
    }

    const uniqueIdsToAdd = [...new Set(tagIdsToAdd)]
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
    personal_status: getPersonalStatusNameById(work.personal_status_id) ?? "To read",
    publication_status_id: work.publication_status_id ?? null,
    personal_status_id: work.personal_status_id ?? null,
    total_chapters: work.total_chapters ?? null,
    chapters_read: work.chapters_read ?? null,
    synopsis_quality: work.synopsis_quality ?? null,
    observation_adjustment: work.observation_adjustment ?? 0,
    manual_score: work.manual_score ?? null,
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
    ...criterionValues,
  })
}

export interface WorkPreview {
  workId: string
  title: string
  coverUrl: string | null
  synopsis: string | null
  synopsisQuality: string | null
  publicationStatusId: number | null
  observations: string | null
  year: number | null
  platformAvg: number | null
  totalVotes: number
}

export async function getWorkPreview(workId: string): Promise<WorkPreview | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, synopsis_quality,
      publication_status_id, observations, year,
      work_covers(url, is_primary, position),
      work_synopses(source, text, is_primary, position),
      calculated_scores(platform_avg, total_votes)
    `)
    .eq("id", workId)
    .maybeSingle()

  if (error || !data) return null

  const calc = (data as { calculated_scores?: { platform_avg?: number | null; total_votes?: number | null } | null }).calculated_scores
  const covers = (data as { work_covers?: Parameters<typeof pickPrimaryCover>[0] }).work_covers
  const synopses = (data as { work_synopses?: Parameters<typeof pickPrimarySynopsis>[0] }).work_synopses

  return {
    workId: data.id as string,
    title: data.title as string,
    coverUrl: pickPrimaryCover(covers),
    synopsis: pickPrimarySynopsis(synopses),
    synopsisQuality: (data.synopsis_quality as string | null) ?? null,
    publicationStatusId: (data.publication_status_id as number | null) ?? null,
    observations: (data.observations as string | null) ?? null,
    year: (data.year as number | null) ?? null,
    platformAvg: calc?.platform_avg ?? null,
    totalVotes: calc?.total_votes ?? 0,
  }
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
    .select(`
      *,
      category_scores(*),
      platform_ratings(*),
      work_tags(tag_id, tags(*))
    `)
    .ilike("title", normalizedTitle)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data && !error) {
    const { data: originalTitleMatch } = await supabase
      .from("works")
      .select(`
        *,
        category_scores(*),
        platform_ratings(*),
        work_tags(tag_id, tags(*))
      `)
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
      .select(`
        *,
        category_scores(*),
        platform_ratings(*),
        work_tags(tag_id, tags(*))
      `)
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

/**
 * Insere a obra completa no banco (works + category_scores + platform_ratings + tags)
 * mas NÃO dispara o recálculo. Usado tanto pelo fluxo normal quanto pelo batch.
 */
export interface CreateWorkAiMeta {
  inputHash: string
  modelName: string
  promptVersion: string
}

async function persistNewWork(
  values: WorkFormValues,
  aiMeta?: CreateWorkAiMeta
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

  if ((existingWorks ?? []).some((work) => workMatchesAnyName(work, incomingNames))) {
    return { ok: false, error: { title: ["Já existe uma obra com esse título"] } }
  }

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
      personal_status_id:
        data.personal_status_id ?? getPersonalStatusIdByName(data.personal_status),
      total_chapters: data.total_chapters ?? null,
      chapters_read: data.chapters_read ?? null,
      synopsis_quality: data.synopsis_quality ?? null,
      observation_adjustment: data.observation_adjustment,
      manual_score: data.manual_score ?? null,
      post_story_score: data.post_story_score ?? null,
      post_fl_score: data.post_fl_score ?? null,
      post_ml_score: data.post_ml_score ?? null,
      post_character_development_score: data.post_character_development_score ?? null,
      post_pacing_score: data.post_pacing_score ?? null,
      post_art_visual_score: data.post_art_visual_score ?? null,
      post_impact_immersion_score: data.post_impact_immersion_score ?? null,
      post_originality_score: data.post_originality_score ?? null,
      observations: data.observations ?? null,
      ai_eval_status: "pending",
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: { _root: [error.message] } }

  const workId = work.id

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
        summary: "Notas e explicações geradas durante a busca externa do título.",
        confidence: null,
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
  await syncWorkCovers(supabase, workId, data.covers)
  await syncWorkSynopses(supabase, workId, data.synopses)
  await upsertWorkExternalIds(supabase, workId, data.external_ids)

  const hasScores = scores.length >= CRITERION_SLUGS.length
  await supabase
    .from("works")
    .update({ ai_eval_status: hasScores ? "done" : "pending" })
    .eq("id", workId)

  return { ok: true, workId }
}

export async function createWork(values: WorkFormValues, aiMeta?: CreateWorkAiMeta) {
  const result = await persistNewWork(values, aiMeta)
  if (!result.ok) return { error: result.error }

  // Recalcular todos: a média global muda quando um título é adicionado
  try {
    await recalculateAll()
  } catch (error) {
    console.error("[createWork] Failed to recalculate scores", error)
    return {
      error: {
        _root: [
          "Obra criada, mas houve erro ao recalcular as notas. Tente recalcular em Configurações.",
        ],
      },
      data: { id: result.workId },
    }
  }

  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/")
  return { data: { id: result.workId } }
}

/**
 * Versão "batch": insere a obra mas adia o recálculo para finalizePendingBatch().
 * Use quando for adicionar vários títulos em sequência.
 */
export async function createWorkPending(values: WorkFormValues) {
  const result = await persistNewWork(values)
  if (!result.ok) return { error: result.error }

  revalidatePath("/titles")
  revalidatePath("/titles/new")
  return { data: { id: result.workId } }
}

export async function createWorksBatch(values: WorkFormValues[]) {
  if (values.length === 0) {
    return { error: { _root: ["Nenhuma obra para criar"] } }
  }

  const titleCounts = new Map<string, number>()
  for (const value of values) {
    for (const key of getComparableNames(value)) {
      titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
    }
  }

  const duplicatedTitle = [...titleCounts.entries()].find(([, count]) => count > 1)?.[0]
  if (duplicatedTitle) {
    return { error: { title: [`"${duplicatedTitle}" aparece mais de uma vez no lote`] } }
  }

  const created: Array<{ id: string; title: string }> = []
  for (const value of values) {
    const result = await persistNewWork(value)
    if (!result.ok) return { error: result.error, data: { created } }
    created.push({ id: result.workId, title: value.title })
  }

  try {
    await recalculateAll()
  } catch (error) {
    console.error("[createWorksBatch] Failed to recalculate scores", error)
    return {
      error: {
        _root: [
          "Obras criadas, mas houve erro ao recalcular as notas. Tente recalcular em Configurações.",
        ],
      },
      data: { created },
    }
  }

  revalidatePath("/titles")
  revalidatePath("/titles/new")
  revalidatePath("/ranking")
  revalidatePath("/")
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
 * Finaliza o batch: dispara recalculateAll uma única vez.
 */
export async function finalizePendingBatch() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, calculated_scores(id)")
    .eq("is_archived", false)
    .limit(2000)
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = (data ?? []).filter((w: any) => !w.calculated_scores).length

  await recalculateAll()

  revalidatePath("/titles")
  revalidatePath("/titles/new")
  revalidatePath("/ranking")
  revalidatePath("/")
  return { finalized: pending }
}

export async function updateWork(id: string, values: WorkFormValues) {
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data
  const supabase = createAdminClient()
  let knownGenres: Awaited<ReturnType<typeof filterKnownGenres>>
  try {
    knownGenres = await filterKnownGenres(supabase, data.genres ?? [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: { genres: [message] } }
  }

  const { error } = await supabase
    .from("works")
    .update({
      title: data.title,
      original_title: data.original_title ?? null,
      alternative_titles: normalizeTextList(data.alternative_titles ?? []),
      year: data.year ?? null,
      year_end: data.year_end ?? null,
      publication_status_id:
        data.publication_status_id ?? getPublicationStatusIdByName(data.publication_status),
      personal_status_id:
        data.personal_status_id ?? getPersonalStatusIdByName(data.personal_status),
      total_chapters: data.total_chapters ?? null,
      chapters_read: data.chapters_read ?? null,
      synopsis_quality: data.synopsis_quality ?? null,
      observation_adjustment: data.observation_adjustment,
      manual_score: data.manual_score ?? null,
      post_story_score: data.post_story_score ?? null,
      post_fl_score: data.post_fl_score ?? null,
      post_ml_score: data.post_ml_score ?? null,
      post_character_development_score: data.post_character_development_score ?? null,
      post_pacing_score: data.post_pacing_score ?? null,
      post_art_visual_score: data.post_art_visual_score ?? null,
      post_impact_immersion_score: data.post_impact_immersion_score ?? null,
      post_originality_score: data.post_originality_score ?? null,
      observations: data.observations ?? null,
    })
    .eq("id", id)

  if (error) return { error: { _root: [error.message] } }

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

  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    const numericScore = Number(score)
    const prev = existingByCriterion.get(slug)
    const prevSource = prev?.source ?? null
    const wasAi = prevSource === "ai_accepted" || prevSource === "ai_edited"
    const sameValue = prev != null && Number(prev.score) === numericScore
    const source: "manual" | "ai_accepted" | "ai_edited" = wasAi
      ? sameValue
        ? (prevSource as "ai_accepted" | "ai_edited")
        : "ai_edited"
      : "manual"
    return [{
      work_id: id,
      criterion_slug: slug,
      score: numericScore,
      source,
      ai_evaluation_id: wasAi ? prev?.ai_evaluation_id ?? null : null,
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
  await syncWorkCovers(supabase, id, data.covers)
  await syncWorkSynopses(supabase, id, data.synopses)
  await upsertWorkExternalIds(supabase, id, data.external_ids)

  // Atualizar status IA com base na cobertura de critérios
  const hasAllScores = scores.length >= CRITERION_SLUGS.length
  await supabase
    .from("works")
    .update({ ai_eval_status: hasAllScores ? "done" : "pending" })
    .eq("id", id)
    .neq("ai_eval_status", "skipped")

  // Recalcular todos sem bloquear a edição: a média global muda quando qualquer título é alterado,
  // mas esperar a base inteira aqui deixa o formulário preso quando o recálculo demora.
  recalculateAllInBackground("updateWork")

  revalidatePath(`/titles/${id}`)
  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/")
  return { data: { id } }
}

export async function archiveWork(id: string) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ is_archived: true })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/titles")
  revalidatePath("/")
  return { data: null }
}

export async function unarchiveWork(id: string) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ is_archived: false })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath(`/titles/${id}`)
  revalidatePath("/titles")
  return { data: null }
}

export async function updateWorkStatus(id: string, values: WorkStatusValues) {
  const parsed = workStatusSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data
  const supabase = createAdminClient()

  const { error } = await supabase
    .from("works")
    .update({
      personal_status_id:
        getPersonalStatusIdByName(data.personal_status) ?? data.personal_status_id ?? null,
      synopsis_quality: data.synopsis_quality ?? null,
      observation_adjustment: data.observation_adjustment,
      observations: data.observations ?? null,
      chapters_read: data.chapters_read ?? null,
      manual_score: data.manual_score ?? null,
      post_story_score: data.post_story_score ?? null,
      post_fl_score: data.post_fl_score ?? null,
      post_ml_score: data.post_ml_score ?? null,
      post_character_development_score: data.post_character_development_score ?? null,
      post_pacing_score: data.post_pacing_score ?? null,
      post_art_visual_score: data.post_art_visual_score ?? null,
      post_impact_immersion_score: data.post_impact_immersion_score ?? null,
      post_originality_score: data.post_originality_score ?? null,
    })
    .eq("id", id)

  if (error) return { error: { _root: [error.message] } }

  recalculateAllInBackground("updateWorkStatus")

  revalidatePath("/titles/[id]", "page")
  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/")
  return { data: { id } }
}

export async function deleteWork(id: string) {
  const supabase = createAdminClient()
  const { error } = await supabase.from("works").delete().eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/titles")
  revalidatePath("/")
  return { data: null }
}

export interface ExternalWorkUpdate {
  title?: string
  originalTitle?: string | null
  alternativeTitles?: string[]
  synopsis?: string | null
  coverUrl?: string | null
  publicationStatus?: string | null
  totalChapters?: number | null
  genres?: string[]
  tags?: string[]
  platformRatings?: Array<{ platform: string; rating?: number | null; votes?: number | null }>
  externalIds?: Record<string, string>
}

export async function updateWorkExternalData(id: string, updates: ExternalWorkUpdate) {
  try {
    const supabase = createAdminClient()
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

    if (Object.keys(workFields).length > 0) {
      const { error } = await supabase.from("works").update(workFields).eq("id", id)
      if (error) return { error: error.message }
    }

    // synopsis/coverUrl: gravar via work_synopses/work_covers como nova entrada
    // primária (substitui a primária anterior).
    if (typeof updates.synopsis === "string" && updates.synopsis.trim().length > 0) {
      await supabase.from("work_synopses").update({ is_primary: false }).eq("work_id", id)
      await supabase.from("work_synopses").insert({
        work_id: id,
        source: "manual",
        text: updates.synopsis,
        is_primary: true,
        position: 0,
      })
    }
    if (typeof updates.coverUrl === "string" && updates.coverUrl.trim().length > 0) {
      await supabase.from("work_covers").update({ is_primary: false }).eq("work_id", id)
      await supabase.from("work_covers").insert({
        work_id: id,
        url: updates.coverUrl,
        source: "manual",
        is_primary: true,
        position: 0,
      })
    }

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

    recalculateAllInBackground("updateWorkExternalData")
    revalidatePath(`/titles`)
    revalidatePath("/")
    return { data: { id } }
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
  | { ok: false; reason: "NO_IDS" | "ALL_404"; message?: string }

const SUPPORTED_SOURCES: ReadonlySet<ExternalSourceId> = new Set([
  "anilist",
  "mangaupdates",
  "myanimelist",
  "kitsu",
  "mangadex",
  "comick",
  "comix",
  "animeplanet",
])

function buildCandidateFromStoredIds(
  work: { title: string; original_title: string | null; alternative_titles: string[] | null },
  rows: Array<{ source: string; external_id: string }>
): MergedCandidate {
  const sources: ExternalSourceId[] = []
  const trustedSources: ExternalSourceId[] = []
  const candidate: MergedCandidate = {
    title: work.title,
    originalTitle: work.original_title ?? undefined,
    alternativeTitles: work.alternative_titles ?? [],
    sources,
    // Fontes vindas de work_external_ids foram explicitamente vinculadas pelo
    // usuário (no create ou via "Revalidar fontes"). Marcamos como trusted
    // pra bypass o composite check em fetchMultiSourceDetails — caso contrário
    // fontes com título ligeiramente divergente (ex.: MangaUpdates) podem ser
    // descartadas mesmo já tendo sido confirmadas pelo user.
    trustedSources,
  }
  for (const row of rows) {
    const source = row.source as ExternalSourceId
    if (!SUPPORTED_SOURCES.has(source)) continue
    sources.push(source)
    trustedSources.push(source)
    switch (source) {
      case "anilist": {
        const n = Number(row.external_id)
        if (Number.isFinite(n)) candidate.anilistId = n
        break
      }
      case "mangaupdates": {
        const n = Number(row.external_id)
        if (Number.isFinite(n)) candidate.muId = n
        break
      }
      case "myanimelist": {
        const n = Number(row.external_id)
        if (Number.isFinite(n)) candidate.malId = n
        break
      }
      case "kitsu":
        candidate.kitsuId = row.external_id
        break
      case "mangadex":
        candidate.mangadexId = row.external_id
        break
      case "comick":
        candidate.comickHid = row.external_id
        break
      case "comix":
        candidate.comixHid = row.external_id
        break
      case "animeplanet":
        candidate.animePlanetSlug = row.external_id
        break
    }
  }
  return candidate
}

export async function refreshWorkExternalData(workId: string): Promise<RefreshWorkExternalDataResult> {
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
