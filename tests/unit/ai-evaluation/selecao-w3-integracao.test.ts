import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  AI_EVAL_REVIEW_CAPS,
  canonicalInputHashV2,
  comApendiceDeArte,
  evidenciaDeArteComoEnviada,
  prepareReviews,
  PRODUCTION_VARIANT,
} from "@/lib/ai-evaluation/service"
import type { AiEvaluationRequest } from "@/lib/ai-evaluation/service"
import { selecionarApendiceArte } from "@/lib/ai-evaluation/art-appendix"
import { selectReviewsForEvaluation } from "@/lib/external/index"
import { mergeFreshWithPersistedReviews } from "@/lib/external/review-merge"
import { montarReviewsDaAvaliacao, REVIEW_SELECTION_POLICY } from "@/lib/external/review-selection"
import type { ExternalSourceId, SourcedReview } from "@/lib/external/types"

/**
 * O caminho da avaliação com a política W3, na MESMA sequência de `triggerAiEvaluation`
 * (`server/actions/ai.ts`): união fresco ∪ persistido → seleção → manuais por fora → registro.
 */

let uid = 0
function rev(source: ExternalSourceId, palavras = 20, extra = ""): SourcedReview {
  const id = ++uid
  const text = `${Array.from({ length: palavras }, (_, j) => `tok${id}x${j}`).join(" ")}${extra}`
  return { source, sourceTitle: "Obra", matchScore: 1, text, textLength: text.length }
}
const muitas = (source: ExternalSourceId, n: number) => Array.from({ length: n }, (_, i) => rev(source, 10 + ((i * 11) % 50)))
const manual = (text: string): SourcedReview => ({ source: "anilist", sourceTitle: "Obra", matchScore: 1, text, textLength: text.length, isManual: true })

/** Reproduz o trecho de `triggerAiEvaluation` entre a busca externa e o `requestAiEvaluation`. */
function caminhoDaAvaliacao(args: { fresco: SourcedReview[]; persistidas: SourcedReview[]; rejeitadas?: string[]; manuais?: SourcedReview[] }) {
  const { merged: pool, recovered } = mergeFreshWithPersistedReviews(args.fresco, args.persistidas, args.rejeitadas ?? [])
  const selecionadas = selectReviewsForEvaluation(pool, AI_EVAL_REVIEW_CAPS)
  const { efetivas, reviewSelection } = montarReviewsDaAvaliacao({
    pool, selecionadas, manuais: args.manuais ?? [], capacidade: AI_EVAL_REVIEW_CAPS.total, recuperadas: recovered,
  })
  const req: AiEvaluationRequest = comApendiceDeArte({ workId: "w", title: "Obra", sourcedReviews: efetivas, artEvidencePool: pool })
  return { pool, selecionadas, efetivas, reviewSelection, req, prepared: prepareReviews(req) }
}

describe("manuais e fontes rejeitadas", () => {
  it("as manuais entram POR FORA da capacidade: 31 raspadas + 2 manuais → 30 + 2 no prompt", () => {
    const r = caminhoDaAvaliacao({
      fresco: [], persistidas: muitas("mangago", 31),
      manuais: [manual("Minha leitura: a protagonista age desde o primeiro capítulo e o casal conversa abertamente sobre tudo."), manual("Conteúdo adulto explícito a partir do capítulo 40, com cenas detalhadas e frequentes no arco final.")],
    })
    expect(r.prepared.sourcedReviews).toHaveLength(32)
    expect(r.prepared.sourcedReviews!.slice(0, 2).every((x) => x.isManual)).toBe(true)
    expect(r.reviewSelection).toMatchObject({ policy: REVIEW_SELECTION_POLICY, capacity: 30, poolRaw: 31, poolDedup: 31, selected: 30, selectedBySelector: 30, manualOutsideCapacity: 2 })
  })

  it("fonte rejeitada fica fora do pool, da seleção e do registro", () => {
    const r = caminhoDaAvaliacao({ fresco: [], persistidas: [...muitas("kitsu", 5), ...muitas("comix", 6)], rejeitadas: ["kitsu"] })
    expect(r.selecionadas.some((x) => x.source === "kitsu")).toBe(false)
    expect(r.reviewSelection.bySourcePool).toEqual({ comix: 6 })
    expect(r.reviewSelection.bySourceSelected).toEqual({ comix: 6 })
  })
})

