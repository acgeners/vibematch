// @vitest-environment node
// Proveniência HUMANA por campo (`tags.human_decisions`, migration 219).
//
// Até aqui uma correção humana não deixava rastro (grupo, 18+, subgrupo) ou deixava o MESMO rastro da
// IA (a marca do piso). Uma tag cuja classificação falhou e que alguém corrigiu à mão era
// indistinguível de uma que ninguém tocou, e só saía da fila pagando um reprocessamento.
//
// As regras que estes casos fixam:
//   · decidir UM campo registra só aquele campo, e nunca transforma a tag inteira em `curated`;
//   · `enrichment_status` continua dizendo o que a AUTOMAÇÃO fez;
//   · com grupo definido e 18+ decidido por um humano, a tag sai da recuperação — sem fingir que a IA
//     concluiu e sem precisar pagar;
//   · reprocessar depois NÃO sobrescreve campo decidido por humano, nem a proveniência dele.
//
// Código real (actions de revisão e de subgrupo, ingestão, fila); provider mockado; `fetch` proibido.
import { describe, it, expect, beforeEach, vi } from "vitest"
import { execSync } from "node:child_process"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, after: [] as Array<() => Promise<void>>, user: "curadora-uuid" as string | null }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { h.after.push(fn) } }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => ({ ok: true }),
  getSessionUserId: async () => h.user,
}))
vi.mock("@/lib/ai/anthropic-client", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  createLoggedMessage: vi.fn(),
}))

import { createLoggedMessage } from "@/lib/ai/anthropic-client"
import { changeTagGroup, reprocessTagEnrichment, setTagAdult, setTagScoreTier } from "@/server/actions/tag-review"
import { moveTagToSubgroup, moveTagsToSubgroup, unassignTag } from "@/server/actions/tag-subgroups"
import { resolveOrCreateTags, scheduleTagEnrichment } from "@/lib/tags/ingest"
import { countNewTagsQueue, loadNewTagsQueue, rowNeedsRecovery } from "@/server/queries/new-tags-queue"
import { parseHumanDecisions, recoveryState } from "@/lib/tags/enrichment-view"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"

const CI = (TAG_GROUP_IDS as Record<string, string>)["content_indicator"]
const provider = vi.mocked(createLoggedMessage)
const msg = (input: unknown) =>
  ({ message: { content: [{ type: "tool_use", name: "x", input }], model: "mock", stop_reason: "tool_use" }, apiCallId: null, usage: {} }) as never

const tag = (o: Record<string, unknown>) => ({
  tag_group_id: null, tag_subgroup_id: null, adult_indicator: false, adult_indicator_strong: false, adult_score_tier: null,
  adult_score_tier_reviewed_at: null, reviewed_at: null, origin: "manual", enrichment_status: "provider_failed",
  enrichment_detail: "grupo: Error: 529 overloaded", human_decisions: {}, created_at: "2026-10-12T00:00:00Z", ...o,
})
const T = (id: string) => h.db.rows("tags").find((t) => t.id === id)!
const hd = (id: string) => parseHumanDecisions(T(id).human_decisions)
const estado = (id: string) => recoveryState({ enrichmentStatus: T(id).enrichment_status as string, hasGroup: T(id).tag_group_id != null, humanDecisions: hd(id) })

beforeEach(() => {
  h.db = new FakeDb()
  h.after = []
  h.user = "curadora-uuid"
  provider.mockReset()
  process.env.ANTHROPIC_API_KEY = "sk-ant-OFFLINE-nunca-chamada"
  globalThis.fetch = (() => { throw new Error("REDE PROIBIDA neste teste") }) as typeof fetch
  h.db.tables.tag_group = [{ id: CI, slug: "content_indicator", group: "Content Indicator" }]
  h.db.tables.tag_subgroup = [{ id: "sub-st", tag_group_id: CI, slug: "sexual-themes", name: "Sexual Themes", status: "approved", description: null }]
  h.db.tables.tags = [
    tag({ id: "t-falhou", slug: "lewd-ritual", name: "Lewd Ritual" }),
    tag({ id: "t-fonte", slug: "mouse-girl-s", name: "Mouse Girl/s", origin: "external", enrichment_status: "provider_not_called", enrichment_detail: "mig 210" }),
    tag({ id: "t-ia", slug: "shy-male-lead", name: "Shy Male Lead", tag_group_id: CI, enrichment_status: "done", enrichment_detail: null, adult_score_tier_reviewed_at: "2026-10-01T00:00:00Z" }),
  ]
  for (const t of ["tag_alias", "work_tags", "works", "category_scores", "tag_subgroup_assignment", "tag_cluster_proposal"]) h.db.tables[t] = []
})

