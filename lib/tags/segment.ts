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

/**
 * Peso a partir do qual uma declaração é ÊNFASE FORTE ("muito amada" / "muito
 * evitada"). É a mesma régua que o filtro "Esconder tags evitadas → só as
 * fortes" (`hide_avoided=strong`, em `/ranking` e `/favorites`) já usava — por
 * isso ela mora aqui, e não copiada em cada consumidor: uma 2ª régua é como a
 * tela deixa de concordar com o filtro sobre quais tags são "fortes".
 */
export const STRONG_TAG_WEIGHT = 2

/**
 * Stance + de onde ela veio + intensidade.
 *
 * `strong` só existe pra declaração (`user_tag_preferences.weight ≥
 * STRONG_TAG_WEIGHT`, o botão ✨ 2× de `/preferencias`). Tag que casou pelo
 * PERFIL de gosto nunca é forte: a régua de lá é `strength` 0–1, inferida pelo
 * modelo — outra escala, cujo "alto" precisaria de um limiar inventado.
 */
export interface TagStanceInfo {
  stance: TagStance
  /** Ênfase 2× declarada. Sempre `false` quando `source === "profile"`. */
  strong: boolean
  source: "declared" | "profile"
}

export interface TagStanceLookup {
  /** Stance declarada pelo usuário, por slug de tag (precede o perfil). */
  bySlug: Map<string, TagStanceInfo>
  /** Stance do perfil de gosto, por nome em minúsculas. */
  byName: Map<string, TagStanceInfo>
}

/**
 * Monta o lookup unindo preferências declaradas (por slug) com o perfil de gosto
 * (loved_tags/avoided_tags, por nome). `avoided` é setado antes de `loved` no
 * mapa por nome pra que, em conflito raro, "amada" prevaleça.
 */
export function buildTagStanceLookup(
  declared: ReadonlyArray<{ slug: string; stance: TagStance; weight?: number }>,
  profileLoved: ReadonlyArray<{ name: string }>,
  profileAvoided: ReadonlyArray<{ name: string }>,
): TagStanceLookup {
  const bySlug = new Map<string, TagStanceInfo>()
  for (const d of declared) {
    bySlug.set(d.slug, {
      stance: d.stance,
      strong: (d.weight ?? 1) >= STRONG_TAG_WEIGHT,
      source: "declared",
    })
  }
  const byName = new Map<string, TagStanceInfo>()
  const fromProfile = (stance: TagStance): TagStanceInfo => ({ stance, strong: false, source: "profile" })
  for (const t of profileAvoided) if (t.name) byName.set(t.name.toLowerCase(), fromProfile("avoid"))
  for (const t of profileLoved) if (t.name) byName.set(t.name.toLowerCase(), fromProfile("love"))
  return { bySlug, byName }
}

/** Stance efetiva de uma tag: declarada (por slug) tem precedência sobre o perfil (por nome). */
export function resolveTagStance(
  tag: { slug?: string | null; name: string },
  lookup: TagStanceLookup,
): TagStanceInfo | null {
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
 *
 * Dentro de `loved`/`avoided` as FORTES vêm primeiro (partição estável, a ordem
 * relativa original se mantém dentro de cada nível). Quem tem prévia cortada —
 * a coluna do comparador mostra 5 chips de dezenas — passa a mostrar a tag mais
 * decisiva, não a primeira alfabética. Quem reordena depois (a página da obra)
 * precisa carregar `strong` como 1ª chave do próprio comparador.
 */
export function segmentTags<T extends { name: string }>(
  tags: ReadonlyArray<T>,
  getStance: (t: T) => TagStanceInfo | null,
  excludeNames?: ReadonlySet<string>,
): SegmentedTags<T> {
  const loved: T[] = []
  const lovedWeak: T[] = []
  const avoided: T[] = []
  const avoidedWeak: T[] = []
  const rest: T[] = []
  for (const t of tags) {
    if (excludeNames && excludeNames.has(t.name.toLowerCase())) continue
    const s = getStance(t)
    if (!s) rest.push(t)
    else if (s.stance === "love") (s.strong ? loved : lovedWeak).push(t)
    else (s.strong ? avoided : avoidedWeak).push(t)
  }
  return { loved: [...loved, ...lovedWeak], avoided: [...avoided, ...avoidedWeak], rest }
}

/** Conjunto de nomes (minúsculos) pra excluir tags já mostradas em Categorias. */
export function lowercasedNameSet(names: ReadonlyArray<string>): Set<string> {
  return new Set(names.filter(Boolean).map((n) => n.toLowerCase()))
}