describe("o registro `reviewSelection` descreve o que o prompt recebeu", () => {
  it("bate com as reviews raspadas do prompt, por fonte", () => {
    const r = caminhoDaAvaliacao({ fresco: muitas("mangaupdates", 4), persistidas: [...muitas("comix", 9), ...muitas("mangago", 30)], manuais: [manual("Uma review manual qualquer, com texto suficiente para não ser curta demais de verdade.")] })
    const raspadas = r.prepared.sourcedReviews!.filter((x) => !x.isManual)
    const porFonte = raspadas.reduce<Record<string, number>>((m, x) => ((m[x.source] = (m[x.source] ?? 0) + 1), m), {})
    expect(r.reviewSelection.selected).toBe(raspadas.length)
    expect(r.reviewSelection.bySourceSelected).toEqual(porFonte)
    expect(r.reviewSelection.recoveredFromPersisted).toBe(39)
    expect(r.reviewSelection.poolRaw).toBe(43)
  })

  it("se uma raspada duplica uma manual, o prompt manda a manual e o registro conta o que de fato foi", () => {
    const raspadas = muitas("comix", 10)
    const r = caminhoDaAvaliacao({ fresco: [], persistidas: raspadas, manuais: [{ ...raspadas[0], source: "anilist", isManual: true }] })
    expect(r.reviewSelection.selectedBySelector).toBe(10)
    expect(r.reviewSelection.selected).toBe(9)
    expect(r.reviewSelection.manualOutsideCapacity).toBe(1)
  })

  it("review dividida em duas postagens não gasta vaga: acima de 30, o prompt recebe 30", () => {
    const fx = JSON.parse(readFileSync("tests/fixtures/ai-evaluation/reviews-duplicadas-reais.json", "utf8"))
    const [parte1, parte2, inteira] = (fx.reviewDivididaEmDuasPostagens as Array<{ source: ExternalSourceId; text: string }>).map(
      (x): SourcedReview => ({ source: x.source, sourceTitle: "Obra", matchScore: 1, text: x.text, textLength: x.text.length }),
    )
    // Como no caso real: a Comix tem reviews MAIS LONGAS que a versão inteira, então ela só entra no
    // rodízio DEPOIS da 2ª parte da ComicK — é essa ordem que deixava a 2ª parte sobrar na seleção.
    const comixLongas = Array.from({ length: 3 }, () => rev("comix", 120))
    const r = caminhoDaAvaliacao({ fresco: [], persistidas: [parte1, parte2, inteira, ...comixLongas, ...muitas("mangago", 30)] })
    expect(r.selecionadas).toHaveLength(30)
    expect(r.prepared.sourcedReviews).toHaveLength(30)
    expect(r.selecionadas).toContain(inteira)
    expect(r.selecionadas).not.toContain(parte2)
    expect(r.reviewSelection.selected).toBe(r.reviewSelection.selectedBySelector)
  })

  it("cópias contam uma vez no pool deduplicado", () => {
    const base = muitas("comix", 10)
    const r = caminhoDaAvaliacao({ fresco: [], persistidas: [...base, ...base.slice(0, 3).map((x) => ({ ...x, source: "mangago" as const }))] })
    expect(r.reviewSelection.poolRaw).toBe(13)
    expect(r.reviewSelection.poolDedup).toBe(10)
    expect(r.reviewSelection.selected).toBe(10)
  })
})

describe("evidência de Arte continua disponível e citável", () => {
  const ARTE = " The art is absolutely gorgeous and the coloring is stunning in every single chapter of this series."

  it("a review de arte que vai ao corpo é citável (R…) e não se repete no apêndice", () => {
    const deArte = rev("mangaupdates", 30, ARTE)
    const r = caminhoDaAvaliacao({ fresco: [], persistidas: [...muitas("comix", 12), deArte] })
    const evid = evidenciaDeArteComoEnviada(r.req, r.prepared, PRODUCTION_VARIANT)
    const noCorpo = evid.find((e) => e.id.startsWith("R") && e.text.includes("art is absolutely gorgeous"))
    expect(noCorpo).toBeDefined()
    expect((r.req.artAppendix ?? []).some((a) => a.trecho.includes("art is absolutely gorgeous"))).toBe(false)
  })

  it("entre a cópia resumida (sem a arte) e a versão inteira (com a arte), vai a inteira — e o trecho segue citável", () => {
    // A resumida está numa fonte que vem ANTES no rodízio (AnimePlanet antes da Comix): sem a
    // preferência pela versão mais completa, seria ela a ficar.
    const inteira = rev("comix", 30, ARTE)
    const resumida: SourcedReview = { ...inteira, source: "animeplanet", text: inteira.text.slice(0, inteira.text.indexOf(" The art")), textLength: 0 }
    resumida.textLength = resumida.text.length
    const r = caminhoDaAvaliacao({ fresco: [resumida], persistidas: [inteira, ...muitas("mangago", 5)] })
    expect(r.selecionadas).toContain(inteira)
    expect(r.selecionadas).not.toContain(resumida)
    expect(r.selecionadas.find((x) => x.text === inteira.text)?.source).toBe("comix")
    const evid = evidenciaDeArteComoEnviada(r.req, r.prepared, PRODUCTION_VARIANT)
    expect(evid.some((e) => e.text.includes("art is absolutely gorgeous"))).toBe(true)
  })
})

