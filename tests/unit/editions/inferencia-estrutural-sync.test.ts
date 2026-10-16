import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("server-only", () => ({}))

import {
  STRUCTURAL_INFERENCE_AUTO_APPLY,
  applyStructuralPlan,
  inferenceNeedsRetry,
  recalcPendingAfter,
  loadStructuralFacts,
  reconcileStructuralInference,
  reconcileStructuralInferenceForRecalc,
  reconcileStructuralInferenceForWork,
} from "@/server/editions/structural-inference-sync"
import { LEGACY_STANDARD_BASE_RULE, STRUCTURAL_RULES, planStructuralInference } from "@/lib/editions/structural-inference"

/**
 * O executor da inferência estrutural contra um banco FALSO que reproduz o gatilho da migration 213:
 * UPDATE que REBAIXA a força é recusado, e nota de versão só entra em obra mixed. Se a reconciliação
 * dependesse de rebaixar (ou gravasse em obra não-mixed), estes testes reprovariam com erro.
 */

type Row = Record<string, unknown>
const FORCA: Record<string, number> = { not_rated: 0, inferred_base: 1, reused_existing: 2, ai_evaluated: 2, curator_confirmed: 3 }

function campo(r: Row, c: string): unknown {
  if (c === "evidence->>regra") return ((r.evidence ?? {}) as Row).regra ?? null
  return r[c]
}

class FakeDb {
  tables: Record<string, Row[]> = {}
  calls: string[] = []
  writes: Array<{ table: string; op: string }> = []
  /** Roda uma vez, logo antes da próxima ESCRITA — simula outro escritor entre a leitura e o UPDATE. */
  antesDeEscrever: (() => void) | null = null
  /** Falha injetada: devolve erro na escrita que casar (simula queda no meio da reconciliação). */
  falhar: ((table: string, op: string, alvo: Row[]) => boolean) | null = null
  /** Falha injetada na LEITURA de uma tabela (a reconciliação nem chega a planejar). */
  leituraFalha: string | null = null
  from(table: string) {
    this.calls.push(table)
    return new Q(this, table)
  }
}

class Q {
  private filters: Array<(r: Row) => boolean> = []
  private op: "select" | "insert" | "update" | "delete" = "select"
  private payload: Row | null = null
  private returning = false
  private single = false
  private rangeV: [number, number] | null = null
  constructor(private db: FakeDb, private table: string) {}
  select() {
    if (this.op !== "select") this.returning = true
    return this
  }
  eq(c: string, v: unknown) { this.filters.push((r) => campo(r, c) === v); return this }
  neq(c: string, v: unknown) { this.filters.push((r) => campo(r, c) !== v); return this }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(campo(r, c))); return this }
  or() { return this }
  order() { return this }
  range(a: number, b: number) { this.rangeV = [a, b]; return this }
  maybeSingle() { this.single = true; return this }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this }
  update(p: Row) { this.op = "update"; this.payload = p; return this }
  delete() { this.op = "delete"; return this }
  then(ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) {
    return Promise.resolve().then(() => this.exec()).then(ok, falha)
  }
  private rows() { return (this.db.tables[this.table] ??= []) }
  private mixed(workId: unknown) {
    return (this.db.tables.work_edition_state ?? []).some((s) => s.work_id === workId && s.state === "mixed")
  }
  private exec() {
    const t = this.rows()
    const casa = (r: Row) => this.filters.every((f) => f(r))
    const projetar = (r: Row) => (this.table === "work_edition_scores" ? { ...r, regra: campo(r, "evidence->>regra") } : { ...r })
    if (this.op === "select") {
      if (this.db.leituraFalha === this.table) return { data: null, error: { message: `falha injetada lendo ${this.table}` } }
      let out = t.filter(casa).map(projetar)
      if (this.rangeV) out = out.slice(this.rangeV[0], this.rangeV[1] + 1)
      return { data: this.single ? (out[0] ?? null) : out, error: null }
    }
    if (this.db.antesDeEscrever) {
      const f = this.db.antesDeEscrever
      this.db.antesDeEscrever = null
      f()
    }
    if (this.db.falhar?.(this.table, this.op, this.op === "insert" ? [this.payload!] : t.filter(casa)))
      return { data: null, error: { message: `falha injetada em ${this.table}.${this.op}` } }
    this.db.writes.push({ table: this.table, op: this.op })
    if (this.op === "insert") {
      const p = this.payload!
      if (this.table === "work_edition_scores") {
        if (!this.mixed(p.work_id)) return { data: null, error: { message: "a obra não é mixed (gatilho 213)" } }
        if (t.some((r) => r.work_id === p.work_id && r.edition === p.edition && r.criterion_slug === p.criterion_slug))
          return { data: null, error: { code: "23505", message: "duplicate key" } }
      }
      t.push({ ...p })
      return { data: null, error: null }
    }
    const alvo = t.filter(casa)
    if (this.op === "update") {
      for (const r of alvo) {
        if (this.table === "work_edition_scores" && FORCA[String(this.payload!.source)] < FORCA[String(r.source)])
          return { data: null, error: { message: `recusado rebaixar ${String(r.source)} → ${String(this.payload!.source)} (gatilho 213)` } }
      }
      for (const r of alvo) Object.assign(r, this.payload)
      return { data: this.returning ? alvo.map(projetar) : null, error: null }
    }
    this.db.tables[this.table] = t.filter((r) => !casa(r))
    return { data: this.returning ? alvo.map(projetar) : null, error: null }
  }
}

