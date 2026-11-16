import { beforeEach, describe, expect, it, vi } from "vitest"
import { getPublicationStatusIdByName } from "@/lib/constants/status-lookups"

/**
 * A Chance de gostar entrou como FILTRO (`min_chance`/`max_chance`) e como ORDENAÇÃO
 * (`chance_score`) do `getRanking`, e a coluna imprime o inteiro de `displayChance` ("70%").
 *
 * 🔴 O que este teste prende é a régua "quem filtra e ordena vê o MESMO número da tela":
 *   - "≥ 70" aceita a obra que a coluna mostra como 70% (cru 69,5) e recusa a que mostra 69%;
 *   - duas obras que aparecem como 70% EMPATAM, e o nível seguinte de ordenação decide;
 *   - obra sem Chance não passa no filtro (régua da Prevista) e vai pro fim da ordenação;
 *   - sem modelo (visitante), o filtro pessoal não se aplica e a ordenação cai na média externa.
 *
 * O PostgREST falso é o mesmo de `catalogo-so-ordem.test.ts`, encolhido ao que estes casos usam.
 */

type Row = Record<string, unknown>

const estado = vi.hoisted(() => ({
  tabelas: {} as Record<string, Row[]>,
  leitor: "dona" as "dona" | "anon",
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
  let sel = "*"
  let faixa: [number, number] | null = null
  const q = {
    select: (s: string) => ((sel = s), q),
    eq: (col: string, v: unknown) => (preds.push((r) => valorEm(r, col) === v), q),
    in: (col: string, vs: unknown[]) => {
      const set = new Set(vs)
      preds.push((r) => set.has(valorEm(r, col)))
      return q
    },
    not: () => q,
    is: () => q,
    gte: () => q,
    lte: () => q,
    or: () => q,
    order: () => q,
    range: (from: number, to: number) => ((faixa = [from, to]), q),
    limit: () => q,
    then: (ok: (v: { data: Row[] | null; error: null }) => unknown) => {
      let rows = (estado.tabelas[tabela] ?? []).filter((r) => preds.every((p) => p(r)))
      rows = faixa ? rows.slice(faixa[0], faixa[1] + 1) : rows
      return Promise.resolve(ok({ data: rows.map((r) => projetar(r, sel)), error: null }))
    },
  }
  return q
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: () => {}, revalidatePath: () => {} }))
vi.mock("@/server/queries/current-user", () => ({ getHideAdultContent: async () => false }))
vi.mock("@/server/queries/verdict-scale", () => ({ getVerdictScale: async () => null }))
vi.mock("@/server/queries/synopsis-quality", () => ({ getAllActiveSynopsisPredictions: async () => new Map() }))
vi.mock("@/server/queries/user-scores", async (orig) => {
  const real = await orig<typeof import("@/server/queries/user-scores")>()
  const VAZIO: Record<string, unknown> = Object.fromEntries(
    real.PERSONAL_SCORE_FIELDS.map((f) => [
      f,
      f === "expected_is_stub" || f === "chance_is_stub" ? true : f === "alignment_stale" ? false : null,
    ]),
  )
  return {
    ...real,
    getScoresReader: async () =>
      estado.leitor === "dona"
        ? { userId: "dona", isOwner: true, hasModel: true, overlay: (_id: string, row: unknown) => row }
        : {
            userId: null,
            isOwner: false,
            hasModel: false,
            overlay: (_id: string, row: unknown) => (row ? { ...(row as object), ...VAZIO } : row),
          },
  }
})
vi.mock("@/server/queries/user-work-state", async (orig) => {
  const real = await orig<typeof import("@/server/queries/user-work-state")>()
  return {
    ...real,
    getPersonalStateReader: async () => ({ userId: null, get: () => ({ ...real.EMPTY_PERSONAL_STATE }) }),
    resolvePersonalFilterIds: async () => null,
  }
})

import { getRanking } from "@/server/queries/ranking"
import type { RankingFilters, SortLevel } from "@/server/queries/ranking"

const COMPLETED = getPublicationStatusIdByName("Completed")

/** [título, chance crua, média externa]. Os nomes dizem o que a COLUNA imprime. */
const OBRAS: Array<[string, number | null, number]> = [
  ["exibe 70 (cru 69,5)", 69.5, 7.0],
  ["exibe 70 (cru 70,4)", 70.4, 8.0],
  ["exibe 69 (cru 69,4)", 69.4, 9.0],
  ["exibe 85", 85.2, 6.0],
  ["sem chance", null, 9.5],
]

