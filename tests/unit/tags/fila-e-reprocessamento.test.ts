// @vitest-environment node
// Recuperação MANUAL de tag cuja classificação não terminou (decisão da Ana, 2026-10-13): fila que
// mostra a tag independente da origem, contador que conta o mesmo que a fila abre, e uma ação de
// reprocessar que reusa `enrichNewTags` — paga, só por clique, nunca automática.
//
// Código real; `createLoggedMessage` mockado e `fetch` proibido: nenhum provider é chamado.
import { describe, it, expect, beforeEach, vi } from "vitest"
import { execSync } from "node:child_process"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, admin: true }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/server", () => ({ after: () => { throw new Error("reprocessar não pode ir para after()") } }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => (h.admin ? { ok: true } : { ok: false, error: "Só o Curador do catálogo pode fazer isso." }),
}))
vi.mock("@/lib/ai/anthropic-client", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  createLoggedMessage: vi.fn(),
}))

import { createLoggedMessage } from "@/lib/ai/anthropic-client"
import { listNewTags, reprocessTagEnrichment } from "@/server/actions/tag-review"
import { countNewTagsQueue, loadNewTagsQueue } from "@/server/queries/new-tags-queue"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"

const CI = (TAG_GROUP_IDS as Record<string, string>)["content_indicator"]
const provider = vi.mocked(createLoggedMessage)
const msg = (input: unknown) =>
  ({ message: { content: [{ type: "tool_use", name: "x", input }], model: "mock", stop_reason: "tool_use" }, apiCallId: null, usage: {} }) as never

const tag = (o: Record<string, unknown>) => ({
  tag_group_id: null, tag_subgroup_id: null, adult_indicator: false, adult_indicator_strong: false, adult_score_tier: null,
  adult_score_tier_reviewed_at: null, reviewed_at: null, origin: "external", enrichment_status: "legacy", enrichment_detail: null,
  created_at: "2026-10-01T00:00:00Z", ...o,
})

beforeEach(() => {
  h.db = new FakeDb()
  h.admin = true
  provider.mockReset()
  process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
  globalThis.fetch = (() => { throw new Error("REDE PROIBIDA neste teste") }) as typeof fetch
  h.db.tables.tag_group = [{ id: CI, slug: "content_indicator", group: "Content Indicator" }]
  h.db.tables.tag_subgroup = [{ id: "sub-st", tag_group_id: CI, slug: "sexual-themes", name: "Sexual Themes", status: "approved", description: null }]
  h.db.tables.tags = [
    // as 4 de 08/10, no estado em que a 210 as deixou
    tag({ id: "t-falhou", slug: "mouse-girl-s", name: "Mouse Girl/s", enrichment_status: "provider_not_called", enrichment_detail: "mig 210: nenhuma chamada de IA", created_at: "2026-10-08T06:15:15Z" }),
    // tag MANUAL cuja classificação falhou: antes não aparecia em fila nenhuma
    tag({ id: "t-manual", slug: "lewd-ritual", name: "Lewd Ritual", origin: "manual", enrichment_status: "provider_failed", enrichment_detail: "grupo: Error: 529 overloaded", created_at: "2026-10-12T00:00:00Z" }),
    // de fonte, classificada e não revisada: a fila de sempre
    tag({ id: "t-ok", slug: "shy-male-lead", name: "Shy Male Lead", tag_group_id: CI, enrichment_status: "done", created_at: "2026-10-13T00:00:00Z" }),
    // de fonte, já revisada, legado: fora
    tag({ id: "t-revisada", slug: "x", name: "X", reviewed_at: "2026-09-01T00:00:00Z" }),
    // de fonte, não revisada E falhou: está nas duas partes da regra — não pode contar duas vezes
    tag({ id: "t-dupla", slug: "dupla", name: "Dupla", enrichment_status: "partial", enrichment_detail: "enriquecimento: o modelo não devolveu esta tag" }),
  ]
  for (const t of ["tag_alias", "work_tags", "works", "category_scores", "tag_subgroup_assignment", "tag_cluster_proposal"]) h.db.tables[t] = []
})