describe("A–D · cada ação registra SÓ o seu campo", () => {
  it("A. IA falhou → humano decide o 18+: status automático continua verdadeiro; só `adult` registrado, com quem e quando", async () => {
    expect(await setTagAdult("t-falhou", "explicit")).toEqual({ ok: true })
    const t = T("t-falhou")
    expect(t).toMatchObject({ enrichment_status: "provider_failed", adult_indicator: true, adult_indicator_strong: true })
    expect(Object.keys(hd("t-falhou"))).toEqual(["adult"])
    expect(hd("t-falhou").adult).toMatchObject({ by: "curadora-uuid", at: expect.any(String) })
    expect(t.adult_score_tier_reviewed_at).toBeNull() // o piso não foi decidido
  })

  it("B. humano altera o grupo → só `group`", async () => {
    expect(await changeTagGroup("t-falhou", "content_indicator")).toEqual({ ok: true })
    expect(T("t-falhou").tag_group_id).toBe(CI)
    expect(Object.keys(hd("t-falhou"))).toEqual(["group"])
  })

  it("C. humano decide o piso → `adult_score_tier` próprio; a marca da IA continua sem proveniência humana", async () => {
    expect(await setTagScoreTier("t-falhou", "label")).toEqual({ ok: true })
    expect(T("t-falhou").adult_score_tier).toBe("label")
    expect(T("t-falhou").adult_score_tier_reviewed_at).not.toBeNull()
    expect(Object.keys(hd("t-falhou"))).toEqual(["adult_score_tier"])
    // a tag que a IA concluiu tem a MESMA marca, e nenhuma decisão humana: dá para separar
    expect(T("t-ia").adult_score_tier_reviewed_at).not.toBeNull()
    expect(hd("t-ia")).toEqual({})
  })

  it("D. colocação manual de subgrupo, em lote e remoção (\"nenhum\") → `subgroup`", async () => {
    expect(await moveTagToSubgroup("t-falhou", "sub-st", "content_indicator")).toEqual({})
    expect(h.db.rows("tag_subgroup_assignment")[0]).toMatchObject({ tag_id: "t-falhou", status: "approved" })
    expect(Object.keys(hd("t-falhou"))).toEqual(["subgroup"])

    expect(await moveTagsToSubgroup(["t-fonte", "t-ia"], "sub-st", "content_indicator")).toEqual({ moved: 2 })
    expect(Object.keys(hd("t-fonte"))).toEqual(["subgroup"])
    expect(Object.keys(hd("t-ia"))).toEqual(["subgroup"])

    T("t-ia").tag_subgroup_id = "sub-st"
    expect(await unassignTag("t-ia")).toEqual({})
    expect(T("t-ia").tag_subgroup_id).toBeNull()
    expect(hd("t-ia").subgroup).toBeTruthy()
  })

  it("sem usuário de sessão, registra o QUANDO e omite o quem (nunca um id inventado)", async () => {
    h.user = null
    await setTagAdult("t-falhou", "none")
    expect(hd("t-falhou").adult).toEqual({ at: expect.any(String) })
  })

  it("valor e proveniência vão no MESMO update: se a escrita falha, nenhum dos dois fica", async () => {
    h.db.failWhen = ({ table, op }) => (table === "tags" && op === "update" ? "injetado" : null)
    expect(await setTagAdult("t-falhou", "explicit")).toEqual({ ok: false })
    expect(T("t-falhou").adult_indicator).toBe(false)
    expect(hd("t-falhou")).toEqual({})
  })
})