const W = "w-caso-a"
const NOVA = "w-nova"
const tagAto = { work_id: W, tag_id: "t1", source: null, tags: { name: "Cunnilingus", adult_score_tier: "explicit", adult_indicator: true, adult_indicator_strong: true, tag_subgroup: { slug: "explicit" } } }
const tagR19 = { work_id: W, tag_id: "t2", source: null, tags: { name: "R19", adult_score_tier: "label", adult_indicator: true, adult_indicator_strong: true, tag_subgroup: { slug: "rating-labels" } } }
const BASE_LEGADA = {
  work_id: W, edition: "normal", criterion_slug: "adult_content", score: 5, source: "inferred_base", status: "provisional",
  confidence: "baixa", decided_by: "audit", ai_evaluation_id: null, evidence: { mig: "214", regra: LEGACY_STANDARD_BASE_RULE },
}
const NAO_AVALIADO = {
  work_id: W, edition: "r18", criterion_slug: "adult_content", score: null, source: "not_rated", status: "not_rated",
  confidence: null, decided_by: "audit", ai_evaluation_id: null, evidence: { mig: "214", motivo: "insufficient_evidence" },
}

let db: FakeDb
beforeEach(() => {
  db = new FakeDb()
  db.tables = {
    work_edition_state: [
      { work_id: W, state: "mixed", r18_extra_chapters: false, linhas_normal: ["Original Webtoon: R15: Ridibooks"], normal_lines: null, genres: null, generos_adultos: [] },
    ],
    work_edition_scores: [structuredClone(BASE_LEGADA), structuredClone(NAO_AVALIADO)],
    work_tags: [structuredClone(tagAto), structuredClone(tagR19)],
    ai_evaluations: [],
  }
})
const nota = (workId: string, edition: string) =>
  db.tables.work_edition_scores.find((r) => r.work_id === workId && r.edition === edition)
const NOW = "2026-10-15T12:00:00.000Z"

describe("ensaio (apply: false) não grava nada", () => {
  it("planeja 6 e 9 e não escreve", async () => {
    const antes = structuredClone(db.tables.work_edition_scores)
    const r = await reconcileStructuralInference(db as never, { apply: false, nowIso: NOW })
    expect(r.works[0].plan.decisions.normal).toMatchObject({ kind: "infer", target: { score: 6 } })
    expect(r.works[0].plan.decisions.r18).toMatchObject({ kind: "infer", target: { score: 9 } })
    expect(db.writes).toEqual([])
    expect(db.tables.work_edition_scores).toEqual(antes)
  })
})

