import { describe, expect, it } from "vitest"

import { selectReviewsForEvaluation } from "@/lib/external/index"
import { SELECTABLE_EXTERNAL_SOURCES, sourceOrderIndex } from "@/lib/external/source-order"
import type { ExternalSourceId, SourcedReview } from "@/lib/external/types"

/**
 * Política W3 (`selectReviewsForEvaluation`): 30 é capacidade MÁXIMA, não cota a cumprir. A
 * diversidade de fonte decide a ORDEM (rodízio), não um teto; a dedup vem antes do corte.
 * Diagnóstico: `Auditoria/qualidade-avaliacoes-ia-2026-10/SELECAO-SEM-DEGRAU-DIAGNOSTICO-2026-10-22.md`.
 */

const CAPS = { total: 30 }

let uid = 0
/** Review sintética de texto ÚNICO (vocabulário próprio): a dedup nunca as junta. */
function rev(source: ExternalSourceId, palavras = 20, userRating?: number): SourcedReview {
  const id = ++uid
  const text = Array.from({ length: palavras }, (_, j) => `tok${id}x${j}`).join(" ")
  return { source, sourceTitle: "Obra", matchScore: 1, text, textLength: text.length, ...(userRating != null ? { userRating } : {}) }
}
const muitas = (source: ExternalSourceId, n: number) => Array.from({ length: n }, (_, i) => rev(source, 10 + ((i * 7) % 60)))
const porFonte = (l: SourcedReview[]) => l.reduce<Record<string, number>>((m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m), {})

describe("capacidade, não cota", () => {
  it("uma fonte com 28 reviews envia as 28 (a cota antiga mandava 12)", () => {
    expect(selectReviewsForEvaluation(muitas("mangago", 28), CAPS)).toHaveLength(28)
  })

  it("uma fonte com 31 envia 30 — sem o degrau 30 → 12", () => {
    expect(selectReviewsForEvaluation(muitas("mangago", 31), CAPS)).toHaveLength(30)
  })

  it("várias fontes equilibradas: 5 × 7 = 35 → 30, seis de cada", () => {
    const pool = (["mangaupdates", "myanimelist", "comix", "mangago", "animeplanet"] as const).flatMap((s) => muitas(s, 7))
    const sel = selectReviewsForEvaluation(pool, CAPS)
    expect(sel).toHaveLength(30)
    expect(Object.values(porFonte(sel))).toEqual([6, 6, 6, 6, 6])
  })

  it("desequilibradas: as fontes pequenas entram INTEIRAS e a grande preenche o resto", () => {
    const pool = [...muitas("mangaupdates", 3), ...muitas("myanimelist", 1), ...muitas("kitsu", 1), ...muitas("comix", 5), ...muitas("mangago", 25)]
    const sel = selectReviewsForEvaluation(pool, CAPS)
    expect(sel).toHaveLength(30)
    expect(porFonte(sel)).toEqual({ mangaupdates: 3, myanimelist: 1, kitsu: 1, comix: 5, mangago: 20 })
  })

  it("duas fontes, uma dominante: 4 MAL + 27 Mangago = 31 → as 4 MAL ficam", () => {
    const sel = selectReviewsForEvaluation([...muitas("myanimelist", 4), ...muitas("mangago", 27)], CAPS)
    expect(porFonte(sel)).toEqual({ myanimelist: 4, mangago: 26 })
  })

  it("um limite por fonte EXPLÍCITO continua sendo respeitado", () => {
    const sel = selectReviewsForEvaluation([...muitas("comix", 10), ...muitas("mangago", 10)], { total: 30, maxPerSource: 3 })
    expect(porFonte(sel)).toEqual({ comix: 3, mangago: 3 })
  })
})

