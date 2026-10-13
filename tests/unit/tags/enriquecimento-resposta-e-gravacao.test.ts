// @vitest-environment node
// 🔴 Nada que NÃO foi decidido pode terminar `done` (auditoria de 2026-10-13, Auditoria/pipeline-de-tags-2026-10-13).
//
// A 210 tirou o "falha vira `other` + marca". A auditoria seguinte achou o mesmo defeito em duas
// camadas mais finas, provadas com o código real:
//   · RESPOSTA: `adult_level` fora do enum ou ausente, subgrupo inexistente e item cortado por
//     `max_tokens` viravam "none" e a tag ia para `done` — idêntica a uma decisão legítima;
//   · GRAVAÇÃO: o update do grupo e o das flags 18+ não eram conferidos, e o `done` vinha depois
//     mesmo assim.
//
// Código REAL (ingestão, classificador, enriquecedor, gate) contra um banco em memória; só
// `createLoggedMessage` (a fronteira do provider) é mockado, e `fetch` é proibido: nada sai daqui.
import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, after: [] as Array<() => Promise<void>> }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { h.after.push(fn) } }))
vi.mock("@/lib/ai/anthropic-client", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  createLoggedMessage: vi.fn(),
}))

import { APIConnectionTimeoutError } from "@anthropic-ai/sdk"
import { createLoggedMessage } from "@/lib/ai/anthropic-client"
import { resolveOrCreateTags, scheduleTagEnrichment } from "@/lib/tags/ingest"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"

const CI = (TAG_GROUP_IDS as Record<string, string>)["content_indicator"]
const OTHER = (TAG_GROUP_IDS as Record<string, string>)["other"]
const provider = vi.mocked(createLoggedMessage)
const NOME = "Lewd Ritual" // fora do catálogo de nomes: passa pelo classificador

type Meta = { operation: string }
const msg = (input: unknown, stop_reason = "tool_use") =>
  ({ message: { content: [{ type: "tool_use", name: "x", input }], model: "mock", stop_reason }, apiCallId: null, usage: {} }) as never
const textOnly = () =>
  ({ message: { content: [{ type: "text", text: "Não sei." }], model: "mock", stop_reason: "end_turn" }, apiCallId: null, usage: {} }) as never
const classificou = (slug = "content_indicator") => msg({ classifications: [{ tag_name: NOME, group_slug: slug }] })
const item = (o: Record<string, unknown> = {}) => ({
  tag_name: NOME, subgroup_slug: "none", synonym_of_slug: "none", confidence: 0.9, adult_level: "none", adult_score_tier: "none", ...o,
})
/** Classificador responde o grupo; o enriquecedor responde `results`. */
const responde = (results: unknown, stop?: string, grupo = "content_indicator") =>
  provider.mockImplementation(async (_c, _p, m: Meta) =>
    m.operation === "tag_classifier" ? classificou(grupo) : msg({ results }, stop))

function seed() {
  h.db = new FakeDb()
  h.after = []
  h.db.tables.tag_group = [
    { id: CI, slug: "content_indicator", group: "Content Indicator" },
    { id: OTHER, slug: "other", group: "Other" },
  ]
  h.db.tables.tag_subgroup = [{ id: "sub-st", tag_group_id: CI, slug: "sexual-themes", name: "Sexual Themes", status: "approved", description: null }]
  for (const t of ["tags", "tag_alias", "work_tags", "category_scores", "tag_subgroup_assignment", "tag_cluster_proposal"]) h.db.tables[t] = []
  h.db.tables.works = [{ id: "w1", adult_auto: false, adult_reason: null, adult_override: null }]
}

/** O fluxo de obra: cria a tag, agenda o enriquecimento, vincula, e a resposta sai (`after` roda). */
async function criar() {
  const { ids, createdIds } = await resolveOrCreateTags(h.db.client() as never, [NOME], "external")
  scheduleTagEnrichment(createdIds)
  h.db.rows("work_tags").push({ work_id: "w1", tag_id: ids[0] })
  for (const f of h.after.splice(0)) await f()
  return h.db.rows("tags").find((t) => t.id === ids[0])!
}

/** Nada com cara de decisão da IA: sem marca de revisão do piso, status ≠ done. */
function naoConcluida(t: Record<string, unknown>) {
  expect(t.enrichment_status).not.toBe("done")
  expect(t.adult_score_tier_reviewed_at).toBeNull()
}

beforeEach(() => {
  seed()
  provider.mockReset()
  process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
  globalThis.fetch = (() => { throw new Error("REDE PROIBIDA neste teste") }) as typeof fetch
})

