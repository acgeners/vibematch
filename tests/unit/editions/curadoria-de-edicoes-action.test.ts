import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A action "Edições da obra" contra um banco FALSO COM ESTADO, que reproduz as duas regras do
 * gatilho da 213 que importam aqui: nota por edição só existe em obra `mixed`, e um UPDATE (ou upsert
 * em conflito) não pode REBAIXAR a origem. As asserções olham o estado FINAL das tabelas — não a
 * lista de chamadas —, porque o que se quer provar é onde o banco termina, inclusive quando algo
 * falha no meio.
 */
vi.mock("server-only", () => ({}))

type Row = Record<string, unknown>
const FORCA: Record<string, number> = { not_rated: 0, inferred_base: 1, reused_existing: 2, ai_evaluated: 2, curator_confirmed: 3 }

let admin = true
let estado = new Map<string, Row>()
let notas = new Map<string, Row>()
let overrides = new Map<string, boolean | null>()
const escritasEmWorks: Row[] = []
let falhas: Array<{ table: string; op: string; vezes: number }> = []
let leituraFalha: string | null = null
/** Roda logo antes de uma escrita em work_edition_state — é como se simula outro escritor no meio. */
let antesDeEscreverEstado: (() => void) | null = null
const markRecalcPending = vi.fn<(context: string, opts?: unknown) => Promise<void>>(async () => {})

vi.mock("@/server/queries/current-user", () => ({
  ensureAdmin: async () => (admin ? { ok: true } : { ok: false, error: "Só o Curador do catálogo pode fazer isso." }),
}))
vi.mock("@/server/recalc/queue", () => ({ markRecalcPending: (c: string, o?: unknown) => markRecalcPending(c, o) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const chaveNota = (r: Row) => `${r.work_id}|${r.edition}|${r.criterion_slug}`

class Consulta {
  private filtros: Array<[string, unknown]> = []
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select"
  private payload: Row | null = null
  /** Como no PostgREST: escrita só devolve linhas com `.select()` depois dela (RETURNING). */
  private retorna = false
  constructor(private tabela: string) {}
  select() {
    if (this.op !== "select") this.retorna = true
    return this
  }
  eq(c: string, v: unknown) {
    this.filtros.push([c, v])
    return this
  }
  insert(p: Row) {
    this.op = "insert"
    this.payload = p
    return this
  }
  upsert(p: Row) {
    this.op = "upsert"
    this.payload = p
    return this
  }
  update(p: Row) {
    this.op = "update"
    this.payload = p
    return this
  }
  delete() {
    this.op = "delete"
    return this
  }
  maybeSingle() {
    return this.executar().then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }))
  }
  then<T>(ok: (v: { data: unknown; error: { message: string } | null }) => T, ko?: (e: unknown) => T) {
    return this.executar().then(ok, ko)
  }
  private casa = (r: Row) => this.filtros.every(([c, v]) => r[c] === v)
  private erro = (message: string) => ({ data: null, error: { message } })
  private async executar(): Promise<{ data: unknown; error: { message: string } | null }> {
    const f = falhas.find((x) => x.table === this.tabela && x.op === this.op && x.vezes > 0)
    if (f) {
      f.vezes--
      return this.erro(`falha injetada em ${this.tabela}.${this.op}`)
    }
    if (this.op === "select" && leituraFalha) return this.erro(leituraFalha)
    if (this.tabela === "works") {
      if (this.op !== "select") {
        escritasEmWorks.push({ op: this.op, payload: this.payload })
        return { data: [], error: null }
      }
      const id = this.filtros.find(([c]) => c === "id")?.[1] as string
      return { data: [{ adult_override: overrides.get(id) ?? null }], error: null }
    }
    if (this.tabela === "work_edition_state") return this.estado()
    return this.notas()
  }
  private estado() {
    if (this.op !== "select" && antesDeEscreverEstado) {
      antesDeEscreverEstado()
      antesDeEscreverEstado = null
    }
    const linhas = [...estado.values()].filter(this.casa)
    if (this.op === "select") return { data: linhas.map((r) => structuredClone(r)), error: null }
    if (this.op === "upsert") {
      const id = this.payload!.work_id as string
      estado.set(id, { ...(estado.get(id) ?? {}), ...structuredClone(this.payload!) })
      return { data: null, error: null }
    }
    if (this.op === "update") {
      for (const r of linhas) estado.set(r.work_id as string, { ...r, ...structuredClone(this.payload!) })
      return { data: this.retorna ? linhas.map((r) => ({ work_id: r.work_id })) : null, error: null }
    }
    if (this.op === "delete") {
      for (const r of linhas) estado.delete(r.work_id as string)
      return { data: this.retorna ? linhas : null, error: null }
    }
    return this.erro("op inesperada")
  }
  private notas() {
    const linhas = [...notas.values()].filter(this.casa)
    if (this.op === "select") return { data: linhas.map((r) => structuredClone(r)), error: null }
    if (this.op === "delete") {
      for (const r of linhas) notas.delete(chaveNota(r))
      return { data: this.retorna ? linhas : null, error: null }
    }
    const nova = structuredClone(this.payload!)
    // Gatilho da 213 (1): nota por edição só em obra mixed.
    if (estado.get(nova.work_id as string)?.state !== "mixed") return this.erro("work_edition_scores: a obra não é mixed")
    const atual = notas.get(chaveNota(nova))
    if (this.op === "insert") {
      if (atual) return this.erro("duplicate key value violates unique constraint")
      notas.set(chaveNota(nova), { created_at: "2026-10-12T00:00:00Z", ...nova })
      return { data: null, error: null }
    }
    // upsert em conflito passa pelo BEFORE UPDATE — Gatilho da 213 (2): não rebaixa.
    if (atual && FORCA[nova.source as string] < FORCA[atual.source as string]) return this.erro("recusado rebaixar")
    notas.set(chaveNota(nova), { ...(atual ?? { created_at: "2026-10-12T00:00:00Z" }), ...nova })
    return { data: null, error: null }
  }
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => new Consulta(t) }) }))

