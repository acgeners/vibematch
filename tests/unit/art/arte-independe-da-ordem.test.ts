import { describe, expect, it } from "vitest"
import { artOutOfFoldEstimates, computeArtForCatalog } from "@/lib/art/model"
import type { ArtCatalogInput } from "@/lib/art/model"
import { ART_SIGNAL_VERSION, ART_TAG_SLUGS, artFeatureVector } from "@/lib/art/signal"

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}
function embaralhar<T>(a: readonly T[], seed: number): T[] {
  const r = rng(seed)
  const o = [...a]
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}

// 160 obras, 90 rotuladas (acima do piso de treino), sinais e tags variados.
const r = rng(7)
const catalogo: ArtCatalogInput[] = Array.from({ length: 160 }, (_, i) => {
  const reviews = 1 + Math.floor(r() * 60)
  return {
    id: `obra-${((i * 2654435761) >>> 0).toString(16).padStart(8, "0")}`,
    signal: {
      v: ART_SIGNAL_VERSION,
      digestPositive: Math.floor(r() * 3),
      digestNegative: Math.floor(r() * 2),
      reviewCount: reviews,
      artMentions: Math.floor(r() * reviews),
      lexPositive: Math.floor(r() * 8),
      lexNegative: Math.floor(r() * 5),
    },
    tagSlugs: ART_TAG_SLUGS.filter(() => r() < 0.15),
    label: i % 16 < 9 ? Math.round((3 + r() * 7) * 2) / 2 : null,
  }
})
const valores = (m: Map<string, unknown>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1))

describe("computeArtForCatalog é invariante à ordem de entrada", () => {
  const base = computeArtForCatalog(catalogo)

  it("o cenário tem modelo de verdade (senão o teste passaria com tudo null)", () => {
    const comNumero = [...base.values()].filter((x) => x.estimate != null)
    expect(comNumero.length).toBeGreaterThan(100)
  })

  it("contraprova: o out-of-fold SEM ordem canônica depende da posição neste cenário", () => {
    const amostras = catalogo
      .filter((c) => c.label != null)
      .map((c) => ({ id: c.id, features: artFeatureVector(c.signal!, c.tagSlugs), label: c.label as number }))
    const direto = artOutOfFoldEstimates(amostras)!
    const invertido = artOutOfFoldEstimates([...amostras].reverse())!.reverse()
    expect(direto.some((v, k) => Math.abs(v - invertido[k]) > 1e-9)).toBe(true)
  })

  it("🔴 mesmo conjunto em 5 ordens ⇒ mesmos números, obra a obra", () => {
    const ordens = [[...catalogo].reverse(), embaralhar(catalogo, 1), embaralhar(catalogo, 2), embaralhar(catalogo, 3)]
    for (const ordem of ordens) {
      const res = computeArtForCatalog(ordem)
      expect(valores(res)).toEqual(valores(base))
      // A ordem de entrada só decide a ordem de iteração do Map devolvido.
      expect([...res.keys()]).toEqual(ordem.map((o) => o.id))
    }
  })

  it("chamadas repetidas ⇒ resultado byte-idêntico", () => {
    expect(JSON.stringify(valores(computeArtForCatalog(catalogo)))).toBe(JSON.stringify(valores(base)))
  })
})