describe("o carregador leva a procedência do vínculo da tag até a política", () => {
  const sexualContent = (source?: string | null) => ({
    work_id: W, tag_id: "t3", ...(source === undefined ? {} : { source }),
    tags: { name: "Sexual Content", adult_score_tier: "label", adult_indicator: true, adult_indicator_strong: false, tag_subgroup: { slug: "rating-labels" } },
  })

  it("Sexual Content inferida pela IA, sozinha: a adulta segue sem nota (e nada é gravado)", async () => {
    db.tables.work_tags = [sexualContent("ai_inferred"), structuredClone(tagR19)]
    const r = await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    expect(r.works[0].facts.tags.find((t) => t.name === "Sexual Content")?.source).toBe("ai_inferred")
    expect(r.works[0].plan.decisions.r18).toMatchObject({ kind: "none" })
    expect(nota(W, "r18")).toMatchObject(NAO_AVALIADO)
  })

  it("a mesma tag vinda das fontes confirma e grava o piso", async () => {
    db.tables.work_tags = [sexualContent("imported"), structuredClone(tagR19)]
    await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    expect(nota(W, "r18")).toMatchObject({ score: 9, evidence: { sinais: ["tag sexual: Sexual Content"] } })
  })

  it("vínculo SEM a coluna `source` (select que a perdeu) não confirma — falha para o lado de não inferir", async () => {
    db.tables.work_tags = [sexualContent(undefined), structuredClone(tagR19)]
    const r = await reconcileStructuralInference(db as never, { apply: false, nowIso: NOW })
    expect(r.works[0].plan.decisions.r18).toMatchObject({ kind: "none" })
  })

  // O banco falso ignora o select, então quem guarda a coluna é a leitura do source: sem ela o vínculo
  // chega sem procedência e NENHUMA tag confirma (o caso acima) — seguro, mas apagaria o legado inteiro.
  it("o select do carregador pede a coluna `source` de work_tags (no nível do vínculo, não da tag)", () => {
    const src = readFileSync(join(__dirname, "../../../server/editions/structural-inference-sync.ts"), "utf8")
    const select = src.match(/from\("work_tags"\)\s*\.select\(\s*"([^"]*)"/)?.[1]
    expect(select).toBeDefined()
    const doVinculo = select!.replace(/\w+!?\w*\([^()]*(\([^()]*\))?[^()]*\)/g, "").split(",").map((c) => c.trim())
    expect(doVinculo).toContain("source")
  })
})

