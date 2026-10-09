import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { chavePrimaria, ordemDePaginacao, paginasOrdenadas } from "@/scripts/lib/backup-ordem.mjs"

/**
 * O backup pagina com ORDEM TOTAL — senão repete e perde linhas sem mudar a contagem.
 *
 * 🔴 O defeito é real e foi medido na nuvem (2026-09-21): 2.050 linhas lidas em 3 páginas sem
 * `ORDER BY` viraram 1.550 únicas. No `backup-db.mjs` ele seria MUDO, porque a guarda compara só
 * `written !== count`: repetidas compensando perdidas fecham a conta.
 *
 * O banco falso abaixo reproduz o que o Postgres promete — e o que ele NÃO promete: cada consulta
 * vê as linhas numa permutação nova, e `order` só fixa a ordem do que a coluna pedida separa
 * (empates continuam na ordem da vez). A semente é fixa para o resultado ser reprodutível.
 */

const RAIZ = join(import.meta.dirname, "../../..")

function rng(semente: number) {
  let a = semente
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Linha = Record<string, string | number>

function bancoFalso(linhas: Linha[], semente = 42) {
  const sorteio = rng(semente)
  return () => {
    const ordem: string[] = []
    const builder = {
      order(coluna: string) {
        ordem.push(coluna)
        return builder
      },
      range(from: number, to: number) {
        const embaralhadas = [...linhas]
        for (let i = embaralhadas.length - 1; i > 0; i--) {
          const j = Math.floor(sorteio() * (i + 1))
          ;[embaralhadas[i], embaralhadas[j]] = [embaralhadas[j], embaralhadas[i]]
        }
        // `sort` é ESTÁVEL: o que a ordem pedida não separa fica na permutação desta consulta.
        const vistas = embaralhadas.sort((x, y) => {
          for (const c of ordem) if (x[c] !== y[c]) return x[c] < y[c] ? -1 : 1
          return 0
        })
        return Promise.resolve({ data: vistas.slice(from, to + 1), error: null })
      },
    }
    return builder
  }
}

async function lerTudo(construir: ReturnType<typeof bancoFalso>, ordem: string[], chave: (l: Linha) => string) {
  const lidas: string[] = []
  for await (const pagina of paginasOrdenadas(construir, ordem, 1000, "t")) lidas.push(...pagina.map(chave))
  return { total: lidas.length, unicas: new Set(lidas).size }
}

const PK = "Note:\nThis is a Primary Key.<pk/>"
const coluna = (description?: string) => ({ type: "string", ...(description ? { description } : {}) })

// 2.500 obras (3 páginas) com `id` único; e 2.500 vínculos obra × tag onde `work_id` se REPETE.
// ⚠️ 7 tags por obra, não 5: com 5, a fronteira de 1.000 cai no fim exato de um grupo de empate
// e o defeito não aparece — o caso nasceria inofensivo.
const comId: Linha[] = Array.from({ length: 2500 }, (_, i) => ({ id: `w-${String(i).padStart(5, "0")}` }))
const workTags: Linha[] = Array.from({ length: 2500 }, (_, i) => ({
  work_id: `w-${String(Math.floor(i / 7)).padStart(4, "0")}`,
  tag_id: `t-${i % 7}`,
}))
const chaveId = (l: Linha) => String(l.id)
const chaveWorkTag = (l: Linha) => `${l.work_id}|${l.tag_id}`

describe("o defeito que a ordem evita", () => {
  it("sem ordem, 3 páginas repetem e perdem linhas — e a CONTAGEM fecha igual (por isso a guarda não via)", async () => {
    const r = await lerTudo(bancoFalso(comId), [], chaveId)
    expect(r.total).toBe(2500)
    expect(r.unicas).toBeLessThan(2500)
  })
})

describe("caso A — paginação com ordem total", () => {
  it("lê as 2.500 linhas em 3 páginas, sem repetida e sem perdida", async () => {
    const r = await lerTudo(bancoFalso(comId), ["id"], chaveId)
    expect(r).toEqual({ total: 2500, unicas: 2500 })
  })
})

describe("caso B — empate na primeira coluna", () => {
  it("ordenar só pelo `work_id` (que se repete) ainda repete e perde na fronteira das páginas", async () => {
    const r = await lerTudo(bancoFalso(workTags), ["work_id"], chaveWorkTag)
    expect(r.total).toBe(2500)
    expect(r.unicas).toBeLessThan(2500)
  })

  it("a PK composta inteira (`work_id`, `tag_id`) desempata e a leitura fecha", async () => {
    const ordem = chavePrimaria({ properties: { work_id: coluna(PK), tag_id: coluna(PK), source: coluna("Origem") } })
    expect(ordem).toEqual(["work_id", "tag_id"])
    const r = await lerTudo(bancoFalso(workTags), ordem, chaveWorkTag)
    expect(r).toEqual({ total: 2500, unicas: 2500 })
  })
})

describe("caso C — a chave sai do OpenAPI, tabela por tabela", () => {
  it("PK simples chamada `id`", () => {
    expect(chavePrimaria({ properties: { id: coluna(PK), title: coluna() } })).toEqual(["id"])
  })

  it("PK que NÃO se chama `id` e também é FK (forma real de `ai_evaluation_art`)", () => {
    const def = {
      properties: {
        ai_evaluation_id: coluna(
          "Note:\nThis is a Primary Key.<pk/>\nThis is a Foreign Key to `ai_evaluations.id`.<fk table='ai_evaluations' column='id'/>",
        ),
        work_id: coluna("Note:\nThis is a Foreign Key to `works.id`.<fk table='works' column='id'/>"),
      },
    }
    expect(chavePrimaria(def)).toEqual(["ai_evaluation_id"])
  })

  it("sem chave primária: vale só se cabe numa página; passou disso, FALHA nomeando a tabela", () => {
    const snapshot = { properties: { id: coluna(), title: coluna() } }
    expect(chavePrimaria(snapshot)).toEqual([])
    expect(ordemDePaginacao("works_snapshot", snapshot, 882, 1000)).toEqual([])
    expect(ordemDePaginacao("works_snapshot", snapshot, 1000, 1000)).toEqual([])
    expect(() => ordemDePaginacao("works_snapshot", snapshot, 1001, 1000)).toThrow(/works_snapshot: sem chave primária/)
  })

  it("com chave primária a ordem é a chave, qualquer que seja o tamanho", () => {
    expect(ordemDePaginacao("works", { properties: { id: coluna(PK) } }, 50_000, 1000)).toEqual(["id"])
  })
})

describe("erro de página mantém a mensagem que o backup imprimia", () => {
  it("rótulo da tabela + offset", async () => {
    const quebrado = () => ({
      order() {
        return this
      },
      range: () => Promise.resolve({ data: null, error: { message: "timeout" } }),
    })
    const ler = async () => {
      for await (const _ of paginasOrdenadas(quebrado, ["id"], 1000, "work_reviews")) void _
    }
    await expect(ler()).rejects.toThrow("work_reviews: página 0 falhou — timeout")
  })
})

describe("o `backup-db.mjs` pagina pelo dono da regra", () => {
  // Sem comentários: eles citam `.range()` para explicar o defeito.
  const src = readFileSync(join(RAIZ, "scripts/backup-db.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it("não tem `.range()` próprio — toda leitura de página passa por `paginasOrdenadas`", () => {
    expect(src).not.toMatch(/\.range\(/)
    expect(src).toMatch(/paginasOrdenadas\(/)
  })

  it("a ordem de cada tabela sai de `ordemDePaginacao`, com a definição do OpenAPI daquela tabela", () => {
    expect(src).toMatch(/ordemDePaginacao\(\s*table\s*,\s*definicao\s*,\s*count\s*,\s*PAGE\s*\)/)
    expect(src).toMatch(/dumpTable\(\s*t\s*,\s*defs\[t\]/)
  })
})
