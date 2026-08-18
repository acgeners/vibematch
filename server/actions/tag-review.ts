"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { ensureAdmin } from "@/server/queries/current-user"
import { recomputeAdultAuto } from "@/lib/tags/adult-classify"
import { TAG_GROUP_IDS, TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { GENRE_PROPOSAL_MIN_OCCURRENCES } from "@/lib/tags/genre-proposals"

// ============================================================
// Revisão de tags/gêneros criados automaticamente das fontes (mig 165).
// Alimenta as abas "Tags novas" e "Gêneros propostos" da Consolidação.
// Todas as ações são admin-only (catálogo compartilhado, service role).
// ============================================================

export type AdultLevel = "none" | "label" | "explicit"

export interface NewTagRow {
  id: string
  name: string
  slug: string
  groupSlug: string
  groupLabel: string
  adultLevel: AdultLevel
  origin: string
  createdAt: string
  workCount: number
}

export interface GenreProposalRow {
  id: string
  rawName: string
  slug: string
  occurrences: number
  status: string
  isAdultTag: boolean
  sampleTitles: string[]
}

function adultLevelOf(indicator: boolean, strong: boolean): AdultLevel {
  return strong ? "explicit" : indicator ? "label" : "none"
}

// ---- Tags novas ----------------------------------------------------------

/** Tags criadas de fonte e ainda não revisadas (origin='external' ∧ reviewed_at null). */
export async function listNewTags(): Promise<NewTagRow[]> {
  const gate = await ensureAdmin()
  if (!gate.ok) return []
  const supabase = createAdminClient()

  const { data: tags, error } = await supabase
    .from("tags")
    .select("id, name, slug, tag_group_id, adult_indicator, adult_indicator_strong, origin, created_at")
    .eq("origin", "external")
    .is("reviewed_at", null)
    .order("created_at", { ascending: false })
    .limit(2000)
  if (error) {
    console.error("[listNewTags] falhou", error.message)
    return []
  }
  if (!tags?.length) return []

  // Contagem de obras por tag (dedup em JS — a fila de pendentes é pequena).
  const ids = tags.map((t) => t.id as string)
  const counts = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("work_tags")
      .select("tag_id")
      .in("tag_id", ids)
      .range(from, from + 999)
    for (const r of data ?? []) counts.set(r.tag_id as string, (counts.get(r.tag_id as string) ?? 0) + 1)
    if (!data || data.length < 1000) break
  }

  return tags.map((t) => {
    const groupSlug = t.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id as string] ?? "") : ""
    return {
      id: t.id as string,
      name: t.name as string,
      slug: t.slug as string,
      groupSlug,
      groupLabel: groupSlug ? (TAG_GROUP_LABELS[groupSlug as TagGroupSlug] ?? groupSlug) : "",
      adultLevel: adultLevelOf(t.adult_indicator as boolean, t.adult_indicator_strong as boolean),
      origin: t.origin as string,
      createdAt: t.created_at as string,
      workCount: counts.get(t.id as string) ?? 0,
    }
  })
}

/** Marca tags como revisadas (saem da fila). */
export async function confirmNewTags(tagIds: string[]): Promise<{ ok: boolean }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false }
  if (!tagIds.length) return { ok: true }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tags")
    .update({ reviewed_at: new Date().toISOString() })
    .in("id", tagIds)
  if (error) {
    console.error("[confirmNewTags] falhou", error.message)
    return { ok: false }
  }
  revalidatePath("/curation/settings")
  return { ok: true }
}

/** Ajusta o sinal 18+ de uma tag e recomputa o adult_auto das obras que a carregam. */
export async function setTagAdult(tagId: string, level: AdultLevel): Promise<{ ok: boolean }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false }
  const supabase = createAdminClient()
  const indicator = level !== "none"
  const strong = level === "explicit"
  const { error } = await supabase
    .from("tags")
    .update({ adult_indicator: indicator, adult_indicator_strong: strong })
    .eq("id", tagId)
  if (error) {
    console.error("[setTagAdult] falhou", error.message)
    return { ok: false }
  }
  // Recomputa adult_auto (monotônico) das obras com essa tag.
  if (indicator) {
    // A tag mais usada do catálogo tem 894 vínculos — abaixo do corte de 1000, mas é o
    // número de HOJE, e truncar aqui deixaria obras sem recomputar o flag 18+.
    const wt = await fetchAllRows<{ work_id: string }>(
      (from, to) => supabase.from("work_tags").select("work_id").eq("tag_id", tagId).range(from, to),
      "setTagAdultIndicator.work_tags",
    )
    const workIds = [...new Set(wt.map((r) => r.work_id))]
    for (const w of workIds) await recomputeAdultAuto(supabase, w)
  }
  revalidatePath("/curation/settings")
  return { ok: true }
}