const W = "obra-1"
const manter = { kind: "manter" as const }
const nota = (value: number) => ({ kind: "nota" as const, value })
const naoAvaliado = { kind: "nao_avaliado" as const }
const AUDIT_MIXED: Row = {
  work_id: W,
  state: "mixed",
  r18_extra_chapters: false,
  basis: "mangaupdates_description",
  decided_by: "audit",
  decided_at: "2026-10-10T00:00:00Z",
  evidence: { auditoria: { motivo: "MU lista R15 e R19" } },
}
const NOTA_214: Row = {
  work_id: W,
  edition: "r18",
  criterion_slug: "adult_content",
  score: 9,
  source: "reused_existing",
  status: "rated",
  confidence: "media",
  ai_evaluation_id: null,
  decided_by: "audit",
  evidence: { mig: "214", regra: "nota legada atribuída à R18" },
  created_at: "2026-10-11T00:00:00Z",
}

async function acoes() {
  return import("@/server/actions/work-editions")
}
const salvar = async (state: string, scores: Record<string, unknown> = { normal: manter, r18: manter }, extras = false) =>
  (await acoes()).saveWorkEditionCuration(W, { state, r18ExtraChapters: extras, scores } as never)
const remover = async () => (await acoes()).revertWorkEditionCuration(W)

beforeEach(() => {
  admin = true
  estado = new Map()
  notas = new Map()
  overrides = new Map([[W, null]])
  escritasEmWorks.length = 0
  falhas = []
  leituraFalha = null
  antesDeEscreverEstado = null
  markRecalcPending.mockClear()
})

describe("gate e leitura", () => {
  it("quem não é curador não grava nem remove nada", async () => {
    admin = false
    expect(await salvar("mixed")).toEqual({ error: "Só o Curador do catálogo pode fazer isso." })
    expect(await remover()).toEqual({ error: "Só o Curador do catálogo pode fazer isso." })
    expect(await (await acoes()).getWorkEditionCuration(W)).toEqual({ error: "Só o Curador do catálogo pode fazer isso." })
    expect(estado.size + notas.size).toBe(0)
  })

  it("falha ao LER o estado ⇒ não grava por cima (\"sem estado\" e \"não li\" não são a mesma coisa)", async () => {
    leituraFalha = "timeout"
    expect(await salvar("mixed")).toEqual({ error: "work_edition_state: timeout" })
    expect(estado.size).toBe(0)
  })

  it("nota fora da grade é recusada antes de ler o banco", async () => {
    expect(await salvar("mixed", { normal: nota(7.3), r18: manter })).toEqual({ error: "A nota anda de 0,5 em 0,5." })
  })
})

