"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { ensureAdmin } from "@/server/queries/current-user"
import { recomputeAdultAuto } from "@/lib/tags/adult-classify"
import { TAG_GROUP_IDS, TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { GENRE_PROPOSAL_MIN_OCCURRENCES } from "@/lib/tags/genre-proposals"
import { enrichNewTags } from "@/lib/tags/ingest"
import { enrichmentNeedsRecovery } from "@/lib/tags/enrichment-view"
import { loadNewTagsQueue } from "@/server/queries/new-tags-queue"
import { humanDecisionPatches } from "@/server/queries/tag-human-decisions"
import { parseHumanDecisions } from "@/lib/tags/enrichment-view"
import type { HumanDecisionField, HumanDecisions } from "@/lib/tags/enrichment-view"

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
  /** `tags.enrichment_status` — decide se grupo e 18+ desta linha são decisão de alguém. */
  enrichmentStatus: string
  /** Motivo gravado quando a classificação automática não terminou. */
  enrichmentDetail: string | null
  /** Quais campos um HUMANO decidiu, e quando (`tags.human_decisions`, migration 219). */
  humanDecisions: HumanDecisions
}

/**
 * Grava o valor canônico de UMA tag JUNTO com a proveniência humana dos `fields` — um UPDATE só.
 * Decidir um campo não faz a tag inteira virar `curated`: `enrichment_status` continua dizendo o que a
 * AUTOMAÇÃO fez, e `human_decisions` diz, campo a campo, o que um humano decidiu.
 */
async function gravarDecisaoHumana(
  supabase: ReturnType<typeof createAdminClient>,
  tagId: string,
  fields: HumanDecisionField[],
  valores: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const prov = await humanDecisionPatches(supabase, [tagId], fields)
  if (!prov.ok) return { error: prov.error }
  const { error } = await supabase
    .from("tags")
    .update({ ...valores, human_decisions: prov.patches.get(tagId) })
    .eq("id", tagId)
  return { error: error?.message ?? null }
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

/** Ids por requisição na contagem de obras da fila: 100 UUIDs ≈ 4 KB de URL, folgado nos dois gateways. */
const WORK_COUNT_ID_CHUNK = 100

/**
 * A fila "Tags novas": tags de fonte ainda não revisadas ∪ tags de QUALQUER origem cuja classificação
 * automática não terminou (regra em `server/queries/new-tags-queue.ts`, a mesma do contador da aba).
 * 🔴 Erro de leitura LANÇA: devolver `[]` desenharia "Nenhuma tag nova para revisar 🎉" sobre uma
 * falha.
 */
export async function listNewTags(): Promise<NewTagRow[]> {
  const gate = await ensureAdmin()
  if (!gate.ok) return []
  const supabase = createAdminClient()

  const tags = await loadNewTagsQueue(supabase)
  if (!tags.length) return []

  // Obras por tag, com os ids em LOTES: o `.in()` vai na URL do GET, e o gateway recusa URL longa
  // (local: 414 acima de ~8 KB, entre 200 e 300 UUIDs, medido em 2026-10-14; nuvem: 400 acima de
  // ~24 KB, medido em 07/2026). 🔴 Até 2026-10-14 ia a fila inteira num `.in()` só — 1.000 ids, ~39 KB,
  // acima dos dois — e o `error` era IGNORADO: a leitura falhada virava "0 obras" em toda linha.
  // Cada lote pagina com a PK de `work_tags`, e erro agora LANÇA, como o resto da fila.
  const ids = tags.map((t) => t.id)
  const lotes: string[][] = []
  for (let i = 0; i < ids.length; i += WORK_COUNT_ID_CHUNK) lotes.push(ids.slice(i, i + WORK_COUNT_ID_CHUNK))
  const porLote = await Promise.all(
    lotes.map((lote) =>
      fetchAllRows<{ tag_id: string }>(() => supabase.from("work_tags").select("tag_id").in("tag_id", lote), {
        orderBy: ["work_id", "tag_id"],
        label: "fila Tags novas (obras por tag)",
      }),
    ),
  )
  const counts = new Map<string, number>()
  for (const r of porLote.flat()) counts.set(r.tag_id, (counts.get(r.tag_id) ?? 0) + 1)

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
      enrichmentStatus: t.enrichment_status,
      enrichmentDetail: t.enrichment_detail,
      humanDecisions: parseHumanDecisions(t.human_decisions),
    }
  })
}

