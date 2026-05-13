"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { workFormSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import { recalculateWork } from "./calculations"

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

export async function createWork(values: WorkFormValues) {
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data
  const supabase = await createClient()

  // Verificar duplicata
  const { data: existing } = await supabase
    .from("works")
    .select("id")
    .ilike("title", data.title)
    .maybeSingle()

  if (existing) {
    return { error: { title: ["Já existe uma obra com esse título"] } }
  }

  const { data: work, error } = await supabase
    .from("works")
    .insert({
      title: data.title,
      original_title: data.original_title ?? null,
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
      cover_url: data.cover_url || null,
      observations: data.observations ?? null,
      ai_eval_status: "pending",
    })
    .select("id")
    .single()

  if (error) return { error: { _root: [error.message] } }

  const workId = work.id

  // Salvar notas por critério
  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    return [{ work_id: workId, criterion_slug: slug, score: Number(score), source: "manual" }]
  })

  if (scores.length > 0) {
    await supabase.from("category_scores").insert(scores)
  }

  // Salvar plataformas
  const platforms = [
    { platform: "mangaupdates", rating: data.mu_rating, votes: data.mu_votes },
    { platform: "animeplanet", rating: data.ap_rating, votes: data.ap_votes },
    { platform: "comick", rating: data.cmx_rating, votes: data.cmx_votes },
  ].filter((p) => p.rating != null || (p.votes != null && p.votes > 0))

  if (platforms.length > 0) {
    await supabase.from("platform_ratings").insert(
      platforms.map((p) => ({
        work_id: workId,
        platform: p.platform,
        rating: p.rating ?? null,
        vote_count: p.votes ?? 0,
      }))
    )
  }

  // Salvar tags
  await syncWorkTags(supabase, workId, data.tags ?? [])

  // Atualizar status de IA
  const hasScores = scores.length >= CRITERION_SLUGS.length
  await supabase
    .from("works")
    .update({ ai_eval_status: hasScores ? "done" : "pending" })
    .eq("id", workId)

  // Calcular e salvar scores
  await recalculateWork(workId)

  revalidatePath("/titles")
  revalidatePath("/")
  return { data: { id: workId } }
}

export async function updateWork(id: string, values: WorkFormValues) {
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data
  const supabase = await createClient()

  const { error } = await supabase
    .from("works")
    .update({
      title: data.title,
      original_title: data.original_title ?? null,
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
      cover_url: data.cover_url || null,
      observations: data.observations ?? null,
    })
    .eq("id", id)

  if (error) return { error: { _root: [error.message] } }

  // Upsert notas por critério
  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    return [{ work_id: id, criterion_slug: slug, score: Number(score), source: "manual" as const }]
  })

  if (scores.length > 0) {
    await supabase
      .from("category_scores")
      .upsert(scores, { onConflict: "work_id,criterion_slug" })
  }

  // Upsert plataformas
  const platforms = [
    { platform: "mangaupdates", rating: data.mu_rating, votes: data.mu_votes },
    { platform: "animeplanet", rating: data.ap_rating, votes: data.ap_votes },
    { platform: "comick", rating: data.cmx_rating, votes: data.cmx_votes },
  ].filter((p) => p.rating != null || (p.votes != null && p.votes > 0))

  if (platforms.length > 0) {
    await supabase
      .from("platform_ratings")
      .upsert(
        platforms.map((p) => ({
          work_id: id,
          platform: p.platform,
          rating: p.rating ?? null,
          vote_count: p.votes ?? 0,
        })),
        { onConflict: "work_id,platform" }
      )
  }

  // Salvar tags
  await syncWorkTags(supabase, id, data.tags ?? [])

  // Atualizar status IA
  const hasAllScores = scores.length >= CRITERION_SLUGS.length
  if (hasAllScores) {
    await supabase
      .from("works")
      .update({ ai_eval_status: "done" })
      .eq("id", id)
      .eq("ai_eval_status", "pending")
  }

  revalidatePath(`/titles/${id}`)
  revalidatePath("/titles")
  revalidatePath("/")
  return { data: { id } }
}

export async function archiveWork(id: string) {
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
  const { error } = await supabase.from("works").delete().eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/titles")
  revalidatePath("/")
  return { data: null }
}