describe("aplicação, idempotência e retirada", () => {
  it("caso A: 5→6 e não avaliado→9, guardando o estado anterior; nenhuma subida recusada pelo gatilho", async () => {
    const r = await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    expect(r.errors).toEqual([])
    expect(r.works[0].outcomes).toEqual([{ edition: "normal", action: "atualizada" }, { edition: "r18", action: "atualizada" }])
    expect(nota(W, "normal")).toMatchObject({ score: 6, source: "inferred_base", status: "provisional", confidence: "baixa", evidence: { regra: STRUCTURAL_RULES.standardBase, anterior: { score: 5, source: "inferred_base" } } })
    expect(nota(W, "r18")).toMatchObject({ score: 9, source: "inferred_base", evidence: { regra: STRUCTURAL_RULES.adultFloor, anterior: { source: "not_rated" } } })
    expect((nota(W, "r18")!.evidence as { sinais: string[] }).sinais).toContain("tag de ato explícito: Cunnilingus")
  })

  it("reprocessar é idempotente: a 2ª passada não grava nada", async () => {
    await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    db.writes = []
    const r = await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    expect(r.works[0].plan.decisions.normal.kind).toBe("keep")
    expect(r.works[0].plan.decisions.r18.kind).toBe("keep")
    expect(db.writes).toEqual([])
  })

  it("o sinal sexual some: retira as duas e devolve EXATAMENTE o que havia antes (sem passar por rebaixamento)", async () => {
    await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    db.tables.work_tags = [structuredClone(tagR19)] // a tag de ato foi corrigida; sobra só o rótulo de idade
    const r = await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    expect(r.errors).toEqual([])
    expect(r.works[0].outcomes.map((o) => o.action)).toEqual(["retirada", "retirada"])
    expect(nota(W, "r18")).toMatchObject(NAO_AVALIADO)
    expect(nota(W, "normal")).toMatchObject(BASE_LEGADA)
    // E a base legada que voltou não é retirada sozinha: vira conflito para a curadoria.
    const depois = await reconcileStructuralInference(db as never, { apply: false, nowIso: NOW })
    expect(depois.works[0].plan.decisions.normal.kind).toBe("conflict")
  })

  it("mixed nova sem linhas: cria as duas; o sinal sumindo depois deixa a versão sem linha (o 'não avaliado' de sempre)", async () => {
    db.tables.work_edition_state.push({ work_id: NOVA, state: "mixed", r18_extra_chapters: false, linhas_normal: null, normal_lines: ["Original Webtoon: R15"], genres: ["Romance", "Smut"], generos_adultos: null })
    const r = await reconcileStructuralInference(db as never, { workIds: [NOVA], apply: true, nowIso: NOW })
    expect(r.works[0].outcomes).toEqual([{ edition: "normal", action: "inserida" }, { edition: "r18", action: "inserida" }])
    expect(nota(NOVA, "r18")).toMatchObject({ score: 9, evidence: { sinais: ["gênero do MangaUpdates: smut"], anterior: null } })
    db.tables.work_edition_state.find((s) => s.work_id === NOVA)!.genres = ["Romance"]
    await reconcileStructuralInference(db as never, { workIds: [NOVA], apply: true, nowIso: NOW })
    expect(nota(NOVA, "r18")).toBeUndefined()
    expect(nota(NOVA, "normal")).toBeUndefined()
  })

  it("só a versão pedida é gravada (aplicação em etapas)", async () => {
    await reconcileStructuralInference(db as never, { apply: true, editions: ["normal"], nowIso: NOW })
    expect(nota(W, "normal")).toMatchObject({ score: 6 })
    expect(nota(W, "r18")).toMatchObject({ source: "not_rated" })
  })
})

describe("nunca toca nota mais forte — nem a que mudou no meio", () => {
  it("reused_existing / curator_confirmed: nenhuma escrita", async () => {
    db.tables.work_edition_scores = [
      { ...structuredClone(BASE_LEGADA), score: 6, source: "reused_existing", status: "rated", evidence: {} },
      { ...structuredClone(NAO_AVALIADO), score: 9, source: "curator_confirmed", status: "rated", decided_by: "curator" },
    ]
    const r = await reconcileStructuralInference(db as never, { apply: true, nowIso: NOW })
    expect(r.works[0].plan.decisions.normal.kind).toBe("preserve")
    expect(r.works[0].plan.decisions.r18.kind).toBe("preserve")
    expect(db.writes).toEqual([])
  })

  it("plano velho + curadoria gravou no meio: a escrita é PULADA e a nota da curadoria fica", async () => {
    const [{ facts }] = await loadStructuralFacts(db as never, { workIds: [W] })
    const plano = planStructuralInference(facts)
    Object.assign(nota(W, "r18")!, { score: 9, source: "curator_confirmed", status: "rated", decided_by: "curator" })
    const out = await applyStructuralPlan(db as never, W, plano, { nowIso: NOW, editions: ["r18"] })
    expect(out).toEqual([{ edition: "r18", action: "pulada", detail: "a linha mudou no meio" }])
    expect(nota(W, "r18")).toMatchObject({ score: 9, source: "curator_confirmed" })
  })

  /**
   * A corrida que só o filtro NO BANCO pega: a releitura viu "não avaliado" da auditoria, e a curadoria
   * registra o "não avaliado" DELA entre a releitura e o UPDATE. Subir 0 → 1 o gatilho ACEITA — sem o
   * filtro, a decisão humana seria sobrescrita calada.
   */
  it("curadoria registra 'não avaliado' entre a releitura e o UPDATE: pulada, a decisão fica", async () => {
    db.antesDeEscrever = () => Object.assign(nota(W, "r18")!, { decided_by: "curator", evidence: { curadoria: true } })
    const r = await reconcileStructuralInference(db as never, { apply: true, editions: ["r18"], nowIso: NOW })
    expect(r.works[0].outcomes).toEqual([{ edition: "r18", action: "pulada", detail: "a linha mudou no meio" }])
    expect(nota(W, "r18")).toMatchObject({ source: "not_rated", decided_by: "curator", evidence: { curadoria: true } })
  })

  it("nota mais forte gravada entre a releitura e o UPDATE: pulada (nunca erro nem sobrescrita)", async () => {
    db.antesDeEscrever = () => Object.assign(nota(W, "normal")!, { score: 4, source: "curator_confirmed", status: "rated", decided_by: "curator" })
    const r = await reconcileStructuralInference(db as never, { apply: true, editions: ["normal"], nowIso: NOW })
    expect(r.works[0].outcomes).toEqual([{ edition: "normal", action: "pulada", detail: "a linha mudou no meio" }])
    expect(nota(W, "normal")).toMatchObject({ score: 4, source: "curator_confirmed" })
  })
})