function semear() {
  estado.tabelas = {
    works: OBRAS.map(([title, chance, avg], i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      title,
      is_archived: false,
      is_adult: false,
      publication_status_id: COMPLETED,
      ai_eval_status: "done",
      total_chapters: 50,
      year: 2020,
      updated_at: "2026-01-01T00:00:00Z",
      calculated_scores: {
        expected_score: 7.5,
        expected_is_stub: false,
        chance_score: chance,
        platform_avg: avg,
        total_votes: 100,
        personal_fit: 0.5,
        personal_fit_percentile: 50,
        tag_overlap_net: 0,
        alignment_score: null,
        alignment_payload: null,
        alignment_stale: false,
      },
      category_scores: [],
      work_covers: [],
    })),
    work_synopses: [],
    work_genres: [],
    work_tags: [],
    personal_status: [],
    publication_status: [],
  }
}

const L = (field: string, dir: "asc" | "desc" = "desc"): SortLevel => ({ field, dir }) as SortLevel
const BASE: RankingFilters = { includeFinishedDropped: true }
const titulos = (entries: Array<{ title: string }>) => entries.map((e) => e.title)

describe("Chance de gostar no getRanking", () => {
  beforeEach(() => {
    semear()
    estado.leitor = "dona"
  })

  it("🔴 o filtro mínimo usa o inteiro EXIBIDO: '≥ 70' aceita o 69,5 que a coluna mostra como 70%", async () => {
    const r = titulos(await getRanking({ ...BASE, minChance: 70 }))
    expect(r).toContain("exibe 70 (cru 69,5)")
    expect(r).toContain("exibe 70 (cru 70,4)")
    expect(r).toContain("exibe 85")
    expect(r).not.toContain("exibe 69 (cru 69,4)")
  })

  it("o filtro máximo usa o mesmo inteiro: '≤ 70' aceita o 70,4 e recusa o 85", async () => {
    const r = titulos(await getRanking({ ...BASE, maxChance: 70 }))
    expect(r).toContain("exibe 70 (cru 70,4)")
    expect(r).toContain("exibe 69 (cru 69,4)")
    expect(r).not.toContain("exibe 85")
  })

  it("obra sem Chance não passa no filtro — 'mínimo que aprova quem não tem nota' não é filtro", async () => {
    expect(titulos(await getRanking({ ...BASE, minChance: 0 }))).not.toContain("sem chance")
    expect(titulos(await getRanking({ ...BASE, maxChance: 100 }))).not.toContain("sem chance")
  })

  it("🔴 obras exibidas como 70% EMPATAM na ordenação, e o 2º nível decide", async () => {
    // Pelo cru, 70,4 viria antes de 69,5 sempre. Empatadas no 70, a média externa (2º nível)
    // inverte: 8,0 antes de 7,0 — e é só assim que o nível escolhido pela pessoa entra.
    const asc = titulos(await getRanking({ ...BASE, sortLevels: [L("chance_score"), L("platform_avg", "asc")] }))
    expect(asc.indexOf("exibe 70 (cru 69,5)")).toBeLessThan(asc.indexOf("exibe 70 (cru 70,4)"))
    const desc = titulos(await getRanking({ ...BASE, sortLevels: [L("chance_score"), L("platform_avg", "desc")] }))
    expect(desc.indexOf("exibe 70 (cru 70,4)")).toBeLessThan(desc.indexOf("exibe 70 (cru 69,5)"))
  })

  it("ordenando por Chance (desc), a maior vem primeiro e a sem Chance vai pro fim", async () => {
    const r = titulos(await getRanking({ ...BASE, sortLevels: [L("chance_score")] }))
    expect(r[0]).toBe("exibe 85")
    expect(r.at(-1)).toBe("sem chance")
  })

  it("sem modelo (visitante), o filtro pessoal não se aplica e a ordem cai na média externa", async () => {
    estado.leitor = "anon"
    // Sem a guarda de `hasModel`, todas as Chances são null e o filtro apagaria o catálogo.
    expect(await getRanking({ ...BASE, minChance: 70 })).toHaveLength(OBRAS.length)
    const r = titulos(await getRanking({ ...BASE, sortLevels: [L("chance_score")] }))
    expect(r[0]).toBe("sem chance") // a maior média externa (9,5)
  })
})
