import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 🔴 Excluir por tag/gênero NÃO pode virar `not id in (…)` na URL.
 *
 * A lista ia inteira na query string de cada página, e acima de ~650 ids (~24 KB) o gateway do
 * Supabase responde 400. Medido em produção em 2026-09-26: `/catalog?tags_exclude=webtoon-webcomic`
 * (904 obras) caía na tela de erro com `getRanking.works: Bad Request`. O "Esconder tags evitadas"
 * do `/ranking` e do `/favorites` passa pelo mesmo caminho (o dono cobria 559 obras, rente ao teto).
 *
 * O PostgREST falso daqui REPRODUZ o gateway: requisição com mais de 24.000 caracteres de filtro
 * volta 400. É isso que impede o teste de passar por vacuidade — ver a contraprova.
 */

type Row = Record<string, unknown>

const LIMITE_URL = 24_000

interface Registro {
  tabela: string
  notIn: string[]
  bytesFiltro: number
}

const estado = vi.hoisted(() => ({
  tabelas: {} as Record<string, Row[]>,
  registros: [] as Registro[],
}))

function valorEm(row: Row, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Row)[k]), row)
}

function builder(tabela: string) {
  const preds: Array<(r: Row) => boolean> = []
  const ordens: Array<[string, boolean]> = []
  const reg: Registro = { tabela, notIn: [], bytesFiltro: 0 }
  let faixa: [number, number] | null = null
  let limite: number | null = null
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => (preds.push((r) => valorEm(r, col) === v), (reg.bytesFiltro += String(v).length), q),
    in: (col: string, vs: unknown[]) => {
      const set = new Set(vs)
      preds.push((r) => set.has(valorEm(r, col)))
      reg.bytesFiltro += vs.map(String).join(",").length
      return q
    },
    not: (col: string, op: string, v: string) => {
      if (op === "in") {
        const ids = v.replace(/^\(|\)$/g, "").split(",")
        const set = new Set(ids)
        preds.push((r) => !set.has(String(valorEm(r, col))))
        reg.notIn.push(col)
        reg.bytesFiltro += v.length
      }
      return q
    },
    is: () => q,
    gte: () => q,
    lte: () => q,
    or: () => q,
    order: (col: string, opts?: { ascending?: boolean }) => (ordens.push([col, opts?.ascending ?? true]), q),
    range: (from: number, to: number) => ((faixa = [from, to]), q),
    limit: (n: number) => ((limite = n), q),
    then: (ok: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) => {
      estado.registros.push(reg)
      if (reg.bytesFiltro > LIMITE_URL) return Promise.resolve(ok({ data: null, error: { message: "Bad Request" } }))
      let rows = (estado.tabelas[tabela] ?? []).filter((r) => preds.every((p) => p(r)))
      for (const [col, asc] of [...ordens].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = String(valorEm(a, col)), y = String(valorEm(b, col))
          return x === y ? 0 : (x < y) === asc ? -1 : 1
        })
      }
      if (faixa) rows = rows.slice(faixa[0], faixa[1] + 1)
      else rows = rows.slice(0, Math.min(limite ?? 1000, 1000)) // o corte de 1000 do PostgREST
      return Promise.resolve(ok({ data: rows, error: null }))
    },
  }
  return q
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: () => {}, revalidatePath: () => {} }))
vi.mock("@/server/queries/current-user", () => ({ getHideAdultContent: async () => false }))
vi.mock("@/server/queries/verdict-scale", () => ({ getVerdictScale: async () => null }))
vi.mock("@/server/queries/synopsis-quality", () => ({ getAllActiveSynopsisPredictions: async () => new Map() }))
vi.mock("@/server/queries/user-scores", () => ({
  getScoresReader: async () => ({ userId: null, isOwner: false, hasModel: false, overlay: (_id: string, row: unknown) => row }),
}))
vi.mock("@/server/queries/user-work-state", async (orig) => {
  const real = await orig<typeof import("@/server/queries/user-work-state")>()
  return {
    ...real,
    getPersonalStateReader: async () => ({ userId: null, get: () => real.EMPTY_PERSONAL_STATE }),
    resolvePersonalFilterIds: async () => null,
  }
})

import { getRanking } from "@/server/queries/ranking"

// 1.027 obras (o catálogo de hoje); a tag "popular" cobre 904, a "rara" 37.
const N = 1027
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
const TODAS = Array.from({ length: N }, (_, i) => id(i))
const POPULAR = new Set(TODAS.slice(0, 904))
const RARA = new Set(TODAS.slice(990, 1027))