const varias = async (n: number, opts: Parameters<typeof reconcileStructuralInference>[1] = { apply: true }) => {
  for (let i = 0; i < n; i++) await reconcileStructuralInference(db as never, { nowIso: NOW, ...opts })
}

describe("'sem nota' da AUDITORIA × 'sem nota' da CURADORIA — mesmo valor, significados opostos", () => {
  it("1) sem nota por ausência de evidência (auditoria) ⇒ a inferência preenche com 9", async () => {
    await varias(1)
    expect(nota(W, "r18")).toMatchObject({ score: 9, source: "inferred_base" })
  })

  it("2) a curadora escolheu 'sem nota' ⇒ continua sem nota depois de vários recálculos, sem nenhuma escrita", async () => {
    Object.assign(nota(W, "r18")!, { decided_by: "curator", evidence: { curadoria: { decidido_em: "2026-10-14" } } })
    const antes = structuredClone(nota(W, "r18"))
    db.writes = []
    await varias(3, { apply: true, editions: ["r18"] })
    expect(nota(W, "r18")).toEqual(antes)
    expect(db.writes).toEqual([])
  })

  it("3) a curadora troca a decisão por uma nota ⇒ ela manda; removida a decisão (sem linha), a automação volta", async () => {
    Object.assign(nota(W, "r18")!, { decided_by: "curator" })
    Object.assign(nota(W, "r18")!, { score: 8, source: "curator_confirmed", status: "rated" })
    await varias(2, { apply: true, editions: ["r18"] })
    expect(nota(W, "r18")).toMatchObject({ score: 8, source: "curator_confirmed" })
    // Sem linha = ninguém decidiu nada: a inferência pode atuar de novo.
    db.tables.work_edition_scores = db.tables.work_edition_scores.filter((r) => r.edition !== "r18")
    await varias(1, { apply: true, editions: ["r18"] })
    expect(nota(W, "r18")).toMatchObject({ score: 9, source: "inferred_base", evidence: { anterior: null } })
  })

  it("4) curator_confirmed é soberano mesmo com o sinal sexual mudando", async () => {
    Object.assign(nota(W, "r18")!, { score: 9, source: "curator_confirmed", status: "rated", decided_by: "curator" })
    await varias(1)
    db.tables.work_tags = []
    await varias(2)
    expect(nota(W, "r18")).toMatchObject({ score: 9, source: "curator_confirmed" })
  })
})

