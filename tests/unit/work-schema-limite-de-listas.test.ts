import { describe, expect, it } from "vitest"
import type { z } from "zod"
import { WORK_FORM_LIST_MAX, workFormBase, workFormSchema } from "@/lib/validations/work.schema"

/**
 * O teto das listas do formulário da obra existe contra NEGAÇÃO DE SERVIÇO (ver
 * `WORK_FORM_LIST_MAX`): `createWork` é endpoint público para qualquer conta, e um array sem
 * teto fazia um pedido de 1 MB gerar 500 mil erros de validação (+521 MB medidos).
 *
 * Três coisas precisam valer juntas, e cada caso abaixo guarda uma:
 * 1. todo array do schema tem teto — derivado do PRÓPRIO schema, então um campo de lista novo
 *    sem `.max()` reprova sem ninguém lembrar de listá-lo aqui;
 * 2. o tamanho é conferido ANTES dos itens — é o que o zod ≥ 4.6.6 faz, e só ele: com o zod
 *    antigo, o caso da lista enorme volta a dar um erro POR ITEM;
 * 3. o teto não tranca obra que já existe — o carregador da edição valida com este schema e
 *    lança, então o teto fica bem acima do maior caso real.
 */

type Field = keyof typeof WORK_FORM_LIST_MAX
const FIELDS = Object.keys(WORK_FORM_LIST_MAX) as Field[]

// Maior caso medido na NUVEM em 2026-11-02 (1.087 obras). Só cresce com o tempo, então serve de
// PISO: um teto que encoste nele passa a trancar a edição da próxima obra que o ultrapassar.
const MAIOR_CASO_MEDIDO: Record<Field, number> = {
  alternative_titles: 40,
  genres: 10,
  tags: 259,
  extra_platform_ratings: 9,
  covers: 27,
  archived_covers: 10,
  synopses: 6,
}

const validItem: Record<Field, (i: number) => unknown> = {
  alternative_titles: (i) => `Título alternativo ${i}`,
  genres: (i) => `Gênero ${i}`,
  tags: (i) => `Tag ${i}`,
  extra_platform_ratings: (i) => ({ platform: `plataforma-${i}`, rating: 7, votes: 10 }),
  covers: (i) => ({ url: `https://exemplo.com/capa-${i}.jpg`, source: "manual", isPrimary: i === 0 }),
  archived_covers: (i) => ({ url: `https://exemplo.com/arquivada-${i}.jpg`, source: null }),
  synopses: (i) => ({ source: `fonte-${i}`, text: `Sinopse ${i}`, isPrimary: i === 0 }),
}

const lista = (field: Field, n: number) => Array.from({ length: n }, (_, i) => validItem[field](i))
const obra = (extra: Record<string, unknown>) => ({ title: "Obra de teste", ...extra })

type AnySchema = z.ZodType & { _zod: { def: Record<string, unknown> & { type: string } } }

/** Todos os nós `array` da cadeia de um campo (default, pipe, transform, optional…). */
function arrayNodes(schema: AnySchema): AnySchema[] {
  const def = schema._zod.def
  const filhos = ["innerType", "in", "out"].map((k) => def[k]).filter(Boolean) as AnySchema[]
  return [...(def.type === "array" ? [schema] : []), ...filhos.flatMap(arrayNodes)]
}

function maxLengthOf(node: AnySchema): number | undefined {
  const checks = (node._zod.def.checks ?? []) as Array<{ _zod: { def: { check: string; maximum?: number } } }>
  return checks.find((c) => c._zod.def.check === "max_length")?._zod.def.maximum
}

describe("limite das listas do formulário da obra", () => {
  it("todo array do schema tem teto, e é o declarado em WORK_FORM_LIST_MAX", () => {
    const shape = workFormBase.shape as unknown as Record<string, AnySchema>
    const comArray = Object.keys(shape).filter((k) => arrayNodes(shape[k]).length > 0)
    expect(comArray.sort()).toEqual([...FIELDS].sort())
    for (const field of FIELDS) {
      for (const node of arrayNodes(shape[field])) {
        expect(maxLengthOf(node), `${field}: um nó array sem .max()`).toBe(WORK_FORM_LIST_MAX[field])
      }
    }
  })

  it.each(FIELDS)("%s: o teto fica bem acima do maior caso real", (field) => {
    expect(WORK_FORM_LIST_MAX[field]).toBeGreaterThanOrEqual(MAIOR_CASO_MEDIDO[field] * 5)
  })

  it.each(FIELDS)("%s: aceita exatamente o teto", (field) => {
    const r = workFormBase.safeParse(obra({ [field]: lista(field, WORK_FORM_LIST_MAX[field]) }))
    expect(r.success, JSON.stringify(r.error?.issues.slice(0, 2))).toBe(true)
  })

  it.each(FIELDS)("%s: um item acima do teto é recusado com UM erro, no próprio campo", (field) => {
    const r = workFormBase.safeParse(obra({ [field]: lista(field, WORK_FORM_LIST_MAX[field] + 1) }))
    expect(r.success).toBe(false)
    expect(r.error!.issues).toHaveLength(1)
    expect(r.error!.issues[0]).toMatchObject({ code: "too_big", path: [field] })
    expect(r.error!.issues[0].message).toContain(String(WORK_FORM_LIST_MAX[field]))
  })

  // 🔴 O caso que o alerta do zod descreve. Com o zod < 4.6.6 este mesmo pedido devolve um erro
  // por item (100.001 aqui), mesmo com o `.max()` no lugar — conferido trocando a versão.
  it.each(FIELDS)("%s: lista enorme de itens inválidos para no tamanho, sem validar item por item", (field) => {
    for (const schema of [workFormBase, workFormSchema]) {
      const r = schema.safeParse(obra({ [field]: Array(100_000).fill(1) }))
      expect(r.success).toBe(false)
      expect(r.error!.issues).toHaveLength(1)
      expect(r.error!.issues[0]).toMatchObject({ code: "too_big", path: [field] })
    }
  })
})
