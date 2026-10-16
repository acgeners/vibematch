import { describe, expect, it } from "vitest"
import {
  adultOverrideWarning,
  describeRevertTarget,
  planRevertEditionCuration,
  describeCurrentEditionScore,
  editionCurationBoundsError,
  editionCurationSchema,
  editionScoreBoundsHint,
  parseEditionScore,
  planEditionCuration,
} from "@/lib/editions/edition-curation"
import type { CurrentEditionCuration, EditionCurationInput } from "@/lib/editions/edition-curation"

/**
 * "Edições da obra" — a régua PURA do que a curadoria grava. A obra mixed nova não tinha caminho
 * nenhum (só a auditoria e o MangaUpdates escreviam o estado; só a mig 214 escrevia nota por edição),
 * e o "Marcar como 18+" acabava usado no lugar — escondendo a obra inteira.
 */
const NOW = "2026-10-12T12:00:00.000Z"
const vazio: CurrentEditionCuration = { state: null, r18ExtraChapters: false, evidence: null, scores: {} }
const manter = { normal: { kind: "manter" as const }, r18: { kind: "manter" as const } }
const entrada = (p: Partial<EditionCurationInput>): EditionCurationInput => ({
  state: "mixed",
  r18ExtraChapters: false,
  scores: manter,
  ...p,
})

describe("estado de edição — decisão da curadoria", () => {
  it("obra sem estado vira mixed com autoria de curadoria e marca recálculo", () => {
    const plan = planEditionCuration(vazio, entrada({ r18ExtraChapters: true }), NOW)
    expect(plan.state).toMatchObject({ state: "mixed", r18_extra_chapters: true, basis: "curator", decided_by: "curator", decided_at: NOW })
    expect(plan.affectsPrediction).toBe(true)
  })

  it("'R18 só nos extras' só existe em mixed — fora dela vira false (o CHECK da 204 recusaria)", () => {
    const plan = planEditionCuration(vazio, entrada({ state: "single", r18ExtraChapters: true }), NOW)
    expect(plan.state?.r18_extra_chapters).toBe(false)
  })

  it("a evidência anterior (auditoria/MangaUpdates) fica; a decisão entra por cima", () => {
    const atual = { ...vazio, state: "unknown" as const, evidence: { mangaupdates: { series_id: "x" } } }
    const plan = planEditionCuration(atual, entrada({}), NOW)
    expect(plan.state?.evidence).toMatchObject({
      mangaupdates: { series_id: "x" },
      curadoria: { decidido_em: NOW, estado_anterior: "unknown", extras_r19: false },
    })
  })

  it("mudar só os extras grava o estado, mas não mexe na previsão", () => {
    const atual = { ...vazio, state: "mixed" as const }
    const plan = planEditionCuration(atual, entrada({ r18ExtraChapters: true }), NOW)
    expect(plan.state?.r18_extra_chapters).toBe(true)
    expect(plan.affectsPrediction).toBe(false)
  })

  it("nada mudou ⇒ plano vazio (não regrava a decisão de outra autoria por acidente)", () => {
    const atual = { ...vazio, state: "mixed" as const, scores: { r18: { score: 9, source: "reused_existing" as const } } }
    const plan = planEditionCuration(atual, entrada({}), NOW)
    expect(plan).toEqual({ state: null, scoreOps: [], stateMarksRecalc: false, affectsPrediction: false })
  })
})

