import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Correção 2A.1 — uma nova versão de taste profile marca recalc_pending (sink
// único = insertNewTasteProfile), e o recalc orquestrado roda 1× depois.
// Mocks isolados a ESTE arquivo (vitest isola módulos por arquivo).

const h = vi.hoisted(() => {
  // prevRow = perfil ANTERIOR devolvido por loadCurrentTasteProfile (gate de
  // materialidade da invalidação). null ⇒ sem anterior (material ⇒ marca stale).
  const state = { insertError: false as boolean, prevRow: null as Record<string, unknown> | null }
  const seq: string[] = []
  const okRow = () => ({
    id: "p9", version: 6, is_current: true, is_stub: false, n_works_used: 12,
    input_hash: "h", model_name: "m", prompt_version: "v6",
    profile: { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" },
    raw_response: null, created_at: new Date().toISOString(),
  })
  const builder: Record<string, (...a: unknown[]) => unknown> = {}
  // eq é CHAINABLE (retorna o builder) p/ suportar .eq().order().limit() de
  // loadCurrentTasteProfile; onde é terminal (update().eq()) o resultado é ignorado.
  for (const m of ["from", "update", "select", "order", "limit", "insert", "eq"]) builder[m] = () => builder
  builder.maybeSingle = () => Promise.resolve({ data: state.prevRow, error: null })
  builder.single = () => Promise.resolve(state.insertError ? { data: null, error: { message: "db down" } } : { data: okRow(), error: null })
  return { state, seq, builder }
})

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.builder }))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: vi.fn(async () => { h.seq.push("recalc_pending") }) }))
vi.mock("@/server/queries/synopsis-quality", () => ({ markSynopsisPredictionsStale: vi.fn(async () => { h.seq.push("synopsis_stale") }) }))

import { insertNewTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { ensureTasteProfile, type TasteProfileGateway } from "@/lib/orchestration/integrations/taste-profile"
import { ensureRecalculateScores, recalcDedupKey } from "@/lib/orchestration/integrations/recalculate-scores"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"
import type { RatedWorkInput, TasteProfileRow } from "@/lib/ai-recommendation/types"

const EMPTY = { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" }
const ARGS = { profile: EMPTY, nWorks: 12, inputHash: "h", isStub: false, modelName: "m", promptVersion: "v6", rawResponse: null }

beforeEach(() => { h.state.insertError = false; h.state.prevRow = null; h.seq.length = 0 })
afterEach(() => __resetSingleFlight())

// ---- marcação em insertNewTasteProfile (sink único) ------------------------

describe("Correção 2 — recalc_pending após nova versão de perfil", () => {
  it("2) perfil novo persistido (material/sem anterior) ⇒ synopsis stale + recalc_pending", async () => {
    await insertNewTasteProfile(ARGS) // prevRow=null ⇒ material ⇒ marca stale
    expect(h.seq).toEqual(["synopsis_stale", "recalc_pending"]) // ordem: após persist e após stale das previsões
  })

  it("2b) regen IMATERIAL (mesma chave que o anterior) ⇒ NÃO marca previsões stale (sem churn)", async () => {
    // Anterior com o MESMO gosto destilado (profile idêntico ao de ARGS, sem
    // fingerprint ⇒ chave = computeProfileSignature). Regen do mesmo acervo não
    // deve tocar a coluna `stale` — o coração do follow-up (b).
    h.state.prevRow = {
      id: "prev", version: 5, is_current: true, is_stub: false, n_works_used: 12,
      input_hash: "h", model_name: "m", prompt_version: "v6", profile: EMPTY,
      raw_response: null, created_at: new Date().toISOString(), heuristic_fingerprint: null,
    }
    await insertNewTasteProfile(ARGS)
    expect(h.seq).not.toContain("synopsis_stale") // invalidação PULADA (imaterial)
    expect(h.seq).toContain("recalc_pending") // recalc de personal_fit ainda dispara
  })

  it("4) persistência falha ⇒ NÃO marca recalc_pending", async () => {
    h.state.insertError = true
    await expect(insertNewTasteProfile(ARGS)).rejects.toThrow()
    expect(h.seq).not.toContain("recalc_pending")
  })

  it("1) perfil fresh reutilizado ⇒ não gera, não marca", async () => {
    const fresh: TasteProfileRow = { id: "p", version: 6, is_current: true, is_stub: false, n_works_used: 12, input_hash: "LIB", model_name: "m", prompt_version: "v6", profile: EMPTY, raw_response: null, created_at: new Date().toISOString() }
    const works: RatedWorkInput[] = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, title: `t${i}`, userScore: 8, postScores: {}, personalStatus: null, synopsis: null, categoryScores: {}, tags: [] }))
    // libraryHash precisa bater com input_hash do perfil ⇒ injeta um gateway cujo loadRatedWorks gera o mesmo hash.
    const gw: TasteProfileGateway = {
      loadCurrent: async () => fresh,
      loadRatedWorks: async () => works,
      generateAndPersist: async () => { throw new Error("não deveria gerar") },
    }
    // força fresh: o input_hash do perfil é comparado ao computeInputHash(works).
    // Como não controlamos o hash, validamos pelo caminho: se não-fresh, generateAndPersist lançaria.
    fresh.input_hash = (await import("@/lib/ai-recommendation/taste-profile")).computeInputHash(works)
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), allowPaid: true })
    expect(out.status).toBe("fresh")
    expect(h.seq).not.toContain("recalc_pending")
  })

  it("3) geração falha ⇒ não persiste ⇒ não marca", async () => {
    const works: RatedWorkInput[] = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, title: `t${i}`, userScore: 8, postScores: {}, personalStatus: null, synopsis: null, categoryScores: {}, tags: [] }))
    const gw: TasteProfileGateway = {
      loadCurrent: async () => null,
      loadRatedWorks: async () => works,
      generateAndPersist: async () => { throw new Error("LLM caiu") },
    }
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), allowPaid: true })
    expect(out.status).toBe("failed")
    expect(h.seq).not.toContain("recalc_pending")
  })
})

