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
// Arquivo VIVO: o teste de restore precisa que o `.delete().in([url])` reflita na
// leitura seguinte (getArchivedCoverUrls) — senão o filtro do syncExternalCovers
// barraria a capa que acabou de ser desarquivada. Um mock estático não pegaria a
// ordem "desarquiva ANTES de gravar", que é toda a correção do restore.
let archivedUrls = new Set<string>()

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

// Builder ESTATEFUL só pra work_cover_archive: `.delete().in("url",[...])` remove
// do conjunto; a leitura seguinte enxerga o conjunto atualizado.
function archiveChain(): unknown {
  let op: "select" | "delete" | "insert" | null = null
  let inUrls: string[] | null = null
  const builder: Record<string, unknown> = {
    select: () => ((op = "select"), builder),
    delete: () => ((op = "delete"), builder),
    insert: (rows: Array<{ url: string }>) => ((op = "insert"), rows.forEach((r) => archivedUrls.add(r.url)), builder),
    eq: () => builder,
    in: (_col: string, urls: string[]) => ((inUrls = urls), builder),
    then: (res: (v: unknown) => void) => {
      if (op === "delete") (inUrls ?? []).forEach((u) => archivedUrls.delete(u))
      const data = op === "select" ? [...archivedUrls].map((url) => ({ url })) : null
      return Promise.resolve({ data, error: null }).then(res)
    },
  }
  return builder
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "work_cover_archive") {
        return archiveChain()
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
  archivedUrls = new Set([ARCHIVED])
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

describe("restaurar uma arquivada no 'Atualizar dados'", () => {
  it("desarquiva ANTES de gravar, então a capa restaurada é inserida", async () => {
    const result = await updateWorkExternalData("work-1", {
      covers: [
        { url: ARCHIVED, source: "comix", isPrimary: true },
        { url: FRESH, source: "anilist", isPrimary: false },
      ],
      // o cliente só manda o que de fato foi restaurado + incluído
      restoredCoverUrls: [ARCHIVED],
    })

    expect(result).not.toHaveProperty("error")
    // A ordem é o que importa: o delete do arquivo roda ANTES do syncExternalCovers,
    // então a leitura do filtro já não vê ARCHIVED e ela passa.
    expect(archivedUrls.has(ARCHIVED)).toBe(false)
    const urls = insertedCovers.map((r) => r.url).sort()
    expect(urls).toEqual([FRESH, ARCHIVED].sort())
  })

  it("sem restoredCoverUrls, a MESMA capa em covers continua barrada (contraprova)", async () => {
    const result = await updateWorkExternalData("work-1", {
      covers: [
        { url: ARCHIVED, source: "comix", isPrimary: true },
        { url: FRESH, source: "anilist", isPrimary: false },
      ],
    })

    expect(result).not.toHaveProperty("error")
    expect(archivedUrls.has(ARCHIVED)).toBe(true) // segue arquivada
    expect(insertedCovers.map((r) => r.url)).toEqual([FRESH])
  })
})