describe("apêndice de Arte com cópias no pool", () => {
  it("fora do corpo, a candidata é a versão inteira (a que tem a arte), não a cópia resumida que veio antes", () => {
    const inteira = rev("comix", 30, " The art is absolutely gorgeous and the coloring is stunning in every single chapter of this series.")
    const resumida: SourcedReview = { ...inteira, source: "animeplanet", text: inteira.text.slice(0, inteira.text.indexOf(" The art")) }
    const { itens } = selecionarApendiceArte([resumida, inteira], [])
    expect(itens).toHaveLength(1)
    expect(itens[0].source).toBe("comix")
    expect(itens[0].trecho).toContain("art is absolutely gorgeous")
  })
})

describe("cache e hash", () => {
  it("o mesmo pool em outra ordem gera a MESMA entrada e o mesmo hash", () => {
    const pool = [...Array.from({ length: 20 }, () => rev("comix", 25)), ...Array.from({ length: 20 }, () => rev("mangago", 25))]
    const a = caminhoDaAvaliacao({ fresco: [], persistidas: pool })
    const b = caminhoDaAvaliacao({ fresco: [], persistidas: [...pool].reverse() })
    expect(canonicalInputHashV2(b.req)).toBe(canonicalInputHashV2(a.req))
  })

  it("uma seleção diferente muda o hash; o registro descritivo não entra nele", () => {
    const pool = muitas("comix", 10)
    const a = caminhoDaAvaliacao({ fresco: [], persistidas: pool })
    const b = caminhoDaAvaliacao({ fresco: [], persistidas: [...pool, rev("mangago", 40)] })
    expect(canonicalInputHashV2(b.req)).not.toBe(canonicalInputHashV2(a.req))
    const comRegistro = { ...a.req, reviewSelection: a.reviewSelection } as AiEvaluationRequest
    expect(canonicalInputHashV2(comRegistro)).toBe(canonicalInputHashV2(a.req))
  })
})

describe("nenhum caminho de avaliação reintroduz o teto implícito de 12", () => {
  it("os limites da avaliação não têm teto por fonte, e uma fonte com 31 envia 30", () => {
    expect(AI_EVAL_REVIEW_CAPS).toEqual({ total: 30 })
    expect(selectReviewsForEvaluation(muitas("mangago", 31), AI_EVAL_REVIEW_CAPS)).toHaveLength(30)
  })

  it("nenhum código de produção dá valor numérico padrão a `maxPerSource`", () => {
    // Varre o DISCO (não o índice do git): arquivo novo, ainda não adicionado, também conta.
    const arquivos: string[] = []
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome)
        if (statSync(p).isDirectory()) andar(p)
        else if (/\.(ts|tsx|mjs|js)$/.test(nome)) arquivos.push(p)
      }
    }
    for (const raiz of ["lib", "server", "app"]) andar(raiz)
    // Linha de comentário fica de fora: a prosa que EXPLICA o teto antigo não é o teto.
    const comentario = (linha: string) => /^\s*(\/\/|\*|\/\*)/.test(linha)
    const achados = arquivos.flatMap((p) =>
      readFileSync(p, "utf8").split("\n").flatMap((linha, i) =>
        !comentario(linha) && /maxPerSource\s*(\?\?|:|=)\s*\d/.test(linha) ? [`${p}:${i + 1}: ${linha.trim()}`] : [],
      ),
    )
    expect(achados).toEqual([])
  })
})
