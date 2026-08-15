import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const ensureAdmin = vi.fn(async () => ({ ok: true as const }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: () => ensureAdmin() }))

let existingRows: Array<{ work_id: string; external_id: string | null; is_rejected: boolean }> = []
type UpsertRow = { work_id: string; source: string; external_id: null; is_rejected: boolean }
const upsertSpy = vi.fn(async (_rows: UpsertRow[], _opts: { onConflict: string }) => ({ error: null }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ in: async () => ({ data: existingRows, error: null }) }),
      }),
      upsert: (rows: UpsertRow[], opts: { onConflict: string }) => upsertSpy(rows, opts),
    }),
  }),
}))

import { markSourcesAbsent } from "@/server/external-ids/absence"

/**
 * O lote que ESVAZIA a fila de Fontes: ele grava "esta obra não existe nesta fonte".
 *
 * 🔴 O modo de falha caro não é marcar de menos — é o `upsert` com
 * `onConflict: "work_id,source"` sobrescrever um `external_id` ATIVO com NULL, apagando
 * um vínculo bom em silêncio. A lista da UI pode estar defasada (o vínculo entra em
 * background pelo resolve resiliente) e `"use server"` é endpoint público, então a
 * guarda TEM que estar no servidor.
 */
beforeEach(() => {
  existingRows = []
  upsertSpy.mockClear()
  ensureAdmin.mockClear()
  ensureAdmin.mockResolvedValue({ ok: true as const })
})

describe("markSourcesAbsent", () => {
  it("marca as obras sem vínculo com o par (external_id NULL, is_rejected true)", async () => {
    const res = await markSourcesAbsent(["w1", "w2"], "mangago")
    expect(res).toEqual({ marked: 2, skipped: 0 })
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsertSpy.mock.calls[0]
    expect(rows).toEqual([
      { work_id: "w1", source: "mangago", external_id: null, is_rejected: true },
      { work_id: "w2", source: "mangago", external_id: null, is_rejected: true },
    ])
    // A chave do conflito é a natural (work_id, source) — sem ela o upsert insere
    // duplicata e viola o unique.
    expect(opts).toEqual({ onConflict: "work_id,source" })
  })

  it("🔴 PULA quem já tem vínculo ativo em vez de apagá-lo", async () => {
    existingRows = [{ work_id: "w2", external_id: "slug-vivo", is_rejected: false }]
    const res = await markSourcesAbsent(["w1", "w2"], "mangago")
    expect(res).toEqual({ marked: 1, skipped: 1 })
    const [rows] = upsertSpy.mock.calls[0]
    expect(rows.map((r) => r.work_id)).toEqual(["w1"])
  })

  it("não chama o banco quando TODAS já têm vínculo", async () => {
    existingRows = [
      { work_id: "w1", external_id: "a", is_rejected: false },
      { work_id: "w2", external_id: "b", is_rejected: false },
    ]
    const res = await markSourcesAbsent(["w1", "w2"], "mangago")
    expect(res).toEqual({ marked: 0, skipped: 2 })
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it("uma ausência JÁ declarada não conta como vínculo — pode ser remarcada", async () => {
    existingRows = [{ work_id: "w1", external_id: null, is_rejected: true }]
    const res = await markSourcesAbsent(["w1"], "mangago")
    expect(res).toEqual({ marked: 1, skipped: 0 })
  })

  it("recusa fonte fora do universo derivado do banco", async () => {
    const res = await markSourcesAbsent(["w1"], "napster" as never)
    expect(res.error).toBe("Fonte inválida.")
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it("recusa quem não é curador — e ANTES de tocar no banco", async () => {
    ensureAdmin.mockResolvedValue({ ok: false, error: "Sem permissão." } as never)
    const res = await markSourcesAbsent(["w1"], "mangago")
    expect(res.error).toBe("Sem permissão.")
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it("lista vazia não vira upsert vazio", async () => {
    const res = await markSourcesAbsent([], "mangago")
    expect(res.error).toBe("Nenhuma obra selecionada.")
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it("deduplica ids repetidos", async () => {
    const res = await markSourcesAbsent(["w1", "w1", "w2"], "mangago")
    expect(res.marked).toBe(2)
  })
})