export type AdultScoreTier = "none" | "label" | "explicit"

export interface AdultScoreTierBacklogRow {
  id: string
  name: string
  /** Nível atual do FLAG is_adult (contexto — o eixo que este ajuste NÃO mexe). */
  adultLevel: AdultLevel
  workCount: number
  sampleTitles: string[]
}

/**
 * Tags que já contam pro flag `is_adult` (adult_indicator) mas nunca foram
 * avaliadas no eixo do PISO da nota `adult_content` (migração 174) — inclui tanto
 * o backlog pré-existente (tags seedadas antes da migração 174 existir) quanto
 * qualquer tag futura que escape do enricher automático. Critério de saída da
 * fila é `adult_score_tier_reviewed_at`, não `adult_score_tier` (que pode ficar
 * NULL de propósito quando a decisão é "sem piso").
 */
export async function listAdultScoreTierBacklog(): Promise<AdultScoreTierBacklogRow[]> {
  const gate = await ensureAdmin()
  if (!gate.ok) return []
  const supabase = createAdminClient()

  const { data: tags, error } = await supabase
    .from("tags")
    .select("id, name, adult_indicator, adult_indicator_strong")
    .eq("adult_indicator", true)
    .is("adult_score_tier_reviewed_at", null)
    .order("name", { ascending: true })
  if (error) {
    console.error("[listAdultScoreTierBacklog] falhou", error.message)
    return []
  }
  if (!tags?.length) return []

  const ids = tags.map((t) => t.id as string)
  const counts = new Map<string, number>()
  const samplesByTag = new Map<string, string[]>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("work_tags")
      .select("tag_id, works(title)")
      .in("tag_id", ids)
      .range(from, from + 999)
    for (const r of (data ?? []) as Array<{ tag_id: string; works: { title?: string } | null }>) {
      counts.set(r.tag_id, (counts.get(r.tag_id) ?? 0) + 1)
      const title = r.works?.title
      if (title) {
        const samples = samplesByTag.get(r.tag_id) ?? []
        if (samples.length < 3) samples.push(title)
        samplesByTag.set(r.tag_id, samples)
      }
    }
    if (!data || data.length < 1000) break
  }

  return tags
    .map((t) => ({
      id: t.id as string,
      name: t.name as string,
      adultLevel: adultLevelOf(t.adult_indicator as boolean, t.adult_indicator_strong as boolean),
      workCount: counts.get(t.id as string) ?? 0,
      sampleTitles: samplesByTag.get(t.id as string) ?? [],
    }))
    .sort((a, b) => b.workCount - a.workCount)
}

/**
 * Decide o piso de `adult_content` da tag (eixo independente de setTagAdult). Marca
 * `adult_score_tier_reviewed_at` mesmo quando `tier="none"` — é essa marca, não o
 * valor do tier, que tira a tag da fila (ver listAdultScoreTierBacklog).
 */
export async function setTagScoreTier(tagId: string, tier: AdultScoreTier): Promise<{ ok: boolean }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("tags")
    .update({
      adult_score_tier: tier === "none" ? null : tier,
      adult_score_tier_reviewed_at: new Date().toISOString(),
    })
    .eq("id", tagId)
  if (error) {
    console.error("[setTagScoreTier] falhou", error.message)
    return { ok: false }
  }
  revalidatePath("/curation/settings")
  return { ok: true }
}

/** Troca o grupo de uma tag (quando a IA errou a classificação). */
export async function changeTagGroup(tagId: string, groupSlug: string): Promise<{ ok: boolean }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false }
  const groupId = (TAG_GROUP_IDS as Record<string, string>)[groupSlug]
  if (!groupId) return { ok: false }
  const supabase = createAdminClient()
  const { error } = await supabase.from("tags").update({ tag_group_id: groupId }).eq("id", tagId)
  if (error) {
    console.error("[changeTagGroup] falhou", error.message)
    return { ok: false }
  }
  revalidatePath("/curation/settings")
  return { ok: true }
}

// ---- Gêneros propostos ---------------------------------------------------