describe("nota por edição — o curador informa; sem regra automática", () => {
  const mixed = { ...vazio, state: "mixed" as const }

  it("nota informada vira curator_confirmed/rated, só na edição pedida — nada copiado para a outra", () => {
    const plan = planEditionCuration(mixed, entrada({ scores: { normal: { kind: "manter" }, r18: { kind: "nota", value: 9.5 } } }), NOW)
    expect(plan.scoreOps).toHaveLength(1)
    expect(plan.scoreOps[0]).toMatchObject({
      edition: "r18",
      op: "upsert",
      row: { score: 9.5, source: "curator_confirmed", status: "rated", decided_by: "curator", criterion_slug: "adult_content" },
    })
    expect(plan.affectsPrediction).toBe(true)
  })

  it("a mesma nota já confirmada pela curadoria não regrava", () => {
    const atual = { ...mixed, scores: { normal: { score: 5, source: "curator_confirmed" as const } } }
    expect(planEditionCuration(atual, entrada({ scores: { normal: { kind: "nota", value: 5 }, r18: { kind: "manter" } } }), NOW).scoreOps).toEqual([])
  })

  it("a mesma nota de OUTRA origem regrava como confirmação da curadoria", () => {
    const atual = { ...mixed, scores: { normal: { score: 5, source: "inferred_base" as const } } }
    const ops = planEditionCuration(atual, entrada({ scores: { normal: { kind: "nota", value: 5 }, r18: { kind: "manter" } } }), NOW).scoreOps
    expect(ops[0]).toMatchObject({ op: "upsert", row: { source: "curator_confirmed" } })
  })

  it("'não avaliado' sobre nota existente APAGA e grava a ausência (o gatilho recusa rebaixar num UPDATE)", () => {
    const atual = { ...mixed, scores: { r18: { score: 9, source: "reused_existing" as const, evidence: { mig: "214" } } } }
    const ops = planEditionCuration(atual, entrada({ scores: { normal: { kind: "manter" }, r18: { kind: "nao_avaliado" } } }), NOW).scoreOps
    expect(ops).toEqual([
      expect.objectContaining({
        op: "replace",
        row: expect.objectContaining({
          score: null,
          source: "not_rated",
          status: "not_rated",
          // A justificativa da linha substituída (mig 214) fica guardada, não some.
          evidence: { curadoria: { decidido_em: NOW, anterior: { source: "reused_existing", score: 9, evidence: { mig: "214" } } } },
        }),
      }),
    ])
  })

  it("'não avaliado' sem linha insere a ausência; sobre a ausência da PRÓPRIA curadoria, nada", () => {
    expect(planEditionCuration(mixed, entrada({ scores: { normal: { kind: "nao_avaliado" }, r18: { kind: "manter" } } }), NOW).scoreOps[0]).toMatchObject({ op: "upsert" })
    const jaDecidido = { ...mixed, scores: { normal: { score: null, source: "not_rated" as const, decidedBy: "curator" as const } } }
    expect(planEditionCuration(jaDecidido, entrada({ scores: { normal: { kind: "nao_avaliado" }, r18: { kind: "manter" } } }), NOW).scoreOps).toEqual([])
  })

  it("🔴 'não avaliado' sobre a ausência da AUDITORIA grava a DECISÃO (upsert de mesma força, sem recálculo)", () => {
    // Mesmo valor, significado oposto: a da auditoria a inferência estrutural pode preencher; a da
    // curadoria é override. Sem gravar, a escolha humana não deixaria rastro.
    const daAuditoria = { ...mixed, scores: { r18: { score: null, source: "not_rated" as const, decidedBy: "audit" as const } } }
    const [op] = planEditionCuration(daAuditoria, entrada({ scores: { normal: { kind: "manter" }, r18: { kind: "nao_avaliado" } } }), NOW).scoreOps
    expect(op).toMatchObject({ edition: "r18", op: "upsert", marksRecalc: false, row: { source: "not_rated", decided_by: "curator" } })
  })

  it("fora de mixed a nota por edição é ignorada (o gatilho da 213 recusaria) — as linhas antigas ficam", () => {
    const atual = { ...mixed, scores: { r18: { score: 9, source: "reused_existing" as const } } }
    const plan = planEditionCuration(atual, entrada({ state: "r18_only", scores: { normal: { kind: "nota", value: 3 }, r18: { kind: "nao_avaliado" } } }), NOW)
    expect(plan.scoreOps).toEqual([])
    expect(plan.state?.state).toBe("r18_only")
    expect(plan.affectsPrediction).toBe(true)
  })
})

