import { beforeEach, describe, expect, it, vi } from "vitest"
import { CRITERION_SLUGS } from "@/types/domain"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"

/**
 * O /catalog usa o `getRanking` só para o TOTAL e a SEQUÊNCIA de `workId` — a página visível é
 * hidratada depois, por `getWorksByIds`. Medido em 2026-10-05: a consulta principal custava
 * 1.227 KB e as sinopses primárias do catálogo inteiro, 305 KB; nenhuma das duas decide a ordem.
 *
 * O modo `"ordering-only"` roda o MESMO pipeline sem o que só desenha a linha. O que fica preso:
 *   - a ordem e o total são idênticos aos do modo completo, em várias ordenações e filtros, para
 *     a dona, o visitante e outra conta;
 *   - a `confidence` do payload do Veredito continua chegando (ela pesa a Prioridade) e nunca
 *     vaza da linha da dona para a Prioridade de outra pessoa;
 *   - o modo não pede os campos pesados nem lê as sinopses primárias;
 *   - o modo completo segue pedindo e entregando tudo, como antes.
 *
 * O PostgREST falso APLICA a projeção do `select` (embed e caminho JSON inclusive) — sem isso,
 * um campo que saiu do select continuaria chegando e o teste passaria por vacuidade.
 */

type Row = Record<string, unknown>
type Leitor = "dona" | "anon" | "outra"

const estado = vi.hoisted(() => ({
  tabelas: {} as Record<string, Row[]>,
  consultas: [] as Array<{ tabela: string; select: string }>,
  leitor: "dona" as "dona" | "anon" | "outra",
  linhasDaOutra: new Map<string, Record<string, unknown>>(),
  estadoPessoal: new Map<string, Record<string, unknown>>(),
  previsoes: new Map<string, unknown>(),
}))

function partes(sel: string): string[] {
  const out: string[] = []
  let nivel = 0
  let atual = ""
  for (const c of sel) {
    if (c === "(") nivel++
    if (c === ")") nivel--
    if (c === "," && nivel === 0) {
      out.push(atual)
      atual = ""
    } else atual += c
  }
  if (atual) out.push(atual)
  return out.filter(Boolean)
}

/** O que o PostgREST devolveria para este `select`: só as colunas pedidas. */
function projetar(row: Row, sel: string): Row {
  const out: Row = {}
  for (const p of partes(sel.replace(/\s+/g, ""))) {
    const embed = p.match(/^(\w+)(?:!\w+)?\((.*)\)$/)
    if (embed) {
      const v = row[embed[1]]
      out[embed[1]] = Array.isArray(v)
        ? v.map((x) => projetar(x as Row, embed[2]))
        : v == null
          ? null
          : projetar(v as Row, embed[2])
      continue
    }
    const json = p.match(/^(?:(\w+):)?(\w+)->(\w+)$/)
    if (json) {
      const base = row[json[2]] as Row | null | undefined
      out[json[1] ?? json[3]] = base == null ? null : (base[json[3]] ?? null)
      continue
    }
    if (p === "*") {
      Object.assign(out, row)
      continue
    }
    out[p] = row[p]
  }
  return out
}

function valorEm(row: Row, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Row)[k]), row)
}

