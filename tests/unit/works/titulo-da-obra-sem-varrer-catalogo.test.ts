import { describe, it, expect, vi, beforeEach } from "vitest"
import { titleToSlug } from "@/lib/utils"

/**
 * `getWorkTitleByIdOrSlug` alimenta o `generateMetadata` da página da obra (título da aba +
 * `canonical`) e da edição. Por slug, ele varria `works(title, previous_slugs)` inteira a cada
 * resolução — e o prefetch de produção dispara esse metadata para cada link de obra visível
 * (medido em 2026-10-05: 7 varreduras por carga da home anônima, 11 na logada; sem JS, zero).
 *
 * Agora o slug ATUAL sai do índice cacheado `getSlugToIdMap` (o mesmo do corpo da página) + o
 * título por id; alias, slug inexistente e índice velho caem na varredura de sempre. O oráculo
 * abaixo é a regra de sempre — slug atual primeiro (primeira obra por id), depois
 * `previous_slugs` — e o resultado tem que bater com ele em todos os casos.
 */

type Row = Record<string, unknown>
let db: Row[]
let selects: string[]
const cache = new Map<string, Promise<unknown>>()

vi.mock("next/cache", () => ({
  // Memoiza por chave, como o cache real faria dentro da janela de 300s.
  unstable_cache:
    (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[]) =>
    (...args: unknown[]) => {
      const k = JSON.stringify([keyParts, args])
      if (!cache.has(k)) cache.set(k, fn(...args))
      return cache.get(k)
    },
  revalidateTag: () => {},
  revalidatePath: () => {},
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let cols = "*"
      let range: [number, number] | null = null
      let single = false
      const orders: string[] = []
      const q: Record<string, unknown> = {
        select: (c: string) => ((cols = c), selects.push(`${table}:${c}`), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        order: (c: string) => (orders.push(c), q),
        range: (a: number, b: number) => ((range = [a, b]), q),
        maybeSingle: () => ((single = true), q),
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          let rows = db.filter((r) => filters.every((f) => f(r)))
          for (const c of [...orders].reverse()) rows = [...rows].sort((x, y) => String(x[c]).localeCompare(String(y[c])))
          if (range) rows = rows.slice(range[0], range[1] + 1)
          const keys = cols.split(",").map((k) => k.trim())
          const data = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])))
          return Promise.resolve({ data: single ? (data[0] ?? null) : data, error: null }).then(res, rej)
        },
      }
      return q
    },
  }),
}))

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`
const obra = (n: number, title: string, previous_slugs: string[] = []): Row => ({ id: id(n), title, previous_slugs })

/** A regra de sempre: slug atual primeiro (primeira obra por id), depois `previous_slugs`. */
function oraculo(slug: string): string | null {
  const porId = [...db].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const atual = porId.find((r) => titleToSlug(String(r.title ?? "")) === slug)
  if (atual) return atual.title as string
  return (porId.find((r) => ((r.previous_slugs as string[]) ?? []).includes(slug))?.title as string) ?? null
}

async function titulo(idOrSlug: string) {
  const { getWorkTitleByIdOrSlug } = await import("@/server/queries/works")
  return getWorkTitleByIdOrSlug(idOrSlug)
}
const varreduras = () => selects.filter((s) => s === "works:title, previous_slugs").length
const leiturasDoIndice = () => selects.filter((s) => s === "works:id, title").length

beforeEach(() => {
  cache.clear()
  selects = []
  db = [
    obra(1, "No Place for the Fake Princess", ["philomel-the-fake"]),
    obra(2, "Villains Are Destined to Die"),
    obra(3, "How to Save a Time-Limited Young Master", ["how-to-save-the-terminally-ill-young-master"]),
    obra(4, "Lady Baby"),
  ]
})

describe("getWorkTitleByIdOrSlug — slug atual pelo índice, sem varrer o catálogo", () => {
  it("UUID: título direto pela linha, sem índice nem varredura", async () => {
    expect(await titulo(id(2))).toBe("Villains Are Destined to Die")
    expect(selects).toEqual(["works:title"])
  })

  it("slug atual: título correto, sem a varredura larga", async () => {
    expect(await titulo("villains-are-destined-to-die")).toBe("Villains Are Destined to Die")
    expect(varreduras()).toBe(0)
    expect(leiturasDoIndice()).toBe(1)
  })

  it("várias resoluções reaproveitam o índice: 1 leitura dele, nenhuma varredura", async () => {
    for (const r of db) await titulo(titleToSlug(String(r.title)))
    expect(leiturasDoIndice()).toBe(1)
    expect(varreduras()).toBe(0)
    expect(selects.filter((s) => s === "works:title").length).toBe(db.length)
  })

  it("slug ANTIGO (previous_slugs): continua resolvendo, pelo fallback de sempre", async () => {
    expect(await titulo("philomel-the-fake")).toBe("No Place for the Fake Princess")
    expect(await titulo("how-to-save-the-terminally-ill-young-master")).toBe("How to Save a Time-Limited Young Master")
    expect(varreduras()).toBeGreaterThan(0)
  })

  it("obra inexistente: null, como antes", async () => {
    expect(await titulo("obra-que-nao-existe-xyz")).toBeNull()
  })

  it("índice velho depois de um RENAME: slug novo e slug antigo resolvem certo", async () => {
    await titulo("lady-baby") // índice cacheado com o título antigo
    db[3] = obra(4, "Lady Baby Returns", ["lady-baby"])

    expect(await titulo("lady-baby-returns")).toBe("Lady Baby Returns") // falta no índice → fallback
    expect(await titulo("lady-baby")).toBe("Lady Baby Returns") // índice aponta, a linha desmente → fallback
  })

  it("índice velho + COLISÃO: outra obra assume o slug antigo — vence o slug atual, como sempre", async () => {
    await titulo("lady-baby")
    db[3] = obra(4, "Lady Baby Returns", ["lady-baby"])
    db.push(obra(5, "Lady Baby")) // nova obra com o título que gera "lady-baby"

    expect(await titulo("lady-baby")).toBe(oraculo("lady-baby"))
    expect(await titulo("lady-baby")).toBe("Lady Baby")
  })

  it("obra criada depois do índice cacheado: resolve pelo fallback", async () => {
    await titulo("lady-baby")
    db.push(obra(6, "The Crown Princess Scandal"))
    expect(await titulo("the-crown-princess-scandal")).toBe("The Crown Princess Scandal")
  })

  it("bate com a regra de sempre em todos os slugs (atuais, antigos e inexistente)", async () => {
    const slugs = [
      ...db.map((r) => titleToSlug(String(r.title))),
      ...db.flatMap((r) => (r.previous_slugs as string[]) ?? []),
      "nada-disso-existe",
    ]
    for (const s of slugs) expect(await titulo(s)).toBe(oraculo(s))
  })
})
