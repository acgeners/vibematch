import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * O "Salvar" do Meu Status (`updateWorkStatus`, caminho da dona) só marca o recálculo com mudança
 * MATERIAL, e o lado "depois" do diff é o que o escritor GRAVOU — não o patch do formulário.
 *
 * 🔴 Com as 7 categorias de gosto completas e a leitura liberada, `writeReadingState` troca a nota
 * do patch pela das categorias (`writeByTasteLabel`). Comparar com o patch acusava "mudou" toda vez
 * que o formulário mandasse outra nota (a craft, calculada das 8 notas da pós-leitura): o aviso de
 * recalcular acendia sem nada ter mudado.
 */
vi.mock("server-only", () => ({}))

const markRecalcPending = vi.fn()
const writeReadingState = vi.fn()

type Linha = Record<string, unknown> | null
let antes: Linha
let gravado: Linha
let erroNaReleitura: { message: string } | null

/** Banco falso: `works_owner` devolve o estado anterior; `user_work_state`, o gravado. */
function clienteFalso() {
  return {
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: tabela === "works_owner" ? antes : null, error: null }),
        maybeSingle: async () =>
          tabela === "user_work_state" ? { data: gravado, error: erroNaReleitura } : { data: null, error: null },
      }
      return q
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  markRecalcPending.mockReset()
  writeReadingState.mockReset().mockResolvedValue({ error: null })
  erroNaReleitura = null
  antes = {
    personal_status_id: null,
    chapters_read: 50,
    last_read_at: "2026-11-01",
    total_chapters: 50,
    user_score: 7.6,
    observation_adjustment: 0,
    observations: null,
    synopsis_quality: null,
  }
  gravado = { user_score: 7.6, observation_adjustment: 0, synopsis_quality: null }

  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))
  vi.doMock("next/server", () => ({ after: vi.fn() }))
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteFalso() }))
  vi.doMock("@/server/recalc/queue", () => ({
    markRecalcPending: (...a: unknown[]) => markRecalcPending(...a),
    recalculateScoresNow: vi.fn(),
  }))
  vi.doMock("@/server/recalc/user-recalc-schedule", () => ({ scheduleUserRecalc: vi.fn() }))
  vi.doMock("@/server/queries/user-work-state", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ensureReadingStateWriter: async () => ({ ok: true, userId: "dona", isOwner: true }),
    writeReadingState: (...a: unknown[]) => writeReadingState(...a),
  }))
})

/** O formulário com as 8 notas da pós-leitura preenchidas manda a nota craft (8,4). */
const formulario = {
  personal_status: "Finished" as const,
  chapters_read: 50,
  last_read_at: "2026-11-01",
  observation_adjustment: 0,
  observations: null,
  synopsis_quality: null,
  user_score: 8.4,
  post_story_score: 8,
  post_fl_score: 9,
  post_ml_score: 8,
  post_character_development_score: 8,
  post_pacing_score: 9,
  post_art_visual_score: 8,
  post_impact_immersion_score: 9,
  post_originality_score: 8,
}

async function salvar() {
  const { updateWorkStatus } = await import("@/server/actions/works")
  const res = await updateWorkStatus("w1", formulario)
  expect(res).toEqual({ data: { id: "w1" } })
  // o patch levou a nota do formulário: quem a troca é o escritor
  expect(writeReadingState.mock.calls[0][2]).toMatchObject({ user_score: 8.4 })
  expect(markRecalcPending).toHaveBeenCalledTimes(1)
  return markRecalcPending.mock.calls[0][1] as { changed: string[] }
}

describe("updateWorkStatus — o diff do recálculo é contra o GRAVADO", () => {
  it("🔴 as categorias venceram e a nota ficou a mesma ⇒ nada material mudou", async () => {
    expect((await salvar()).changed).toEqual([])
  })

  it("a nota gravada mudou de verdade ⇒ marca `user_score`", async () => {
    gravado = { user_score: 8.4, observation_adjustment: 0, synopsis_quality: null }
    expect((await salvar()).changed).toEqual(["user_score"])
  })

  it("releitura falhou ⇒ cai no patch e marca (na dúvida, marcar)", async () => {
    erroNaReleitura = { message: "timeout" }
    gravado = null
    expect((await salvar()).changed).toEqual(["user_score"])
  })
})
