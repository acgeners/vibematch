import { describe, it, expect, vi, beforeEach } from "vitest"
import { fakeSupabase, type Db, type FakeOptions } from "./fake-supabase"

/**
 * `/ranking` grava um snapshot prospectivo no ledger (`prediction_snapshots`) a cada visita —
 * e até 2026-10-04 gravava para QUALQUER visitante, no `user_id` do dono. A causa: a função
 * resolvia o usuário dentro do `after()` de um Server Component, onde o Next proíbe `cookies()`
 * (E843); a sessão virava null e `getCurrentUserId()` caía no dono. Medido: uma visita anônima
 * gravou 200 linhas.
 *
 * Estes testes rodam `recordRankingSnapshots` DE VERDADE sobre um banco em memória e conferem o
 * que de fato chega ao banco. O que prendem:
 *   - o dono autenticado continua gravando (a medição prospectiva dele não pode parar);
 *   - anônimo, outra conta e sessão ausente/ilegível NÃO gravam — e nem leem as notas;
 *   - ausência de sessão nunca é convertida em "dono" (o fallback `getCurrentUserId` sumiu
 *     deste caminho: ele está mockado devolvendo o dono, e mesmo assim nada é gravado);
 *   - não conseguir saber quem é o dono também não grava (falha fechada).
 */

const OWNER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
const W2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
const W3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"

let db: Db
let opts: FakeOptions
const ownerLookup = vi.fn(async () => OWNER)
// O fallback antigo: sem sessão, "o usuário atual" é o dono. Se o caminho voltar a passar por
// aqui, os casos de anônimo/sessão ausente gravam no dono e reprovam.
const currentUserFallback = vi.fn(async () => OWNER)

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeSupabase(db, opts) }))
vi.mock("@/server/queries/current-user", () => ({
  getOwnerUserId: () => ownerLookup(),
  getCurrentUserId: () => currentUserFallback(),
  getSessionUserId: async () => null,
}))
vi.mock("@/server/queries/tier-band-width", () => ({ getTierBandWidth: async () => 0.5 }))
vi.mock("@/server/queries/verdict-scale", () => ({ getVerdictScale: async () => null }))

const scores = (expected: number) => ({
  expected_score: expected,
  calc_score: expected - 0.2,
  personal_fit: 0.5,
  alignment_score: null,
  alignment_payload: null,
  expected_is_stub: false,
})

function baseDb(): Db {
  return {
    formula_config: [
      { formula_version: "v15", cv_mae_expected_stage1: 0.7, expected_stage2_train_size: 210, updated_at: "2026-10-03T06:40:00Z" },
    ],
    works_owner: [
      { id: W1, user_score: null, calculated_scores: scores(8.4) },
      { id: W2, user_score: 9.0, calculated_scores: scores(8.1) }, // já lida: não é prospectiva
      { id: W3, user_score: null, calculated_scores: scores(7.6) },
    ],
    prediction_snapshots: [],
  }
}

async function record(userId: string | null) {
  const { recordRankingSnapshots } = await import("@/lib/server/predictions/record-prediction")
  return recordRankingSnapshots({
    userId,
    orderedWorkIds: [W1, W2, W3],
    filtersKey: JSON.stringify({ publicationStatus: ["Completed"] }),
    moodKey: null,
  })
}

beforeEach(() => {
  db = baseDb()
  opts = { log: [] }
  ownerLookup.mockReset().mockImplementation(async () => OWNER)
  currentUserFallback.mockClear()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("recordRankingSnapshots — só o dono grava no ledger dele", () => {
  it("dono autenticado: continua gravando as obras prospectivas, no user_id dele", async () => {
    const n = await record(OWNER)

    expect(n).toBe(2)
    const gravadas = db.prediction_snapshots
    expect(gravadas.map((r) => r.work_id).sort()).toEqual([W1, W3].sort())
    expect(new Set(gravadas.map((r) => r.user_id))).toEqual(new Set([OWNER]))
    expect(gravadas.map((r) => r.rank_position).sort()).toEqual([1, 3])
    expect(opts.log).toContain("upsert:prediction_snapshots")
  })

  it("visitante anônimo (sessão null): não grava, não lê as notas e não cai no dono", async () => {
    const n = await record(null)

    expect(n).toBe(0)
    expect(db.prediction_snapshots).toEqual([])
    expect(opts.log).toEqual([])
    expect(currentUserFallback).not.toHaveBeenCalled()
  })

  it("outra conta autenticada: não grava (as notas registradas seriam as do dono)", async () => {
    const n = await record(OTHER)

    expect(n).toBe(0)
    expect(db.prediction_snapshots).toEqual([])
    expect(opts.log).not.toContain("select:works_owner")
    expect(opts.log).not.toContain("upsert:prediction_snapshots")
    expect(currentUserFallback).not.toHaveBeenCalled()
  })

  it("sessão ausente por QUALQUER forma (undefined, string vazia) não vira autorização", async () => {
    for (const ausente of [undefined, ""] as unknown as Array<string | null>) {
      expect(await record(ausente)).toBe(0)
    }
    expect(db.prediction_snapshots).toEqual([])
    expect(opts.log).toEqual([])
    expect(currentUserFallback).not.toHaveBeenCalled()
  })

  it("falha ao resolver o dono: não grava (falha FECHADA, nunca presume)", async () => {
    ownerLookup.mockImplementation(async () => {
      throw new Error("user_settings sem linha singleton")
    })

    const n = await record(OWNER)

    expect(n).toBe(0)
    expect(db.prediction_snapshots).toEqual([])
    expect(opts.log).not.toContain("upsert:prediction_snapshots")
  })

  it("o userId é OBRIGATÓRIO no tipo: o chamador não pode esquecê-lo e herdar um fallback", async () => {
    const { recordRankingSnapshots } = await import("@/lib/server/predictions/record-prediction")
    // @ts-expect-error — sem `userId` a chamada não compila; é o tipo que impede o caminho antigo
    const n = await recordRankingSnapshots({ orderedWorkIds: [W1], filtersKey: "{}" })
    expect(n).toBe(0)
    expect(db.prediction_snapshots).toEqual([])
  })
})
