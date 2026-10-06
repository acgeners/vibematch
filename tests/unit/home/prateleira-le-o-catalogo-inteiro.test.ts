import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * "Pra você hoje" (`getTopPicksForToday`) escolhe entre TODAS as obras ativas — não entre as
 * primeiras 1.000 que o PostgREST devolve.
 *
 * O defeito, medido em 2026-10-05 contra a nuvem: a leitura era uma consulta só, com
 * `.limit(2000)` e sem ordem. O PostgREST corta em 1.000 sem erro; com 1.044 obras ativas, 44
 * ficavam de fora — e eram TODAS das 100 atualizadas mais recentemente, porque sem `ORDER BY` vem
 * a ordem física e a linha atualizada vai pro fim. A prateleira ignorava justamente a obra que
 * acabou de ser editada ou reavaliada.
 *
 * O PostgREST falso daqui reproduz as duas coisas: corta em 1.000 quando não há `range`, e devolve
 * as linhas na ordem "física" do array, com as obras de nota mais alta no FIM.
 */

type Row = Record<string, unknown>

const estado = vi.hoisted(() => ({
  fisica: [] as Row[],
  consultas: [] as Array<{ ordens: string[]; faixa: [number, number] | null; limite: number | null }>,
  status: new Map<string, number | null>(),
  hasModel: true,
}))

function builder() {
  const preds: Array<(r: Row) => boolean> = []
  const ordens: string[] = []
  let faixa: [number, number] | null = null
  let limite: number | null = null
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: unknown) => (preds.push((r) => r[col] === v), q),
    order: (col: string) => (ordens.push(col), q),
    range: (a: number, b: number) => ((faixa = [a, b]), q),
    limit: (n: number) => ((limite = n), q),
    then: (ok: (v: { data: Row[]; error: null }) => unknown) => {
      estado.consultas.push({ ordens: [...ordens], faixa, limite })
      let rows = estado.fisica.filter((r) => preds.every((p) => p(r)))
      for (const col of [...ordens].reverse()) rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])))
      // O teto do PostgREST: sem `range`, no máximo 1.000 linhas, diga o `.limit` o que disser.
      rows = faixa ? rows.slice(faixa[0], faixa[1] + 1) : rows.slice(0, Math.min(limite ?? 1000, 1000))
      return Promise.resolve(ok({ data: rows, error: null }))
    },
  }
  return q
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => builder() }) }))
vi.mock("@/server/queries/user-work-state", async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return {
    ...real,
    getPersonalStateReader: async () => ({
      userId: "dona",
      get: (id: string) => ({
        personalStatusId: estado.status.get(id) ?? null,
        chaptersRead: null,
        userScore: null,
        synopsisQuality: null,
        isFavorite: false,
        lastReadAt: null,
      }),
    }),
  }
})
vi.mock("@/server/queries/user-scores", () => ({
  getScoresReader: async () => ({
    userId: "dona",
    isOwner: true,
    hasModel: estado.hasModel,
    overlay: (_id: string, row: unknown) => row,
  }),
}))

import { getTopPicksForToday } from "@/server/queries/dashboard"
import { isPickablePersonalStatus, personalStatusNameOrDefault } from "@/lib/constants/status-lookups"

const N = 1044
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
// Ids do catálogo REAL de personal_status: 2 Reading (em curso, fica fora), 12 Read Again (entra),
// 8 Want to Read (entra), null = sem linha (aparenta Want to Read, entra).
const STATUS = [null, 8, 2, 12, null, 2]

function semear() {
  estado.consultas = []
  estado.status = new Map()
  estado.hasModel = true
  const linhas: Row[] = []
  for (let i = 0; i < N; i++) {
    linhas.push({
      id: id((i * 389) % N), // ids embaralhados: a ordem por id NÃO é a física
      title: `Obra ${i}`,
      is_archived: i % 97 === 0,
      publication_status_id: 1,
      is_adult: false,
      total_chapters: 50,
      // Nota cresce com a posição FÍSICA: as melhores são as últimas (as "recém-atualizadas").
      calculated_scores: { expected_score: 5 + (i / N) * 4, platform_avg: 9 - (i / N) * 3 },
      work_covers: [],
    })
    estado.status.set(id((i * 389) % N), STATUS[i % STATUS.length])
  }
  estado.fisica = linhas
}

/** A regra de pertencimento e de ordem, escrita à parte, sobre o catálogo INTEIRO. */
function oraculo(campo: "expected_score" | "platform_avg", limite: number) {
  return estado.fisica
    .filter((r) => !r.is_archived)
    .filter((r) => isPickablePersonalStatus(personalStatusNameOrDefault(estado.status.get(r.id as string) ?? null)))
    .map((r) => ({ id: r.id as string, v: (r.calculated_scores as Record<string, number>)[campo] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, limite)
    .map((r) => r.id)
}

describe("Pra você hoje: escolhe entre o catálogo inteiro, não entre as 1.000 primeiras linhas", () => {
  beforeEach(semear)

  it("contraprova: as obras de nota mais alta estão DEPOIS da linha 1.000 na ordem física", () => {
    const ativas = estado.fisica.filter((r) => !r.is_archived)
    expect(ativas.length).toBeGreaterThan(1000)
    const topo = new Set(oraculo("expected_score", 12))
    const primeiras1000 = new Set(estado.fisica.slice(0, 1000).map((r) => r.id))
    // Se o topo coubesse nas 1.000 primeiras, o teste não distinguiria leitura cortada de inteira.
    expect([...topo].some((x) => !primeiras1000.has(x))).toBe(true)
  })

  it("com modelo: as 12 são as de maior Nota Prevista no catálogo inteiro", async () => {
    const r = await getTopPicksForToday(12)
    expect(r.basis).toBe("expected")
    expect(r.items.map((w) => w.id)).toEqual(oraculo("expected_score", 12))
  })

  it("sem modelo: cai na nota da comunidade, também sobre o catálogo inteiro", async () => {
    estado.hasModel = false
    const r = await getTopPicksForToday(12)
    expect(r.basis).toBe("platform")
    expect(r.items.map((w) => w.id)).toEqual(oraculo("platform_avg", 12))
  })

  it("o corte continua por status: em curso fica fora; não começada e 'Ler de novo' entram", async () => {
    const r = await getTopPicksForToday(60)
    const status = r.items.map((w) => estado.status.get(w.id) ?? null)
    expect(status).not.toContain(2)
    expect(status).toContain(12)
    expect(status).toContain(8)
    expect(status).toContain(null)
  })

  // Qual coluna ordena é decisão do paginador (e a ordem TOTAL é guardada por
  // `paginacao-ordem-total.test.ts`); aqui o que importa é paginar com ordem, nunca o `.limit`.
  it("a leitura pagina com ordem, sem depender de `.limit`", async () => {
    await getTopPicksForToday(12)
    expect(estado.consultas.length).toBeGreaterThan(1)
    for (const c of estado.consultas) {
      expect(c.faixa).not.toBeNull()
      expect(c.ordens.length).toBeGreaterThan(0)
      expect(c.limite).toBeNull()
    }
  })
})
