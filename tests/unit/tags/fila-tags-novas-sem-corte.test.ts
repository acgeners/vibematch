// @vitest-environment node
// A fila "Tags novas" lê o conjunto INTEIRO. 🔴 Até 2026-10-14 cada parte era `.limit(2000)` numa
// requisição só e o PostgREST corta em 1.000 por resposta: em produção (v50) o contador dizia 1.544 e a
// lista abria 1.000. O bug passou verde porque o banco falso não cortava, não ordenava e aceitava `.in()`
// de qualquer tamanho — aqui os três estão ligados (`maxRows`, ordenação real, `maxInList`).
//
// Código real; nenhum provider é chamado (`createLoggedMessage` mockado e `fetch` proibido).
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createHash } from "node:crypto"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/server", () => ({ after: () => { throw new Error("a fila não agenda nada") } }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }) }))
vi.mock("@/lib/ai/anthropic-client", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  createLoggedMessage: vi.fn(() => { throw new Error("a fila não chama IA") }),
}))

import { listNewTags } from "@/server/actions/tag-review"
import { countNewTagsQueue, loadNewTagsQueue, rowNeedsRecovery } from "@/server/queries/new-tags-queue"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"

const CI = (TAG_GROUP_IDS as Record<string, string>)["content_indicator"]