function builder(tabela: string) {
  const preds: Array<(r: Row) => boolean> = []
  const ordens: Array<[string, boolean]> = []
  let sel = "*"
  let faixa: [number, number] | null = null
  let limite: number | null = null
  const q = {
    select: (s: string) => ((sel = s), estado.consultas.push({ tabela, select: s }), q),
    eq: (col: string, v: unknown) => (preds.push((r) => valorEm(r, col) === v), q),
    in: (col: string, vs: unknown[]) => {
      const set = new Set(vs)
      preds.push((r) => set.has(valorEm(r, col)))
      return q
    },
    not: () => q,
    is: () => q,
    gte: (col: string, v: number) => (preds.push((r) => (valorEm(r, col) as number) >= v), q),
    lte: (col: string, v: number) => (preds.push((r) => (valorEm(r, col) as number) <= v), q),
    or: () => q,
    order: (col: string, opts?: { ascending?: boolean }) => (ordens.push([col, opts?.ascending ?? true]), q),
    range: (from: number, to: number) => ((faixa = [from, to]), q),
    limit: (n: number) => ((limite = n), q),
    then: (ok: (v: { data: Row[] | null; error: null }) => unknown) => {
      let rows = (estado.tabelas[tabela] ?? []).filter((r) => preds.every((p) => p(r)))
      for (const [col, asc] of [...ordens].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = String(valorEm(a, col)), y = String(valorEm(b, col))
          return x === y ? 0 : (x < y) === asc ? -1 : 1
        })
      }
      rows = faixa ? rows.slice(faixa[0], faixa[1] + 1) : rows.slice(0, Math.min(limite ?? 1000, 1000))
      return Promise.resolve(ok({ data: rows.map((r) => projetar(r, sel)), error: null }))
    },
  }
  return q
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: () => {}, revalidatePath: () => {} }))
vi.mock("@/server/queries/current-user", () => ({ getHideAdultContent: async () => false }))
vi.mock("@/server/queries/verdict-scale", () => ({ getVerdictScale: async () => ({ mean: 55, sd: 15, expectedSd: 1 }) }))
vi.mock("@/server/queries/synopsis-quality", () => ({ getAllActiveSynopsisPredictions: async () => estado.previsoes }))
vi.mock("@/server/queries/user-scores", async (orig) => {
  const real = await orig<typeof import("@/server/queries/user-scores")>()
  // Mesmos campos pessoais e mesma regra de overlay do leitor real (dona / anônimo / outra).
  const VAZIO: Record<string, unknown> = Object.fromEntries(
    real.PERSONAL_SCORE_FIELDS.map((f) => [
      f,
      f === "expected_is_stub" || f === "chance_is_stub" ? true : f === "alignment_stale" ? false : null,
    ]),
  )
  return {
    ...real,
    getScoresReader: async () => {
      if (estado.leitor === "dona")
        return { userId: "dona", isOwner: true, hasModel: true, overlay: (_id: string, row: unknown) => row }
      if (estado.leitor === "anon")
        return {
          userId: null,
          isOwner: false,
          hasModel: false,
          overlay: (_id: string, row: unknown) => (row ? { ...(row as object), ...VAZIO } : row),
        }
      return {
        userId: "outra",
        isOwner: false,
        hasModel: true,
        overlay: (id: string, row: unknown) =>
          row ? { ...(row as object), ...VAZIO, ...(estado.linhasDaOutra.get(id) ?? {}) } : row,
      }
    },
  }
})
vi.mock("@/server/queries/user-work-state", async (orig) => {
  const real = await orig<typeof import("@/server/queries/user-work-state")>()
  return {
    ...real,
    getPersonalStateReader: async () => ({
      userId: null,
      get: (id: string) => ({ ...real.EMPTY_PERSONAL_STATE, ...(estado.estadoPessoal.get(id) ?? {}) }),
    }),
    resolvePersonalFilterIds: async () => null,
  }
})

import { getRanking } from "@/server/queries/ranking"
import type { RankingFilters, SortLevel } from "@/server/queries/ranking"

// Gerador determinístico: o catálogo falso é o mesmo em toda execução.
function lcg(seed: number) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296), s / 4294967296)
}

const N = 160
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
const PUB = [getPublicationStatusIdByName("Completed"), getPublicationStatusIdByName("Ongoing"), null]