// ---- recalc orquestrado após regeneração (state machine) -------------------

describe("Correção 2 — recalc orquestrado (force=false, coalescido)", () => {
  it("5) pendência true ⇒ executa 1 recalc global ⇒ pendência false no sucesso", async () => {
    const pending = { pending: true, lastEditAt: "t1" }
    let recalcCalls = 0
    const out = await ensureRecalculateScores({
      recalc: async () => { recalcCalls++; pending.pending = false; return { recalculated: 7 } },
      readPending: async () => pending,
      jobStore: new InMemoryJobStore(),
    })
    expect(out.status).toBe("succeeded")
    expect(recalcCalls).toBe(1)
    expect(pending.pending).toBe(false) // zerada no sucesso
  })

  it("5b) pendência false e sem force ⇒ fresh, não recalcula", async () => {
    let recalcCalls = 0
    const out = await ensureRecalculateScores({
      recalc: async () => { recalcCalls++; return { recalculated: 0 } },
      readPending: async () => ({ pending: false, lastEditAt: null }),
      jobStore: new InMemoryJobStore(),
    })
    expect(out.status).toBe("fresh")
    expect(recalcCalls).toBe(0)
  })

  it("6) recalc falha ⇒ pendência permanece true; job failed (resumível)", async () => {
    const pending = { pending: true, lastEditAt: "t1" }
    const js = new InMemoryJobStore()
    const out = await ensureRecalculateScores({
      recalc: async () => { throw new Error("recalc boom") },
      readPending: async () => pending,
      jobStore: js,
    })
    expect(out.status).toBe("failed")
    expect(pending.pending).toBe(true) // NÃO zerada
    expect(js.records[0].status).toBe("failed") // resumível
  })

  it("7) dois callers concorrentes (mesma geração) ⇒ um único recalc", async () => {
    const pending = { pending: true, lastEditAt: "t1" }
    let recalcCalls = 0
    const js = new InMemoryJobStore()
    const deps = {
      recalc: async () => { recalcCalls++; await new Promise((r) => setTimeout(r, 5)); pending.pending = false; return { recalculated: 3 } },
      readPending: async () => pending,
      jobStore: js,
    }
    await Promise.all([ensureRecalculateScores(deps), ensureRecalculateScores(deps)])
    expect(recalcCalls).toBe(1) // dedup_key idêntico (mesma lastEditAt) ⇒ single-flight
    expect(js.records.length).toBe(1)
    expect(js.records[0].dedupKey).toBe(recalcDedupKey("t1"))
  })
})