/** UUID determinístico e SEM correlação com a ordem de criação (como os reais). */
const uuid = (seed: string) => {
  const x = createHash("md5").update(seed).digest("hex")
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

const tag = (o: Record<string, unknown>) => ({
  tag_group_id: null, tag_subgroup_id: null, adult_indicator: false, adult_indicator_strong: false, adult_score_tier: null,
  adult_score_tier_reviewed_at: null, reviewed_at: null, origin: "external", enrichment_status: "legacy",
  enrichment_detail: null, human_decisions: {}, ...o,
})

/**
 * `n` tags de fonte não revisadas (parte A), classificação registrada (fora da parte B). Por padrão cada
 * uma tem um instante; com `instantes`, elas se repartem em poucos instantes — o caso real (na réplica
 * local, 1.496 tags em 20 instantes, o maior com 1.431).
 */
function semear(n: number, instantes = n) {
  const base = Date.parse("2026-09-01T00:00:00Z")
  for (let i = 0; i < n; i++) {
    const t = new Date(base + (i % instantes) * 1000).toISOString()
    h.db.rows("tags").push(tag({ id: uuid(`a-${i}`), slug: `tag-${i}`, name: `Tag ${i}`, created_at: t }))
  }
}

/** A ordem esperada da parte A: a mais nova primeiro, `id` desempatando (decrescente). */
const ordemEsperada = (rows: Array<Record<string, unknown>>) =>
  [...rows]
    .sort((x, y) => (y.created_at as string).localeCompare(x.created_at as string) || ((y.id as string) < (x.id as string) ? -1 : 1))
    .map((r) => r.id as string)

/** Requisições da parte A (tags de fonte não revisadas) — uma por página. */
const paginasDaParteA = () =>
  h.db.log.filter((e) => e.table === "tags" && e.op === "select" && e.filtros?.includes("eq:origin")).map((e) => e.range)

beforeEach(() => {
  h.db = new FakeDb()
  h.db.maxRows = 1000 // o `max-rows` do PostgREST na nuvem
  h.db.maxInList = 200 // o gateway local recusa entre 200 e 300 UUIDs (414), medido em 2026-10-14
  globalThis.fetch = (() => { throw new Error("REDE PROIBIDA neste teste") }) as typeof fetch
  for (const t of ["tags", "work_tags"]) h.db.tables[t] = []
})

describe("o banco falso reproduz o que escondeu o bug (senão os casos abaixo nascem inofensivos)", () => {
  it("a consulta antiga (`.limit(2000)` numa requisição) volta com 1.000 de 1.544", async () => {
    semear(1544)
    const { data } = await createAdminClient().from("tags").select("id").eq("origin", "external").is("reviewed_at", null)
      .order("created_at", { ascending: false }).limit(2000)
    expect(data).toHaveLength(1000)
  })

  it("paginar com ordem PARCIAL (só created_at) sobre empates repete e perde linha", async () => {
    semear(1544, 3)
    h.db.desempateInstavel = true
    const rows = await fetchAllRows<{ id: string }>(
      () => createAdminClient().from("tags").select("id").eq("origin", "external").is("reviewed_at", null),
      { orderBy: [{ column: "created_at", ascending: false }] },
    )
    expect(rows).toHaveLength(1544)
    expect(new Set(rows.map((r) => r.id)).size).toBeLessThan(1544)
  })
})

describe("fila 'Tags novas': a lista traz o conjunto inteiro, em páginas de até 1.000", () => {
  it.each([
    { n: 700, paginas: [[0, 999]] },
    { n: 1000, paginas: [[0, 999], [1000, 1999]] },
    { n: 1544, paginas: [[0, 999], [1000, 1999]] },
    { n: 2250, paginas: [[0, 999], [1000, 1999], [2000, 2999]] },
  ])("$n tags → todas, sem repetir nem perder, na ordem da tela", async ({ n, paginas }) => {
    semear(n)
    const fila = await loadNewTagsQueue(h.db.client() as never)
    const ids = fila.map((t) => t.id)
    expect(ids).toHaveLength(n)
    expect(new Set(ids).size).toBe(n)
    expect(ids).toEqual(ordemEsperada(h.db.rows("tags")))
    expect(paginasDaParteA()).toEqual(paginas)
    expect(await countNewTagsQueue(h.db.client() as never)).toBe(n)
  })

  it("empates de created_at (o caso real) não trocam nem somem entre páginas: `id` desempata", async () => {
    semear(1544, 3) // 1.544 tags em 3 instantes
    h.db.desempateInstavel = true
    const fila = await loadNewTagsQueue(h.db.client() as never)
    const ids = fila.map((t) => t.id)
    expect(new Set(ids).size).toBe(1544)
    expect(ids).toEqual(ordemEsperada(h.db.rows("tags")))
  })
})

describe("integração: o retrato de produção (1.540 de fonte + as 4 que não foram classificadas)", () => {
  const QUATRO = ["rabbitbeast-s", "mouse-girl-s", "prehistoric-ambience", "catbeast-s"]
  beforeEach(() => {
    semear(1540, 20)
    QUATRO.forEach((slug, i) =>
      h.db.rows("tags").push(tag({
        id: uuid(`q-${slug}`), slug, name: slug, enrichment_status: "provider_not_called",
        enrichment_detail: "mig 210: nenhuma chamada de IA", created_at: `2026-10-08T06:15:1${i}Z`,
      })),
    )
    // fora da fila: de fonte já revisada, e manual com classificação registrada
    h.db.rows("tags").push(tag({ id: uuid("revisada"), slug: "revisada", name: "R", reviewed_at: "2026-09-02T00:00:00Z", created_at: "2026-10-09T00:00:00Z" }))
    h.db.rows("tags").push(tag({ id: uuid("manual"), slug: "manual", name: "M", origin: "manual", enrichment_status: "done", created_at: "2026-10-09T00:00:00Z" }))
  })

  it("contador = itens da lista = 1.544, e as 4 de recuperação vêm no topo", async () => {
    const rows = await listNewTags()
    expect(rows).toHaveLength(1544)
    expect(await countNewTagsQueue(h.db.client() as never)).toBe(rows.length)
    expect(rows.slice(0, 4).map((r) => r.slug).sort()).toEqual([...QUATRO].sort())
    expect(rows.slice(4).every((r) => r.enrichmentStatus === "legacy")).toBe(true)
    expect(rows.map((r) => r.slug)).not.toContain("revisada")
    expect(rows.map((r) => r.slug)).not.toContain("manual")
  })

  it("regra do #565 intacta: resolvida à mão, sai do topo mas continua na fila (é de fonte e não foi confirmada)", async () => {
    const t = h.db.rows("tags").find((x) => x.slug === "catbeast-s")!
    Object.assign(t, { tag_group_id: CI, human_decisions: { adult: { at: "2026-10-14T00:00:00Z", by: "curadora" } } })
    const fila = await loadNewTagsQueue(h.db.client() as never)
    expect(fila).toHaveLength(1544)
    expect(fila.slice(0, 3).every(rowNeedsRecovery)).toBe(true)
    expect(fila.slice(3).some(rowNeedsRecovery)).toBe(false)
    expect(fila.map((x) => x.slug)).toContain("catbeast-s")
    expect(await countNewTagsQueue(h.db.client() as never)).toBe(1544)
  })

  it("obras por tag contam certo em TODA a lista: ids em lotes curtos, e lote com > 1.000 vínculos pagina", async () => {
    const fila = await loadNewTagsQueue(h.db.client() as never)
    const [primeira, meio, ultima] = [fila[0], fila[800], fila[1543]]
    const vinculos: Array<[string, number]> = [[primeira.id, 2], [meio.id, 1234], [ultima.id, 3]]
    for (const [tagId, n] of vinculos) {
      for (let i = 0; i < n; i++) h.db.rows("work_tags").push({ work_id: uuid(`w-${i}`), tag_id: tagId })
    }
    const rows = await listNewTags()
    const obras = new Map(rows.map((r) => [r.id, r.workCount]))
    for (const [tagId, n] of vinculos) expect(obras.get(tagId)).toBe(n)
    expect(rows.filter((r) => r.workCount > 0)).toHaveLength(3)
    // toda leitura de work_tags foi um lote dentro do limite de URL (o fake recusaria acima de 200)
    expect(h.db.log.filter((e) => e.table === "work_tags").length).toBeGreaterThanOrEqual(16)
  })

  it("erro ao contar obras LANÇA — antes a falha virava '0 obras' em toda linha", async () => {
    h.db.failWhen = ({ table, op }) => (table === "work_tags" && op === "select" ? "injetado: read failed" : null)
    await expect(listNewTags()).rejects.toThrow(/fila Tags novas \(obras por tag\)/)
  })
})