describe("criar e editar — regressão", () => {
  it("obra sem estado vira mixed com notas independentes, autoria da curadoria e recálculo marcado", async () => {
    const res = await salvar("mixed", { normal: nota(4), r18: nota(9) }, true)
    expect(res).toEqual({ data: { changed: true, recalcMarked: true } })
    expect(estado.get(W)).toMatchObject({ state: "mixed", r18_extra_chapters: true, basis: "curator", decided_by: "curator" })
    expect(notas.get(`${W}|normal|adult_content`)).toMatchObject({ score: 4, source: "curator_confirmed", status: "rated", decided_by: "curator" })
    expect(notas.get(`${W}|r18|adult_content`)).toMatchObject({ score: 9, source: "curator_confirmed" })
    expect(markRecalcPending).toHaveBeenCalledWith("saveWorkEditionCuration", { changed: ["edition_scores"] })
  })

  it("nota numa edição só: a outra fica SEM linha — nenhum fallback entre edições", async () => {
    await salvar("mixed", { normal: manter, r18: nota(8.5) })
    expect(notas.get(`${W}|r18|adult_content`)).toMatchObject({ score: 8.5 })
    expect(notas.has(`${W}|normal|adult_content`)).toBe(false)
  })

  it("r18_only grava o estado e ignora nota por edição (o gatilho a recusaria)", async () => {
    await salvar("r18_only", { normal: nota(3), r18: nota(9) })
    expect(estado.get(W)).toMatchObject({ state: "r18_only", r18_extra_chapters: false, decided_by: "curator" })
    expect(notas.size).toBe(0)
  })

  it("só os extras mudaram ⇒ grava o estado, sem marcar recálculo", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    expect(await salvar("mixed", { normal: manter, r18: manter }, true)).toEqual({ data: { changed: true, recalcMarked: false } })
    expect(estado.get(W)).toMatchObject({ r18_extra_chapters: true, decided_by: "curator" })
    expect(markRecalcPending).not.toHaveBeenCalled()
  })

  it("nada mudou ⇒ nenhuma escrita e nenhum recálculo", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    notas.set(`${W}|r18|adult_content`, { ...NOTA_214, source: "curator_confirmed" })
    expect(await salvar("mixed", { normal: manter, r18: nota(9) })).toEqual({ data: { changed: false, recalcMarked: false } })
    expect(markRecalcPending).not.toHaveBeenCalled()
  })
})

describe("recálculo pendente: só quando a ENTRADA da previsão muda", () => {
  const marcou = () => markRecalcPending.mock.calls.length > 0
  const estadoDe = (state: string) => ({ ...structuredClone(AUDIT_MIXED), state })

  it("entrar em mixed marca", async () => {
    estado.set(W, estadoDe("single"))
    expect(await salvar("mixed")).toEqual({ data: { changed: true, recalcMarked: true } })
    expect(marcou()).toBe(true)
  })

  it("sair de mixed marca (as notas guardadas deixam de valer)", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    notas.set(`${W}|r18|adult_content`, structuredClone(NOTA_214))
    expect(await salvar("single")).toEqual({ data: { changed: true, recalcMarked: true } })
    expect(notas.size).toBe(1)
  })

  it.each([
    ["single", "r18_only"],
    ["r18_only", "unknown"],
    ["unknown", "single"],
  ])("%s → %s grava o estado e NÃO marca (a previsão é idêntica)", async (de, para) => {
    estado.set(W, estadoDe(de))
    expect(await salvar(para)).toEqual({ data: { changed: true, recalcMarked: false } })
    expect(estado.get(W)).toMatchObject({ state: para, decided_by: "curator" })
    expect(marcou()).toBe(false)
  })

  it("sem estado → single não marca (sem linha já era tratado como edição única)", async () => {
    expect(await salvar("single")).toEqual({ data: { changed: true, recalcMarked: false } })
  })

  it("mudar a nota de uma edição marca; trocar not_rated ↔ nota marca", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    notas.set(`${W}|r18|adult_content`, structuredClone(NOTA_214))
    expect(await salvar("mixed", { normal: manter, r18: nota(8) })).toMatchObject({ data: { recalcMarked: true } })
    markRecalcPending.mockClear()
    expect(await salvar("mixed", { normal: manter, r18: naoAvaliado })).toMatchObject({ data: { recalcMarked: true } })
    markRecalcPending.mockClear()
    expect(await salvar("mixed", { normal: manter, r18: nota(9) })).toMatchObject({ data: { recalcMarked: true } })
  })

  it("mesma nota com outra ORIGEM (provisória 5,0 → curadoria 5,0) grava a autoria e NÃO marca", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    notas.set(`${W}|normal|adult_content`, { ...structuredClone(NOTA_214), edition: "normal", score: 5, source: "inferred_base", status: "provisional", confidence: "baixa" })
    expect(await salvar("mixed", { normal: nota(5), r18: manter })).toEqual({ data: { changed: true, recalcMarked: false } })
    expect(notas.get(`${W}|normal|adult_content`)).toMatchObject({ score: 5, source: "curator_confirmed" })
  })

  it("'não avaliado' onde não havia linha grava a decisão e NÃO marca (a edição já entrava sem nota)", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    expect(await salvar("mixed", { normal: naoAvaliado, r18: manter })).toEqual({ data: { changed: true, recalcMarked: false } })
    expect(notas.get(`${W}|normal|adult_content`)).toMatchObject({ source: "not_rated", decided_by: "curator" })
  })
})

