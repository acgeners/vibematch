import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId } from "@/server/queries/current-user"
import { getAllTags, getAllTagsUncached } from "@/server/queries/tags"

export type TagStance = "love" | "avoid"
export type TagPrefLevel = "tag" | "subgroup" | "group"

/** Linha crua de user_tag_preferences (uma stance num alvo: tag XOR subgrupo XOR grupo). */
export interface TagPreferenceRow {
  id: string
  level: TagPrefLevel
  /** id do alvo: tags.id | tag_subgroup.id | tag_group.id conforme o level. */
  targetId: string
  stance: TagStance
  weight: number
}

/**
 * Declaração já EXPANDIDA e RESOLVIDA por tag (a forma que o pipeline consome).
 * Uma stance/weight efetivos por tag, depois de aplicar a precedência
 * tag > subgrupo > grupo. `group` é o tag_group_id (mesma representação que as
 * tags das obras carregam no recalc), pra casar com loved/avoided do perfil.
 */
export interface DeclaredTagPref {
  slug: string
  name: string
  group: string | null
  stance: TagStance
  weight: number
  /** Nível de onde a stance veio (o mais específico que cobriu a tag). */
  source: TagPrefLevel
}

interface RawRow {
  id: string
  tag_id: string | null
  tag_subgroup_id: string | null
  tag_group_id: string | null
  stance: TagStance
  weight: number | string
}

function rawToRow(r: RawRow): TagPreferenceRow | null {
  if (r.tag_id) return { id: r.id, level: "tag", targetId: r.tag_id, stance: r.stance, weight: Number(r.weight) }
  if (r.tag_subgroup_id)
    return { id: r.id, level: "subgroup", targetId: r.tag_subgroup_id, stance: r.stance, weight: Number(r.weight) }
  if (r.tag_group_id)
    return { id: r.id, level: "group", targetId: r.tag_group_id, stance: r.stance, weight: Number(r.weight) }
  return null
}

/**
 * Linhas cruas das preferências do usuário atual — pra a UI renderizar os
 * controles 3-estados (amo/neutro/evito) em cada nó da árvore Grupo→Subgrupo→Tag.
 * Não expande nada.
 */
export async function getTagPreferenceRows(
  admin?: ReturnType<typeof createAdminClient>,
): Promise<TagPreferenceRow[]> {
  const supabase = admin ?? createAdminClient()
  const userId = await getCurrentUserId(supabase)
  const { data, error } = await supabase
    .from("user_tag_preferences")
    .select("id, tag_id, tag_subgroup_id, tag_group_id, stance, weight")
    .eq("user_id", userId)
  if (error) {
    console.error("[tag-preferences] erro lendo rows:", error.message)
    return []
  }
  return ((data ?? []) as RawRow[]).map(rawToRow).filter((r): r is TagPreferenceRow => r != null)
}

/**
 * Preferências EXPANDIDAS por tag, com precedência tag > subgrupo > grupo.
 * Consumida pelo recalc (alimenta o prior do perfil via shrinkage) e pela
 * página do ranking (deriva os slugs evitados pro filtro opt-in).
 *
 * Uma declaração de grupo/subgrupo aplica a mesma stance a TODAS as tags-membras;
 * uma tag-específica sobrepõe. Tags órfãs (alvo que não existe mais no catálogo)
 * são silenciosamente ignoradas.
 */
export async function getDeclaredTagPreferences(
  admin?: ReturnType<typeof createAdminClient>,
  opts?: { headless?: boolean },
): Promise<DeclaredTagPref[]> {
  const supabase = admin ?? createAdminClient()
  // Headless (CLI/worker): catálogo de tags via leitura UNCACHED (sem request
  // scope). Runtime Next: wrapper cacheado. Mesma lógica/resultado.
  const loadTags = opts?.headless ? getAllTagsUncached : getAllTags
  const [rows, tags] = await Promise.all([getTagPreferenceRows(supabase), loadTags()])
  if (rows.length === 0) return []

  // Índices do catálogo
  const byTagId = new Map(tags.map((t) => [t.id, t]))
  const bySubgroupId = new Map<string, typeof tags>()
  const byGroupId = new Map<string, typeof tags>()
  for (const t of tags) {
    if (t.tag_subgroup_id) {
      const arr = bySubgroupId.get(t.tag_subgroup_id) ?? []
      arr.push(t)
      bySubgroupId.set(t.tag_subgroup_id, arr)
    }
    if (t.tag_group_id) {
      const arr = byGroupId.get(t.tag_group_id) ?? []
      arr.push(t)
      byGroupId.set(t.tag_group_id, arr)
    }
  }

  // Resolução por precedência: aplica do menos pro mais específico, sobrescrevendo.
  // Mapa por slug da tag → declaração efetiva.
  const effective = new Map<string, DeclaredTagPref>()
  const PRECEDENCE: TagPrefLevel[] = ["group", "subgroup", "tag"]
  const set = (t: (typeof tags)[number], stance: TagStance, weight: number, source: TagPrefLevel) => {
    effective.set(t.slug, { slug: t.slug, name: t.name, group: t.tag_group_id, stance, weight, source })
  }

  for (const level of PRECEDENCE) {
    for (const row of rows) {
      if (row.level !== level) continue
      if (level === "tag") {
        const t = byTagId.get(row.targetId)
        if (t) set(t, row.stance, row.weight, "tag")
      } else if (level === "subgroup") {
        for (const t of bySubgroupId.get(row.targetId) ?? []) set(t, row.stance, row.weight, "subgroup")
      } else {
        for (const t of byGroupId.get(row.targetId) ?? []) set(t, row.stance, row.weight, "group")
      }
    }
  }

  return [...effective.values()]
}