describe("E–F · quando a tag sai da recuperação", () => {
  it("E. recuperação manual COMPLETA (grupo + 18+): sai da recuperação, sem fingir que a IA concluiu e sem pagar", async () => {
    await changeTagGroup("t-falhou", "content_indicator")
    await setTagAdult("t-falhou", "none")
    expect(estado("t-falhou")).toBe("resolved_manually")
    expect(T("t-falhou").enrichment_status).toBe("provider_failed")
    expect(T("t-falhou").adult_score_tier_reviewed_at).toBeNull()
    expect(provider).not.toHaveBeenCalled()
    // origem manual: deixa a fila; a de fonte (ainda não confirmada) continua, como linha resolvida
    const fila = (await loadNewTagsQueue(h.db.client() as never)).map((t) => t.id)
    expect(fila).not.toContain("t-falhou")
    expect(await countNewTagsQueue(h.db.client() as never)).toBe(fila.length)
  })

  it("E2. tag de fonte resolvida à mão continua na fila, mas não como \"precisa de recuperação\"", async () => {
    await changeTagGroup("t-fonte", "content_indicator")
    await setTagAdult("t-fonte", "label")
    expect(estado("t-fonte")).toBe("resolved_manually")
    const fila = (await loadNewTagsQueue(h.db.client() as never)).map((t) => t.id)
    expect(fila).toEqual(["t-falhou", "t-fonte"]) // a que ainda precisa vem antes
  })

  it("F. recuperação INCOMPLETA (só o 18+): continua precisando, e registra o que já foi decidido", async () => {
    await setTagAdult("t-falhou", "explicit")
    expect(estado("t-falhou")).toBe("in_progress")
    const fila = await loadNewTagsQueue(h.db.client() as never)
    // no bloco do TOPO (o das que precisam de alguém). Dentro dele a ordem é created_at desc, id desc:
    // `t-fonte` empata no created_at e também precisa, então a posição exata não é o que se testa aqui.
    const i = fila.findIndex((t) => t.id === "t-falhou")
    expect(i).toBeGreaterThanOrEqual(0)
    expect(fila.slice(0, i + 1).every(rowNeedsRecovery)).toBe(true)
    expect(parseHumanDecisions(fila[i].human_decisions).adult).toBeTruthy()
  })

  it("F2. piso NÃO é exigido para sair da recuperação (a fila \"Piso adulto\" o cobra), nem subgrupo", async () => {
    await changeTagGroup("t-falhou", "content_indicator")
    await setTagAdult("t-falhou", "explicit")
    expect(T("t-falhou").adult_score_tier_reviewed_at).toBeNull()
    expect(T("t-falhou").tag_subgroup_id).toBeNull()
    expect(estado("t-falhou")).toBe("resolved_manually")
  })
})

