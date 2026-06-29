/**
 * Segmentação de tags de obra pra exibição, na ordem pedida pelo usuário:
 *   1. Categorias (gêneros) — tratadas pela tela (vêm de `work.genres`)
 *   2. Amadas — tags que casam com o gosto (perfil ∪ preferências declaradas)
 *   3. Evitadas — idem
 *   4. Resto — agrupamento padrão (tag_group → sub-grupo)
 *
 * Sem duplicar: cada tag entra em UMA seção, com precedência
 * Categoria > Amada > Evitada > Resto (a exclusão de Categorias é feita via
 * `excludeNames`). Preferências declaradas (explícitas) têm precedência sobre o
 * perfil (inferido). Helper PURO — usável em server e client.
 */

export type TagStance = "love" | "avoid"

export interface TagStanceLookup {
  /** Stance declarada pelo usuário, por slug de tag (precede o perfil). */
  bySlug: Map<string, TagStance>
  /** Stance do perfil de gosto, por nome em minúsculas. */
  byName: Map<string, TagStance>
}

/**
 * Monta o lookup unindo preferências declaradas (por slug) com o perfil de gosto
 * (loved_tags/avoided_tags, por nome). `avoided` é setado antes de `loved` no
 * mapa por nome pra que, em conflito raro, "amada" prevaleça.
 */
export function buildTagStanceLookup(
  declared: ReadonlyArray<{ slug: string; stance: TagStance }>,
  profileLoved: ReadonlyArray<{ name: string }>,
  profileAvoided: ReadonlyArray<{ name: string }>,
): TagStanceLookup {
  const bySlug = new Map<string, TagStance>()
  for (const d of declared) bySlug.set(d.slug, d.stance)
  const byName = new Map<string, TagStance>()
  for (const t of profileAvoided) if (t.name) byName.set(t.name.toLowerCase(), "avoid")
  for (const t of profileLoved) if (t.name) byName.set(t.name.toLowerCase(), "love")
  return { bySlug, byName }
}

/** Stance efetiva de uma tag: declarada (por slug) tem precedência sobre o perfil (por nome). */
export function resolveTagStance(
  tag: { slug?: string | null; name: string },
  lookup: TagStanceLookup,
): TagStance | null {
  if (tag.slug) {
    const s = lookup.bySlug.get(tag.slug)
    if (s) return s
  }
  return lookup.byName.get(tag.name.toLowerCase()) ?? null
}

export interface SegmentedTags<T> {
  loved: T[]
  avoided: T[]
  rest: T[]
}

/**
 * Divide as tags em amadas / evitadas / resto, sem duplicar. `getStance` resolve
 * a stance de cada tag (no server use `(t) => resolveTagStance(t, lookup)`; no
 * client, quando a stance já vem anexada, use `(t) => t.stance ?? null`).
 * `excludeNames` (em minúsculas) remove tags já exibidas em Categorias (gêneros).
 */
export function segmentTags<T extends { name: string }>(
  tags: ReadonlyArray<T>,
  getStance: (t: T) => TagStance | null,
  excludeNames?: ReadonlySet<string>,
): SegmentedTags<T> {
  const loved: T[] = []
  const avoided: T[] = []
  const rest: T[] = []
  for (const t of tags) {
    if (excludeNames && excludeNames.has(t.name.toLowerCase())) continue
    const s = getStance(t)
    if (s === "love") loved.push(t)
    else if (s === "avoid") avoided.push(t)
    else rest.push(t)
  }
  return { loved, avoided, rest }
}

/** Conjunto de nomes (minúsculos) pra excluir tags já mostradas em Categorias. */
export function lowercasedNameSet(names: ReadonlyArray<string>): Set<string> {
  return new Set(names.filter(Boolean).map((n) => n.toLowerCase()))
}
