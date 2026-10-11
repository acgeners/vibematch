// @vitest-environment node
// 🔴 Uma falha do enriquecimento nunca pode parecer uma decisão do enricher (migration 210).
//
// Até aqui, quando o provider não era chamado (sem chave, guard de proveniência) ou falhava, o
// classificador jogava a tag em `other`, o enricher devolvia um resultado NEUTRO e `enrichNewTags`
// gravava `adult_score_tier_reviewed_at` — o mesmo dado de uma tag avaliada. Medido na nuvem em
// 2026-10-10: 4 tags de 08/10 assim, sem nenhuma chamada de IA no log.
//
// Roda o código REAL (ingestão, classificador, enricher, gate) contra um banco em memória. Só a
// chamada ao provider (`createLoggedMessage`) é mockada, e `fetch` é proibido: nada sai daqui.
import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, after: [] as Array<() => Promise<void>> }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { h.after.push(fn) } }))
vi.mock("@/lib/ai/anthropic-client", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  createLoggedMessage: vi.fn(),
}))

import { createLoggedMessage, PaidCallBlockedError } from "@/lib/ai/anthropic-client"
import { resolveOrCreateTags, scheduleTagEnrichment } from "@/lib/tags/ingest"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"

const CI = (TAG_GROUP_IDS as Record<string, string>)["content_indicator"]
const OTHER = (TAG_GROUP_IDS as Record<string, string>)["other"]
const provider = vi.mocked(createLoggedMessage)
const NOME = "Lewd Ritual" // não está no catálogo de nomes: precisa do classificador

const tool = (input: unknown) =>
  ({ message: { content: [{ type: "tool_use", name: "x", input }], model: "mock", stop_reason: "tool_use" }, apiCallId: null, usage: {} }) as never

function seed() {
  h.db = new FakeDb()
  h.after = []
  h.db.tables.tag_group = [
    { id: CI, slug: "content_indicator", group: "Content Indicator" },
    { id: OTHER, slug: "other", group: "Other" },
  ]
  h.db.tables.tag_subgroup = [{ id: "sub-st", tag_group_id: CI, slug: "sexual-themes", name: "Sexual Themes", status: "approved", description: null }]
  h.db.tables.tags = []
  h.db.tables.tag_alias = []
  h.db.tables.work_tags = []
  h.db.tables.works = [{ id: "w1", adult_auto: false, adult_reason: null, adult_override: null }]
  h.db.tables.category_scores = []
  h.db.tables.tag_subgroup_assignment = []
  h.db.tables.tag_cluster_proposal = []
}

/** O fluxo de obra: cria a tag, agenda o enriquecimento, vincula, e a resposta sai (after roda). */
async function criarPeloFluxoDeObra() {
  const { ids, createdIds } = await resolveOrCreateTags(h.db.client() as never, [NOME], "external")
  scheduleTagEnrichment(createdIds)
  h.db.rows("work_tags").push({ work_id: "w1", tag_id: ids[0] })
  for (const f of h.after.splice(0)) await f()
  return h.db.rows("tags").find((t) => t.name === NOME)!
}

/** Nenhum sinal de decisão foi gravado: sem grupo inventado, sem 18+, sem marca de revisão. */
function semCaraDeAvaliada(t: Record<string, unknown>) {
  expect(t.tag_group_id).toBeNull()
  expect(t.tag_subgroup_id).toBeNull()
  expect(t.adult_indicator).toBe(false)
  expect(t.adult_score_tier).toBeNull()
  expect(t.adult_score_tier_reviewed_at).toBeNull()
}

beforeEach(() => {
  seed()
  provider.mockReset()
  delete process.env.ANTHROPIC_API_KEY
  globalThis.fetch = (() => { throw new Error("REDE PROIBIDA neste teste") }) as typeof fetch
})