describe("G–H · humano × IA", () => {
  const iaResponde = (adult = "explicit", tier = "explicit") =>
    provider.mockImplementation(async (_c, _p, m: { operation: string }) =>
      m.operation === "tag_classifier"
        ? msg({ classifications: [{ tag_name: "Lewd Ritual", group_slug: "content_indicator" }] })
        : msg({ results: [{ tag_name: "Lewd Ritual", subgroup_slug: "sexual-themes", synonym_of_slug: "none", confidence: 0.9, adult_level: adult, adult_score_tier: tier }] }))

  it("G. IA concluída normalmente NÃO ganha proveniência humana", async () => {
    h.db.tables.tags = []
    iaResponde()
    const { ids, createdIds } = await resolveOrCreateTags(h.db.client() as never, ["Lewd Ritual"], "external")
    scheduleTagEnrichment(createdIds)
    for (const f of h.after.splice(0)) await f()
    expect(T(ids[0])).toMatchObject({ enrichment_status: "done", human_decisions: {} })
  })

  it("H. reprocessar uma tag corrigida em parte: humano VENCE nos campos dele; a IA preenche o resto; a proveniência fica intacta", async () => {
    await changeTagGroup("t-falhou", "content_indicator")
    await setTagAdult("t-falhou", "none")
    const antes = JSON.stringify(T("t-falhou").human_decisions)
    iaResponde("explicit", "explicit")

    const r = await reprocessTagEnrichment("t-falhou")
    expect(r).toEqual({ ok: true, status: "done", detail: null })
    const t = T("t-falhou")
    expect(JSON.stringify(t.human_decisions)).toBe(antes) // nada apagado nem reescrito
    expect(t.adult_indicator).toBe(false) // o "Não é 18+" humano vale sobre o "explicit" da IA
    expect(t.tag_group_id).toBe(CI) // grupo humano: o classificador nem roda
    expect(provider.mock.calls.map((c) => (c[2] as { operation: string }).operation)).toEqual(["tag_enricher"])
    expect(t.tag_subgroup_id).toBe("sub-st") // ninguém tinha decidido o subgrupo: vale o da IA
    expect(t.adult_score_tier).toBe("explicit") // nem o piso
  })

  it("H2. piso decidido por humano: o reprocessamento não reescreve o valor nem a marca dele", async () => {
    await setTagScoreTier("t-falhou", "none")
    const marca = T("t-falhou").adult_score_tier_reviewed_at
    iaResponde("explicit", "explicit")
    await new Promise((r) => setTimeout(r, 5))
    await reprocessTagEnrichment("t-falhou")
    expect(T("t-falhou")).toMatchObject({ enrichment_status: "done", adult_score_tier: null, adult_score_tier_reviewed_at: marca })
    expect(T("t-falhou").adult_indicator_strong).toBe(true) // o 18+ ninguém decidiu: vale o da IA
  })

  it("H3. subgrupo decidido por humano (inclusive \"nenhum\"): a IA não aplica o dela", async () => {
    await unassignTag("t-falhou")
    iaResponde()
    await reprocessTagEnrichment("t-falhou")
    expect(T("t-falhou").tag_subgroup_id).toBeNull()
    expect(h.db.rows("tag_subgroup_assignment")).toEqual([])
  })
})