describe("evidence.anterior: as sequências reais, sem cadeia e sem fotografia velha", () => {
  const profundidade = (e: unknown): number => {
    const a = (e as { anterior?: { evidence?: unknown } } | null)?.anterior
    return a ? 1 + profundidade(a.evidence) : 0
  }

  it("A) anterior → inferência → retração ⇒ a linha anterior volta idêntica", async () => {
    const original = structuredClone(nota(W, "r18"))
    await varias(1)
    db.tables.work_tags = [structuredClone(tagR19)]
    await varias(1)
    expect(nota(W, "r18")).toEqual(original)
  })

  it("B) anterior → inferência → inferência ATUALIZADA de novo → retração ⇒ volta a linha de ANTES da 1ª (sem cadeia)", async () => {
    const legada = structuredClone(nota(W, "normal"))
    await varias(1)
    // A própria regra gravada com outro valor (ex.: a constante mudou de versão): a reconciliação reescreve.
    Object.assign(nota(W, "normal")!, { score: 5.5 })
    await varias(1)
    const reescrita = nota(W, "normal")!
    expect(reescrita).toMatchObject({ score: 6, evidence: { regra: STRUCTURAL_RULES.standardBase, anterior: { score: 5, source: "inferred_base" } } })
    expect(profundidade(reescrita.evidence)).toBe(1)
    db.tables.work_tags = [structuredClone(tagR19)]
    await varias(1)
    expect(nota(W, "normal")).toEqual(legada)
  })

  it("C) anterior → inferência → entra nota MAIS FORTE → sinais mudam ⇒ a nota forte fica; a foto velha NÃO volta", async () => {
    await varias(1)
    const inferida = structuredClone(nota(W, "r18"))
    Object.assign(nota(W, "r18")!, {
      score: 9, source: "curator_confirmed", status: "rated", decided_by: "curator",
      evidence: { curadoria: { anterior: { source: inferida!.source, score: inferida!.score, evidence: inferida!.evidence } } },
    })
    db.tables.work_tags = [structuredClone(tagR19)]
    db.writes = []
    await varias(2)
    expect(nota(W, "r18")).toMatchObject({ score: 9, source: "curator_confirmed" })
    expect(db.writes.filter((w) => w.table === "work_edition_scores" && w.op !== "update")).toEqual([])
  })

  it("D) inferência sem estado anterior → retração ⇒ a linha some", async () => {
    db.tables.work_edition_scores = db.tables.work_edition_scores.filter((r) => r.edition !== "r18")
    await varias(1)
    expect(nota(W, "r18")).toMatchObject({ score: 9, evidence: { anterior: null } })
    db.tables.work_tags = [structuredClone(tagR19)]
    await varias(1)
    expect(nota(W, "r18")).toBeUndefined()
  })

  it("reprocessar N vezes é idempotente: as linhas não mudam depois da 1ª aplicação, e a profundidade fica em 1", async () => {
    await varias(1)
    const depois1 = structuredClone(db.tables.work_edition_scores)
    db.writes = []
    await varias(5)
    expect(db.tables.work_edition_scores).toEqual(depois1)
    expect(db.writes).toEqual([])
    for (const r of db.tables.work_edition_scores) expect(profundidade(r.evidence)).toBeLessThanOrEqual(1)
  })
})