export async function listGenreProposals(
  status: "pending" | "approved" | "rejected" = "pending",
): Promise<GenreProposalRow[]> {
  const gate = await ensureAdmin()
  if (!gate.ok) return []
  const supabase = createAdminClient()

  let query = supabase
    .from("genre_proposal")
    .select("id, raw_name, slug, occurrences, status, sample_work_ids")
    .eq("status", status)
    .order("occurrences", { ascending: false })
    .limit(1000)
  // Pendentes: só mostra as que recorreram o bastante (esconde ruído de tag fina).
  if (status === "pending") query = query.gte("occurrences", GENRE_PROPOSAL_MIN_OCCURRENCES)
  const { data: props, error } = await query
  if (error) {
    console.error("[listGenreProposals] falhou", error.message)
    return []
  }
  if (!props?.length) return []

  // A tag homônima é 18+? (mostra o aviso "não altera o sinal 18+" no card)
  const slugs = props.map((p) => p.slug as string)
  const { data: tags } = await supabase
    .from("tags")
    .select("slug, adult_indicator")
    .in("slug", slugs)
  const adultBySlug = new Map((tags ?? []).map((t) => [t.slug as string, t.adult_indicator as boolean]))

  // Amostra de títulos.
  const allSampleIds = [...new Set(props.flatMap((p) => (p.sample_work_ids as string[]) ?? []))]
  const titleById = new Map<string, string>()
  if (allSampleIds.length) {
    const { data: works } = await supabase.from("works").select("id, title").in("id", allSampleIds)
    for (const w of works ?? []) titleById.set(w.id as string, w.title as string)
  }

  return props.map((p) => ({
    id: p.id as string,
    rawName: p.raw_name as string,
    slug: p.slug as string,
    occurrences: p.occurrences as number,
    status: p.status as string,
    isAdultTag: adultBySlug.get(p.slug as string) ?? false,
    sampleTitles: ((p.sample_work_ids as string[]) ?? [])
      .map((id) => titleById.get(id))
      .filter((t): t is string => Boolean(t))
      .slice(0, 3),
  }))
}

/**
 * Promove um candidato a gênero (NÃO-destrutivo): cria a linha em `genres` e
 * popula `work_genres` para as obras que já carregam a tag homônima. A TAG é
 * MANTIDA — apagá-la perderia o sinal 18+ dela e é irreversível num banco sem
 * backup. A pequena redundância (conceito como tag E gênero) é aceitável.
 * Rodar `npm run sync-constants` depois pra o gênero entrar no roteamento da criação.
 */
export async function approveGenreProposal(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()

  const { data: prop } = await supabase
    .from("genre_proposal")
    .select("id, raw_name, slug, status")
    .eq("id", id)
    .maybeSingle()
  if (!prop) return { ok: false, error: "proposta não encontrada" }
  if (prop.status !== "pending") return { ok: false, error: "proposta já resolvida" }

  // 1) cria/pega o gênero.
  await supabase
    .from("genres")
    .upsert({ name: prop.raw_name as string, slug: prop.slug as string }, { onConflict: "slug", ignoreDuplicates: true })
  const { data: genre } = await supabase.from("genres").select("id").eq("slug", prop.slug as string).maybeSingle()
  if (!genre) return { ok: false, error: "falha ao criar gênero" }

  // 2) obras com a tag homônima → work_genres.
  const { data: tag } = await supabase.from("tags").select("id").eq("slug", prop.slug as string).maybeSingle()
  if (tag) {
    const wt = await fetchAllRows<{ work_id: string }>(
      (from, to) =>
        supabase.from("work_tags").select("work_id").eq("tag_id", tag.id as string).range(from, to),
      "approveGenreProposal.work_tags",
    )
    const rows = [...new Set(wt.map((r) => r.work_id))].map((work_id) => ({
      work_id,
      genre_id: genre.id as string,
    }))
    if (rows.length) {
      await supabase.from("work_genres").upsert(rows, { onConflict: "work_id,genre_id", ignoreDuplicates: true })
    }
  }

  await supabase
    .from("genre_proposal")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
  revalidatePath("/curation/settings")
  revalidatePath("/ranking")
  return { ok: true }
}

/** Rejeita: mantém como tag (não vira gênero), tira da fila. */
export async function rejectGenreProposal(id: string): Promise<{ ok: boolean }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("genre_proposal")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) {
    console.error("[rejectGenreProposal] falhou", error.message)
    return { ok: false }
  }
  revalidatePath("/curation/settings")
  return { ok: true }
}