describe("entrada da nota", () => {
  it("o schema aceita a grade de 0,5 entre 0 e 10 e recusa o resto", () => {
    const com = (value: number) =>
      editionCurationSchema.safeParse(entrada({ scores: { normal: { kind: "nota", value }, r18: { kind: "manter" } } })).success
    expect([0, 5, 7.5, 10].map(com)).toEqual([true, true, true, true])
    expect([7.3, -0.5, 10.5].map(com)).toEqual([false, false, false])
  })

  it("o campo aceita vírgula e ponto; fora da grade é null", () => {
    expect(parseEditionScore("7,5")).toBe(7.5)
    expect(parseEditionScore(" 9.0 ")).toBe(9)
    expect(parseEditionScore("7,3")).toBeNull()
    expect(parseEditionScore("11")).toBeNull()
    expect(parseEditionScore("")).toBeNull()
    expect(parseEditionScore("abc")).toBeNull()
  })
})

describe("o que o diálogo mostra", () => {
  it("a nota atual sai com a MESMA procedência da página da obra — e a ausência se distingue do not_rated", () => {
    expect(describeCurrentEditionScore("r18", { score: 9, source: "reused_existing" })).toBe("9,0 · Da avaliação da obra")
    expect(describeCurrentEditionScore("normal", { score: 5, source: "inferred_base" })).toBe("5,0 · Nota-base inferida")
    expect(describeCurrentEditionScore("r18", { score: 9, source: "inferred_base" })).toBe("9,0 · Nota mínima inferida")
    // Para quem cura, "sem linha" e `not_rated` explícito NÃO são a mesma coisa — a tela diz qual é.
    expect(describeCurrentEditionScore("normal", undefined)).toBe("Sem registro (não avaliado)")
    expect(describeCurrentEditionScore("r18", { score: null, source: "not_rated", decidedBy: "curator" })).toBe("Não avaliado · registrado pela curadoria")
    expect(describeCurrentEditionScore("r18", { score: null, source: "not_rated", decidedBy: "audit" })).toBe("Não avaliado · registrado pela auditoria")
    expect(describeCurrentEditionScore("r18", { score: null, source: "not_rated" })).toBe("Não avaliado (registrado)")
  })

  it("'Marcar como 18+' ligado gera aviso (ele vence o estado); automático não", () => {
    expect(adultOverrideWarning(null)).toBeNull()
    expect(adultOverrideWarning(true)).toMatch(/voltar ao automático/)
    expect(adultOverrideWarning(false)).toMatch(/não-18\+/)
  })
})

describe("o estado de ANTES da curadoria fica registrado — é dele que a remoção volta", () => {
  const audit: CurrentEditionCuration = {
    ...vazio,
    state: "single",
    basis: "mangaupdates_description",
    decidedBy: "audit",
    decidedAt: "2026-10-10T00:00:00Z",
    evidence: { auditoria: { motivo: "x" } },
  }

  it("1ª decisão sobre a auditoria fotografa estado, base, autor e data", () => {
    const ev = planEditionCuration(audit, entrada({}), NOW).state!.evidence
    expect(ev.antes_da_curadoria).toEqual({
      state: "single",
      r18_extra_chapters: false,
      basis: "mangaupdates_description",
      decided_by: "audit",
      decided_at: "2026-10-10T00:00:00Z",
    })
    expect(ev.auditoria).toEqual({ motivo: "x" })
  })

  it("1ª decisão sobre obra SEM estado registra null (≠ chave ausente)", () => {
    const ev = planEditionCuration(vazio, entrada({}), NOW).state!.evidence
    expect(ev).toHaveProperty("antes_da_curadoria", null)
  })

  it("decisões seguintes NÃO trocam a foto (a que vale é a de antes da 1ª)", () => {
    const jaCurada: CurrentEditionCuration = {
      ...vazio,
      state: "mixed",
      basis: "curator",
      decidedBy: "curator",
      evidence: { antes_da_curadoria: { state: "single", r18_extra_chapters: false, basis: "reviews", decided_by: "audit", decided_at: null } },
    }
    const ev = planEditionCuration(jaCurada, entrada({ state: "r18_only" }), NOW).state!.evidence
    expect(ev.antes_da_curadoria).toMatchObject({ state: "single", decided_by: "audit" })
  })
})