describe("'Não avaliado' sobre nota existente — termina num estado consistente", () => {
  beforeEach(() => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    notas.set(`${W}|r18|adult_content`, structuredClone(NOTA_214))
  })

  it("vira not_rated EXPLÍCITO (linha presente), com autoria da curadoria e a evidência anterior guardada", async () => {
    const res = await salvar("mixed", { normal: manter, r18: naoAvaliado })
    expect(res).toEqual({ data: { changed: true, recalcMarked: true } })
    const linha = notas.get(`${W}|r18|adult_content`)
    expect(linha).toBeDefined() // não é mera ausência
    expect(linha).toMatchObject({ score: null, source: "not_rated", status: "not_rated", decided_by: "curator" })
    expect((linha!.evidence as Row).curadoria).toMatchObject({
      anterior: { score: 9, source: "reused_existing", evidence: { mig: "214", regra: "nota legada atribuída à R18" } },
    })
  })

  it("se a inserção do not_rated falhar, a linha anterior VOLTA idêntica (autoria, data, evidência) e nada é marcado", async () => {
    falhas = [{ table: "work_edition_scores", op: "insert", vezes: 1 }]
    const res = await salvar("mixed", { normal: manter, r18: naoAvaliado })
    expect("error" in res && res.error).toMatch(/a nota anterior foi mantida/)
    expect(notas.get(`${W}|r18|adult_content`)).toEqual(NOTA_214)
    expect(markRecalcPending).not.toHaveBeenCalled()
  })

  it("se a restauração TAMBÉM falhar, o erro diz que a nota foi perdida e o log guarda a linha inteira", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    falhas = [{ table: "work_edition_scores", op: "insert", vezes: 2 }]
    const res = await salvar("mixed", { normal: manter, r18: naoAvaliado })
    expect("error" in res && res.error).toMatch(/ATENÇÃO: a nota anterior \(9, reused_existing\) foi apagada e não pôde ser restaurada/)
    expect(log.mock.calls[0].join(" ")).toContain('"evidence":{"mig":"214"')
    log.mockRestore()
  })

  it("se o DELETE falhar, nada muda", async () => {
    falhas = [{ table: "work_edition_scores", op: "delete", vezes: 1 }]
    const res = await salvar("mixed", { normal: manter, r18: naoAvaliado })
    expect("error" in res).toBe(true)
    expect(notas.get(`${W}|r18|adult_content`)).toEqual(NOTA_214)
  })
})

