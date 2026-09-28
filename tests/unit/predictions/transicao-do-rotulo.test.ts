import { describe, it, expect, vi, beforeEach } from "vitest"
import { fakeSupabase, type Db, type FakeOptions } from "./fake-supabase"

/**
 * A 1ª nota de uma obra tem que deixar registrada a previsão que existia IMEDIATAMENTE ANTES
 * dela — por QUALQUER caminho de escrita. Estes testes rodam `writeReadingState` e
 * `mirrorOwnerState` DE VERDADE (e as funções de resolução/descarte de verdade) sobre um banco
 * em memória. O que eles prendem:
 *   - a previsão é lida ANTES de a nota ser gravada (o banco falso "recalcula" no upsert da nota);
 *   - 1ª nota → 1 linha no ledger, mesmo com retry e com duas escritas simultâneas;
 *   - editar não cria 1ª nota nova; apagar DESCARTA a medição (não só carimba auditoria);
 *   - previsão indisponível e leitura que falhou ficam DISTINGUÍVEIS;
 *   - sem a migration 200 a nota continua sendo gravada (ledger cai no formato legado).
 */

const U = "11111111-1111-4111-8111-111111111111" // quem avalia (é o dono)
const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
const W2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
const W3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"

let db: Db
let opts: FakeOptions

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeSupabase(db, opts) }))
vi.mock("@/lib/supabase/user", () => ({ createUserClient: async () => fakeSupabase(db, opts) }))
vi.mock("@/server/queries/current-user", () => ({
  getOwnerUserId: async () => U,
  getCurrentUserId: async () => U,
  getSessionUserId: async () => U,
  ensureSignedIn: async () => ({ ok: true, userId: U }),
  ensurePermission: async () => ({ ok: true }),
}))
vi.mock("@/server/queries/verdict-scale", () => ({ getVerdictScale: async () => null }))

function baseDb(): Db {
  return {
    user_work_state: [],
    user_calculated_scores: [
      { user_id: U, work_id: W1, expected_score: 7.5, expected_is_stub: false, calc_score: 7.2, personal_fit: 0.6, personal_fit_percentile: 80, alignment_score: null, alignment_payload: null, alignment_stale: false, calculated_at: "2026-09-27T10:00:00Z" },
      { user_id: U, work_id: W2, expected_score: 6.8, expected_is_stub: false, calc_score: 6.9, personal_fit: 0.4, personal_fit_percentile: 30, alignment_score: null, alignment_payload: null, alignment_stale: false, calculated_at: "2026-09-27T10:00:00Z" },
    ],
    calibration_history: [{ recorded_at: "2026-09-27T10:00:00Z", train_size: 231 }],
    prediction_ledger: [],
    prediction_snapshots: [],
  }
}

/** Simula o pior caso: assim que a nota é gravada, um recálculo já troca a previsão. */
function recalculaAoGravarNota(): FakeOptions["afterUpsert"] {
  return (table, rows) => {
    if (table !== "user_work_state") return
    for (const r of rows) {
      const ucs = db.user_calculated_scores.find((x) => x.work_id === r.work_id && x.user_id === r.user_id)
      if (ucs && r.user_score != null) Object.assign(ucs, { expected_score: 9.9, calc_score: 9.9, personal_fit: 0.99 })
    }
  }
}

async function writer() {
  return import("@/server/queries/user-work-state")
}

