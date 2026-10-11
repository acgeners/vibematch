// @vitest-environment node
// 🔴 Regra do gate 18+ desde 2026-10-10 (decisão da Ana): `adult_auto` liga quando a obra tem ≥ 1 tag
// FORTE, e só isso. A regra antiga "tag fraca + adult_content ≥ 7" foi REMOVIDA: gate e nota são
// dimensões diferentes, e a nota tem legado e pisos que a inflam. Logo: mudar a nota não muda o gate;
// mudar a COMPOSIÇÃO de tags (ou a flag de uma tag) muda.
//
// Código REAL contra um banco em memória; só auth, cache e fila de recálculo são mockados.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "./fake-supabase"

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: vi.fn(async () => {}), recalculateScoresNow: vi.fn() }))
vi.mock("@/server/queries/alignment", () => ({ markWorkAlignmentStale: vi.fn(async () => {}) }))
vi.mock("@/server/queries/current-user", () => {
  const ok = async () => ({ ok: true, userId: "dono" })
  return {
    ensureAdmin: ok, ensurePermission: ok, ensureSignedIn: ok,
    getOwnerUserId: async () => "dono", getSessionUserId: async () => "dono",
    getSynopsisCanonicalOnCreate: async () => false, getTagInferenceOnCreate: async () => false,
    getGenerateAllOnCreate: async () => false,
  }
})

import { decideAdultAuto, recomputeAdultAuto } from "@/lib/tags/adult-classify"
import { submitAiReview } from "@/server/actions/ai"
import { updateWorkExternalData } from "@/server/actions/works"
import { setTagAdult } from "@/server/actions/tag-review"

type Obra = { adult_auto?: boolean; adult_reason?: string | null; adult_override?: boolean | null; nota?: number; tags?: string[] }
function seed(o: Obra = {}) {
  h.db = new FakeDb()
  const d = h.db.tables
  d.tags = [
    { id: "t-fraca", slug: "sexual-content", name: "Sexual Content", adult_indicator: true, adult_indicator_strong: false },
    { id: "t-forte", slug: "cunnilingus", name: "Cunnilingus", adult_indicator: true, adult_indicator_strong: true },
    { id: "t-neutra", slug: "romance-x", name: "Romance X", adult_indicator: false, adult_indicator_strong: false },
  ]
  d.tag_alias = []
  d.works = [{ id: "w1", title: "Obra", adult_auto: o.adult_auto ?? false, adult_reason: o.adult_reason ?? null, adult_override: o.adult_override ?? null, publication_status_id: null }]
  d.work_tags = (o.tags ?? []).map((tag_id) => ({ work_id: "w1", tag_id }))
  d.category_scores = o.nota == null ? [] : [{ id: "cs1", work_id: "w1", criterion_slug: "adult_content", score: o.nota, source: "ai_accepted" }]
  d.ai_evaluation_scores = []
  d.score_calibration_suggestions = []
  d.work_genres = []
}
const work = () => h.db.rows("works")[0]
const recompute = () => recomputeAdultAuto(h.db.client() as never, "w1")

beforeEach(() => {
  globalThis.fetch = (() => { throw new Error("REDE PROIBIDA neste teste") }) as typeof fetch
})

describe("a régua (decideAdultAuto)", () => {
  const casos: Array<[string, { adult_auto: boolean; adult_reason: string | null }, boolean, ReturnType<typeof decideAdultAuto>]> = [
    ["sem forte e sem auto: nada", { adult_auto: false, adult_reason: null }, false, null],
    ["forte presente liga", { adult_auto: false, adult_reason: null }, true, { adult_auto: true, adult_reason: "tag_explicit" }],
    ["forte vence a 2ª opinião 'limpo' (ela só olhou sinais fracos)", { adult_auto: false, adult_reason: "ai_review_clean" }, true, { adult_auto: true, adult_reason: "tag_explicit" }],
    ["forte some: desliga o que a régua de tags ligou", { adult_auto: true, adult_reason: "tag_explicit" }, false, { adult_auto: false, adult_reason: null }],
    ["legado tag_soft_score sem forte: desliga", { adult_auto: true, adult_reason: "tag_soft_score" }, false, { adult_auto: false, adult_reason: null }],
    ["legado tag_soft_score com forte: só troca o motivo", { adult_auto: true, adult_reason: "tag_soft_score" }, true, { adult_auto: true, adult_reason: "tag_explicit" }],
    ["ai_review sem forte: intocado (evidência independente)", { adult_auto: true, adult_reason: "ai_review" }, false, null],
    ["ai_review com forte: intocado", { adult_auto: true, adult_reason: "ai_review" }, true, null],
    ["já coerente: nada", { adult_auto: true, adult_reason: "tag_explicit" }, true, null],
  ]
  for (const [nome, atual, forte, esperado] of casos) it(nome, () => expect(decideAdultAuto(atual, forte)).toEqual(esperado))
})