export type ReprocessTagResult =
  | { ok: true; status: string; detail: string | null }
  | { ok: false; error: string }

/**
 * Reprocessa a classificação automática de UMA tag que não terminou (status em
 * `ENRICHMENT_NEEDS_RECOVERY`), reusando o `enrichNewTags` da ingestão — não há caminho paralelo.
 *
 * 🔴 CHAMADA PAGA (Claude Haiku: classificador de grupo, quando a tag não tem grupo, + enriquecedor).
 * Só por clique do curador, depois do popup de custo do painel; nada aqui é automático, agendado ou
 * em lote. Recusa tag com classificação registrada (`done`, `curated`, `legacy`): não há o que
 * reprocessar, e pagar de novo sobrescreveria uma decisão.
 *
 * Roda SÍNCRONO (não em `after()`): o painel precisa do desfecho real para dizer se concluiu.
 */
export async function reprocessTagEnrichment(tagId: string): Promise<ReprocessTagResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()
  const { data: tag, error } = await supabase
    .from("tags")
    .select("id, enrichment_status")
    .eq("id", tagId)
    .maybeSingle()
  if (error) return { ok: false, error: `não consegui ler a tag (${error.message})` }
  if (!tag) return { ok: false, error: "tag não encontrada" }
  if (!enrichmentNeedsRecovery(tag.enrichment_status as string)) {
    return { ok: false, error: `a classificação desta tag já está registrada (${tag.enrichment_status}); nada a reprocessar` }
  }

  try {
    await enrichNewTags([tagId])
  } catch (err) {
    // Erro de server action vira mensagem genérica no cliente em produção: devolve o motivo.
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const { data: depois, error: depoisErr } = await supabase
    .from("tags")
    .select("enrichment_status, enrichment_detail")
    .eq("id", tagId)
    .maybeSingle()
  revalidatePath("/curation/settings")
  if (depoisErr || !depois) return { ok: false, error: `reprocessado, mas não consegui ler o resultado (${depoisErr?.message ?? "tag sumiu"})` }
  return { ok: true, status: depois.enrichment_status as string, detail: (depois.enrichment_detail as string | null) ?? null }
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
  const { error } = await gravarDecisaoHumana(supabase, tagId, ["adult"], {
    adult_indicator: indicator,
    adult_indicator_strong: strong,
  })
  if (error) {
    console.error("[setTagAdult] falhou", error)
    return { ok: false }
  }
  // Recalcula o gate das obras com essa tag, nos DOIS sentidos: a regra é "≥1 tag forte"
  // (lib/tags/adult-classify.ts), então rebaixar a flag também muda o gate. Antes só recalculava ao
  // subir, porque a regra antiga era monotônica.
  // A tag mais usada do catálogo tem 894 vínculos — abaixo do corte de 1000, mas é o
  // número de HOJE, e truncar aqui deixaria obras sem recomputar o flag 18+.
  const wt = await fetchAllRows<{ work_id: string }>(
    () => supabase.from("work_tags").select("work_id").eq("tag_id", tagId),
    { orderBy: ["work_id", "tag_id"], label: "setTagAdultIndicator.work_tags" },
  )
  const workIds = [...new Set(wt.map((r) => r.work_id))]
  for (const w of workIds) await recomputeAdultAuto(supabase, w)
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
      .order("work_id")
      .order("tag_id")
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
  // A marca `adult_score_tier_reviewed_at` é a MESMA que o enriquecedor grava (é ela que tira a tag da
  // fila "Piso adulto"); quem distingue humano de IA é `human_decisions.adult_score_tier`.
  const { error } = await gravarDecisaoHumana(supabase, tagId, ["adult_score_tier"], {
    adult_score_tier: tier === "none" ? null : tier,
    adult_score_tier_reviewed_at: new Date().toISOString(),
  })
  if (error) {
    console.error("[setTagScoreTier] falhou", error)
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
  const { error } = await gravarDecisaoHumana(supabase, tagId, ["group"], { tag_group_id: groupId })
  if (error) {
    console.error("[changeTagGroup] falhou", error)
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
      () =>
        supabase.from("work_tags").select("work_id").eq("tag_id", tag.id as string),
      { orderBy: ["work_id", "tag_id"], label: "approveGenreProposal.work_tags" },
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
