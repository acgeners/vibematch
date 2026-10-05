import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveInterestPromptVersion } from "@/lib/ai-evaluation/compiled-preferences"

/**
 * `getAllActiveSynopsisPredictions` alimenta o Interesse previsto do `getRanking` (`/catalog`,
 * `/ranking`) e lia `select("*")` das ~2.400 previsões — inclusive a `justification`, texto
 * longo que o ranking nunca lê. Medido em 2026-10-04: 1.020 KB por carga logada. Agora a
 * projeção é explícita.
 *
 * O banco em memória daqui APLICA a projeção (a linha volta só com as colunas pedidas), então
 * um campo que faltasse na lista sumiria do resultado em vez de passar verde com a linha
 * inteira. A referência de paridade é `getSynopsisPredictionsByWorkIds`, que segue com `*` e o
 * mesmo `pickActiveRaw`: para os mesmos dados, as duas leituras têm que escolher a MESMA
 * previsão ativa com os MESMOS valores.
 */

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let selects: Array<{ table: string; cols: string }>

function topLevel(cols: string): string[] {
  return cols.split(",").map((c) => c.trim()).filter(Boolean)
}

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let cols = "*"
      let range: [number, number] | null = null
      const orders: string[] = []
      const q: Record<string, unknown> = {
        select(c: string) {
          cols = c
          selects.push({ table, cols: c })
          return q
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        order: (c: string) => (orders.push(c), q),
        range: (a: number, b: number) => ((range = [a, b]), q),
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          let rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)))
          for (const c of [...orders].reverse()) rows = [...rows].sort((x, y) => String(x[c]).localeCompare(String(y[c])))
          if (range) rows = rows.slice(range[0], range[1] + 1)
          const keys = topLevel(cols)
          const data = keys.includes("*") ? rows : rows.map((r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]])))
          return Promise.resolve({ data, error: null }).then(res, rej)
        },
      }
      return q
    },
  }
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }))
vi.mock("@/server/queries/user-interest", () => ({ getInterestReader: async () => ({ scope: <T,>(q: T) => q }) }))

const V = resolveInterestPromptVersion()
const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001"
const W2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002"
const W3 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003"
const W4 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004"
let seq = 0
const linha = (workId: string, extra: Row): Row => ({
  id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(++seq).padStart(12, "0")}`,
  work_id: workId,
  predicted_quality: "♥♥",
  justification: "uma justificativa longa que o ranking nunca lê",
  confidence: 0.5,
  taste_profile_version: 7,
  taste_profile_hash: "f".repeat(64),
  model_name: "claude-sonnet-5",
  prompt_version: V,
  stale: false,
  predicted_at: "2026-09-01T00:00:00Z",
  ...extra,
})

function baseDb() {
  seq = 0
  return {
    synopsis_quality_predictions: [
      // W1: versão atual vence a antiga; confidence numérica em string (como o PostgREST manda numeric)
      linha(W1, { prompt_version: "v1", predicted_quality: "♥" }),
      linha(W1, { predicted_quality: "♥♥♥♥", confidence: "0.83" }),
      // W2: sem a versão atual → a de MAIOR versão, e ela está stale
      linha(W2, { prompt_version: "v2", predicted_quality: "♥" }),
      linha(W2, { prompt_version: "v3", predicted_quality: "♥♥♥", stale: true }),
      // W3: mesma versão (não atual) → desempate pela previsão mais recente
      linha(W3, { prompt_version: "v2", predicted_quality: "♥", predicted_at: "2026-08-01T00:00:00Z" }),
      linha(W3, { prompt_version: "v2", predicted_quality: "♥♥", predicted_at: "2026-09-15T00:00:00Z" }),
      // W4: stale nulo vira false; confidence nula continua nula
      linha(W4, { stale: null, confidence: null }),
    ],
  }
}

async function mod() {
  return import("@/server/queries/synopsis-quality")
}

beforeEach(() => {
  db = baseDb()
  selects = []
})

describe("getAllActiveSynopsisPredictions — projeção explícita, mesmo resultado", () => {
  it("seleciona só as colunas de que o ranking e a escolha da ativa precisam — sem justification, sem *", async () => {
    const { getAllActiveSynopsisPredictions } = await mod()
    await getAllActiveSynopsisPredictions()

    const lidas = selects.filter((s) => s.table === "synopsis_quality_predictions").map((s) => s.cols)
    expect(lidas.length).toBeGreaterThan(0)
    for (const cols of lidas) {
      expect(cols).not.toContain("*")
      expect(cols).not.toContain("justification")
      expect(topLevel(cols).sort()).toEqual(
        ["confidence", "predicted_at", "predicted_quality", "prompt_version", "stale", "work_id"].sort(),
      )
    }
  })

  it("escolhe a MESMA previsão ativa, com os MESMOS valores, que a leitura completa (select *)", async () => {
    const { getAllActiveSynopsisPredictions, getSynopsisPredictionsByWorkIds } = await mod()
    const estreita = await getAllActiveSynopsisPredictions()
    const completa = await getSynopsisPredictionsByWorkIds([W1, W2, W3, W4])

    expect([...estreita.keys()].sort()).toEqual([...completa.keys()].sort())
    for (const [workId, e] of estreita) {
      const c = completa.get(workId)!
      expect(e).toEqual({
        workId: c.workId,
        predictedQuality: c.predictedQuality,
        confidence: c.confidence,
        promptVersion: c.promptVersion,
        stale: c.stale,
        predictedAt: c.predictedAt,
      })
    }
  })

  it("predictedQuality, stale e confidence seguem as mesmas regras de escolha e conversão", async () => {
    const { getAllActiveSynopsisPredictions } = await mod()
    const m = await getAllActiveSynopsisPredictions()

    expect(m.get(W1)).toMatchObject({ predictedQuality: "♥♥♥♥", confidence: 0.83, stale: false, promptVersion: V })
    expect(m.get(W2)).toMatchObject({ predictedQuality: "♥♥♥", stale: true, promptVersion: "v3" })
    expect(m.get(W3)).toMatchObject({ predictedQuality: "♥♥", predictedAt: "2026-09-15T00:00:00Z" })
    expect(m.get(W4)).toMatchObject({ stale: false, confidence: null })
  })

  it("o objeto devolvido não carrega justification nem os campos de perfil", async () => {
    const { getAllActiveSynopsisPredictions } = await mod()
    const m = await getAllActiveSynopsisPredictions()
    const w1 = m.get(W1)!

    expect(Object.keys(w1).sort()).toEqual(["confidence", "predictedAt", "predictedQuality", "promptVersion", "stale", "workId"])
    // @ts-expect-error — o tipo é a projeção: pedir a justificativa aqui não compila
    expect(w1.justification).toBeUndefined()
  })
})