describe("Remover decisão da curadoria", () => {
  it("decisão mixed sobre obra SEM estado ⇒ volta a não ter estado; notas ficam; recálculo marcado", async () => {
    await salvar("mixed", { normal: nota(4), r18: nota(9) })
    markRecalcPending.mockClear()
    expect(await remover()).toEqual({ data: { changed: true, recalcMarked: true } })
    expect(estado.has(W)).toBe(false)
    expect(notas.size).toBe(2)
    expect(markRecalcPending).toHaveBeenCalledWith("revertWorkEditionCuration", { changed: ["edition_scores"] })
  })

  it("decisão single sobre obra sem estado ⇒ sem estado, e SEM recálculo (os dois são 'não mixed')", async () => {
    await salvar("single")
    markRecalcPending.mockClear()
    expect(await remover()).toEqual({ data: { changed: true, recalcMarked: false } })
    expect(estado.has(W)).toBe(false)
    expect(markRecalcPending).not.toHaveBeenCalled()
  })

  it("'Indefinido' é decisão (grava linha unknown); só a remoção volta ao sem-estado", async () => {
    await salvar("unknown")
    expect(estado.get(W)).toMatchObject({ state: "unknown", decided_by: "curator" })
    await remover()
    expect(estado.has(W)).toBe(false)
  })

  it("sobre decisão da AUDITORIA ⇒ volta a ela: estado, base, autor, data e evidência originais", async () => {
    estado.set(W, { ...structuredClone(AUDIT_MIXED), state: "single" })
    await salvar("mixed", { normal: manter, r18: nota(9) })
    await remover()
    const linha = estado.get(W)!
    expect(linha).toMatchObject({ state: "single", basis: "mangaupdates_description", decided_by: "audit", decided_at: "2026-10-10T00:00:00Z" })
    const ev = linha.evidence as Row
    expect(ev.auditoria).toEqual({ motivo: "MU lista R15 e R19" })
    expect(ev).not.toHaveProperty("antes_da_curadoria")
    expect(ev).not.toHaveProperty("curadoria")
    // A decisão removida não some: vira histórico.
    expect(ev.curadoria_removida).toEqual([expect.objectContaining({ estado: "mixed", decisao: expect.objectContaining({ estado_anterior: "single" }) })])
    expect(notas.get(`${W}|r18|adult_content`)).toMatchObject({ score: 9 })
  })

  it("várias decisões seguidas voltam ao estado de ANTES da 1ª (não à penúltima)", async () => {
    estado.set(W, { ...structuredClone(AUDIT_MIXED), state: "single" })
    await salvar("mixed")
    await salvar("r18_only")
    await remover()
    expect(estado.get(W)).toMatchObject({ state: "single", decided_by: "audit" })
  })

  it("auditoria mixed → curadoria mexe só nos extras → remover: mixed de novo, sem recálculo", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    await salvar("mixed", { normal: manter, r18: manter }, true)
    expect(await remover()).toEqual({ data: { changed: true, recalcMarked: false } })
    expect(estado.get(W)).toMatchObject({ state: "mixed", r18_extra_chapters: false, decided_by: "audit" })
  })

  it("decisão que NÃO é da curadoria ⇒ nada a remover, nenhuma escrita", async () => {
    estado.set(W, structuredClone(AUDIT_MIXED))
    expect(await remover()).toEqual({ data: { changed: false, recalcMarked: false } })
    expect(estado.get(W)).toEqual(AUDIT_MIXED)
  })

  it("decisão da curadoria SEM registro do estado anterior ⇒ recusa (não inventa para onde voltar)", async () => {
    estado.set(W, { ...structuredClone(AUDIT_MIXED), basis: "curator", decided_by: "curator", evidence: {} })
    const res = await remover()
    expect("error" in res && res.error).toMatch(/não guardou o estado anterior/)
    expect(estado.get(W)).toMatchObject({ decided_by: "curator" })
  })

  it("o mesmo vale quando a remoção RESTAURA a auditoria (o UPDATE também confere o autor)", async () => {
    estado.set(W, { ...structuredClone(AUDIT_MIXED), state: "single" })
    await salvar("mixed")
    antesDeEscreverEstado = () => estado.set(W, { ...estado.get(W)!, decided_by: "auto", state: "unknown" })
    expect(await remover()).toEqual({ error: "A decisão de edição mudou enquanto o diálogo estava aberto. Reabra e confira." })
    expect(estado.get(W)).toMatchObject({ decided_by: "auto", state: "unknown" })
  })

  it("se a decisão deixou de ser da curadoria entre a leitura e a escrita, nada é desfeito", async () => {
    await salvar("mixed")
    // A escrita filtra por decided_by = curator: outro escritor troca o autor depois da LEITURA.
    antesDeEscreverEstado = () => estado.set(W, { ...estado.get(W)!, decided_by: "auto" })
    const res = await remover()
    expect(res).toEqual({ error: "A decisão de edição mudou enquanto o diálogo estava aberto. Reabra e confira." })
    expect(estado.get(W)).toMatchObject({ decided_by: "auto" })
  })
})

describe("adult_override fica fora de tudo", () => {
  it("nenhum fluxo escreve em works", async () => {
    overrides.set(W, true)
    estado.set(W, structuredClone(AUDIT_MIXED))
    notas.set(`${W}|r18|adult_content`, structuredClone(NOTA_214))
    await salvar("mixed", { normal: nota(3), r18: naoAvaliado }, true)
    await remover()
    await salvar("r18_only")
    await remover()
    expect(escritasEmWorks).toEqual([])
    expect(overrides.get(W)).toBe(true)
  })
})
