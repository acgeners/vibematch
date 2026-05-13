"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { workFormSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  PERSONAL_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
} from "@/lib/constants/criteria"
import { recalculateAll } from "./calculations"
import { GENRE_TAG_GROUP_ID, TAG_GROUP_IDS } from "@/lib/constants/tag-groups"
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

type GenreJoinRow = {
  id?: string | null
  tag_id?: string | null
  tags?: { name?: string | null } | null
}

async function fetchGenreCatalog(supabase: SupabaseAdminClient): Promise<GenreCatalogEntry[]> {
  const { data, error } = await supabase
    .from("genres")
    .select("id, tag_id, tags(name)")
    .limit(10000)

  if (!error && data) {
    return (data as GenreJoinRow[])
      .flatMap((row) => {
        const name = row.tags?.name?.trim()
        return name ? [{ id: row.id ?? null, tagId: row.tag_id ?? null, name }] : []
      })
  }

  const { data: tagRows, error: tagError } = await supabase
    .from("tags")
    .select("id, name")
    .eq("tag_group_id", GENRE_TAG_GROUP_ID)
    .limit(10000)

  if (tagError) throw new Error(`Erro ao validar gêneros: ${tagError.message}`)

  return (tagRows ?? []).flatMap((tag) => {
    const name = tag.name?.trim()
    return name ? [{ id: null, tagId: tag.id, name }] : []
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

function normalizePublicationStatusForForm(value: string | null | undefined): WorkFormValues["publication_status"] {
  const normalized = value ? PUBLICATION_STATUS_LABELS[value] ?? value : null
  switch (normalized) {
    case "C":
    case "CMP":
    case "Completed":
      return "Completed"
    case "O":
    case "ONG":
    case "Ongoing":
      return "Ongoing"
    case "H":
    case "HIA":
    case "Hiatus":
      return "Hiatus"
    case "D":
    case "CXL":
    case "Cancelled":
      return "Cancelled"
    default:
      return "Unknown"
  }
}

function normalizePersonalStatusForForm(value: string | null | undefined): WorkFormValues["personal_status"] {
  const normalized = value ? PERSONAL_STATUS_LABELS[value] ?? value : null
  switch (normalized) {
    case "Completed":
      return "Completed"
    case "Reading":
      return "Reading"
    case "Started":
      return "Started"
    case "Stalled":
      return "Stalled"
    case "Paused":
      return "Paused"
    case "Hiatus":
      return "Hiatus"
    case "On-hold":
      return "On-hold"
    case "Dropped":
      return "Dropped"
    default:
      return "To read"
  }
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
  genres: string[],
  tags: string[],
  knownGenreTagIds: string[] = []
) {
  await supabase.from("work_tags").delete().eq("work_id", workId)

  const tagIds: string[] = [...knownGenreTagIds]
  for (const name of genres) {
    if (knownGenreTagIds.length > 0) continue
    const id = await upsertTag(supabase, name, GENRE_TAG_GROUP_ID)
    if (id) tagIds.push(id)
  }
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

// Adds external genres/tags without deleting existing work_tags.
// Data entered manually (not returned by external search) is preserved.
async function syncWorkTagsPartial(
  supabase: SupabaseAdminClient,
  workId: string,
  genres: string[] | undefined,
  tags: string[] | undefined,
  knownGenreTagIds: string[] = [],
  knownGenreIds: string[] = []
) {
  if (genres === undefined && tags === undefined) return

  const tagIdsToAdd: string[] = [...knownGenreTagIds]
  if (genres !== undefined) {
    for (const name of genres) {
      if (knownGenreTagIds.length > 0) continue
      const id = await upsertTag(supabase, name, GENRE_TAG_GROUP_ID)
      if (id) tagIdsToAdd.push(id)
    }
  }
  if (tags !== undefined) {
    for (const name of tags) {
      const id = await upsertTag(supabase, name, resolveTagGroupId(name))
      if (id) tagIdsToAdd.push(id)
    }
  }

  const uniqueIdsToAdd = [...new Set(tagIdsToAdd)]
  if (uniqueIdsToAdd.length === 0) return

  // Only insert work_tags that don't already exist
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

  const criterionValues = Object.fromEntries(
    CRITERION_SLUGS.map((slug) => [slug, scoreMap[slug] ?? null])
  )

  return workFormSchema.parse({
    title: work.title,
    original_title: work.original_title ?? "",
    alternative_titles: work.alternative_titles ?? [],
    synopsis: work.synopsis ?? "",
    genres: work.genres ?? [],
    tags,
    year: work.year ?? null,
    year_end: work.year_end ?? null,
    publication_status: normalizePublicationStatusForForm(work.publication_status),
    personal_status: normalizePersonalStatusForForm(work.personal_status),
    total_chapters: work.total_chapters ?? null,
    chapters_read: work.chapters_read ?? null,
    synopsis_quality: work.synopsis_quality ?? null,
    observation_penalty: work.observation_penalty ?? 0,
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
    cover_url: work.cover_url ?? "",
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
async function persistNewWork(values: WorkFormValues): Promise<
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
      synopsis: data.synopsis ?? null,
      genres: knownGenres.names,
      year: data.year ?? null,
      year_end: data.year_end ?? null,
      publication_status: data.publication_status,
      personal_status: data.personal_status,
      total_chapters: data.total_chapters ?? null,
      chapters_read: data.chapters_read ?? null,
      synopsis_quality: data.synopsis_quality ?? null,
      observation_penalty: data.observation_penalty,
      manual_score: data.manual_score ?? null,
      post_story_score: data.post_story_score ?? null,
      post_fl_score: data.post_fl_score ?? null,
      post_ml_score: data.post_ml_score ?? null,
      post_character_development_score: data.post_character_development_score ?? null,
      post_pacing_score: data.post_pacing_score ?? null,
      post_art_visual_score: data.post_art_visual_score ?? null,
      post_impact_immersion_score: data.post_impact_immersion_score ?? null,
      post_originality_score: data.post_originality_score ?? null,
      cover_url: data.cover_url || null,
      observations: data.observations ?? null,
      ai_eval_status: "pending",
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: { _root: [error.message] } }

  const workId = work.id

  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    return [{ work_id: workId, criterion_slug: slug, score: Number(score), source: "manual" }]
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

  await syncWorkTags(supabase, workId, knownGenres.names, data.tags ?? [], knownGenres.tagIds)
  await syncWorkGenres(supabase, workId, knownGenres.genreIds, "replace")

  const aiJustifications = data.ai_justifications ?? {}
  const aiJustificationEntries = Object.entries(aiJustifications)
    .filter(([, justification]) => justification?.trim())
  if (aiJustificationEntries.length > 0) {
    const { data: evaluation } = await supabase
      .from("ai_evaluations")
      .insert({
        work_id: workId,
        status: "completed",
        model_name: "external-ai-criteria",
        prompt_version: "external-import",
        summary: "Notas e explicações geradas durante a busca externa do título.",
        confidence: null,
        raw_response: { criteriaJustifications: aiJustifications },
      })
      .select("id")
      .single()

    if (evaluation) {
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

  const hasScores = scores.length >= CRITERION_SLUGS.length
  await supabase
    .from("works")
    .update({ ai_eval_status: hasScores ? "done" : "pending" })
    .eq("id", workId)

  return { ok: true, workId }
}

export async function createWork(values: WorkFormValues) {
  const result = await persistNewWork(values)
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
      synopsis: data.synopsis ?? null,
      genres: knownGenres.names,
      year: data.year ?? null,
      year_end: data.year_end ?? null,
      publication_status: data.publication_status,
      personal_status: data.personal_status,
      total_chapters: data.total_chapters ?? null,
      chapters_read: data.chapters_read ?? null,
      synopsis_quality: data.synopsis_quality ?? null,
      observation_penalty: data.observation_penalty,
      manual_score: data.manual_score ?? null,
      post_story_score: data.post_story_score ?? null,
      post_fl_score: data.post_fl_score ?? null,
      post_ml_score: data.post_ml_score ?? null,
      post_character_development_score: data.post_character_development_score ?? null,
      post_pacing_score: data.post_pacing_score ?? null,
      post_art_visual_score: data.post_art_visual_score ?? null,
      post_impact_immersion_score: data.post_impact_immersion_score ?? null,
      post_originality_score: data.post_originality_score ?? null,
      cover_url: data.cover_url || null,
      observations: data.observations ?? null,
    })
    .eq("id", id)

  if (error) return { error: { _root: [error.message] } }

  // Sincronizar notas por critério: upsert presentes, deletar removidos
  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    return [{ work_id: id, criterion_slug: slug, score: Number(score), source: "manual" as const }]
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
  await syncWorkTags(supabase, id, knownGenres.names, data.tags ?? [], knownGenres.tagIds)
  await syncWorkGenres(supabase, id, knownGenres.genreIds, "replace")

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
    if (updates.synopsis !== undefined) workFields.synopsis = updates.synopsis ?? null
    if (updates.coverUrl !== undefined) workFields.cover_url = updates.coverUrl ?? null
    if (updates.publicationStatus !== undefined) workFields.publication_status = updates.publicationStatus ?? null
    if (updates.totalChapters !== undefined) workFields.total_chapters = updates.totalChapters ?? null
    if (knownGenres) workFields.genres = knownGenres.names

    if (Object.keys(workFields).length > 0) {
      const { error } = await supabase.from("works").update(workFields).eq("id", id)
      if (error) return { error: error.message }
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

    if (updates.genres !== undefined || updates.tags !== undefined) {
      await syncWorkTagsPartial(
        supabase,
        id,
        knownGenres?.names,
        updates.tags,
        knownGenres?.tagIds ?? [],
        knownGenres?.genreIds ?? []
      )
    }

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