describe("fila 'Tags novas': lista e contador pela MESMA regra", () => {
  it("entra tag com classificação não concluída de QUALQUER origem; as que precisam de recuperação vêm primeiro", async () => {
    const fila = await loadNewTagsQueue(h.db.client() as never)
    const ids = fila.map((t) => t.id)
    expect(ids).toContain("t-manual")
    expect(ids).toContain("t-falhou")
    expect(ids).not.toContain("t-revisada")
    expect(ids.slice(0, 3).sort()).toEqual(["t-dupla", "t-falhou", "t-manual"])
    expect(ids.at(-1)).toBe("t-ok")
  })

  it("o contador da aba é o tamanho da fila (sem contar duas vezes quem está nas duas partes)", async () => {
    const fila = await loadNewTagsQueue(h.db.client() as never)
    expect(await countNewTagsQueue(h.db.client() as never)).toBe(fila.length)
    expect(fila.length).toBe(4)
  })

  it("a linha leva o estado e o motivo para a tela", async () => {
    const rows = await listNewTags()
    expect(rows.find((r) => r.id === "t-falhou")).toMatchObject({ enrichmentStatus: "provider_not_called", enrichmentDetail: "mig 210: nenhuma chamada de IA" })
    expect(rows.find((r) => r.id === "t-ok")).toMatchObject({ enrichmentStatus: "done", enrichmentDetail: null })
  })

  it("erro de leitura LANÇA (não desenha 'Nenhuma tag nova 🎉' sobre uma falha)", async () => {
    h.db.failWhen = ({ table, op }) => (table === "tags" && op === "select" ? "injetado: read failed" : null)
    await expect(listNewTags()).rejects.toThrow(/fila Tags novas/)
  })
})

describe("16 · reprocessar com IA (provider MOCKADO)", () => {
  it("tag que falhou → reprocessa pelo enrichNewTags, SÍNCRONO, e devolve o desfecho real (done)", async () => {
    provider.mockImplementation(async (_c, _p, m: { operation: string }) =>
      m.operation === "tag_classifier"
        ? msg({ classifications: [{ tag_name: "Lewd Ritual", group_slug: "content_indicator" }] })
        : msg({ results: [{ tag_name: "Lewd Ritual", subgroup_slug: "sexual-themes", synonym_of_slug: "none", confidence: 0.9, adult_level: "explicit", adult_score_tier: "explicit" }] }),
    )
    const r = await reprocessTagEnrichment("t-manual")
    expect(r).toEqual({ ok: true, status: "done", detail: null })
    expect(h.db.rows("tags").find((t) => t.id === "t-manual")).toMatchObject({ tag_group_id: CI, tag_subgroup_id: "sub-st", adult_indicator_strong: true, enrichment_status: "done" })
    expect(provider.mock.calls.map((c) => (c[2] as { operation: string }).operation)).toEqual(["tag_classifier", "tag_enricher"])
  })

  it("falhou de novo → devolve o estado e o motivo novos; NÃO vira done", async () => {
    provider.mockRejectedValue(new Error("529 overloaded"))
    const r = await reprocessTagEnrichment("t-manual")
    expect(r).toMatchObject({ ok: true, status: "provider_failed" })
    if (r.ok) expect(r.detail).toMatch(/529/)
  })

  it("tag com classificação REGISTRADA (done) → recusa, sem chamar o provider", async () => {
    const r = await reprocessTagEnrichment("t-ok")
    expect(r).toMatchObject({ ok: false })
    expect(provider).not.toHaveBeenCalled()
  })

  it("sem papel de curador → recusa, sem chamar o provider", async () => {
    h.admin = false
    const r = await reprocessTagEnrichment("t-manual")
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Curador/) })
    expect(provider).not.toHaveBeenCalled()
  })
})

describe("recuperação SÓ manual (arquitetura)", () => {
  it("enrichNewTags só é chamado pela ingestão, pela ação manual e pelo script de backfill", () => {
    const hits = execSync("git grep -lE 'enrichNewTags\\(' -- app components lib server scripts || true", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort()
    expect(hits).toEqual(["lib/tags/ingest.ts", "scripts/backfill-external-tags-apply.ts", "server/actions/tag-review.ts"])
  })

  it("a ação manual não é chamada fora do painel da fila", () => {
    const hits = execSync("git grep -lE 'reprocessTagEnrichment\\(' -- app components lib server || true", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort()
    expect(hits).toEqual(["components/settings/tag-consolidation/new-tags-panel.tsx", "server/actions/tag-review.ts"])
  })
})