describe("enriquecimento: só 'done' é decisão", () => {
  it("provider respondeu sobre a tag → done, com grupo, subgrupo, 18+, piso e a marca de revisão", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
    provider.mockImplementation(async (_c, _p, meta: { operation: string }) =>
      meta.operation === "tag_classifier"
        ? tool({ classifications: [{ tag_name: NOME, group_slug: "content_indicator" }] })
        : tool({ results: [{ tag_name: NOME, subgroup_slug: "sexual-themes", synonym_of_slug: "none", confidence: 0.9, adult_level: "explicit", adult_score_tier: "explicit" }] }),
    )
    const t = await criarPeloFluxoDeObra()
    expect(t.enrichment_status).toBe("done")
    expect(t.tag_group_id).toBe(CI)
    expect(t.tag_subgroup_id).toBe("sub-st")
    expect(t.adult_indicator_strong).toBe(true)
    expect(t.adult_score_tier_reviewed_at).not.toBeNull()
    expect(h.db.rows("works")[0].adult_auto).toBe(true) // a obra vinculada entra no 18+
  })

  it("provider NÃO chamado (sem chave) → provider_not_called, e nada com cara de decisão", async () => {
    const t = await criarPeloFluxoDeObra()
    expect(t.enrichment_status).toBe("provider_not_called")
    expect(String(t.enrichment_detail)).toMatch(/ANTHROPIC_API_KEY/)
    semCaraDeAvaliada(t)
    expect(provider).not.toHaveBeenCalled()
  })

  it("guard de proveniência recusa → provider_not_called (o grupo não vira `other`)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
    provider.mockRejectedValue(new PaidCallBlockedError("checkout não canônico"))
    const t = await criarPeloFluxoDeObra()
    expect(provider).toHaveBeenCalled() // a recusa passou pela chamada, não por outro erro
    expect(t.enrichment_status).toBe("provider_not_called")
    expect(String(t.enrichment_detail)).toMatch(/PaidCallBlockedError/)
    semCaraDeAvaliada(t)
  })

  it("provider chamado e falhou → provider_failed", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
    provider.mockRejectedValue(new Error("529 overloaded"))
    const t = await criarPeloFluxoDeObra()
    expect(t.enrichment_status).toBe("provider_failed")
    expect(String(t.enrichment_detail)).toMatch(/529/)
    semCaraDeAvaliada(t)
  })

  it("classificou o grupo mas o enricher falhou → grupo fica, o resto não, status provider_failed", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
    provider.mockImplementation(async (_c, _p, meta: { operation: string }) => {
      if (meta.operation === "tag_classifier") return tool({ classifications: [{ tag_name: NOME, group_slug: "content_indicator" }] })
      throw new Error("timeout")
    })
    const t = await criarPeloFluxoDeObra()
    expect(t.tag_group_id).toBe(CI) // o grupo foi decisão do modelo
    expect(t.enrichment_status).toBe("provider_failed")
    expect(t.adult_score_tier_reviewed_at).toBeNull()
    expect(t.tag_subgroup_id).toBeNull()
  })

  it("fallback técnico: o modelo respondeu mas omitiu a tag → partial, sem marca", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
    provider.mockImplementation(async (_c, _p, meta: { operation: string }) =>
      meta.operation === "tag_classifier"
        ? tool({ classifications: [{ tag_name: NOME, group_slug: "content_indicator" }] })
        : tool({ results: [] }),
    )
    const t = await criarPeloFluxoDeObra()
    expect(t.enrichment_status).toBe("partial")
    expect(t.adult_score_tier_reviewed_at).toBeNull()
  })

  it("o classificador devolve slug inventado → a tag não ganha grupo `other` por tabela", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
    provider.mockImplementation(async () => tool({ classifications: [{ tag_name: NOME, group_slug: "grupo-que-nao-existe" }] }))
    const t = await criarPeloFluxoDeObra()
    expect(t.enrichment_status).toBe("partial")
    semCaraDeAvaliada(t)
  })
})
