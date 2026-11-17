import { LOVED_CHIPS, VETO_CHIPS } from "@/lib/onboarding/chips"

/**
 * Como os chips das boas-vindas viram linhas de `user_tag_preferences`, e de volta.
 *
 * As boas-vindas podem ser refeitas (link no card "Primeiros passos"), e a pessoa pode ter ajustado
 * as tags em Preferências no meio. Por isso a gravação não substitui tudo: só mexe nos chips que
 * MUDARAM de estado desde o que está no banco. Tag que nenhum chip cobre nunca é tocada.
 *
 * Um chip está "ligado" quando:
 *   - "Me atrai": a tag dele está declarada como amada;
 *   - "Eu evito": ALGUMA das tags dele está declarada como evitada. Com "todas", quem evitou só
 *     "Physical Abuse" em Preferências veria o chip desligado, e passar pela tela sem tocar nele
 *     apagaria essa declaração.
 *
 * Os chips de gênero sem tag (Ação, Mistério…) não têm estado no banco: nunca aparecem ligados.
 */

export type ChipStance = "love" | "avoid"

export interface TagStanceRow {
  tagName: string
  stance: ChipStance
}

export interface ChipTastePlan {
  /** Linhas que saem: a tag deixou de ser escolhida com esta stance. */
  remove: TagStanceRow[]
  /** Linhas que entram. Antes, a linha da mesma tag com qualquer stance sai (uma stance por tag). */
  insert: TagStanceRow[]
}

const has = (rows: TagStanceRow[], tagName: string, stance: ChipStance) =>
  rows.some((r) => r.tagName === tagName && r.stance === stance)

/** Os rótulos dos chips ligados, pelo que está gravado. */
export function chipStateFromRows(rows: TagStanceRow[]): { loved: string[]; vetos: string[] } {
  return {
    loved: LOVED_CHIPS.filter((c) => c.tag != null && has(rows, c.tag, "love")).map((c) => c.label),
    vetos: VETO_CHIPS.filter((v) => v.tags.some((t) => has(rows, t, "avoid"))).map((v) => v.label),
  }
}

/** O que gravar para os chips escolhidos agora, dado o que está no banco. Rótulo desconhecido é ignorado. */
export function planChipTastes(
  rows: TagStanceRow[],
  lovedLabels: string[],
  vetoLabels: string[],
): ChipTastePlan {
  const before = chipStateFromRows(rows)
  const wasLoved = new Set(before.loved)
  const wasVeto = new Set(before.vetos)
  const loved = new Set(lovedLabels)
  const vetos = new Set(vetoLabels)

  const plan: ChipTastePlan = { remove: [], insert: [] }
  for (const c of LOVED_CHIPS) {
    if (!c.tag) continue
    const now = loved.has(c.label)
    if (now && !wasLoved.has(c.label)) plan.insert.push({ tagName: c.tag, stance: "love" })
    if (!now && wasLoved.has(c.label)) plan.remove.push({ tagName: c.tag, stance: "love" })
  }
  for (const v of VETO_CHIPS) {
    const now = vetos.has(v.label)
    if (now && !wasVeto.has(v.label)) for (const t of v.tags) plan.insert.push({ tagName: t, stance: "avoid" })
    if (!now && wasVeto.has(v.label)) {
      for (const t of v.tags) if (has(rows, t, "avoid")) plan.remove.push({ tagName: t, stance: "avoid" })
    }
  }
  return plan
}

/** Todas as tags que algum chip cobre — o universo que as boas-vindas leem e gravam. */
export function chipTagNames(): string[] {
  const names = new Set<string>()
  for (const c of LOVED_CHIPS) if (c.tag) names.add(c.tag)
  for (const v of VETO_CHIPS) for (const t of v.tags) names.add(t)
  return [...names]
}
