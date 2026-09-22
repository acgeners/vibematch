import { describe, expect, it } from "vitest"
import { fetchRecalcWorks } from "@/server/queries/recalc-works"
import { fetchAllRows } from "@/lib/supabase/paginate"

/**
 * Um PostgREST de mentira com o comportamento que importa aqui: sem `.order`, cada página é
 * uma fatia da ORDEM FÍSICA do heap — e essa ordem muda quando uma linha é atualizada (MVCC).
 * `moverEntrePaginas` simula um UPDATE acontecendo entre uma página e a seguinte.
 */
type Linha = { id: string; is_archived: boolean }
function clienteFalso(linhas: Linha[], opts: { moverEntrePaginas?: boolean } = {}) {
  const fisica = [...linhas]
  let paginas = 0
  const cliente = {
    from(_tabela: string) {
      let ordem: keyof Linha | null = null
      const filtros: Array<[keyof Linha, unknown]> = []
      const q = {
        select: () => q,
        eq: (col: keyof Linha, v: unknown) => (filtros.push([col, v]), q),
        order: (col: keyof Linha) => ((ordem = col), q),
        range: (from: number, to: number) => {
          let base = fisica.filter((r) => filtros.every(([c, v]) => r[c] === v))
          if (ordem) {
            const c = ordem
            base = [...base].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0))
          }
          const data = base.slice(from, to + 1)
          paginas++
          // Um UPDATE entre as páginas: a primeira linha do heap ganha versão nova no fim.
          if (opts.moverEntrePaginas) fisica.push(...fisica.splice(0, 1))
          return Promise.resolve({ data, error: null })
        },
      }
      return q
    },
  }
  return { cliente, paginas: () => paginas, fisica }
}

// 2.500 obras (mais de duas páginas), ids em ordem física EMBARALHADA, e 100 arquivadas.
const hex = (n: number) => n.toString(16).padStart(8, "0")
const obras: Linha[] = Array.from({ length: 2600 }, (_, i) => ({
  id: `${hex((i * 2654435761) >>> 0)}-0000-4000-8000-${hex(i)}0000`,
  is_archived: i % 26 === 0,
}))
const ativasOrdenadas = obras.filter((o) => !o.is_archived).map((o) => o.id).sort()

describe("fetchRecalcWorks — a leitura de works do recálculo", () => {
  it("contraprova: o falso REPRODUZ o defeito — sem ordem, um UPDATE entre páginas duplica/omite", async () => {
    const { cliente } = clienteFalso(obras, { moverEntrePaginas: true })
    const semOrdem = (await fetchAllRows<Linha>((from, to) =>
      cliente.from("works").select().eq("is_archived", false).range(from, to),
    )) as Linha[]
    const ids = semOrdem.map((r) => r.id)
    const distintas = new Set(ids)
    // Sem isto o teste abaixo passaria por vacuidade: é o que prova que o cenário morde.
    expect(distintas.size !== ativasOrdenadas.length || ids.length !== distintas.size).toBe(true)
  })

  it(`🔴 >1000 obras e ordem física mudando entre páginas: conjunto EXATO e ordenado por id`, async () => {
    const { cliente, paginas } = clienteFalso(obras, { moverEntrePaginas: true })
    const lidas = (await fetchRecalcWorks(cliente as never)) as Linha[]
    expect(paginas()).toBeGreaterThan(2)
    const ids = lidas.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length) // nenhuma duplicada
    expect(ids).toEqual(ativasOrdenadas) // nenhuma omitida, nenhuma arquivada, ordem canônica
  })

  it("mesma base em outra ordem física ⇒ resultado byte-idêntico (e em qualquer tamanho de página)", async () => {
    const a = await fetchRecalcWorks(clienteFalso(obras).cliente as never)
    const invertida = [...obras].reverse()
    const b = await fetchRecalcWorks(clienteFalso(invertida).cliente as never, 100)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})