beforeEach(() => {
  db = baseDb()
  opts = { log: [], unique: { prediction_ledger: ["user_id", "work_id"] } }
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("1ª nota (NULL → valor)", () => {
  it("captura a previsão PRÉ-nota — mesmo que um recálculo aconteça no instante da gravação", async () => {
    opts.afterUpsert = recalculaAoGravarNota()
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })

    expect(r.error).toBeNull()
    expect(db.user_work_state).toEqual([expect.objectContaining({ work_id: W1, user_score: 8 })])
    expect(db.prediction_ledger).toHaveLength(1)
    expect(db.prediction_ledger[0]).toMatchObject({
      user_id: U,
      work_id: W1,
      user_score: 8,
      predicted_expected: 7.5, // o valor ANTES da nota — não o 9.9 do "recálculo"
      predicted_calc: 7.2,
      predicted_personal_fit: 0.6,
      predicted_personal_fit_percentile: 80,
      prediction_calculated_at: "2026-09-27T10:00:00Z",
      predicted_is_stub: false,
      train_size_at_capture: 231,
      capture_status: "captured",
      capture_source: "writeReadingState",
      capture_error: null,
    })
  })

  it("lê a previsão ANTES do upsert da nota e grava o ledger DEPOIS", async () => {
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 8 })
    const log = opts.log!
    const leitura = log.indexOf("select:user_calculated_scores")
    const nota = log.indexOf("upsert:user_work_state")
    const ledger = log.indexOf("upsert:prediction_ledger")
    expect(leitura).toBeGreaterThanOrEqual(0)
    expect(leitura).toBeLessThan(nota)
    expect(nota).toBeLessThan(ledger)
  })

  it("obra criada JÁ com nota: sem previsão existente ⇒ `no_prediction`, não um NULL mudo", async () => {
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W3], { user_score: 9, personal_status_id: 3 })
    expect(db.prediction_ledger).toEqual([
      expect.objectContaining({ work_id: W3, user_score: 9, capture_status: "no_prediction", predicted_expected: null, predicted_is_stub: true, capture_error: null }),
    ])
  })

  it("leitura da previsão que FALHA vira `failed` com a mensagem — e a nota é gravada mesmo assim", async () => {
    opts.failOn = (t, op) => (t === "user_calculated_scores" && op === "select" ? { message: "timeout lendo previsões" } : null)
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })
    expect(r.error).toBeNull()
    expect(db.user_work_state[0]).toMatchObject({ user_score: 8 })
    expect(db.prediction_ledger[0]).toMatchObject({ capture_status: "failed", capture_error: "timeout lendo previsões", predicted_expected: null })
  })

  it("se a NOTA não é gravada, nada vai pro ledger (nenhuma linha afirmando uma nota que não existe)", async () => {
    opts.failOn = (t, op) => (t === "user_work_state" && op === "upsert" ? { message: "RLS" } : null)
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })
    expect(r.error).toMatch(/RLS/)
    expect(db.prediction_ledger).toHaveLength(0)
  })

  it("resolve o snapshot pendente com a 1ª nota", async () => {
    db.prediction_snapshots.push({ id: "s1", user_id: U, work_id: W1, resolved_at: null, actual_user_score: null, superseded: false, label_changed_at: null, discarded_at: null })
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 8 })
    expect(db.prediction_snapshots[0]).toMatchObject({ actual_user_score: 8 })
    expect(db.prediction_snapshots[0].resolved_at).not.toBeNull()
  })
})

describe("idempotência", () => {
  it("retry da mesma nota: 1 linha no ledger", async () => {
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 8 })
    await writeReadingState(U, [W1], { user_score: 8 })
    expect(db.prediction_ledger).toHaveLength(1)
  })

  it("duas 1ªs notas SIMULTÂNEAS na mesma obra: 1 linha (a unique vence a corrida)", async () => {
    const { writeReadingState } = await writer()
    await Promise.all([writeReadingState(U, [W1], { user_score: 8 }), writeReadingState(U, [W1], { user_score: 8 })])
    expect(db.prediction_ledger).toHaveLength(1)
  })
})

describe("edição e remoção", () => {
  beforeEach(() => {
    db.user_work_state.push({ user_id: U, work_id: W1, user_score: 8 })
    db.prediction_ledger.push({ user_id: U, work_id: W1, user_score: 8, predicted_expected: 7.5, discarded_at: null })
    db.prediction_snapshots.push({ id: "s1", user_id: U, work_id: W1, resolved_at: "2026-09-27T11:00:00Z", actual_user_score: 8, superseded: false, label_changed_at: null, discarded_at: null })
  })

  it("editar 8 → 8,5 NÃO cria 1ª previsão nova; a 1ª medição fica intacta e é só carimbada", async () => {
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 8.5 })
    expect(db.prediction_ledger).toHaveLength(1)
    expect(db.prediction_ledger[0]).toMatchObject({ user_score: 8, predicted_expected: 7.5, discarded_at: null })
    expect(db.prediction_snapshots[0]).toMatchObject({ actual_user_score: 8, discarded_at: null })
    expect(db.prediction_snapshots[0].label_changed_at).not.toBeNull()
    expect(opts.log).not.toContain("select:user_calculated_scores") // edição não lê previsão
    expect(opts.log).not.toContain("select:prediction_ledger") // nem o histórico — só a 1ª nota paga isso
  })

  it("apagar a nota DESCARTA a medição (snapshot + ledger) e PRESERVA as linhas — o caso Returned Villainess", async () => {
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: null })
    expect(db.prediction_snapshots).toHaveLength(1)
    expect(db.prediction_ledger).toHaveLength(1)
    expect(db.prediction_snapshots[0].discarded_at).toEqual(expect.any(String))
    expect(db.prediction_ledger[0].discarded_at).toEqual(expect.any(String))
    expect(db.prediction_snapshots[0]).toMatchObject({ actual_user_score: 8 }) // histórico bruto preservado
  })

  it("apagar e dar nota DE NOVO não cria nem sobrescreve medição — a 1ª (descartada) vence", async () => {
    // O modelo já treinou com a nota antiga: a "nova 1ª nota" não é prospectiva. A linha original
    // fica como está (descartada), sem virar outra medição válida.
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: null })
    await writeReadingState(U, [W1], { user_score: 6 })
    expect(db.prediction_ledger).toHaveLength(1)
    expect(db.prediction_ledger[0]).toMatchObject({ user_score: 8, predicted_expected: 7.5 })
    expect(db.prediction_ledger[0].discarded_at).toEqual(expect.any(String))
  })

  it("patch que não toca a nota (favoritar) não lê nada do ledger", async () => {
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { is_favorite: true })
    expect(opts.log).toEqual(["upsert:user_work_state"])
  })
})