function semear() {
  const r = lcg(42)
  estado.consultas = []
  estado.linhasDaOutra = new Map()
  estado.estadoPessoal = new Map()
  estado.previsoes = new Map()
  const works: Row[] = []
  for (let i = 0; i < N; i++) {
    // Títulos embaralhados em relação ao id, para a ordem por título não coincidir com a de id.
    const t = (i * 37) % N
    const temVeredito = r() < 0.7
    const payload =
      !temVeredito || r() < 0.15
        ? null
        : {
            // ~20% sem `confidence`: a Prioridade cai no padrão — tem que cair igual nos dois modos.
            ...(r() < 0.2 ? {} : { confidence: Math.round(r() * 100) / 100 }),
            risks: ["risco longo ".repeat(20)],
            review_quotes: ["citação longa ".repeat(30)],
          }
    works.push({
      id: id(i),
      title: `Obra ${String(t).padStart(3, "0")}`,
      is_archived: i % 41 === 0,
      is_adult: false,
      publication_status_id: PUB[i % 3],
      ai_eval_status: i % 5 === 0 ? "pending" : "done",
      hiatus_kind: null,
      hiatus_kind_confidence: null,
      publication_status_note: "nota do MangaUpdates ".repeat(5),
      total_chapters: 20 + Math.floor(r() * 200),
      year: 2010 + Math.floor(r() * 15),
      updated_at: new Date(Date.UTC(2026, 0, 1 + Math.floor(r() * 200))).toISOString(),
      canonical_synopsis: r() < 0.6 ? `Sinopse canônica ${i} `.repeat(40) : null,
      calculated_scores: {
        // Notas numa grade curta: muitas empatam na nota EXIBIDA, então os desempates trabalham.
        expected_score: r() < 0.05 ? null : 6 + Math.floor(r() * 30) / 10,
        expected_baseline: 6.5,
        expected_quality_adj: 0.1,
        expected_is_stub: false,
        chance_score: Math.round(r() * 100),
        platform_avg: 6 + Math.floor(r() * 35) / 10,
        total_votes: Math.floor(r() * 5000),
        personal_fit: r(),
        personal_fit_percentile: Math.floor(r() * 100),
        tag_overlap_net: Math.floor(r() * 6) - 2,
        art_percentile: r() < 0.2 ? null : r(),
        alignment_score: temVeredito ? Math.floor(r() * 100) : null,
        alignment_justification: temVeredito ? "justificativa do Veredito ".repeat(30) : null,
        alignment_payload: payload,
        alignment_at: temVeredito ? "2026-09-01T00:00:00Z" : null,
        alignment_stale: r() < 0.2,
      },
      category_scores: CRITERION_SLUGS.map((slug) => ({ criterion_slug: slug, score: Math.floor(r() * 21) / 2 })),
      work_covers: [{ url: `https://capa/${i}.jpg`, is_primary: true, position: 0 }],
    })
    if (r() < 0.4) estado.estadoPessoal.set(id(i), { userScore: 5 + Math.floor(r() * 50) / 10, synopsisQuality: "♥♥" })
    if (r() < 0.5)
      estado.previsoes.set(id(i), { predictedQuality: r() < 0.5 ? "♥" : "♥♥♥", stale: false, confidence: 0.7 })
    // A outra conta tem Veredito PRÓPRIO numa parte das obras, com confiança diferente da da dona.
    if (r() < 0.5)
      estado.linhasDaOutra.set(id(i), {
        expected_score: 5 + Math.floor(r() * 40) / 10,
        expected_is_stub: false,
        alignment_score: Math.floor(r() * 100),
        // ~25% sem `confidence`: é onde a confiança da DONA vazaria, se o alias sobrasse.
        alignment_payload: r() < 0.25 ? {} : { confidence: Math.round(r() * 100) / 100 },
        alignment_stale: false,
        tag_overlap_net: Math.floor(r() * 6) - 2,
      })
  }
  estado.tabelas = {
    works,
    work_synopses: works.map((w) => ({ id: `s-${w.id}`, work_id: w.id, text: `primária de ${w.id}`, is_primary: true })),
    work_genres: works.map((w, i) => ({ work_id: w.id, genre_id: i % 2 ? "g-rom" : "g-fan", genres: { name: i % 2 ? "Romance" : "Fantasy" } })),
    work_tags: [],
    personal_status: [],
    publication_status: [],
  }
}

