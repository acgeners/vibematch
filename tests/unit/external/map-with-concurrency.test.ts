import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "@/lib/external/map-with-concurrency"

/** Promise que só resolve quando alguém chamar o `solta` devolvido. */
function comControle<T>(): { promise: Promise<T>; solta: (v: T) => void } {
  let solta!: (v: T) => void
  const promise = new Promise<T>((res) => {
    solta = res
  })
  return { promise, solta }
}

describe("mapWithConcurrency", () => {
  it("nunca passa do teto de itens em voo", async () => {
    const portoes = Array.from({ length: 10 }, () => comControle<number>())
    let emVoo = 0
    let pico = 0

    const rodando = mapWithConcurrency(portoes, 3, async (p) => {
      emVoo++
      pico = Math.max(pico, emVoo)
      const v = await p.promise
      emVoo--
      return v
    })

    // Deixa o event loop dar a partida em quantos couberem.
    await new Promise((r) => setTimeout(r, 0))
    expect(pico).toBe(3)

    // Libera de um em um: o teto tem que se manter durante a drenagem inteira.
    for (const [i, p] of portoes.entries()) {
      p.solta(i)
      await new Promise((r) => setTimeout(r, 0))
    }

    await rodando
    expect(pico).toBe(3)
  })

  it("preserva a ORDEM da entrada mesmo com itens terminando fora de ordem", async () => {
    // O 1º demora mais que os outros — num map ingênuo por ordem de chegada, ele
    // apareceria por último, e quem casa índice com obra leria o resultado errado.
    const atrasos = [30, 0, 10, 0, 5]
    const out = await mapWithConcurrency(atrasos, 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms))
      return i
    })
    expect(out).toEqual([0, 1, 2, 3, 4])
  })

  it("não engole erro — a rejeição sobe, igual ao Promise.all que ele substitui", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("estourou")
        return n
      }),
    ).rejects.toThrow("estourou")
  })

  it("aceita lista vazia e teto maior que a lista", async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([2, 4])
  })
})
