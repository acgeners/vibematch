import { describe, it, expect } from "vitest"
import {
  mergeDeclaredTagPreferences,
  buildRatedTagCounts,
} from "@/lib/ai-recommendation/taste-profile-heuristic"
import type { TasteProfilePayload, ProfileTag } from "@/lib/ai-recommendation/types"
import type { DeclaredTagPref } from "@/server/queries/tag-preferences"

function emptyProfile(over: Partial<TasteProfilePayload> = {}): TasteProfilePayload {
  return {
    loved_tags: [],
    avoided_tags: [],
    loved_themes: [],
    avoided_themes: [],
    criterion_preferences: {},
    narrative_patterns: [],
    summary: "",
    ...over,
  }
}

const decl = (name: string, stance: "love" | "avoid", weight = 1): DeclaredTagPref => ({
  slug: name.toLowerCase(),
  name,
  group: "g1",
  stance,
  weight,
  source: "tag",
})

const find = (tags: ProfileTag[], name: string) =>
  tags.find((t) => t.name.toLowerCase() === name.toLowerCase())

describe("mergeDeclaredTagPreferences (prior com encolhimento)", () => {
  it("sem declarações retorna o perfil intacto (identidade)", () => {
    const p = emptyProfile({ loved_tags: [{ name: "Isekai", group: "g1", strength: 0.7 }] })
    expect(mergeDeclaredTagPreferences(p, [], new Map())).toBe(p)
  })

  it("prior puro: tag declarada sem dado (n=0) entra com strength = BASE×weight", () => {
    const out = mergeDeclaredTagPreferences(emptyProfile(), [decl("Isekai", "love")], new Map())
    const t = find(out.loved_tags, "Isekai")
    expect(t).toBeDefined()
    // λ=0 → 100% declarado: DECLARED_BASE(0.5) × weight(1) = 0.5
    expect(t!.strength).toBeCloseTo(0.5, 5)
  })

  it("weight enfático dobra a força do prior puro", () => {
    const out = mergeDeclaredTagPreferences(emptyProfile(), [decl("Isekai", "love", 2)], new Map())
    expect(find(out.loved_tags, "Isekai")!.strength).toBeCloseTo(1.0, 5)
  })

  it("dado forte e contrário SOBREPÕE o 'amo' (vira evitada)", () => {
    // learned −0.4 (em avoided), declarado amo, n=15 → λ=0.75 → blended<0
    const p = emptyProfile({ avoided_tags: [{ name: "Tragedy", group: "g1", strength: 0.4 }] })
    const out = mergeDeclaredTagPreferences(p, [decl("Tragedy", "love")], new Map([["tragedy", 15]]))
    expect(find(out.loved_tags, "Tragedy")).toBeUndefined()
    const a = find(out.avoided_tags, "Tragedy")
    expect(a).toBeDefined()
    expect(a!.strength).toBeCloseTo(0.175, 3)
  })

  it("evito é mais teimoso que amo: mesmo n e dado oposto, amo flipa mas evito segura", () => {
    const counts = new Map([["x", 10]])
    // AMO X, mas dado diz −0.3 (X está em avoided) → deve FLIPAR pra evitada
    const loveOut = mergeDeclaredTagPreferences(
      emptyProfile({ avoided_tags: [{ name: "X", group: "g1", strength: 0.3 }] }),
      [decl("X", "love")],
      counts,
    )
    expect(find(loveOut.avoided_tags, "X")).toBeDefined()
    expect(find(loveOut.loved_tags, "X")).toBeUndefined()

    // EVITO X, mas dado diz +0.3 (X está em loved) → deve SEGURAR como evitada
    const avoidOut = mergeDeclaredTagPreferences(
      emptyProfile({ loved_tags: [{ name: "X", group: "g1", strength: 0.3 }] }),
      [decl("X", "avoid")],
      counts,
    )
    expect(find(avoidOut.avoided_tags, "X")).toBeDefined()
    expect(find(avoidOut.loved_tags, "X")).toBeUndefined()
  })

  it("aprendido não-declarado é preservado", () => {
    const p = emptyProfile({ loved_tags: [{ name: "Action", group: "g1", strength: 0.6 }] })
    const out = mergeDeclaredTagPreferences(p, [decl("Romance", "love")], new Map())
    expect(find(out.loved_tags, "Action")).toBeDefined()
    expect(find(out.loved_tags, "Romance")).toBeDefined()
  })
})

describe("buildRatedTagCounts", () => {
  it("conta 1× por obra (não duplica tag repetida na mesma obra)", () => {
    const counts = buildRatedTagCounts([
      { tags: [{ name: "Isekai" }, { name: "Isekai" }, { name: "Magic" }] },
      { tags: [{ name: "Isekai" }] },
    ])
    expect(counts.get("isekai")).toBe(2)
    expect(counts.get("magic")).toBe(1)
  })
})
