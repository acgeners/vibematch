import { describe, expect, it } from "vitest"
import { fetchAllRows, fetchAllRowsParallel } from "@/lib/supabase/paginate"
import type { PaginableQuery } from "@/lib/supabase/paginate"

/**
 * O contrato do paginador: a ordem é OBRIGATÓRIA, é aplicada pelo helper, na sequência
 * declarada, e SEMPRE antes do `.range()`.
 *
 * ⚠️ O builder falso REGISTRA a sequência de operações em vez de devolver `this` calado: um
 * mock que aceita qualquer chamada em qualquer ordem passaria verde com o `.range()` antes do
 * `.order()` — que é justamente o que este teste existe para impedir.
 */
type Op = ["order", string, boolean] | ["range", number, number]

function builderQueGrava(total: number) {
  const log: Op[][] = []
  const build = (): PaginableQuery => {
    const ops: Op[] = []
    log.push(ops)
    const q: PaginableQuery = {
      order(column, options) {
        ops.push(["order", column, options?.ascending ?? true])
        return q
      },
      range(from, to) {
        ops.push(["range", from, to])
        const n = Math.max(0, Math.min(to, total - 1) - from + 1)
        return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ i: from + i })), error: null })
      },
    }
    return q
  }
  return { build, log }
}

describe("fetchAllRows — ordem total obrigatória", () => {
  it("aplica as ordens NA SEQUÊNCIA declarada, com asc/desc, e só depois o range", async () => {
    const { build, log } = builderQueGrava(10)
    await fetchAllRows(build, {
      orderBy: [{ column: "created_at", ascending: false }, "title", { column: "id", ascending: false }],
    })
    expect(log[0]).toEqual([
      ["order", "created_at", false],
      ["order", "title", true],
      ["order", "id", false],
      ["range", 0, 999],
    ])
  })

  it("repete a MESMA ordem em todas as páginas (a estabilidade vem de cada página ser da mesma sequência)", async () => {
    const { build, log } = builderQueGrava(2500)
    const rows = await fetchAllRows<{ i: number }>(build, { orderBy: ["work_id", "tag_id"] })
    expect(rows).toHaveLength(2500)
    expect(log).toHaveLength(3)
    for (const [p, ops] of log.entries()) {
      expect(ops).toEqual([
        ["order", "work_id", true],
        ["order", "tag_id", true],
        ["range", p * 1000, p * 1000 + 999],
      ])
    }
  })

  it("recusa em runtime quem chega sem ordem por cast (o tipo já recusa em compilação)", async () => {
    const { build } = builderQueGrava(1)
    // @ts-expect-error — sem `orderBy` não compila: é a guarda de tipo do contrato.
    await expect(fetchAllRows(build, { label: "semOrdem" })).rejects.toThrow(/sem ordem declarada/)
    // @ts-expect-error — tupla vazia também não compila.
    await expect(fetchAllRows(build, { orderBy: [], label: "vazia" })).rejects.toThrow(/sem ordem declarada/)
  })
})

describe("fetchAllRowsParallel — mesma regra nas páginas paralelas", () => {
  it("cada página paralela recebe a ordem inteira antes do range", async () => {
    const { build, log } = builderQueGrava(2500)
    const rows = await fetchAllRowsParallel<{ i: number }>(
      () => Promise.resolve({ count: 2500, error: null }),
      build,
      { orderBy: ["id"], label: "par" },
    )
    expect(rows.map((r) => r.i)).toEqual(Array.from({ length: 2500 }, (_, i) => i))
    expect(log).toHaveLength(3)
    for (const ops of log) {
      expect(ops[0]).toEqual(["order", "id", true])
      expect(ops[1][0]).toBe("range")
      expect(ops).toHaveLength(2)
    }
  })

  it("no fallback sem count, cai no sequencial COM a mesma ordem", async () => {
    const { build, log } = builderQueGrava(1200)
    const rows = await fetchAllRowsParallel(() => Promise.resolve({ count: null, error: null }), build, {
      orderBy: [{ column: "id", ascending: false }],
    })
    expect(rows).toHaveLength(1200)
    expect(log.every((ops) => ops[0][0] === "order" && ops[0][2] === false && ops[1][0] === "range")).toBe(true)
  })

  it("recusa sem ordem antes de qualquer requisição", async () => {
    const { build, log } = builderQueGrava(10)
    let contou = false
    await expect(
      // @ts-expect-error — sem `orderBy` não compila.
      fetchAllRowsParallel(() => ((contou = true), Promise.resolve({ count: 10, error: null })), build, {}),
    ).rejects.toThrow(/sem ordem declarada/)
    expect(contou).toBe(false)
    expect(log).toHaveLength(0)
  })
})
