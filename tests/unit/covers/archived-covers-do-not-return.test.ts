import { describe, it, expect, vi, beforeEach } from "vitest"

// O que este arquivo prende é uma AUSÊNCIA: a capa que você apagou na edição não
// pode voltar quando o "Atualizar dados" grava as capas das fontes externas.
//
// É o pior formato de bug do projeto — o que produz resultado. Se o filtro sumir,
// nada quebra: nenhum tipo, nenhum lint, nenhuma exceção. A gravação "funciona",
// só que a capa ruim reaparece e você refaz a limpeza. Nada além deste teste
// percebe.
//
// O segundo caso é mais sutil que o primeiro: quando TUDO que veio de fora está
// arquivado, `syncExternalCovers` precisa SAIR ANTES do delete. Sem essa saída
// antecipada ele apagaria as capas atuais e não inseriria nada — a obra ficaria
// sem capa nenhuma por causa de um arquivamento.

const ARCHIVED = "https://cdn.exemplo/capa-ruim.jpg"
const FRESH = "https://cdn.exemplo/capa-boa.jpg"

let insertedCovers: Array<Record<string, unknown>> = []
let coversDeleted = false

/** Encadeável: qualquer método devolve o proxy; o `await` resolve `result`. */
const chain = (result: unknown, onCall?: (method: string, arg: unknown) => void): unknown =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
        }
        return (arg: unknown) => {
          onCall?.(String(prop), arg)
          return chain(result, onCall)
        }
      },
    },
  )

// `after()` só existe dentro de um request do Next. Fora dele lança, e a action
// devolveria esse erro em vez do resultado da gravação — que é o que medimos aqui.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn }))
// Idem: fora de um request, `revalidatePath` lança "static generation store missing".
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}))

vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => ({ ok: true }),
  ensurePermission: async () => ({ ok: true }),
  ensureSignedIn: async () => ({ ok: true, userId: "u1" }),
  getOwnerUserId: async () => "u1",
  getSynopsisCanonicalOnCreate: async () => false,
  getTagInferenceOnCreate: async () => false,
  getGenerateAllOnCreate: async () => false,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "work_cover_archive") {
        return chain({ data: [{ url: ARCHIVED }], error: null })
      }
      if (table === "work_covers") {
        return chain({ data: null, error: null }, (method, arg) => {
          if (method === "delete") coversDeleted = true
          if (method === "insert") insertedCovers = arg as Array<Record<string, unknown>>
        })
      }
      if (table === "works") {
        return chain({ data: { title: "Obra" }, error: null })
      }
      return chain({ data: [], error: null })
    },
  }),
}))

import { updateWorkExternalData } from "@/server/actions/works"

beforeEach(() => {
  insertedCovers = []
  coversDeleted = false
})

describe("capa arquivada não volta pelo 'Atualizar dados'", () => {
  it("descarta a arquivada e grava só as demais", async () => {
    const result = await updateWorkExternalData("work-1", {
      covers: [
        { url: ARCHIVED, source: "comix", isPrimary: true },
        { url: FRESH, source: "anilist", isPrimary: false },
      ],
    })

    expect(result).not.toHaveProperty("error")
    const urls = insertedCovers.map((r) => r.url)
    expect(urls).toEqual([FRESH])
    // A primária vinha marcada na ARQUIVADA: sem renormalizar, o insert iria com
    // zero primárias e a obra perderia a capa dos cards.
    expect(insertedCovers[0]?.is_primary).toBe(true)
  })

  it("quando TODAS as candidatas estão arquivadas, preserva as capas atuais", async () => {
    const result = await updateWorkExternalData("work-1", {
      covers: [{ url: ARCHIVED, source: "comix", isPrimary: true }],
    })

    expect(result).not.toHaveProperty("error")
    expect(insertedCovers).toEqual([])
    // O delete é o ponto sem volta: se rodar, a obra fica sem capa.
    expect(coversDeleted).toBe(false)
  })
})
