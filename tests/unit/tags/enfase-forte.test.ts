import { describe, it, expect } from "vitest"
import {
  STRONG_TAG_WEIGHT,
  buildTagStanceLookup,
  resolveTagStance,
  segmentTags,
} from "@/lib/tags/segment"

/**
 * Os DOIS níveis de amada/evitada: a ênfase 2× declarada (`weight ≥
 * STRONG_TAG_WEIGHT`) contra a declaração normal e contra a tag que só casou
 * pelo perfil de gosto.
 *
 * O modo de falha desta classe é o de sempre no projeto: resultado plausível.
 * Uma tag "muito amada" que perde o nível continua verde, no lugar certo, sem
 * erro e sem log — só deixa de ser distinguível da vizinha.
 */

const noProfile = { loved: [] as { name: string }[], avoided: [] as { name: string }[] }

describe("buildTagStanceLookup + resolveTagStance", () => {
  it("weight ≥ 2 vira forte; weight 1 e ausente, não", () => {
    const lookup = buildTagStanceLookup(
      [
        { slug: "adult-couple", stance: "love", weight: 2 },
        { slug: "royalty", stance: "love", weight: 1 },
        { slug: "cruel-fl", stance: "avoid", weight: 2 },
        { slug: "teenagers", stance: "avoid" }, // sem weight → 1 (default do banco)
      ],
      noProfile.loved,
      noProfile.avoided,
    )
    expect(resolveTagStance({ slug: "adult-couple", name: "Adult Couple" }, lookup)).toEqual({
      stance: "love",
      strong: true,
      source: "declared",
    })
    expect(resolveTagStance({ slug: "royalty", name: "Royalty" }, lookup)?.strong).toBe(false)
    expect(resolveTagStance({ slug: "cruel-fl", name: "Cruel Female Lead" }, lookup)?.strong).toBe(true)
    expect(resolveTagStance({ slug: "teenagers", name: "Teenagers" }, lookup)?.strong).toBe(false)
  })

  it("tag vinda SÓ do perfil nunca é forte — a régua de lá é outra escala", () => {
    // 🔴 O perfil traz `strength` 0–1, inferida pelo modelo. Promovê-la a "muito
    // amada" exigiria inventar um limiar, e o desenho passaria a afirmar que os
    // dois números são o mesmo. `source: "profile"` é o que o tooltip usa pra
    // não dizer "você marcou" sobre algo que ninguém marcou.
    const lookup = buildTagStanceLookup([], [{ name: "Time Skip" }], [{ name: "Isekai" }])
    expect(resolveTagStance({ name: "Time Skip" }, lookup)).toEqual({
      stance: "love",
      strong: false,
      source: "profile",
    })
    expect(resolveTagStance({ name: "Isekai" }, lookup)).toEqual({
      stance: "avoid",
      strong: false,
      source: "profile",
    })
  })

  it("a declaração 1× vence o perfil — e o resultado NÃO é forte", () => {
    // A precedência declarada > perfil já existia. O que se ganha aqui é que ela
    // continue valendo pro nível: uma tag que você marcou como amada comum não
    // pode virar "muito amada" por causa do perfil.
    const lookup = buildTagStanceLookup(
      [{ slug: "time-skip", stance: "love", weight: 1 }],
      [{ name: "Time Skip" }],
      [],
    )
    expect(resolveTagStance({ slug: "time-skip", name: "Time Skip" }, lookup)).toEqual({
      stance: "love",
      strong: false,
      source: "declared",
    })
  })

  it("STRONG_TAG_WEIGHT é a mesma régua do filtro hide_avoided=strong", () => {
    // O valor está aqui pra não haver 2ª cópia: `/ranking` e `/favorites`
    // importam esta constante pra montar `avoidedSlugs`. Se ela mudar sem eles,
    // a tela marca como forte uma tag que o filtro não esconde.
    expect(STRONG_TAG_WEIGHT).toBe(2)
  })
})

describe("segmentTags", () => {
  const tags = [
    { name: "Royalty", strong: false, stance: "love" as const },
    { name: "Adult Couple", strong: true, stance: "love" as const },
    { name: "Teenagers", strong: false, stance: "avoid" as const },
    { name: "Villainess", strong: null },
    { name: "Cruel Female Lead", strong: true, stance: "avoid" as const },
    { name: "Time Skip", strong: true, stance: "love" as const },
  ]
  const getStance = (t: (typeof tags)[number]) =>
    t.strong === null ? null : { stance: t.stance!, strong: t.strong, source: "declared" as const }

  it("põe as fortes primeiro, mantendo a ordem original DENTRO de cada nível", () => {
    // A prévia do comparador corta em 5 chips de dezenas: sem esta partição, a
    // tag mais decisiva da obra some atrás de uma amada qualquer que por acaso
    // vinha antes.
    const { loved, avoided, rest } = segmentTags(tags, getStance)
    expect(loved.map((t) => t.name)).toEqual(["Adult Couple", "Time Skip", "Royalty"])
    expect(avoided.map((t) => t.name)).toEqual(["Cruel Female Lead", "Teenagers"])
    expect(rest.map((t) => t.name)).toEqual(["Villainess"])
  })

  it("excludeNames continua tirando as tags já mostradas em Categorias", () => {
    const { loved, rest } = segmentTags(tags, getStance, new Set(["adult couple", "villainess"]))
    expect(loved.map((t) => t.name)).toEqual(["Time Skip", "Royalty"])
    expect(rest).toEqual([])
  })
})