describe("1–7 · desfechos da chamada", () => {
  it("1. provider OK → done, com subgrupo, sinal forte, piso e marca; a obra vira 18+", async () => {
    responde([item({ subgroup_slug: "sexual-themes", adult_level: "explicit", adult_score_tier: "explicit" })])
    const t = await criar()
    expect(t).toMatchObject({ enrichment_status: "done", tag_group_id: CI, tag_subgroup_id: "sub-st", adult_indicator_strong: true, adult_score_tier: "explicit" })
    expect(t.adult_score_tier_reviewed_at).not.toBeNull()
    expect(h.db.rows("works")[0].adult_auto).toBe(true)
  })

  it("4. timeout do SDK → provider_failed, com o motivo", async () => {
    provider.mockRejectedValue(new APIConnectionTimeoutError())
    const t = await criar()
    expect(t.enrichment_status).toBe("provider_failed")
    expect(String(t.enrichment_detail)).toMatch(/timed out/i)
    naoConcluida(t)
  })

  it("5. processo interrompido durante o after() → continua `pending` (nunca com cara de concluída)", async () => {
    provider.mockImplementation(() => new Promise(() => {})) // a chamada nunca volta
    const { ids, createdIds } = await resolveOrCreateTags(h.db.client() as never, [NOME], "external")
    scheduleTagEnrichment(createdIds)
    void h.after.splice(0).map((f) => f()) // dispara e abandona
    await new Promise((r) => setTimeout(r, 10))
    const t = h.db.rows("tags").find((x) => x.id === ids[0])!
    expect(t.enrichment_status).toBe("pending")
    naoConcluida(t)
  })

  it("6. sem tool_use (o modelo respondeu texto) → partial", async () => {
    provider.mockImplementation(async () => textOnly())
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    naoConcluida(t)
  })

  it("7. JSON inválido (o SDK lança no parse) → provider_failed", async () => {
    provider.mockRejectedValue(new SyntaxError("Expected ',' or '}' after property value in JSON at position 27"))
    const t = await criar()
    expect(t.enrichment_status).toBe("provider_failed")
    naoConcluida(t)
  })
})

describe("8–13 · resposta do enriquecedor: inválida ≠ decisão negativa", () => {
  it("8. enum inválido (adult_level=\"EXPLICIT\", adult_score_tier=\"strong\") → partial, com o valor no motivo", async () => {
    responde([item({ adult_level: "EXPLICIT", adult_score_tier: "strong" })])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/adult_level="EXPLICIT"/)
    naoConcluida(t)
    expect(t.adult_indicator).toBe(false)
  })

  it("9. campo necessário ausente (só tag_name) → partial, nomeando o campo", async () => {
    responde([{ tag_name: NOME }])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/campo ausente: subgroup_slug/)
    naoConcluida(t)
  })

  it("9b. só adult_score_tier ausente → partial (não vira \"sem piso\")", async () => {
    const { adult_score_tier: _omit, ...semPiso } = item({ adult_level: "explicit" })
    void _omit
    responde([semPiso])
    const t = await criar()
    expect(String(t.enrichment_detail)).toMatch(/campo ausente: adult_score_tier/)
    naoConcluida(t)
  })

  it("10. saída truncada (max_tokens): o ÚLTIMO item não é confiável → partial; o anterior, fechado, vale", async () => {
    // Como o `partialParse` do SDK devolve um item cortado: o `"adult_level":"expl…"` incompleto some.
    const outra = "Other Tag"
    const { ids } = await resolveOrCreateTags(h.db.client() as never, [NOME, outra], "external")
    provider.mockImplementation(async (_c, _p, m: Meta) =>
      m.operation === "tag_classifier"
        ? msg({ classifications: [{ tag_name: NOME, group_slug: "content_indicator" }, { tag_name: outra, group_slug: "content_indicator" }] })
        : msg({ results: [item({ tag_name: outra }), { tag_name: NOME, subgroup_slug: "sexual-themes", synonym_of_slug: "none", confidence: 0.9 }] }, "max_tokens"))
    const { enrichNewTags } = await import("@/lib/tags/ingest")
    await enrichNewTags(ids)
    const [a, b] = ids.map((id) => h.db.rows("tags").find((x) => x.id === id)!)
    expect(a.enrichment_status).toBe("partial")
    expect(String(a.enrichment_detail)).toMatch(/truncada/)
    naoConcluida(a)
    expect(b.enrichment_status).toBe("done") // item anterior: o modelo já tinha emitido o seguinte
  })

  it("10b. truncada mesmo com o último item aparentemente completo → partial (não dá para provar que fechou)", async () => {
    responde([item()], "max_tokens")
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    naoConcluida(t)
  })

  it("11. subgrupo inexistente → partial; NÃO vira \"nenhum subgrupo aplicável\"", async () => {
    responde([item({ subgroup_slug: "sub-que-nao-existe" })])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/subgrupo inválido: "sub-que-nao-existe"/)
    naoConcluida(t)
  })

  it("11b. `results` com forma errada (objeto, não lista) → partial com motivo (antes: exceção engolida e `pending` mudo)", async () => {
    responde({ tag_name: NOME })
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/não é uma lista/)
  })

  it("11c. item nulo no meio da lista não derruba as outras tags", async () => {
    responde([null, item()])
    const t = await criar()
    expect(t.enrichment_status).toBe("done")
  })

  it("12. \"none\" LEGÍTIMO (subgrupo e 18+) → done", async () => {
    responde([item()])
    const t = await criar()
    expect(t).toMatchObject({ enrichment_status: "done", tag_subgroup_id: null, adult_indicator: false })
    expect(t.adult_score_tier_reviewed_at).not.toBeNull()
  })

  it("13. `other` LEGÍTIMO (o classificador escolheu other) → done em other", async () => {
    responde([item()], undefined, "other")
    const t = await criar()
    expect(t).toMatchObject({ enrichment_status: "done", tag_group_id: OTHER })
  })

  it("12 × 11: a mesma linha NÃO sai mais de uma decisão legítima e de uma resposta inválida", async () => {
    responde([item()])
    const legit = await criar()
    seed()
    provider.mockReset()
    responde([item({ subgroup_slug: "nao-existe" })])
    const invalida = await criar()
    expect(legit.enrichment_status).not.toBe(invalida.enrichment_status)
  })

  it("confiança fora de 0–1 vai como NULL (não inventa 0 nem estoura o CHECK do banco)", async () => {
    responde([item({ subgroup_slug: "sexual-themes", confidence: 1.5 })])
    const t = await criar()
    expect(t.enrichment_status).toBe("done")
    expect(h.db.rows("tag_subgroup_assignment")[0].confidence).toBeNull()
  })
})