describe("arquitetura", () => {
  it("só as ações humanas ESCREVEM `human_decisions`; o enriquecimento só lê", () => {
    const hits = execSync("git grep -lP 'human_decisions:\\s*+(?!unknown\\b)' -- lib server app components || true", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort()
    expect(hits).toEqual(["server/actions/tag-review.ts", "server/actions/tag-subgroups.ts"])
  })
})

describe("subgrupo: valor (tag_subgroup_assignment) e proveniência (tags) em DUAS tabelas", () => {
  /** Linha que já existia antes da decisão humana (da IA). */
  const ANTERIOR = { id: "asg-0", tag_id: "t-ia", subgroup_id: "sub-velho", group_slug: "content_indicator", status: "applied", confidence: 0.8, reviewed_at: "2026-10-01T00:00:00Z", applied_at: "2026-10-01T00:00:00Z" }
  const asg = (tagId: string) => h.db.rows("tag_subgroup_assignment").find((a) => a.tag_id === tagId)
  /** O invariante: nenhuma tag fica com a decisão nova sem a proveniência, nem com proveniência sem a decisão. */
  const coerente = (tagId: string, decidiu: boolean) => {
    expect(Boolean(hd(tagId).subgroup)).toBe(decidiu)
    if (decidiu) expect(asg(tagId)).toMatchObject({ status: "approved", subgroup_id: "sub-st" })
  }
  /** Falha só na N-ésima operação que casar (as outras passam). */
  const falharNa = (n: number, casa: (q: { table: string; op: string }) => boolean) => {
    let vistas = 0
    h.db.failWhen = (q) => (casa(q) && ++vistas === n ? "injetado: write failed" : null)
  }
  const provTags = (q: { table: string; op: string }) => q.table === "tags" && q.op === "update"

  beforeEach(() => {
    h.db.tables.tag_subgroup_assignment = [{ ...ANTERIOR }]
    T("t-ia").tag_subgroup_id = "sub-velho"
  })

  it("sucesso → valor e proveniência", async () => {
    expect(await moveTagToSubgroup("t-ia", "sub-st", "content_indicator")).toEqual({})
    coerente("t-ia", true)
  })

  it("remoção → \"nenhum subgrupo\" decidido por humano: linha apagada, vínculo limpo, proveniência registrada", async () => {
    expect(await unassignTag("t-ia")).toEqual({})
    expect(asg("t-ia")).toBeUndefined()
    expect(T("t-ia").tag_subgroup_id).toBeNull()
    expect(hd("t-ia").subgroup).toMatchObject({ by: "curadora-uuid" })
  })

  it("falha ao gravar o VALOR → nenhuma proveniência (mover e remover)", async () => {
    falharNa(1, (q) => q.table === "tag_subgroup_assignment" && q.op === "upsert")
    expect((await moveTagToSubgroup("t-ia", "sub-st", "content_indicator")).error).toMatch(/nada mudou/)
    expect(asg("t-ia")).toMatchObject(ANTERIOR)
    expect(hd("t-ia")).toEqual({})

    falharNa(1, (q) => q.table === "tag_subgroup_assignment" && q.op === "delete")
    expect((await unassignTag("t-ia")).error).toMatch(/nada mudou/)
    expect(asg("t-ia")).toMatchObject(ANTERIOR) // a linha continua: se a proveniência tivesse ido, diria "nenhum" com ela aqui
    expect(T("t-ia").tag_subgroup_id).toBe("sub-velho")
    expect(hd("t-ia")).toEqual({})
  })

  it("falha ao gravar a PROVENIÊNCIA → o valor é DESFEITO (linha anterior restaurada), e o erro diz isso", async () => {
    falharNa(1, provTags)
    expect((await moveTagToSubgroup("t-ia", "sub-st", "content_indicator")).error).toMatch(/desfeita, nada mudou/)
    expect(asg("t-ia")).toMatchObject(ANTERIOR)
    expect(hd("t-ia")).toEqual({})

    // tag sem linha anterior: o desfazer APAGA a que acabou de nascer
    falharNa(1, provTags)
    await moveTagToSubgroup("t-falhou", "sub-st", "content_indicator")
    expect(asg("t-falhou")).toBeUndefined()
    expect(hd("t-falhou")).toEqual({})
  })

  it("falha na proveniência da REMOÇÃO → a linha apagada volta e o vínculo da tag fica como estava", async () => {
    falharNa(1, provTags)
    expect((await unassignTag("t-ia")).error).toMatch(/desfeita/)
    expect(asg("t-ia")).toMatchObject(ANTERIOR)
    expect(T("t-ia").tag_subgroup_id).toBe("sub-velho")
    expect(hd("t-ia")).toEqual({})
  })

  it("falha DUPLA (proveniência e o desfazer): o resíduo não é silencioso — mensagem 🔴 e log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    let upserts = 0
    h.db.failWhen = (q) =>
      provTags(q) || (q.table === "tag_subgroup_assignment" && q.op === "upsert" && ++upserts === 2) ? "injetado" : null
    const r = await moveTagToSubgroup("t-ia", "sub-st", "content_indicator")
    expect(r.error).toMatch(/SEM o registro de decisão humana.*desfazer também falhou/)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/SEM proveniência humana/), expect.anything())
    log.mockRestore()
  })

  it("lote com falha no MEIO → para ali; cada tag fica coerente; `moved` conta só as que ficaram com os dois", async () => {
    falharNa(2, provTags) // a proveniência da 2ª tag falha
    const r = await moveTagsToSubgroup(["t-falhou", "t-fonte", "t-ia"], "sub-st", "content_indicator")
    expect(r).toEqual({ moved: 1, error: expect.stringMatching(/^1 de 3 movida\(s\); parou numa tag: .*desfeita/) })
    coerente("t-falhou", true)
    coerente("t-fonte", false)
    expect(asg("t-fonte")).toBeUndefined() // desfeita
    coerente("t-ia", false)
    expect(asg("t-ia")).toMatchObject(ANTERIOR) // não foi tocada
  })
})