describe("transição de 26 a 36 reviews (pools aninhados: cada um é o anterior + 1)", () => {
  const arquetipos: Array<[string, Record<string, number>, (k: number) => ExternalSourceId]> = [
    ["1 fonte", {}, () => "mangago"],
    ["2 fontes, 1 dominante", { myanimelist: 4 }, () => "mangago"],
    ["2 fontes grandes equilibradas", {}, (k) => (k % 2 ? "comix" : "mangago")],
    ["5 fontes equilibradas", {}, (k) => (["mangaupdates", "myanimelist", "comix", "mangago", "animeplanet"] as const)[k % 5]],
    ["5 fontes muito diferentes", { mangaupdates: 3, myanimelist: 1, kitsu: 1, comix: 5 }, () => "mangago"],
  ]
  for (const [nome, base, proxima] of arquetipos) {
    it(`${nome}: envia min(30, n), nunca cai, e cada review nova tira no máximo 1 — só quando ela entra`, () => {
      const pool: SourcedReview[] = Object.entries(base).flatMap(([s, n]) => muitas(s as ExternalSourceId, n))
      let k = 0
      while (pool.length < 26) pool.push(rev(proxima(k++), 10 + ((k * 13) % 70)))
      let anterior: Set<SourcedReview> | null = null
      let enviadasAntes = 0
      for (let n = 26; n <= 36; n++) {
        if (pool.length < n) pool.push(rev(proxima(k++), 10 + ((k * 13) % 70)))
        const nova = pool[pool.length - 1]
        const sel = selectReviewsForEvaluation(pool, CAPS)
        expect(sel.length).toBe(Math.min(30, n))
        expect(sel.length).toBeGreaterThanOrEqual(enviadasAntes)
        if (anterior) {
          const atual = new Set(sel)
          const sairam = [...anterior].filter((r) => !atual.has(r)).length
          expect(sairam).toBeLessThanOrEqual(1)
          if (sairam === 1) expect(atual.has(nova)).toBe(true)
        }
        anterior = new Set(sel)
        enviadasAntes = sel.length
      }
    })
  }
})

describe("diversidade e ordem", () => {
  it("rodízio de sentimento: com a fonte cortada, as notas baixas entram junto das altas", () => {
    // 20 notas altas longas e 20 baixas curtas na MESMA fonte, disputando 15 vagas com outra fonte.
    const altas = Array.from({ length: 20 }, () => rev("mangaupdates", 80, 9))
    const baixas = Array.from({ length: 20 }, () => rev("mangaupdates", 15, 2))
    const sel = selectReviewsForEvaluation([...altas, ...baixas, ...muitas("animeplanet", 20)], CAPS)
    const mu = sel.filter((r) => r.source === "mangaupdates")
    expect(mu).toHaveLength(15)
    expect(mu.some((r) => (r.userRating ?? 10) <= 4)).toBe(true)
    expect(mu.some((r) => (r.userRating ?? 0) >= 7)).toBe(true)
  })

  it("toda fonte tem a vez antes de outra repetir (primeira rodada na ordem canônica)", () => {
    const fontes = [...SELECTABLE_EXTERNAL_SOURCES].reverse()
    const sel = selectReviewsForEvaluation(fontes.flatMap((s) => muitas(s, 5)), CAPS)
    const primeiraRodada = sel.slice(0, fontes.length).map((r) => r.source)
    expect(primeiraRodada).toEqual([...fontes].sort((a, b) => sourceOrderIndex(a) - sourceOrderIndex(b)))
  })

  it("é determinística: a mesma entrada em outra ordem produz a mesma seleção", () => {
    // Comprimentos EMPATADOS de propósito: era aí que a ordem de entrada decidia.
    const pool = [...Array.from({ length: 25 }, () => rev("comix", 20)), ...Array.from({ length: 20 }, () => rev("mangago", 20))]
    const a = selectReviewsForEvaluation(pool, CAPS)
    const b = selectReviewsForEvaluation([...pool].reverse(), CAPS)
    const c = selectReviewsForEvaluation([...pool].sort((x, y) => (x.text < y.text ? 1 : -1)), CAPS)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })
})

describe("dedup antes do corte", () => {
  it("vaga de duplicata é reaproveitada: 35 cruas com 5 cópias → 30 distintas", () => {
    const pool = muitas("comix", 30)
    // As cópias são as MAIS LONGAS (entram primeiro na ordem) e vêm de outra plataforma.
    const copias = [...pool].sort((x, y) => y.text.length - x.text.length).slice(0, 5).map((r) => ({ ...r, source: "mangago" as const }))
    const sel = selectReviewsForEvaluation([...pool, ...copias], CAPS)
    expect(sel).toHaveLength(30)
    expect(new Set(sel.map((r) => r.text)).size).toBe(30)
  })
})
