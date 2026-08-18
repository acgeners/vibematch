import "server-only"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { slugifyTagName } from "@/lib/utils"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"
import { TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import { classifyTagsByGroup } from "@/lib/ai-evaluation/tag-classifier"
import { enrichTagsForGroup } from "@/lib/ai-evaluation/tag-enricher"
import { recomputeAdultAuto } from "@/lib/tags/adult-classify"

type SupabaseAdmin = ReturnType<typeof createAdminClient>

// Confidence below which the ingestion won't even propose a cluster.
const SYNONYM_PROPOSAL_THRESHOLD = 0.85

// ---- Catalog fast-path (nome conhecido → tag_group_id) -------------------

let cachedNameToGroupId: Map<string, string> | null = null
function nameToGroupId(): Map<string, string> {
  if (cachedNameToGroupId) return cachedNameToGroupId
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
  cachedNameToGroupId = map
  return map
}

export function resolveCatalogGroupId(name: string): string | null {
  return nameToGroupId().get(name.trim().toLowerCase()) ?? null
}

// ---- Shared resolution + creation (both ingestion paths) -----------------

// Resolves tag names to ids, creating missing tags. Each incoming slug is first
// resolved through `tag_alias` (historical/external variants → canonical), then
// looked up in `tags`. Missing tags are created with a catalog group (or null,
// for the background enricher to fill). Returns all resolved ids + the ids of
// genuinely newly-created tags.
export async function resolveOrCreateTags(
  supabase: SupabaseAdmin,
  names: string[],
  origin: "manual" | "external" | "ai_inferred" = "manual",
): Promise<{ ids: string[]; createdIds: string[] }> {
  const prepared = names
    .map((name) => ({ name: name.trim(), slug: slugifyTagName(name) }))
    .filter((t) => t.slug !== "")

  const bySlug = new Map<string, { name: string; slug: string }>()
  for (const t of prepared) if (!bySlug.has(t.slug)) bySlug.set(t.slug, t)
  if (bySlug.size === 0) return { ids: [], createdIds: [] }

  const slugs = [...bySlug.keys()]
  const idByInputSlug = new Map<string, string>()

  // 1. Aliases — incoming slug may point to a different canonical tag.
  const { data: aliasRows } = await supabase
    .from("tag_alias")
    .select("alias_slug, canonical_tag_id")
    .in("alias_slug", slugs)
  for (const row of aliasRows ?? []) {
    idByInputSlug.set(row.alias_slug as string, row.canonical_tag_id as string)
  }

  const createdIds: string[] = []
  const slugsToLookup = slugs.filter((s) => !idByInputSlug.has(s))

  if (slugsToLookup.length > 0) {
    // 2. Existing tags by slug.
    const { data: existing, error: selectError } = await supabase
      .from("tags")
      .select("id, slug")
      .in("slug", slugsToLookup)
    if (selectError) {
      console.error("[resolveOrCreateTags] select failed", selectError.message)
    } else {
      for (const row of existing ?? []) idByInputSlug.set(row.slug as string, row.id as string)
    }

    // 3. Create missing.
    const missing = slugsToLookup.filter((s) => !idByInputSlug.has(s))
    if (missing.length > 0) {
      const rows = missing.map((slug) => {
        const t = bySlug.get(slug)!
        return { slug, name: t.name, tag_group_id: resolveCatalogGroupId(t.name), origin }
      })
      const { data: inserted, error: insertError } = await supabase
        .from("tags")
        .upsert(rows, { onConflict: "slug", ignoreDuplicates: false })
        .select("id, slug")
      if (insertError) {
        console.error("[resolveOrCreateTags] insert failed", insertError.message)
      } else {
        for (const row of inserted ?? []) {
          idByInputSlug.set(row.slug as string, row.id as string)
          createdIds.push(row.id as string)
        }
      }
    }
  }

  const ids = slugs.map((s) => idByInputSlug.get(s)).filter((id): id is string => Boolean(id))
  return { ids, createdIds }
}

// ---- Background enrichment ------------------------------------------------

// Schedules group/sub-group/cluster evaluation for newly-created tags, after the
// response is sent (Next `after()`) so it never blocks a work save.
export function scheduleTagEnrichment(createdIds: string[]): void {
  if (createdIds.length === 0) return
  after(async () => {
    try {
      await enrichNewTags(createdIds)
    } catch (err) {
      console.error("[scheduleTagEnrichment] enrichment failed", err)
    }
  })
}

interface NewTagRow {
  id: string
  name: string
  slug: string
  tag_group_id: string | null
}

// For each new tag: ensure a group (AI if missing), assign an approved sub-group
// (applied), and propose a cluster (pending) when it's a near-synonym of an
// existing tag. Non-destructive — never merges.
export async function enrichNewTags(createdIds: string[]): Promise<void> {
  if (createdIds.length === 0) return
  const supabase = createAdminClient()

  const { data: tagsData } = await supabase
    .from("tags")
    .select("id, name, slug, tag_group_id")
    .in("id", createdIds)
  const tags = (tagsData ?? []) as NewTagRow[]
  if (tags.length === 0) return

  // 1. Group classification for tags the catalog couldn't place.
  const ungrouped = tags.filter((t) => !t.tag_group_id)
  if (ungrouped.length > 0) {
    const cls = await classifyTagsByGroup({ tagNames: ungrouped.map((t) => t.name) })
    for (const t of ungrouped) {
      const gid = cls.byName.get(t.name) ?? cls.fallbackGroupId
      t.tag_group_id = gid
      await supabase.from("tags").update({ tag_group_id: gid }).eq("id", t.id)
    }
  }

  // 2. Group by tag_group_id and enrich each group in one AI call.
  const byGroup = new Map<string, NewTagRow[]>()
  for (const t of tags) {
    if (!t.tag_group_id) continue
    const arr = byGroup.get(t.tag_group_id) ?? []
    arr.push(t)
    byGroup.set(t.tag_group_id, arr)
  }
  if (byGroup.size === 0) return

  const { data: groupRows } = await supabase
    .from("tag_group")
    .select("id, slug, group")
    .in("id", [...byGroup.keys()])
  const groupById = new Map((groupRows ?? []).map((g) => [g.id as string, g]))
  const now = new Date().toISOString()
  // Tags que a IA marcou como 18+ nesta rodada — usadas depois pra recomputar o
  // adult_auto das obras que já as carregam (o enriquecimento roda em after()).
  const adultTagIds: string[] = []

  for (const [groupId, groupTags] of byGroup) {
    const g = groupById.get(groupId)
    if (!g) continue
    const groupSlug = g.slug as string

    const [{ data: subs }, { data: existing }] = await Promise.all([
      supabase
        .from("tag_subgroup")
        .select("id, slug, name, description")
        .eq("tag_group_id", groupId)
        .eq("status", "approved"),
      supabase.from("tags").select("id, name, slug, tag_subgroup_id").eq("tag_group_id", groupId),
    ])

    const newIds = new Set(groupTags.map((t) => t.id))
    const existingTags = (existing ?? []).filter((t) => !newIds.has(t.id as string))
    const subBySlug = new Map((subs ?? []).map((s) => [s.slug as string, s]))
    const existingBySlug = new Map(
      existingTags.map((t) => [
        t.slug as string,
        {
          id: t.id as string,
          name: t.name as string,
          slug: t.slug as string,
          subgroupId: (t.tag_subgroup_id as string | null) ?? null,
        },
      ]),
    )

    const result = await enrichTagsForGroup({
      groupSlug,
      groupName: (g.group as string | null) ?? groupSlug,
      newTags: groupTags.map((t) => ({ name: t.name, slug: t.slug })),
      approvedSubgroups: (subs ?? []).map((s) => ({
        slug: s.slug as string,
        name: s.name as string,
        description: (s.description as string | null) ?? null,
      })),
      existingTags: existingTags.map((t) => ({ name: t.name as string, slug: t.slug as string })),
    })

    for (const t of groupTags) {
      const r = result.get(t.name)
      if (!r) continue

      // Sub-group → applied.
      let assignedSubgroupId: string | null = null
      if (r.subgroupSlug && subBySlug.has(r.subgroupSlug)) {
        const sub = subBySlug.get(r.subgroupSlug)!
        assignedSubgroupId = sub.id as string
        await supabase.from("tags").update({ tag_subgroup_id: sub.id }).eq("id", t.id)
        await supabase.from("tag_subgroup_assignment").upsert(
          {
            tag_id: t.id,
            subgroup_id: sub.id as string,
            group_slug: groupSlug,
            confidence: r.confidence,
            status: "applied",
            reviewed_at: now,
            applied_at: now,
          },
          { onConflict: "tag_id" },
        )
      }

      // Cluster (synonym) → pending proposal (never auto-merge). Só propõe se a
      // canônica estiver no MESMO sub-grupo da tag nova (clusters não cruzam
      // sub-grupos).
      const canonical = r.synonymOfSlug ? existingBySlug.get(r.synonymOfSlug) : undefined
      if (
        canonical &&
        canonical.id !== t.id &&
        canonical.subgroupId === assignedSubgroupId &&
        r.confidence >= SYNONYM_PROPOSAL_THRESHOLD
      ) {
        // Dedup: skip if a pending proposal in this group already involves this tag.
        const { data: dup } = await supabase
          .from("tag_cluster_proposal")
          .select("id")
          .eq("group_slug", groupSlug)
          .eq("status", "pending")
          .contains("member_tag_ids", [t.id])
          .limit(1)
        if (!dup || dup.length === 0) {
          await supabase.from("tag_cluster_proposal").insert({
            group_slug: groupSlug,
            canonical_name: canonical.name,
            canonical_slug: canonical.slug,
            member_tag_ids: [canonical.id, t.id],
            confidence: r.confidence,
            rationale: `Tag nova "${t.name}" parece sinônimo de "${canonical.name}" (detectado na ingestão).`,
            status: "pending",
          })
        }
      }

      // 18+: grava adult_indicator/_strong a partir da classificação da IA. Só sobe
      // (nunca desmarca uma tag já flagada pela curadoria). As tags do catálogo já
      // vêm com o flag da semente/migração 161; aqui cobrimos as CRIADAS de fonte.
      if (r.adultLevel !== "none") {
        const strong = r.adultLevel === "explicit"
        await supabase
          .from("tags")
          .update({ adult_indicator: true, ...(strong ? { adult_indicator_strong: true } : {}) })
          .eq("id", t.id)
        adultTagIds.push(t.id)
      }
      // Piso da NOTA adult_content (migração 174) — eixo independente do flag
      // acima; fecha o vazamento estrutural pra tags NOVAS (o rules.ts lê esta
      // coluna, não mais um Set hardcoded no código). Marca reviewed_at mesmo
      // quando a IA decide "none" — sem isso a tag reapareceria pra sempre na
      // fila de revisão manual (server/actions/tag-review.ts).
      await supabase
        .from("tags")
        .update({
          ...(r.adultScoreTier === "explicit" || r.adultScoreTier === "label"
            ? { adult_score_tier: r.adultScoreTier }
            : {}),
          adult_score_tier_reviewed_at: now,
        })
        .eq("id", t.id)
    }
  }

  // Recomputa adult_auto das obras que carregam as tags recém-flagadas como 18+.
  // recomputeAdultAuto é monotônico (só sobe) e best-effort.
  if (adultTagIds.length > 0) {
    // `.in(<N tags>)`: quantas linhas volta depende de quantas tags a rodada marcou como
    // 18+. Uma rodada normal marca poucas, mas o TETO é grande — as 167 tags com indicador
    // adulto de hoje somam 1.614 vínculos, acima do corte de 1000. Truncado, obras ficariam
    // sem recomputar o flag 18+ e nada acusaria.
    const wt = await fetchAllRows<{ work_id: string }>(
      (from, to) =>
        supabase.from("work_tags").select("work_id").in("tag_id", adultTagIds).range(from, to),
      "enrichNewTags.adultWorkTags",
    )
    const workIds = [...new Set(wt.map((r) => r.work_id))]
    for (const workId of workIds) await recomputeAdultAuto(supabase, workId)
  }
}