function semear() {
  estado.registros = []
  estado.tabelas = {
    works: TODAS.map((wid, i) => ({
      id: wid,
      title: `Obra ${String(i).padStart(4, "0")}`,
      is_archived: false,
      is_adult: false,
      publication_status_id: null,
      calculated_scores: { expected_score: 5 + (i % 50) / 10 },
      category_scores: [],
      work_covers: [],
    })),
    work_tags: TODAS.flatMap((wid, i) => [
      ...(POPULAR.has(wid) ? [{ work_id: wid, tag_id: "t-pop", tags: { slug: "popular" } }] : []),
      ...(RARA.has(wid) ? [{ work_id: wid, tag_id: "t-rara", tags: { slug: "rara" } }] : []),
      { work_id: wid, tag_id: `t-${i % 3}`, tags: { slug: `outra-${i % 3}` } },
    ]),
    work_genres: TODAS.map((wid, i) => ({ work_id: wid, genre_id: i < 1010 ? "g-rom" : "g-fan", genres: { name: i < 1010 ? "Romance" : "Fantasy" } })),
    work_synopses: [],
    personal_status: [],
    publication_status: [],
  }
}

const ids = (entries: Array<{ workId: string }>) => entries.map((e) => e.workId)

describe("exclusão por tag/gênero não vai para a URL", () => {
  beforeEach(semear)

  it("contraprova: o PostgREST falso DERRUBA um `not id in` de 904 ids, como o gateway real", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const r = await (createAdminClient() as unknown as { from: (t: string) => ReturnType<typeof builder> })
      .from("works")
      .not("id", "in", `(${[...POPULAR].join(",")})`)
    expect(r.error?.message).toBe("Bad Request")
  })

  it("🔴 excluir a tag de 904 obras: nenhuma requisição carrega `not id in`, e o resultado é o complemento exato", async () => {
    const entries = await getRanking({ tagSlugsExclude: ["popular"] })
    expect(estado.registros.flatMap((r) => r.notIn)).toEqual([])
    expect(Math.max(...estado.registros.map((r) => r.bytesFiltro))).toBeLessThan(LIMITE_URL)
    const esperadas = TODAS.filter((w) => !POPULAR.has(w))
    expect(entries).toHaveLength(esperadas.length) // 123 — a contagem que a tela imprime
    expect(new Set(ids(entries))).toEqual(new Set(esperadas))
  })

  it("a exclusão acontece ANTES da paginação visível: fatiar 50 por página não perde nem repete", async () => {
    const entries = await getRanking({ tagSlugsExclude: ["popular"] })
    const paginas = [0, 1, 2].map((p) => ids(entries).slice(p * 50, p * 50 + 50))
    expect(paginas.map((p) => p.length)).toEqual([50, 50, 23])
    expect(new Set(paginas.flat()).size).toBe(123)
    expect(paginas.flat().some((w) => POPULAR.has(w))).toBe(false)
  })

  it("exclusão pequena e exclusão vazia continuam iguais", async () => {
    const pequena = await getRanking({ tagSlugsExclude: ["rara"] })
    expect(pequena).toHaveLength(N - RARA.size)
    expect(ids(pequena).some((w) => RARA.has(w))).toBe(false)
    semear()
    expect(await getRanking({})).toHaveLength(N)
  })

  it("com grupo de favoritos (onlyWorkIds) a exclusão também vale, e sem `not id in`", async () => {
    const grupo = TODAS.slice(880, 960) // 24 na tag popular (880–903), 56 fora
    const entries = await getRanking({ tagSlugsExclude: ["popular"], onlyWorkIds: grupo } as never)
    expect(estado.registros.flatMap((r) => r.notIn)).toEqual([])
    expect(new Set(ids(entries))).toEqual(new Set(grupo.filter((w) => !POPULAR.has(w))))
  })

  it("com filtro positivo (busca por inclusão de tag) segue o caminho em memória de antes", async () => {
    const entries = await getRanking({ tagSlugsAny: ["outra-0"], tagSlugsExclude: ["popular"] })
    const esperadas = TODAS.filter((w, i) => i % 3 === 0 && !POPULAR.has(w))
    expect(new Set(ids(entries))).toEqual(new Set(esperadas))
  })
})

describe("guarda: nenhum `not id in` com lista montada em runtime", () => {
  it("server/, lib/ e app/ não montam `.not(\"id\", \"in\", …)` a partir de um conjunto de ids", async () => {
    const { execSync } = await import("node:child_process")
    const { readFileSync } = await import("node:fs")
    const arquivos = execSync("git ls-files server lib app", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f))
    const achados: string[] = []
    for (const f of arquivos) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (/^\s*(\/\/|\*)/.test(l)) return
          // A lista vinda de variável (template/join) é a forma que cresce com o catálogo; status
          // de publicação usa colunas próprias e poucos valores — não é `id`.
          if (/\.not\(\s*["'](id|work_id)["']\s*,\s*["']in["']/.test(l)) achados.push(`${f}:${i + 1}`)
        })
    }
    expect(achados).toEqual([])
  })
})