describe("tag fraca + nota NÃO liga o gate", () => {
  it("fraca + nota 7 → continua fora", async () => {
    seed({ tags: ["t-fraca"], nota: 7 })
    await recompute()
    expect(work().adult_auto).toBe(false)
  })
  it("fraca + nota 10 → continua fora", async () => {
    seed({ tags: ["t-fraca"], nota: 10 })
    await recompute()
    expect(work().adult_auto).toBe(false)
  })
  it("a obra que estava 18+ só por fraca + nota (legado) sai na próxima mudança de tag", async () => {
    seed({ tags: ["t-fraca"], nota: 9, adult_auto: true, adult_reason: "tag_soft_score" })
    await recompute()
    expect(work()).toMatchObject({ adult_auto: false, adult_reason: null })
  })
})

describe("a nota mudar sozinha não muda o gate", () => {
  it("aceitar avaliação com adult_content 10 numa obra com tag fraca não liga nada", async () => {
    seed({ tags: ["t-fraca"] })
    const r = await submitAiReview({ workId: "w1", evaluationId: "ev1", scores: [{ criterionSlug: "adult_content", acceptedScore: 10, wasEdited: false }] } as never)
    expect(r.error).toBeNull()
    expect(h.db.rows("category_scores")[0].score).toBe(10)
    expect(work().adult_auto).toBe(false)
  })
  it("prova no código: os escritores de nota e a régua não se tocam", () => {
    const src = (p: string) => readFileSync(resolve(__dirname, "../../..", p), "utf8")
    const regua = src("lib/tags/adult-classify.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    expect(regua).not.toMatch(/category_scores|adult_content/)
    expect(src("server/actions/ai.ts")).not.toMatch(/recomputeAdultAuto/)
    const sql = src("supabase/migrations/210_tags_adultas_coerencia.sql")
    const plano = sql.slice(sql.indexOf("-- ── 4) O PLANO"), sql.indexOf("-- ── 5) Aplicar"))
    expect(plano).not.toMatch(/category_scores/)
  })
})

describe("a composição de tags muda → o gate recalcula", () => {
  it("tag forte presente liga", async () => {
    seed({ tags: ["t-forte"] })
    await recompute()
    expect(work()).toMatchObject({ adult_auto: true, adult_reason: "tag_explicit" })
  })
  it("tirar a tag forte da obra (formulário) desliga", async () => {
    seed({ tags: ["t-forte", "t-fraca"], adult_auto: true, adult_reason: "tag_explicit", nota: 10 })
    h.db.tables.work_tags = h.db.rows("work_tags").filter((r) => r.tag_id !== "t-forte")
    await recompute()
    expect(work()).toMatchObject({ adult_auto: false, adult_reason: null })
  })
  it("rebaixar a flag da tag (setTagAdult forte → fraca) desliga as obras que só tinham ela", async () => {
    seed({ tags: ["t-forte"], adult_auto: true, adult_reason: "tag_explicit" })
    expect((await setTagAdult("t-forte", "label")).ok).toBe(true)
    expect(work()).toMatchObject({ adult_auto: false, adult_reason: null })
  })
  it("tirar o sinal da tag (setTagAdult forte → nenhum) também recalcula e desliga", async () => {
    seed({ tags: ["t-forte"], adult_auto: true, adult_reason: "tag_explicit" })
    expect((await setTagAdult("t-forte", "none")).ok).toBe(true)
    expect(work()).toMatchObject({ adult_auto: false, adult_reason: null })
  })
  it("override humano continua vencendo: o recálculo só mexe no automático", async () => {
    seed({ tags: ["t-forte"], adult_override: false })
    await recompute()
    expect(work().adult_override).toBe(false) // intocado; o is_adult (coluna gerada) segue o override
  })
  it("'Atualizar dados' vinculando tag FORTE já existente liga o 18+", async () => {
    seed()
    const r = await updateWorkExternalData("w1", { tags: ["Cunnilingus"] } as never)
    expect(r).not.toHaveProperty("error")
    expect(work()).toMatchObject({ adult_auto: true, adult_reason: "tag_explicit" })
  })
  it("'Atualizar dados' vinculando tag FRACA numa obra com nota 9 não liga", async () => {
    seed({ nota: 9 })
    await updateWorkExternalData("w1", { tags: ["Sexual Content"] } as never)
    expect(h.db.rows("work_tags").map((x) => x.tag_id)).toContain("t-fraca")
    expect(work().adult_auto).toBe(false)
  })
  it("tag NOVA criada por 'Atualizar dados' nasce origin=external e pending", async () => {
    seed()
    await updateWorkExternalData("w1", { tags: ["Tag De Fonte Nova"] } as never)
    const nova = h.db.rows("tags").find((t) => t.name === "Tag De Fonte Nova")!
    expect(nova.origin).toBe("external")
    expect(nova.enrichment_status).toBe("pending")
  })
})