describe("plano de remoção da decisão da curadoria", () => {
  const curada = (antes: unknown, state: CurrentEditionCuration["state"] = "mixed"): CurrentEditionCuration => ({
    ...vazio,
    state,
    basis: "curator",
    decidedBy: "curator",
    evidence: antes === "SEM_CHAVE" ? { curadoria: { x: 1 } } : { antes_da_curadoria: antes, curadoria: { x: 1 }, auditoria: { y: 2 } },
  })

  it("sem decisão da curadoria ⇒ nada a remover", () => {
    expect(planRevertEditionCuration({ ...vazio, state: "mixed", decidedBy: "audit" }, NOW)).toEqual({ kind: "sem_decisao" })
    expect(planRevertEditionCuration(vazio, NOW)).toEqual({ kind: "sem_decisao" })
  })

  it("sem registro (chave ausente ou foto ilegível) ⇒ recusa, nunca inventa", () => {
    expect(planRevertEditionCuration(curada("SEM_CHAVE"), NOW)).toEqual({ kind: "sem_registro" })
    expect(planRevertEditionCuration(curada({ state: "inventado" }), NOW)).toEqual({ kind: "sem_registro" })
  })

  it("antes não havia estado ⇒ apagar; recálculo só se a obra deixa de ser mixed", () => {
    expect(planRevertEditionCuration(curada(null, "mixed"), NOW)).toEqual({ kind: "apagar", marksRecalc: true })
    expect(planRevertEditionCuration(curada(null, "single"), NOW)).toEqual({ kind: "apagar", marksRecalc: false })
    expect(planRevertEditionCuration(curada(null, "unknown"), NOW)).toEqual({ kind: "apagar", marksRecalc: false })
  })

  it("antes havia decisão ⇒ restaura ela, tira a foto e a decisão, e guarda a decisão removida no histórico", () => {
    const antes = { state: "mixed", r18_extra_chapters: true, basis: "mangaupdates_description", decided_by: "audit", decided_at: "2026-10-10T00:00:00Z" }
    const plan = planRevertEditionCuration(curada(antes, "single"), NOW)
    expect(plan).toMatchObject({ kind: "restaurar", marksRecalc: true })
    if (plan.kind !== "restaurar") throw new Error("plano errado")
    expect(plan.row).toMatchObject({ state: "mixed", r18_extra_chapters: true, basis: "mangaupdates_description", decided_by: "audit", decided_at: "2026-10-10T00:00:00Z" })
    expect(plan.row.evidence).toEqual({
      auditoria: { y: 2 },
      curadoria_removida: [{ removido_em: NOW, estado: "single", extras_r19: false, decisao: { x: 1 } }],
    })
    expect(describeRevertTarget(plan)).toBe("Volta para: Versão normal + versão R18 (auditoria).")
  })

  it("mixed → mixed não marca recálculo (a previsão só lê se é mixed)", () => {
    const antes = { state: "mixed", r18_extra_chapters: false, basis: "reviews", decided_by: "audit", decided_at: null }
    expect(planRevertEditionCuration(curada(antes, "mixed"), NOW)).toMatchObject({ kind: "restaurar", marksRecalc: false })
  })
})

