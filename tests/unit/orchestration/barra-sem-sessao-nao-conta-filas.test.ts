import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A action da barra (`getSidebarBadgeCounts`) roda em TODA página, inclusive para visitante — e
 * visitante não vê nenhum dos contadores (o AccountChip exige sessão; o resto é de curador).
 * Medido em 2026-10-05: 118 KB por página anônima só nas filas da barra.
 *
 * O que fica preso aqui:
 *   - sem sessão no cookie: nenhuma consulta das filas/pendências roda, e os contadores vêm 0;
 *   - com sessão: tudo segue calculado como antes;
 *   - o gatilho do recálculo automático (`maybeTriggerStaleRecalc`) roda nos DOIS casos — ele é
 *     o único disparador do recálculo atrasado e não pode sumir junto com os contadores;
 *   - falha ao ler a sessão é tratada como "sem sessão" (zeros, nenhuma consulta das filas).
 */

const getSession = vi.fn()
const maybeTriggerStaleRecalc = vi.fn()
const getCuradoriaBadgeUnreadCount = vi.fn()
const getRecommendationBadgeUnreadCount = vi.fn()
const getSettingsItemUnread = vi.fn()
const countOpenCurationRequests = vi.fn()

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getSession: () => getSession() } }) }))
vi.mock("@/server/recalc/queue", () => ({ maybeTriggerStaleRecalc: () => maybeTriggerStaleRecalc() }))
vi.mock("@/server/queries/ai-eval-read", () => ({
  getCuradoriaBadgeUnreadCount: () => getCuradoriaBadgeUnreadCount(),
  getRecommendationBadgeUnreadCount: () => getRecommendationBadgeUnreadCount(),
}))
vi.mock("@/server/queries/settings-read", () => ({ getSettingsItemUnread: () => getSettingsItemUnread() }))
vi.mock("@/server/queries/curation-requests", () => ({ countOpenCurationRequests: () => countOpenCurationRequests() }))
vi.mock("@/app/curation/settings/sections", () => ({
  SETTINGS_GROUPS: [{ id: "ia", sections: [{ id: "embeddings" }, { id: "sinopse" }] }],
}))
vi.mock("@/lib/external/comix-gate", () => ({ getComixStatus: () => ({ state: "degraded" }) }))

const consultasDasFilas = () => [
  getCuradoriaBadgeUnreadCount,
  getRecommendationBadgeUnreadCount,
  getSettingsItemUnread,
  countOpenCurationRequests,
]

async function barra() {
  const { getSidebarBadgeCounts } = await import("@/server/actions/badges")
  return getSidebarBadgeCounts()
}

beforeEach(() => {
  vi.clearAllMocks()
  maybeTriggerStaleRecalc.mockResolvedValue({ pending: true, lastEditAt: "2026-10-05T00:00:00Z" })
  getCuradoriaBadgeUnreadCount.mockResolvedValue(3)
  getRecommendationBadgeUnreadCount.mockResolvedValue(57)
  getSettingsItemUnread.mockResolvedValue({ embeddings: 2, sinopse: 1 })
  countOpenCurationRequests.mockResolvedValue(1)
})

describe("barra superior: visitante não paga as filas; o recálculo automático continua", () => {
  it("visitante (sem sessão no cookie): nenhuma consulta das filas, contadores zerados", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })

    const r = await barra()

    for (const consulta of consultasDasFilas()) expect(consulta).not.toHaveBeenCalled()
    expect(r).toEqual({
      curadoria: 0,
      recQueue: 0,
      settings: 0,
      requests: 0,
      settingsByGroup: {},
      recalcPending: true,
      comixHealth: "degraded",
    })
  })

  it("visitante: o gatilho do recálculo automático roda mesmo assim", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await barra()
    expect(maybeTriggerStaleRecalc).toHaveBeenCalledTimes(1)
  })

  it("logado: calcula tudo como antes, e o gatilho do recálculo também roda", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null })

    const r = await barra()

    for (const consulta of consultasDasFilas()) expect(consulta).toHaveBeenCalledTimes(1)
    expect(maybeTriggerStaleRecalc).toHaveBeenCalledTimes(1)
    expect(r).toEqual({
      curadoria: 3,
      recQueue: 57,
      settings: 3,
      requests: 1,
      settingsByGroup: { ia: 3 },
      recalcPending: true,
      comixHealth: "degraded",
    })
  })

  it("falha ao ler a sessão: trata como visitante — zeros e nenhuma consulta das filas", async () => {
    getSession.mockRejectedValue(new Error("cookies() indisponível"))

    const r = await barra()

    for (const consulta of consultasDasFilas()) expect(consulta).not.toHaveBeenCalled()
    expect(maybeTriggerStaleRecalc).toHaveBeenCalledTimes(1)
    expect(r.recQueue).toBe(0)
    expect(r.curadoria).toBe(0)
  })

  it("visitante com o gatilho do recálculo falhando: devolve 'não pendente', sem lançar", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    maybeTriggerStaleRecalc.mockRejectedValue(new Error("formula_config indisponível"))

    const r = await barra()

    expect(r.recalcPending).toBe(false)
    for (const consulta of consultasDasFilas()) expect(consulta).not.toHaveBeenCalled()
  })
})
