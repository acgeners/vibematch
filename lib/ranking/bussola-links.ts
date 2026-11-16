/**
 * As LIGAÇÕES de uma obra no mapa da Bússola: o que o painel dela lista e o que ganha linha no
 * mapa. Quatro critérios, e eles respondem perguntas diferentes (medido em 16/11/2026, nas 40
 * obras do /ranking padrão — ver `project-embedding-vs-perfil-de-notas`):
 *
 *   - Parecidas: as 8 da aba Recomendações da obra (`find_similar_works`, embedding de sinopse,
 *     tags, notas e reviews). Mediana de 1 no mapa.
 *   - Mesmo perfil: as 9 notas de atributo do cálculo a até `PROFILE_DISTANCE_CUT` de distância.
 *     Quase não coincide com as Parecidas (0,22 em comum de 8, em média). Mediana de 2 no mapa.
 *   - Mesmo grupo: dividem um grupo de favoritos de QUEM OLHA. Mediana de 0 no mapa.
 *   - Vizinhas no mapa: as 4 mais próximas no par de eixos atual. Calculadas no cliente.
 *
 * As três primeiras trazem também obras de FORA do mapa (o filtro do /ranking as deixou de fora):
 * o painel as lista, marcadas, e só as que estão no mapa ganham linha.
 */

/**
 * Distância euclidiana máxima nas 9 notas para contar como "mesmo perfil". Medido no catálogo
 * (16/11/2026): 2,0 → mediana de 2 obras e 27% sem nenhuma; 2,5 → mediana de 10 e 9% sem nenhuma;
 * 3,0 → mediana de 26. Dividida por 3 (= √9), é a diferença típica por atributo: ~0,8 ponto,
 * dentro do ruído de reavaliação, por isso a ORDEM entre elas não é afirmada na tela.
 */
export const PROFILE_DISTANCE_CUT = 2.5
/** Quantas obras de mesmo perfil vão ao cliente (o resto vira "+N"). */
export const PROFILE_LIST_MAX = 40
export const SIMILAR_LIMIT = 8

export interface BussolaLinkedWork {
  id: string
  title: string
  isAdult: boolean
  isMixed: boolean
}

export interface BussolaLinks {
  similar: Array<BussolaLinkedWork & { similarity: number }>
  /** `null` = a obra não tem as 9 notas de atributo, então não há perfil para comparar. */
  profile: Array<BussolaLinkedWork & { distance: number }> | null
  /** Quantas obras de mesmo perfil existem no total (a lista vem cortada em `PROFILE_LIST_MAX`). */
  profileTotal: number
  /** `null` = sem sessão: os grupos são de quem olha, e o visitante não tem nenhum. */
  groups: Array<BussolaLinkedWork & { groups: string[] }> | null
}

export interface AttributeVectorRow {
  id: string
  title: string
  isAdult: boolean
  isMixed: boolean
  vector: number[]
}

/** Obras com distância ≤ `cut` da obra alvo, da mais próxima para a mais distante. */
export function profileNeighbors(
  rows: AttributeVectorRow[],
  workId: string,
  cut = PROFILE_DISTANCE_CUT,
): Array<BussolaLinkedWork & { distance: number }> | null {
  const me = rows.find((r) => r.id === workId)
  if (!me) return null
  const out: Array<BussolaLinkedWork & { distance: number }> = []
  for (const r of rows) {
    if (r.id === workId) continue
    let s = 0
    for (let i = 0; i < me.vector.length; i++) s += (r.vector[i] - me.vector[i]) ** 2
    const distance = Math.sqrt(s)
    if (distance <= cut) out.push({ id: r.id, title: r.title, isAdult: r.isAdult, isMixed: r.isMixed, distance })
  }
  return out.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1))
}

export type BussolaLinkMode = "similar" | "profile" | "groups" | "near"

export const BUSSOLA_LINK_MODES: Array<{ key: BussolaLinkMode; label: string }> = [
  { key: "similar", label: "Parecidas" },
  { key: "profile", label: "Mesmo perfil" },
  { key: "groups", label: "Mesmo grupo" },
  { key: "near", label: "Vizinhas no mapa" },
]

export const isBussolaLinkMode = (v: unknown): v is BussolaLinkMode =>
  typeof v === "string" && BUSSOLA_LINK_MODES.some((m) => m.key === v)

const fmt1 = (n: number) => n.toFixed(1).replace(".", ",")

export const LINK_MODE_HINT: Record<BussolaLinkMode, string> = {
  similar: "As 8 da aba Recomendações desta obra.",
  profile: `Notas dos atributos com até ~${fmt1(PROFILE_DISTANCE_CUT / 3)} ponto de diferença, em média. A ordem entre elas não importa.`,
  groups: "Estão em algum grupo de favoritos seu junto com esta obra.",
  near: "As 4 mais próximas neste par de eixos: apostas parecidas.",
}

/** Uma linha do painel: a obra ligada, o porquê, e a força (opacidade da linha no mapa). */
export interface LinkRow {
  id: string
  title: string
  isAdult: boolean
  isMixed: boolean
  /** Texto curto do porquê ("33% parecida", "≈ 0,7 pt/atributo", nomes dos grupos). */
  why: string
  strength: number
  onMap: boolean
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Monta as linhas de um critério. `onMap` decide quem ganha linha no mapa; as de fora vêm depois
 * das de dentro só em "Mesmo grupo" (lá não há ordem de força); nas outras, a ordem é a da força.
 */
export function linkRows(
  links: BussolaLinks,
  mode: Exclude<BussolaLinkMode, "near">,
  onMapIds: Set<string>,
): LinkRow[] | null {
  if (mode === "similar") {
    return links.similar.map((r) => ({
      id: r.id,
      title: r.title,
      isAdult: r.isAdult,
      isMixed: r.isMixed,
      // Similaridade centralizada (mig 225): 0 = acaso, vizinhas típicas entre 0,29 e 0,37.
      why: `${Math.round(r.similarity * 100)}% parecida`,
      strength: clamp01((r.similarity - 0.2) / 0.3),
      onMap: onMapIds.has(r.id),
    }))
  }
  if (mode === "profile") {
    if (!links.profile) return null
    return links.profile.map((r) => ({
      id: r.id,
      title: r.title,
      isAdult: r.isAdult,
      isMixed: r.isMixed,
      why: `≈ ${fmt1(r.distance / 3)} pt/atributo`,
      strength: clamp01(1 - r.distance / PROFILE_DISTANCE_CUT + 0.3),
      onMap: onMapIds.has(r.id),
    }))
  }
  if (!links.groups) return null
  return links.groups
    .map((r) => ({
      id: r.id,
      title: r.title,
      isAdult: r.isAdult,
      isMixed: r.isMixed,
      why: r.groups.join(" · "),
      strength: 0.8,
      onMap: onMapIds.has(r.id),
    }))
    .sort((a, b) => Number(b.onMap) - Number(a.onMap) || a.title.localeCompare(b.title, "pt-BR"))
}