const L = (field: string, dir: "asc" | "desc" = "desc"): SortLevel => ({ field, dir }) as SortLevel
const CATALOGO: RankingFilters = { includeFinishedDropped: true }
const SLUG = CRITERION_SLUGS[0]

/** Ordenações e filtros que o /catalog aceita, mais o caminho por lotes de id (gênero). */
const CASOS: Array<[string, RankingFilters]> = [
  ["padrão (sem sortLevels)", { ...CATALOGO }],
  ["Nota Prevista", { ...CATALOGO, sortLevels: [L("expected_score")] }],
  ["Prioridade", { ...CATALOGO, sortLevels: [L("decision")] }],
  ["Prioridade + média externa", { ...CATALOGO, sortLevels: [L("decision"), L("platform_avg")] }],
  ["Veredito", { ...CATALOGO, sortLevels: [L("alignment_score")] }],
  ["título", { ...CATALOGO, sortLevels: [L("title", "asc")] }],
  ["ano + votos", { ...CATALOGO, sortLevels: [L("year", "asc"), L("total_votes")] }],
  ["critério", { ...CATALOGO, sortLevels: [L(`crit_${SLUG}`)] }],
  ["arte", { ...CATALOGO, sortLevels: [L("art")] }],
  ["alinhamento", { ...CATALOGO, sortLevels: [L("personal_fit")] }],
  ["Interesse previsto", { ...CATALOGO, sortLevels: [L("synopsis_pred")] }],
  ["sua nota", { ...CATALOGO, sortLevels: [L("user_score")] }],
  ["atualizada em", { ...CATALOGO, sortLevels: [L("updated_at")] }],
  ["capítulos", { ...CATALOGO, sortLevels: [L("chapters_total", "asc")] }],
  ["filtro: Veredito mínimo", { ...CATALOGO, minAlignment: 50, sortLevels: [L("decision")] }],
  ["filtro: critério mínimo", { ...CATALOGO, criterionMin: { [SLUG]: 5 } }],
  ["filtro: arte forte", { ...CATALOGO, artFilter: "forte" }],
  ["filtro: status de publicação", { ...CATALOGO, publicationStatus: ["Completed"], sortLevels: [L("decision")] }],
  ["filtro: Nota Prevista mínima", { ...CATALOGO, minExpectedScore: 7 }],
  ["filtro: só com nota", { ...CATALOGO, onlyWithFinalScore: true }],
  ["filtro: gênero (lotes de id)", { ...CATALOGO, genreAny: ["Romance"], sortLevels: [L("decision")] }],
  ["arquivadas incluídas", { ...CATALOGO, includeArchived: true, sortLevels: [L("decision")] }],
  ["topN", { ...CATALOGO, topN: 10, sortLevels: [L("decision")] }],
  ["sem includeFinishedDropped", { sortLevels: [L("decision")] }],
]

/**
 * Combinações em que o resultado VAZIO é o correto, nos dois modos: o visitante não tem Nota
 * Prevista nem arte (campos pessoais), e a outra conta não tem estimativa de arte. Fora daqui,
 * vazio é tratado como falha — senão a igualdade "[] = []" passaria por vacuidade.
 */
const VAZIO_ESPERADO = new Set(["anon · filtro: arte forte", "anon · filtro: só com nota", "outra · filtro: arte forte"])

const ids = (entries: Array<{ workId: string }>) => entries.map((e) => e.workId)
const worksSelects = () => estado.consultas.filter((c) => c.tabela === "works").map((c) => c.select.replace(/\s+/g, ""))

