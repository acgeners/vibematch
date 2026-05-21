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
} from "@/lib/constants/status-lookups"
import {
  dedupeSynopsisEntries,
  pickPrimarySynopsis,
  pickPrimaryCover,
  splitSynopsesFromText,
} from "@/lib/work-derived"
import { recalculateAll } from "./calculations"
import { fetchExternalData } from "./external"
import { buildCandidateFromExternalIds } from "@/lib/external/index"
import type { MergedCandidate, ExternalSourceId, ExternalWorkData, ConflictField } from "@/lib/external/types"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"
import { TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import { slugifyTagName } from "@/lib/utils"
import { titleToSlug } from "@/lib/utils"

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
  after(async () => {
    try {
      await recalculateAll()
    } catch (error) {
      console.error(`[${context}] Failed to recalculate scores`, error)
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

// Resolves a list of tag names to ids in a few queries instead of 3 per tag.
// Returns the ids of tags that exist or were created. Drops names whose slug is empty.
// Each incoming slug is first resolved through `tag_alias` so historical/external
// variants (e.g. snake_case) map to their canonical kebab-case tag.
async function upsertTagsBatch(
  supabase: SupabaseAdminClient,
  names: string[],
): Promise<string[]> {
  const prepared = names
    .map((name) => ({ name: name.trim(), slug: slugifyTagName(name) }))
    .filter((t) => t.slug !== "")

  // Dedupe by slug, keeping first name occurrence.
  const bySlug = new Map<string, { name: string; slug: string }>()
  for (const t of prepared) {
    if (!bySlug.has(t.slug)) bySlug.set(t.slug, t)
  }
  if (bySlug.size === 0) return []

  const slugs = [...bySlug.keys()]

  // Resolve aliases first — incoming slug may point to a different canonical tag.
  const idByInputSlug = new Map<string, string>()
  const { data: aliasRows } = await supabase
    .from("tag_alias")
    .select("alias_slug, canonical_tag_id")
    .in("alias_slug", slugs)
  for (const row of aliasRows ?? []) {
    idByInputSlug.set(row.alias_slug as string, row.canonical_tag_id as string)
  }

  const slugsToLookup = slugs.filter((s) => !idByInputSlug.has(s))

  if (slugsToLookup.length > 0) {
    const { data: existing, error: selectError } = await supabase
      .from("tags").select("id, slug").in("slug", slugsToLookup)
    if (selectError) {
      console.error(`[upsertTagsBatch] select failed`, selectError.message)
      return []
    }
    for (const row of existing ?? []) {
      idByInputSlug.set(row.slug as string, row.id as string)
    }

    const missing = slugsToLookup.filter((s) => !idByInputSlug.has(s))
    if (missing.length > 0) {
      const rows = missing.map((slug) => {
        const t = bySlug.get(slug)!
        return {
          slug,
          name: t.name,
          tag_group_id: resolveTagGroupId(t.name),
        }
      })
      const { data: inserted, error: insertError } = await supabase
        .from("tags")
        .upsert(rows, { onConflict: "slug", ignoreDuplicates: false })
        .select("id, slug")
      if (insertError) {
        console.error(`[upsertTagsBatch] insert failed`, insertError.message)
      } else {
        for (const row of inserted ?? []) {
          idByInputSlug.set(row.slug as string, row.id as string)
        }
      }
    }
  }

  return slugs.map((slug) => idByInputSlug.get(slug)).filter((id): id is string => Boolean(id))
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

  // Zera primária em tudo da obra antes de upsertar, pra não colidir com o
  // índice parcial work_covers_one_primary durante os INSERTs.
  const { error: clearErr } = await supabase
    .from("work_covers")
    .update({ is_primary: false })
    .eq("work_id", workId)
  if (clearErr) return { error: `Falha ao limpar capas primárias: ${clearErr.message}` }

  const { data: existing, error: lookupErr } = await supabase
    .from("work_covers")
    .select("id, url")
    .eq("work_id", workId)
  if (lookupErr) return { error: `Falha ao consultar capas: ${lookupErr.message}` }

  const existingByUrl = new Map((existing ?? []).map((r) => [r.url as string, r.id as string]))

  for (const cover of covers) {
    const isPrimary = cover.url === primaryUrl
    const existingId = existingByUrl.get(cover.url)
    if (existingId) {
      const { error } = await supabase
        .from("work_covers")
        .update({ is_primary: isPrimary, source: cover.source })
        .eq("id", existingId)
      if (error) return { error: `Falha ao atualizar capa: ${error.message}` }
    } else {
      const { error } = await supabase.from("work_covers").insert({
        work_id: workId,
        url: cover.url,
        source: cover.source,
        is_primary: isPrimary,
        position: 0,
      })
      if (error) return { error: `Falha ao inserir capa: ${error.message}` }
    }
  }
  return { error: null }
}

async function syncExternalSynopses(
  supabase: SupabaseAdminClient,
  workId: string,
  synopses: Array<{ text: string; source: string; isPrimary: boolean }>
): Promise<{ error: string | null }> {
  const normalizedSynopses = dedupeSynopsisEntries(synopses)
  if (normalizedSynopses.length === 0) return { error: null }

  const primaryIdx = (() => {
    const idx = normalizedSynopses.findIndex((s) => s.isPrimary)
    return idx === -1 ? 0 : idx
  })()
  const primaryText = normalizedSynopses[primaryIdx].text

  const { error: clearErr } = await supabase
    .from("work_synopses")
    .update({ is_primary: false })
    .eq("work_id", workId)
  if (clearErr) return { error: `Falha ao limpar sinopses primárias: ${clearErr.message}` }

  const { data: existing, error: lookupErr } = await supabase
    .from("work_synopses")
    .select("id, text")
    .eq("work_id", workId)
  if (lookupErr) return { error: `Falha ao consultar sinopses: ${lookupErr.message}` }

  const existingByText = new Map((existing ?? []).map((r) => [r.text as string, r.id as string]))

  for (const synopsis of normalizedSynopses) {
    const isPrimary = synopsis.text === primaryText
    const existingId = existingByText.get(synopsis.text)
    if (existingId) {
      const { error } = await supabase
        .from("work_synopses")
        .update({ is_primary: isPrimary, source: synopsis.source })
        .eq("id", existingId)
      if (error) return { error: `Falha ao atualizar sinopse: ${error.message}` }
    } else {
      const { error } = await supabase.from("work_synopses").insert({
        work_id: workId,
        source: synopsis.source,
        text: synopsis.text,
        is_primary: isPrimary,
        position: 0,
      })
      if (error) return { error: `Falha ao inserir sinopse: ${error.message}` }
    }
  }
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

export async function createWork(values: WorkFormValues, aiMeta?: CreateWorkAiMeta) {
  const result = await persistNewWork(values, aiMeta)
  if (!result.ok) return { error: result.error }
  const slug = titleToSlug(values.title)

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
      data: { id: result.workId, slug },
    }
  }

  revalidatePath("/titles")
  revalidatePath(`/titles/${slug}`)
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/")
  return { data: { id: result.workId, slug } }
}

/**
 * Versão "batch": insere a obra mas adia o recálculo para finalizePendingBatch().
 * Use quando for adicionar vários títulos em sequência.
 */
export async function createWorkPending(values: WorkFormValues) {
  const result = await persistNewWork(values)
  if (!result.ok) return { error: result.error }

  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
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
  revalidateTag("works-slug-index", "max")
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
  revalidateTag("works-slug-index", "max")
  revalidatePath("/titles/new")
  revalidatePath("/ranking")
  revalidatePath("/")
  return { finalized: pending }
}

export async function updateWork(id: string, values: WorkFormValues, aiMeta?: CreateWorkAiMeta) {
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data
  const supabase = createAdminClient()
  const { data: existingWork } = await supabase
    .from("works")
    .select("title")
    .eq("id", id)
    .maybeSingle()
  const previousSlug = existingWork?.title ? titleToSlug(existingWork.title) : null
  const nextSlug = titleToSlug(data.title)
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
        getPublicationStatusIdByName(data.publication_status) ?? data.publication_status_id ?? null,
      personal_status_id:
        getPersonalStatusIdByName(data.personal_status) ?? data.personal_status_id ?? null,
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
        summary: "Notas e explicações geradas durante a busca externa do título.",
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

  // Recalcular todos sem bloquear a edição: a média global muda quando qualquer título é alterado,
  // mas esperar a base inteira aqui deixa o formulário preso quando o recálculo demora.
  recalculateAllInBackground("updateWork")

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
  return { data: { id, slug: nextSlug } }
}

export async function archiveWork(id: string) {
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
  revalidateTag("works-slug-index", "max")
  revalidateTag("score-color-thresholds", "max")
  return { data: null }
}

export async function toggleFavorite(id: string, isFavorite: boolean) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ is_favorite: isFavorite })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath(`/titles/${id}`)
  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidateTag("works-slug-index", "max")
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
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidatePath("/")
  return { data: { id } }
}

export async function deleteWork(id: string) {
  const supabase = createAdminClient()
  const { error } = await supabase.from("works").delete().eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/titles")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/")
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
}

export async function updateWorkExternalData(id: string, updates: ExternalWorkUpdate) {
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

    if (Object.keys(workFields).length > 0) {
      const { error } = await supabase.from("works").update(workFields).eq("id", id)
      if (error) return { error: error.message }
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

    if (updates.synopses !== undefined) {
      const result = await syncExternalSynopses(supabase, id, updates.synopses)
      if (result.error) return { error: result.error }
    } else if (typeof updates.synopsis === "string" && updates.synopsis.trim().length > 0) {
      const result = await syncExternalSynopses(supabase, id, [
        { text: updates.synopsis, source: "manual", isPrimary: true },
      ])
      if (result.error) return { error: result.error }
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
  | { ok: false; reason: "NO_IDS" | "ALL_404"; message?: string }

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