describe("classificador: forma e truncamento", () => {
  it("`classifications` com forma errada → partial com motivo", async () => {
    provider.mockImplementation(async () => msg({ classifications: { tag_name: NOME } }))
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/classifications/)
    expect(t.tag_group_id).toBeNull()
  })

  it("max_tokens: o último item do classificador não decide grupo", async () => {
    provider.mockImplementation(async (_c, _p, m: Meta) =>
      m.operation === "tag_classifier" ? msg({ classifications: [{ tag_name: NOME, group_slug: "content_indicator" }] }, "max_tokens") : msg({ results: [item()] }))
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(t.tag_group_id).toBeNull()
  })
})

describe("14–15 · gravação: `done` só depois de TODAS as escritas confirmadas", () => {
  const falharUpdate = (pred: (p: Record<string, unknown>) => boolean) => {
    h.db.failWhen = ({ table, op, payload }) =>
      table === "tags" && op === "update" && pred(payload as Record<string, unknown>) ? "injetado: write failed" : null
  }

  it("14. falha ao gravar a flag 18+ → partial, piso e marca NÃO gravados, obra não recalculada como 18+", async () => {
    falharUpdate((p) => "adult_indicator" in p)
    responde([item({ subgroup_slug: "sexual-themes", adult_level: "explicit", adult_score_tier: "explicit" })])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/sinal 18\+/)
    expect(t.adult_score_tier).toBeNull()
    naoConcluida(t)
    expect(h.db.rows("works")[0].adult_auto).toBe(false)
  })

  it("15a. falha ao gravar o GRUPO → partial; não segue para o enriquecedor (nem paga a 2ª chamada)", async () => {
    falharUpdate((p) => "tag_group_id" in p && Object.keys(p).length === 1)
    responde([item()])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/grupo: o modelo classificou, mas a gravação falhou/)
    expect(t.tag_group_id).toBeNull()
    naoConcluida(t)
    expect(provider.mock.calls.map((c) => (c[2] as Meta).operation)).toEqual(["tag_classifier"])
  })

  it("15b. falha ao gravar o SUBGRUPO → partial", async () => {
    falharUpdate((p) => "tag_subgroup_id" in p)
    responde([item({ subgroup_slug: "sexual-themes" })])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/subgrupo/)
    naoConcluida(t)
  })

  it("15c. falha no registro do subgrupo (tag_subgroup_assignment) → partial", async () => {
    h.db.failWhen = ({ table, op }) => (table === "tag_subgroup_assignment" && op === "upsert" ? "injetado" : null)
    responde([item({ subgroup_slug: "sexual-themes" })])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/registro do subgrupo/)
  })

  it("15d. falha na escrita final (piso + marca + done) → partial, não `pending` mudo", async () => {
    falharUpdate((p) => p.enrichment_status === "done")
    responde([item()])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/piso\/marca de conclusão/)
    naoConcluida(t)
  })

  it("leitura dos subgrupos falha → partial ANTES de pagar o enriquecedor (senão o prompt diria \"sem subgrupos\")", async () => {
    h.db.failWhen = ({ table, op }) => (table === "tag_subgroup" && op === "select" ? "injetado: read failed" : null)
    responde([item()])
    const t = await criar()
    expect(t.enrichment_status).toBe("partial")
    expect(String(t.enrichment_detail)).toMatch(/contexto do grupo não carregou/)
    expect(provider.mock.calls.map((c) => (c[2] as Meta).operation)).toEqual(["tag_classifier"])
  })
})
