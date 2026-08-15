import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }) }))

let existingRows: Array<{ source: string; external_id: string | null; is_rejected: boolean }> = []
const deleteSpy = vi.fn()
type UpsertRow = { work_id: string; source: string; external_id: string | null; is_rejected: boolean }
const upsertSpy = vi.fn(async (_rows: UpsertRow[]) => ({ error: null }))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: existingRows, error: null }) }),
      delete: () => ({
        eq: () => ({
          in: async (_col: string, sources: string[]) => {
            deleteSpy(sources)
            return { error: null }
          },
        }),
      }),
      upsert: async (rows: UpsertRow[]) => upsertSpy(rows),
    }),
  }),
}))

import { saveWorkSourceSelections } from "@/server/actions/external"

/**
 * O diálogo da aba "Fontes" PROMETE, por escrito, que a declaração de ausência é
 * reversível ("dá pra desfazer depois, obra a obra"). Quem cumpre a promessa não é uma
 * action dedicada — é este caminho: marcar a fonte como "Não decidir agora" faz o
 * `SourceSelectionStep` OMITIR a fonte do payload, e o `saveWorkSourceSelections` apaga
 * a linha porque ela não é um vínculo aceito.
 *
 * 🔴 Por isso o desfazer NÃO virou server action própria: seria um endpoint HTTP a mais
 * para algo que o fluxo existente já faz. Mas a promessa passa a depender de uma regra
 * escrita em OUTRO arquivo — e é exatamente esse tipo de dependência invisível que
 * apodrece. Se este teste cair, o texto do diálogo virou mentira.
 */
beforeEach(() => {
  existingRows = []
  deleteSpy.mockClear()
  upsertSpy.mockClear()
})

describe("desfazer a ausência pelo diálogo", () => {
  it("omitir a fonte do payload apaga o MARCADOR de ausência", async () => {
    existingRows = [{ source: "mangago", external_id: null, is_rejected: true }]
    // "Não decidir agora" ⇒ a fonte não entra no payload.
    await saveWorkSourceSelections("w1", [])
    expect(deleteSpy).toHaveBeenCalledWith(["mangago"])
  })

  it("🔴 mas NUNCA apaga um vínculo aceito omitido do payload", async () => {
    // O caso que a regra existe pra proteger: um tropeço transiente da fonte faz o card
    // nem aparecer no diálogo, e o salvar destruiria o id válido.
    existingRows = [{ source: "mangago", external_id: "slug-vivo", is_rejected: false }]
    await saveWorkSourceSelections("w1", [])
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it("marcar ausência pelo diálogo grava o mesmo par que o lote", async () => {
    await saveWorkSourceSelections("w1", [
      { source: "mangago", externalId: null, isRejected: true },
    ])
    expect(upsertSpy).toHaveBeenCalledWith([
      { work_id: "w1", source: "mangago", external_id: null, is_rejected: true },
    ])
  })
})