describe("falha parcial no recálculo: nada vira sucesso, e a passada seguinte converge", () => {
  const ligado = { autoApply: true }
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("uma escrita falha no meio: a outra fica gravada, o status é 'com_erros' e a pendência FICA (janela de 1h reiniciada)", async () => {
    db.falhar = (table, op, alvo) => table === "work_edition_scores" && op === "update" && alvo.some((r) => r.edition === "r18")
    const s = await reconcileStructuralInferenceForRecalc(db as never, ligado)
    expect(s).toMatchObject({ status: "com_erros", obras: 1, gravadas: 1 })
    expect(s.status === "com_erros" && s.erros[0]).toMatch(/r18: falha injetada/)
    expect(nota(W, "normal")).toMatchObject({ score: 6 })
    expect(nota(W, "r18")).toMatchObject({ source: "not_rated" })
    expect(inferenceNeedsRetry(s)).toBe(true)
    expect(recalcPendingAfter(s, NOW)).toEqual({ recalc_pending: true, recalc_last_edit_at: NOW })
  })

  it("a passada seguinte termina o trabalho; a outra depois dela não escreve nada; aí a pendência é limpa", async () => {
    db.falhar = (table, op, alvo) => table === "work_edition_scores" && op === "update" && alvo.some((r) => r.edition === "r18")
    await reconcileStructuralInferenceForRecalc(db as never, ligado)
    db.falhar = null
    expect(await reconcileStructuralInferenceForRecalc(db as never, ligado)).toMatchObject({ status: "ok", gravadas: 1 })
    expect(nota(W, "r18")).toMatchObject({ score: 9 })
    db.writes = []
    const s = await reconcileStructuralInferenceForRecalc(db as never, ligado)
    expect(s).toMatchObject({ status: "ok", gravadas: 0 })
    expect(db.writes).toEqual([])
    expect(recalcPendingAfter(s, NOW)).toEqual({ recalc_pending: false, recalc_last_edit_at: null })
  })

  it("falha ao LER os fatos: status 'falhou', nenhuma escrita, a pendência fica", async () => {
    db.leituraFalha = "work_tags"
    const s = await reconcileStructuralInferenceForRecalc(db as never, ligado)
    expect(s).toMatchObject({ status: "falhou", erro: /falha injetada lendo work_tags/ })
    expect(db.writes).toEqual([])
    expect(recalcPendingAfter(s, NOW).recalc_pending).toBe(true)
  })

  it("o recálculo grava a pendência a partir DESTE status — nunca um `recalc_pending: false` fixo", () => {
    const src = readFileSync(join(process.cwd(), "server/actions/calculations.ts"), "utf8")
    const corpo = src.slice(src.indexOf("export async function recalculateAll("), src.indexOf("export async function recalculateAll(") + 40000)
    const update = corpo.slice(corpo.indexOf('.from("formula_config")\n    .update('), corpo.indexOf('.eq("id", config.id)'))
    expect(update).toMatch(/\.\.\.recalcPendingAfter\(editionInference, /)
    expect(update).not.toMatch(/recalc_pending:\s*false/)
    expect(corpo).toMatch(/const editionInference = await reconcileStructuralInferenceForRecalc\(supabase\)/)
  })
})

describe("as gravações automáticas estão DESLIGADAS até o legado ser aplicado", () => {
  it("o interruptor está desligado e os dois ganchos não tocam o banco", async () => {
    expect(STRUCTURAL_INFERENCE_AUTO_APPLY).toBe(false)
    vi.spyOn(console, "info").mockImplementation(() => {})
    const s = await reconcileStructuralInferenceForRecalc(db as never)
    expect(s).toEqual({ status: "desligada" })
    expect(recalcPendingAfter(s, NOW)).toEqual({ recalc_pending: false, recalc_last_edit_at: null })
    expect(await reconcileStructuralInferenceForWork(db as never, W)).toEqual({ changed: false, failed: false })
    expect(db.calls).toEqual([])
    expect(db.writes).toEqual([])
  })
})

describe("gancho da curadoria (ligado só no teste): a falha volta como 'failed', nunca como sucesso", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  it("grava ⇒ changed; falha de leitura ⇒ failed sem escrita; erro numa linha ⇒ changed E failed", async () => {
    expect(await reconcileStructuralInferenceForWork(db as never, W, { autoApply: true })).toEqual({ changed: true, failed: false })
    db.tables.work_edition_scores = [structuredClone(BASE_LEGADA), structuredClone(NAO_AVALIADO)]
    db.leituraFalha = "work_tags"
    db.writes = []
    expect(await reconcileStructuralInferenceForWork(db as never, W, { autoApply: true })).toEqual({ changed: false, failed: true })
    expect(db.writes).toEqual([])
    db.leituraFalha = null
    db.falhar = (table, op, alvo) => table === "work_edition_scores" && op === "update" && alvo.some((r) => r.edition === "r18")
    expect(await reconcileStructuralInferenceForWork(db as never, W, { autoApply: true })).toEqual({ changed: true, failed: true })
  })
})