describe("cada nota diz se muda a previsão — pela mesma régua do recálculo (adultContentFor)", () => {
  const mixed = { ...vazio, state: "mixed" as const }
  const op = (atual: CurrentEditionCuration, r18: EditionCurationInput["scores"]["r18"]) =>
    planEditionCuration(atual, entrada({ scores: { normal: { kind: "manter" }, r18 } }), NOW).scoreOps[0]

  it("nota nova onde não havia ⇒ marca; mesma nota com outra origem ⇒ não marca", () => {
    expect(op(mixed, { kind: "nota", value: 9 })?.marksRecalc).toBe(true)
    const provisoria = { ...mixed, scores: { r18: { score: 9, source: "inferred_base" as const } } }
    expect(op(provisoria, { kind: "nota", value: 9 })).toMatchObject({ op: "upsert", marksRecalc: false })
  })

  it("not_rated sobre nota ⇒ marca; not_rated onde não havia linha ⇒ não marca", () => {
    const comNota = { ...mixed, scores: { r18: { score: 9, source: "reused_existing" as const } } }
    expect(op(comNota, { kind: "nao_avaliado" })).toMatchObject({ op: "replace", marksRecalc: true })
    expect(op(mixed, { kind: "nao_avaliado" })).toMatchObject({ op: "upsert", marksRecalc: false })
  })

  it("o estado só marca quando a obra entra ou sai de mixed", () => {
    const de = (state: CurrentEditionCuration["state"]) => ({ ...vazio, state })
    expect(planEditionCuration(de("single"), entrada({ state: "r18_only" }), NOW).stateMarksRecalc).toBe(false)
    expect(planEditionCuration(de("r18_only"), entrada({ state: "unknown" }), NOW).stateMarksRecalc).toBe(false)
    expect(planEditionCuration(de(null), entrada({ state: "single" }), NOW).stateMarksRecalc).toBe(false)
    expect(planEditionCuration(de("unknown"), entrada({ state: "mixed" }), NOW).stateMarksRecalc).toBe(true)
    expect(planEditionCuration(de("mixed"), entrada({ state: "unknown" }), NOW).stateMarksRecalc).toBe(true)
  })
})

describe("fronteira editorial — o validador puro que a action e a tela chamam", () => {
  const SINAIS = ["gênero do MangaUpdates: smut"]
  const decisao = (normal: EditionCurationInput["scores"]["normal"], r18: EditionCurationInput["scores"]["r18"], state: EditionCurationInput["state"] = "mixed"): EditionCurationInput => ({
    state,
    r18ExtraChapters: false,
    scores: { normal, r18 },
  })
  const nota = (value: number) => ({ kind: "nota" as const, value })
  const manter = { kind: "manter" as const }

  it("R18 sexual: < 9 recusa (com os sinais na mensagem); 9 e acima passam", () => {
    for (const v of [0, 6, 8.5]) expect(editionCurationBoundsError(decisao(manter, nota(v)), SINAIS)).toMatch(/a nota mínima é 9,0/)
    expect(editionCurationBoundsError(decisao(manter, nota(6)), SINAIS)).toMatch(/\(gênero do MangaUpdates: smut\)/)
    for (const v of [9, 9.5, 10]) expect(editionCurationBoundsError(decisao(manter, nota(v)), SINAIS)).toBeNull()
  })

  it("R18 sem natureza sexual confirmada: sem piso", () => {
    expect(editionCurationBoundsError(decisao(manter, nota(6)), [])).toBeNull()
  })

  it("padrão: 9 ou mais recusa (independe dos sinais); 8,5 passa", () => {
    expect(editionCurationBoundsError(decisao(nota(9), manter), [])).toMatch(/não pode entrar na faixa explícita/)
    expect(editionCurationBoundsError(decisao(nota(8.5), manter), SINAIS)).toBeNull()
  })

  it("só a nota INFORMADA é conferida; fora de mixed não há nota por versão a conferir", () => {
    expect(editionCurationBoundsError(decisao(manter, { kind: "nao_avaliado" }), SINAIS)).toBeNull()
    expect(editionCurationBoundsError(decisao(nota(9), nota(6), "r18_only"), SINAIS)).toBeNull()
  })

  it("o limite anunciado na tela sai da mesma régua", () => {
    expect(editionScoreBoundsHint("normal", [])).toBe("Abaixo de 9,0: a versão normal não entra na faixa explícita.")
    expect(editionScoreBoundsHint("r18", SINAIS)).toMatch(/^A partir de 9,0/)
    expect(editionScoreBoundsHint("r18", [])).toMatch(/^Sem piso/)
  })
})