describe("nota → NULL → nota: a obra NÃO renasce prospectiva", () => {
  const pendente = (id: string) => ({ id, user_id: U, work_id: W1, resolved_at: null, actual_user_score: null, superseded: false, label_changed_at: null, discarded_at: null })

  it("A · nunca avaliada: o snapshot pendente é resolvido como medição VÁLIDA e o ledger nasce", async () => {
    db.prediction_snapshots.push(pendente("s1"))
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 8 })
    expect(db.prediction_snapshots[0]).toMatchObject({ actual_user_score: 8, discarded_at: null })
    expect(db.prediction_ledger).toHaveLength(1)
    expect(db.prediction_ledger[0].discarded_at ?? null).toBeNull()
  })

  it("B · avaliada, apagada e reavaliada: o snapshot NOVO (tirado com a obra sem nota) nasce descartado", async () => {
    db.prediction_snapshots.push(pendente("s1"))
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 8 }) // 1ª nota: s1 válido, ledger nasce
    await writeReadingState(U, [W1], { user_score: null }) // apagada: s1 e ledger descartados
    db.prediction_snapshots.push(pendente("s2")) // o /ranking fotografou a obra de novo, sem nota
    await writeReadingState(U, [W1], { user_score: 6 }) // reavaliada

    expect(db.prediction_ledger).toHaveLength(1) // nenhuma 2ª "1ª medição"
    expect(db.prediction_ledger[0]).toMatchObject({ user_score: 8 })
    expect(db.prediction_ledger[0].discarded_at).toEqual(expect.any(String))
    const s2 = db.prediction_snapshots.find((s) => s.id === "s2")!
    expect(s2.discarded_at, "o snapshot pós-delete NÃO pode virar medição válida").toEqual(expect.any(String))
    expect(s2.actual_user_score).toBe(6) // histórico bruto preservado
    const s1 = db.prediction_snapshots.find((s) => s.id === "s1")!
    expect(s1).toMatchObject({ actual_user_score: 8 })
    expect(s1.discarded_at).toEqual(expect.any(String))
  })

  it("B legado · nota apagada pelo caminho ANTIGO (só carimbo, sem ledger): também não renasce", async () => {
    // O estado da Returned Villainess: snapshot resolvido e NÃO descartado, nenhuma linha no ledger,
    // e a nota hoje NULL. O ledger sozinho não prova que já houve nota — o snapshot resolvido prova.
    db.prediction_snapshots.push({ ...pendente("s1"), resolved_at: "2026-09-15T20:49:39Z", actual_user_score: 7.6, label_changed_at: "2026-09-15T20:49:41Z" })
    db.prediction_snapshots.push(pendente("s2"))
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 7 })

    expect(db.prediction_ledger, "sem 1ª medição nova para quem já teve nota").toHaveLength(0)
    for (const s of db.prediction_snapshots) expect(s.discarded_at, `snapshot ${s.id}`).toEqual(expect.any(String))
    expect(opts.log).not.toContain("select:user_calculated_scores") // reavaliada: nada de previsão pra capturar
  })
})

