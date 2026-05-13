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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncWorkTags(supabase: any, workId: string, tagNames: string[]) {
  await supabase.from("work_tags").delete().eq("work_id", workId)
  if (tagNames.length === 0) return

  const tagIds: string[] = []
  for (const name of tagNames) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    if (!slug) continue

    const { data: existing } = await supabase
      .from("tags")
      .select("id")
      .eq("slug", slug)
      .maybeSingle()

    if (existing) {
      tagIds.push(existing.id)
    } else {
      const { data: created } = await supabase
        .from("tags")
        .insert({ slug, name: name.trim() })
        .select("id")
        .single()
      if (created) tagIds.push(created.id)
    }
  }

  if (tagIds.length > 0) {
    await supabase
      .from("work_tags")
      .insert(tagIds.map((tag_id) => ({ work_id: workId, tag_id })))
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
      genres: data.genres ?? [],
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

  await syncWorkTags(supabase, workId, [...(data.genres ?? []), ...(data.tags ?? [])])

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

  const { error } = await supabase
    .from("works")
    .update({
      title: data.title,
      original_title: data.original_title ?? null,
      alternative_titles: normalizeTextList(data.alternative_titles ?? []),
      synopsis: data.synopsis ?? null,
      genres: data.genres ?? [],
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
  await syncWorkTags(supabase, id, [...(data.genres ?? []), ...(data.tags ?? [])])

  // Atualizar status IA com base na cobertura de critérios
  const hasAllScores = scores.length >= CRITERION_SLUGS.length
  await supabase
    .from("works")
    .update({ ai_eval_status: hasAllScores ? "done" : "pending" })
    .eq("id", id)
    .neq("ai_eval_status", "skipped")

  // Recalcular todos: a média global muda quando qualquer título é alterado
  await recalculateAll()

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