describe("getRanking em modo 'ordering-only' (o /catalog)", () => {
  beforeEach(semear)

  it("contraprova: neste catálogo a `confidence` do Veredito MUDA a ordem da Prioridade", async () => {
    estado.leitor = "dona"
    const com = ids(await getRanking({ ...CATALOGO, sortLevels: [L("decision")] }))
    for (const w of estado.tabelas.works) {
      const cs = w.calculated_scores as Row
      if (cs.alignment_payload) cs.alignment_payload = { ...(cs.alignment_payload as Row), confidence: undefined }
    }
    const sem = ids(await getRanking({ ...CATALOGO, sortLevels: [L("decision")] }))
    // Se isto passar a ser igual, os casos abaixo deixam de provar que a confiança chega.
    expect(sem).not.toEqual(com)
  })

  for (const leitor of ["dona", "anon", "outra"] as Leitor[]) {
    for (const [nome, filtros] of CASOS) {
      it(`${leitor} · ${nome}: mesma sequência de workId e mesmo total do modo completo`, async () => {
        estado.leitor = leitor
        const completo = await getRanking(filtros)
        const soOrdem = await getRanking(filtros, { mode: "ordering-only" })
        if (VAZIO_ESPERADO.has(`${leitor} · ${nome}`)) expect(completo.length).toBe(0)
        else expect(completo.length).toBeGreaterThan(0)
        expect(soOrdem.length).toBe(completo.length)
        expect(ids(soOrdem)).toEqual(ids(completo))
        expect(soOrdem.map((e) => e.rank)).toEqual(completo.map((e) => e.rank))
      })
    }
  }

  it("a Prioridade sai idêntica nos dois modos, para os três leitores (a confiança da dona não vaza)", async () => {
    for (const leitor of ["dona", "anon", "outra"] as Leitor[]) {
      estado.leitor = leitor
      const filtros = { ...CATALOGO, sortLevels: [L("decision")] }
      const porId = (es: Array<{ workId: string }>) =>
        Object.fromEntries(es.map((e) => [e.workId, (e as unknown as { decisionScore: number | null }).decisionScore]))
      const completo = porId(await getRanking(filtros))
      const soOrdem = porId(await getRanking(filtros, { mode: "ordering-only" }))
      expect(soOrdem, leitor).toEqual(completo)
    }
  })

  it("não pede os campos que só desenham a linha, nem as sinopses primárias", async () => {
    estado.leitor = "dona"
    await getRanking({ ...CATALOGO, sortLevels: [L("decision")] }, { mode: "ordering-only" })
    const sels = worksSelects().filter((s) => s.includes("calculated_scores"))
    expect(sels.length).toBeGreaterThan(0)
    for (const s of sels) {
      for (const pesado of [
        "canonical_synopsis",
        "alignment_justification",
        "alignment_at",
        "work_covers",
        "publication_status_note",
        "hiatus_kind",
      ]) {
        expect(s, pesado).not.toContain(pesado)
      }
      // Do payload, só a confiança.
      expect(s).toContain("alignment_payload->confidence")
      expect(s).not.toMatch(/alignment_payload(?!->)/)
    }
    expect(estado.consultas.some((c) => c.tabela === "work_synopses")).toBe(false)
  })

  it("o modo completo segue pedindo e entregando o que desenha a linha", async () => {
    estado.leitor = "dona"
    const entries = await getRanking({ ...CATALOGO, sortLevels: [L("decision")] })
    const sels = worksSelects().filter((s) => s.includes("calculated_scores"))
    for (const s of sels) {
      for (const campo of ["canonical_synopsis", "alignment_justification", "alignment_payload,", "alignment_at", "work_covers"]) {
        expect(s, campo).toContain(campo)
      }
    }
    expect(estado.consultas.some((c) => c.tabela === "work_synopses")).toBe(true)

    const porId = new Map(estado.tabelas.works.map((w) => [w.id as string, w]))
    for (const e of entries) {
      const w = porId.get(e.workId)!
      const cs = w.calculated_scores as Row
      expect(e.coverUrls).toEqual([`https://capa/${Number(e.workId.slice(-12))}.jpg`])
      expect(e.alignmentJustification).toBe(cs.alignment_justification ?? null)
      expect(e.alignmentPayload).toEqual(cs.alignment_payload ?? null)
      const canon = typeof w.canonical_synopsis === "string" ? (w.canonical_synopsis as string).trim() : ""
      expect(e.synopsis).toBe(canon || `primária de ${e.workId}`)
    }
  })
})