describe("histórico ILEGÍVEL em NULL → nota: indeterminado, nunca sucesso", () => {
  const pendente = (id: string) => ({ id, user_id: U, work_id: W1, resolved_at: null, actual_user_score: null, superseded: false, label_changed_at: null, discarded_at: null })

  it("a nota é salva; o ledger registra FALHA descartada — não uma 1ª medição `captured`", async () => {
    opts.failOn = (t, op) => (t === "prediction_ledger" && op === "select" ? { message: "timeout lendo histórico" } : null)
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })

    expect(r.error).toBeNull()
    expect(db.user_work_state[0]).toMatchObject({ work_id: W1, user_score: 8 })
    expect(db.prediction_ledger).toHaveLength(1)
    const row = db.prediction_ledger[0]
    expect(row).toMatchObject({ capture_status: "failed", predicted_expected: null, user_score: 8 })
    expect(String(row.capture_error)).toMatch(/^historico_ilegivel: .*timeout lendo histórico/)
    expect(row.discarded_at, "fora das métricas pelo mecanismo existente (mig 168)").not.toBeNull()
    expect(opts.log).not.toContain("select:user_calculated_scores") // não finge capturar previsão
  })

  it("snapshot pendente da mesma transição é resolvido e DESCARTADO — não vira observação válida", async () => {
    db.prediction_snapshots.push(pendente("s1"))
    opts.failOn = (t, op) => (t === "prediction_ledger" && op === "select" ? { message: "timeout lendo histórico" } : null)
    const { writeReadingState } = await writer()
    await writeReadingState(U, [W1], { user_score: 8 })

    expect(db.prediction_snapshots[0]).toMatchObject({ actual_user_score: 8 }) // histórico preservado
    expect(db.prediction_snapshots[0].discarded_at).toEqual(expect.any(String))
  })

  it("a linha indeterminada NASCE descartada — não depende do descarte posterior, que é best-effort", async () => {
    opts.failOn = (t, op) => {
      if (t === "prediction_ledger" && op === "select") return { message: "timeout lendo histórico" }
      if (t === "prediction_ledger" && op === "update") return { message: "descarte posterior falhou" }
      return null
    }
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })
    expect(r.error).toBeNull()
    expect(db.prediction_ledger[0]).toMatchObject({ capture_status: "failed" })
    expect(db.prediction_ledger[0].discarded_at).toEqual(expect.any(String))
  })

  it("sem a migration 200, a linha legada da observação indeterminada AINDA nasce descartada", async () => {
    opts.failOn = (t, op, payload) => {
      if (t === "prediction_ledger" && op === "select") return { message: "timeout lendo histórico" }
      if (t === "prediction_ledger" && op === "update") return { message: "descarte posterior falhou" }
      if (t === "prediction_ledger" && op === "upsert" && Array.isArray(payload) && "capture_status" in (payload[0] as object))
        return { code: "PGRST204", message: "Could not find the 'capture_status' column of 'prediction_ledger' in the schema cache" }
      return null
    }
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })
    expect(r.error).toBeNull()
    expect(db.prediction_ledger).toHaveLength(1)
    expect(db.prediction_ledger[0].capture_status).toBeUndefined() // formato legado
    expect(db.prediction_ledger[0].discarded_at, "o único sinal de exclusão sem a mig 200").toEqual(expect.any(String))
  })

  it("falha na 2ª leitura do histórico (contagem de snapshots) também vira indeterminado, e nada lança", async () => {
    opts.failOn = (t, op) => (t === "prediction_snapshots" && op === "select" ? { message: "snapshots indisponíveis" } : null)
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })
    expect(r.error).toBeNull()
    expect(db.user_work_state[0]).toMatchObject({ user_score: 8 })
    expect(db.prediction_ledger[0]).toMatchObject({ capture_status: "failed" })
    expect(db.prediction_ledger[0].discarded_at).toEqual(expect.any(String))
  })
})

describe("caminho SEM sessão (mirrorOwnerState) e lote", () => {
  it("lote misto: 1ª nota, edição e sem mudança — cada obra recebe só o que é dela", async () => {
    db.user_work_state.push({ user_id: U, work_id: W2, user_score: 7 })
    db.user_work_state.push({ user_id: U, work_id: W3, user_score: 9 })
    const { mirrorOwnerState } = await writer()
    const r = await mirrorOwnerState(U, [W1, W2, W3], { user_score: 9 })
    expect(r.error).toBeNull()
    expect(db.prediction_ledger).toEqual([
      expect.objectContaining({ work_id: W1, user_score: 9, capture_status: "captured", capture_source: "mirrorOwnerState" }),
    ])
  })
})

describe("migration 200 ausente", () => {
  it("o ledger cai nas colunas da mig 101 e a nota é gravada", async () => {
    opts.failOn = (t, op, payload) =>
      t === "prediction_ledger" && op === "upsert" && Array.isArray(payload) && "capture_status" in (payload[0] as object)
        ? { code: "PGRST204", message: "Could not find the 'capture_status' column of 'prediction_ledger' in the schema cache" }
        : null
    const { writeReadingState } = await writer()
    const r = await writeReadingState(U, [W1], { user_score: 8 })
    expect(r.error).toBeNull()
    expect(db.prediction_ledger).toHaveLength(1)
    expect(Object.keys(db.prediction_ledger[0]).sort()).toEqual(
      ["predicted_decision", "predicted_expected", "predicted_is_stub", "train_size_at_capture", "user_id", "user_score", "work_id"].sort(),
    )
    expect(db.prediction_ledger[0]).toMatchObject({ predicted_expected: 7.5, user_score: 8 })
  })
})
